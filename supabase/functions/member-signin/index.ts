// supabase/functions/member-signin/index.ts
// ─────────────────────────────────────────────────────────────────
// Edge Function — Member login: application number + phone number,
// nothing else. There is no PIN, password or OTP, so this endpoint IS
// the entire security boundary for a member account — see the delta
// spec at docs/superpowers/specs/2026-08-21-checkin-portal-design.md.
//
// Deploy: supabase functions deploy member-signin
// No extra env vars needed (uses built-in SUPABASE_URL + keys).
//
// FOUR RULES THAT MUST NOT DRIFT:
//
// 1. Members have no email. The auth user gets a synthetic address
//    derived from the member's own (immutable) UUID, never from the
//    application number — that can be regenerated, and re-deriving
//    the email from it would orphan the auth account. The member
//    never sees this address.
//
// 2. NO EMAIL IS EVER SENT. admin.createUser() runs with
//    email_confirm: true so nothing needs confirming, and the session
//    is minted with admin.generateLink() + verifyOtp() — generateLink
//    only returns link data, it never dispatches mail. Only
//    inviteUserByEmail / resetPasswordForEmail / signInWithOtp send
//    mail in supabase-js, and none of those are called here. These
//    synthetic addresses don't exist and would bounce.
//
// 3. Wrong application number and wrong phone number return the
//    IDENTICAL error, on the identical code path, with the identical
//    attempt-log write. If they ever diverge, the response becomes an
//    oracle an attacker can use to enumerate valid application
//    numbers against a leaked/guessed phone number.
//
// 4. Rate limited by IP AND by application number (member_login_attempts,
//    migration 104) — checked BEFORE the member lookup runs, so a
//    throttled caller never even reaches the point where a real vs.
//    fake application number would take a different code path.
// ─────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const GENERIC_ERROR = 'Application number or phone number not recognised.';
const MAX_FAILED_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;

