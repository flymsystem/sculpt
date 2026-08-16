// supabase/functions/create-staff-user/index.ts
// ─────────────────────────────────────────────────────────────────
// Edge Function — Create a staff auth account
// Called by gym owners from the Staff management page.
// Uses the service role key to create auth users + gym_users rows.
//
// Deploy: supabase functions deploy create-staff-user
// No extra env vars needed (uses built-in SUPABASE_URL + keys)
//
// ── 2026-08 HARDENING ────────────────────────────────────────────
// "Failed to send a request to the Edge Function" in the browser is
// supabase-js's FunctionsFetchError — it means the request never got a
// usable response, i.e. the CORS preflight was rejected or the function
// isn't deployed. Two things were missing and are now fixed:
//   1. Access-Control-Allow-Methods on the OPTIONS preflight. Chrome
//      requires the preflight response to list POST; without it the
//      browser blocks the real request before it is ever sent.
//   2. An explicit 200 status on the preflight response.
// Also: every failure path now returns a JSON body with `error`, and
// unexpected throws are logged with a stack so they show up in
// `supabase functions logs create-staff-user`.
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

Deno.serve(async (req) => {
  // ── CORS preflight ──────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    // ── Auth: verify the caller is a gym owner ──────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'No authorization header' }, 401);

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    // Admin client (uses service role)
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    // Verify user is an owner and get their gym_id
    const { data: ownerRow, error: ownerError } = await admin
      .from('gym_users')
      .select('role, gym_id')
      .eq('user_id', user.id)
      .eq('role', 'owner')
      .limit(1)
      .maybeSingle();

    if (ownerError) {
      console.error('[create-staff-user] owner lookup failed:', ownerError.message);
      return json({ error: 'Could not verify your account. Please try again.' }, 500);
    }
    if (!ownerRow) {
      return json({ error: 'Forbidden: only gym owners can create staff logins' }, 403);
    }

    const gymId = ownerRow.gym_id;

    // Check gym's subscription tier (staff login is Pro-only)
    const { data: gym } = await admin
      .from('gyms')
      .select('name')
      .eq('id', gymId)
      .maybeSingle();

    if (!gym) {
      return json({ error: 'Gym not found.' }, 404);
    }

    // No subscription-tier gate. This build has no plan tiers — the only
    // access control is the owner-role check above, which still applies.
    //
    // The removed gate compared gyms.subscription_tier against 'pro'. That
    // column defaults to 'core', so leaving it in place would have made
    // every staff-login creation fail with a 402 pointing at an upgrade
    // path that no longer exists.

    // ── Parse request body ──────────────────────────────────────
    let payload: any;
    try {
      payload = await req.json();
    } catch {
      return json({ error: 'Invalid request body' }, 400);
    }

    const { staffId, email, password } = payload || {};
    if (!staffId) return json({ error: 'Missing staffId' }, 400);
    if (!email || !String(email).includes('@')) {
      return json({ error: 'Valid email is required' }, 400);
    }
    if (!password || String(password).length < 6) {
      return json({ error: 'Password must be at least 6 characters' }, 400);
    }

    const cleanEmail = String(email).trim().toLowerCase();

    // Verify this staff member exists, belongs to the owner's gym,
    // and doesn't already have a login
    const { data: staffRow } = await admin
      .from('staff')
      .select('id, full_name, user_id, login_enabled, gym_id')
      .eq('id', staffId)
      .eq('gym_id', gymId)
      .eq('is_active', true)
      .maybeSingle();

    if (!staffRow) {
      return json({ error: 'Staff member not found or does not belong to your gym' }, 404);
    }
    if (staffRow.user_id && staffRow.login_enabled) {
      return json({ error: 'This staff member already has a login account' }, 409);
    }

    // ── Create the auth user ────────────────────────────────────
    const { data: newUser, error: createError } = await admin.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true, // auto-confirm email
      user_metadata: {
        gym_id: gymId,
        staff_id: staffId,
        role: 'staff',
      },
    });

    if (createError) {
      const msg = createError.message || '';
      if (msg.includes('already been registered') || msg.includes('already exists')) {
        return json({
          error: 'This email address is already in use. Please choose a different email.',
        }, 409);
      }
      console.error('[create-staff-user] createUser failed:', msg);
      return json({ error: msg || 'Failed to create user account' }, 400);
    }

    const newUserId = newUser.user.id;

    // ── Create gym_users row with role='staff' ──────────────────
    const { error: linkError } = await admin
      .from('gym_users')
      .insert({
        user_id: newUserId,
        gym_id: gymId,
        role: 'staff',
      });

    if (linkError) {
      // Rollback: delete the auth user we just created
      await admin.auth.admin.deleteUser(newUserId).catch(() => {});
      console.error('[create-staff-user] gym_users insert failed:', linkError.message);
      return json({
        error: 'Failed to link staff account: ' + (linkError.message || 'Unknown error'),
      }, 500);
    }

    // ── Update staff record with user_id ────────────────────────
    const { error: staffUpdateError } = await admin
      .from('staff')
      .update({
        user_id: newUserId,
        login_enabled: true,
      })
      .eq('id', staffId)
      .eq('gym_id', gymId);

    if (staffUpdateError) {
      console.error('[create-staff-user] Staff update failed:', staffUpdateError.message);
      // Don't rollback — the auth user and gym_users row are valid.
      // Staff record just won't show login_enabled. Can be fixed manually.
    }

    return json({
      email: cleanEmail,
      userId: newUserId,
      staffName: staffRow.full_name,
      loginFlagged: !staffUpdateError,
    }, 200);

  } catch (err: any) {
    console.error('[create-staff-user] unhandled:', err?.message, err?.stack);
    return json({ error: err?.message || 'Unexpected server error' }, 500);
  }
});