const normalizePhone = (p: string) => (p || '').replace(/\D/g, '').slice(-10);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    let payload: any;
    try {
      payload = await req.json();
    } catch {
      return json({ error: 'Invalid request body' }, 400);
    }

    // gymCode used to be required and matched against `gyms.gym_code` —
    // client-supplied, and it silently drifted from the live DB value on
    // 2026-08-27 (src/lib/member-auth.js hardcoded 'SCULPT01' against a
    // live 'DSCULPT' row), failing EVERY member login at this exact
    // lookup step for as long as the two disagreed, with the client only
    // ever shown the generic "phone number not recognised" error. Fixing
    // the constant fixes the instance; this fixes the class — CLAUDE.md
    // is explicit that there is exactly one gym, so this function now
    // resolves it directly and no longer trusts (or even reads) anything
    // the client claims the gym code is. If this ever becomes a real
    // multi-gym product, gymCode needs to come back — as a value looked
    // up server-side from the calling origin/tenant, not a client-typed
    // string with no way to verify it against the DB except by hand.
    const rawAppNum = String(payload?.applicationNumber || '').trim().toUpperCase();
    const rawPhone = String(payload?.phone || '').trim();

    if (!rawAppNum || !rawPhone) {
      console.error('[member-signin] MISSING_FIELDS');
      return json({ error: GENERIC_ERROR }, 400);
    }

    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('cf-connecting-ip') ||
      'unknown';

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    // ── Rate limit — before any lookup that could differ by outcome ──
    const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
    const [{ count: ipFails }, { count: appFails }] = await Promise.all([
      admin.from('member_login_attempts').select('id', { count: 'exact', head: true })
        .eq('ip', ip).eq('succeeded', false).gte('created_at', since),
      admin.from('member_login_attempts').select('id', { count: 'exact', head: true })
        .eq('application_number', rawAppNum).eq('succeeded', false).gte('created_at', since),
    ]);

    if ((ipFails || 0) >= MAX_FAILED_ATTEMPTS || (appFails || 0) >= MAX_FAILED_ATTEMPTS) {
      console.error('[member-signin] RATE_LIMITED', { ip, applicationNumber: rawAppNum });
      return json({ error: 'Too many attempts. Please try again in a few minutes.' }, 429);
    }

    // reason is server-only diagnostics (migration 130) — never reflected
    // in the client response, so it can't become an enumeration oracle.
    const logAttempt = (gymId: string | null, succeeded: boolean, reason: string | null) =>
      admin.from('member_login_attempts')
        .insert({ gym_id: gymId, application_number: rawAppNum, ip, succeeded, reject_reason: reason })
        .then(() => {}, () => {}); // logging must never throw past this point

    // ── Resolve the (single) gym, then member — same rejection path
    // either way. Not filtered by any client-supplied code — see the
    // comment above where gymCode used to be read.
    const { data: gym } = await admin
      .from('gyms').select('id').eq('is_active', true).limit(1).maybeSingle();

    if (!gym) {
      console.error('[member-signin] NO_GYM');
      await logAttempt(null, false, 'NO_GYM');
      return json({ error: GENERIC_ERROR }, 400);
    }

    const { data: member } = await admin
      .from('members')
      .select('id, phone, user_id')
      .eq('gym_id', gym.id)
      .eq('application_number', rawAppNum)
      .eq('is_active', true)
      .eq('login_enabled', true)
      .maybeSingle();

    const phoneOk = !!member && normalizePhone(member.phone) === normalizePhone(rawPhone) && normalizePhone(rawPhone).length === 10;

    if (!member || !phoneOk) {
      const reason = !member ? 'NO_MEMBER' : 'PHONE_MISMATCH';
      console.error(`[member-signin] ${reason}`, { gymId: gym.id, applicationNumber: rawAppNum });
      await logAttempt(gym.id, false, reason);
      return json({ error: GENERIC_ERROR }, 400);
    }

    // ── Find or create the auth user ──
    // Synthetic, never shown to the member, never used to log in
    // directly (there is no password flow for it — only this function
    // ever mints a session for it, via generateLink below).
    const email = `member-${member.id}@members.internal`;
    let userId = member.user_id as string | null;

    if (!userId) {
      const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
        email,
        password: crypto.randomUUID() + crypto.randomUUID(),
        email_confirm: true,
        user_metadata: { member_id: member.id, gym_id: gym.id, role: 'member' },
      });
      if (createErr || !newUser?.user) {
        console.error('[member-signin] createUser failed:', createErr?.message);
        return json({ error: 'Could not sign you in. Please try again.' }, 500);
      }
      userId = newUser.user.id;

      const { error: linkUpdateErr } = await admin
        .from('members').update({ user_id: userId }).eq('id', member.id);
      if (linkUpdateErr) {
        console.error('[member-signin] linking user_id failed:', linkUpdateErr.message);
        await admin.auth.admin.deleteUser(userId).catch(() => {});
        return json({ error: 'Could not sign you in. Please try again.' }, 500);
      }
    }

    // ── Mint a session without sending mail ──
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    const tokenHash = linkData?.properties?.hashed_token;
    if (linkErr || !tokenHash) {
      console.error('[member-signin] generateLink failed:', linkErr?.message);
      return json({ error: 'Could not sign you in. Please try again.' }, 500);
    }

    // Redeemed on the anon client, not the admin one — this is what
    // actually turns the token into a normal user session rather than
    // an admin-scoped one.
    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { auth: { persistSession: false } },
    );
    const { data: verifyData, error: verifyErr } = await anonClient.auth.verifyOtp({
      type: 'magiclink',
      token_hash: tokenHash,
    });

    if (verifyErr || !verifyData?.session) {
      console.error('[member-signin] verifyOtp failed:', verifyErr?.message);
      return json({ error: 'Could not sign you in. Please try again.' }, 500);
    }

    await logAttempt(gym.id, true, null);

    return json({
      access_token: verifyData.session.access_token,
      refresh_token: verifyData.session.refresh_token,
    }, 200);

  } catch (err: any) {
    console.error('[member-signin] unhandled:', err?.message, err?.stack);
    return json({ error: 'Unexpected server error' }, 500);
  }
});
