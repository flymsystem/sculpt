// supabase/functions/create-broadcast-order/index.ts
// ─────────────────────────────────────────────────────────────────
// Creates a broadcast record + recipient rows, then creates a
// Razorpay order for payment. Returns the order details so the
// frontend can open the Razorpay checkout modal.
//
// Deploy: supabase functions deploy create-broadcast-order
// Env vars needed: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET
// ─────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  // Chrome blocks the real POST if the preflight doesn't list it. Its
  // absence is exactly the "Failed to send a request to the Edge
  // Function" bug create-staff-user documents having already hit once.
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const COST_PER_MSG_PAISE = 150; // ₹1.50 per message

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── Auth: verify the caller is a gym owner ──────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('No authorization header');

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) throw new Error('Unauthorized');

    // Service-role client for writes
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );

    // Verify user is an owner
    const { data: gymUser } = await admin
      .from('gym_users')
      .select('role, gym_id')
      .eq('user_id', user.id)
      .eq('role', 'owner')
      .limit(1)
      .single();

    if (!gymUser) throw new Error('Forbidden: not a gym owner');

    // ── Parse request ───────────────────────────────────────────
    // `member_ids` is the current shape. `recipients` is the legacy
    // shape and is accepted only for its ids — the names and phone
    // numbers in it are ignored entirely. See the resolution step below.
    const body = await req.json();
    const { gym_id, message } = body;

    const requestedIds: string[] = Array.isArray(body.member_ids)
      ? body.member_ids
      : Array.isArray(body.recipients)
        ? body.recipients.map((r: { member_id?: string }) => r?.member_id).filter(Boolean)
        : [];

    if (!gym_id || !message || requestedIds.length === 0) {
      throw new Error('Missing required fields: gym_id, message, member_ids[]');
    }

    // Validate gym ownership — role included. The check above proves the
    // caller owns *a* gym; this proves they own *this* one.
    const { data: ownerCheck } = await admin
      .from('gym_users')
      .select('gym_id')
      .eq('user_id', user.id)
      .eq('gym_id', gym_id)
      .eq('role', 'owner')
      .maybeSingle();

    if (!ownerCheck) throw new Error('Forbidden: gym_id mismatch');

    if (message.length > 4096) {
      throw new Error('Message too long (max 4096 characters)');
    }

    if (requestedIds.length > 5000) {
      throw new Error('Too many recipients (max 5000)');
    }

    // ── Resolve recipients from the DATABASE, never from the client ──
    // This used to trust the {member_id, member_name, phone} objects the
    // browser posted. Anyone with dev tools open could therefore make
    // Flym's WhatsApp Business number send arbitrary text to arbitrary
    // numbers. They'd be paying ₹1.50 each, so it isn't theft — but it is
    // OUR sender reputation, and one spam run gets the number
    // rate-limited or banned, taking broadcasts down for every paying
    // gym on the platform.
    //
    // It also means the "cancelled members are never messaged" rule is
    // now enforced server-side instead of only in the UI.
    //
    // Chunked because a 5,000-uuid `in.()` filter would blow the URL
    // length limit.
    const ID_CHUNK = 200;
    const resolved: { member_id: string; member_name: string; phone: string }[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < requestedIds.length; i += ID_CHUNK) {
      const chunk = requestedIds.slice(i, i + ID_CHUNK);
      const { data: members, error: mErr } = await admin
        .from('members')
        .select('id, full_name, phone')
        .eq('gym_id', gym_id)          // tenant scope
        .eq('is_active', true)          // not soft-deleted
        .is('cancelled_at', null)       // not cancelled
        .in('id', chunk);

      if (mErr) throw new Error('Could not load recipients: ' + mErr.message);

      for (const m of members || []) {
        if (seen.has(m.id)) continue;
        const digits = String(m.phone || '').replace(/\D/g, '');
        if (digits.length < 10) continue;   // unreachable, don't charge for it
        seen.add(m.id);
        resolved.push({
          member_id: m.id,
          member_name: m.full_name || '',
          phone: digits,
        });
      }
    }

    if (resolved.length === 0) {
      throw new Error('No valid recipients — the selected members are cancelled, removed, or have no phone number.');
    }

    const validRecipients = resolved;
    // Cost is computed from what the SERVER resolved, not what the
    // client claimed, so the owner is charged for exactly the messages
    // that will actually be attempted.
    const totalCount = validRecipients.length;
    const amountPaise = totalCount * COST_PER_MSG_PAISE;

    // ── Create broadcast record ─────────────────────────────────
    const { data: broadcast, error: bErr } = await admin
      .from('broadcasts')
      .insert({
        gym_id,
        message,
        total_recipients: totalCount,
        amount_paise: amountPaise,
        cost_per_msg_paise: COST_PER_MSG_PAISE,
        status: 'payment_pending',
      })
      .select()
      .single();

    if (bErr) throw new Error('Failed to create broadcast: ' + bErr.message);

    // ── Insert recipient rows (batch in chunks of 500) ──────────
    const recipientRows = validRecipients.map((r) => ({
      broadcast_id: broadcast.id,
      member_id: r.member_id,
      member_name: r.member_name,
      phone: r.phone,            // already digits-only from the DB resolve
      status: 'pending',
    }));

    for (let i = 0; i < recipientRows.length; i += 500) {
      const chunk = recipientRows.slice(i, i + 500);
      const { error: rErr } = await admin
        .from('broadcast_recipients')
        .insert(chunk);
      if (rErr) {
        console.error('[create-broadcast-order] recipient insert error:', rErr.message);
        // Clean up the broadcast
        await admin.from('broadcasts').delete().eq('id', broadcast.id);
        throw new Error('Failed to create recipients: ' + rErr.message);
      }
    }

    // ── Create Razorpay order ───────────────────────────────────
    const rzpKeyId = Deno.env.get('RAZORPAY_KEY_ID');
    const rzpKeySecret = Deno.env.get('RAZORPAY_KEY_SECRET');

    if (!rzpKeyId || !rzpKeySecret) {
      // Clean up
      await admin.from('broadcast_recipients').delete().eq('broadcast_id', broadcast.id);
      await admin.from('broadcasts').delete().eq('id', broadcast.id);
      throw new Error('Razorpay not configured. Contact Flym support.');
    }

    const rzpAuth = btoa(`${rzpKeyId}:${rzpKeySecret}`);
    const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${rzpAuth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: 'INR',
        receipt: `bc_${broadcast.id.slice(0, 8)}`,
        notes: {
          broadcast_id: broadcast.id,
          gym_id,
          recipient_count: String(totalCount),
        },
      }),
    });

    if (!rzpRes.ok) {
      const rzpErr = await rzpRes.text();
      console.error('[create-broadcast-order] Razorpay error:', rzpErr);
      // Clean up
      await admin.from('broadcast_recipients').delete().eq('broadcast_id', broadcast.id);
      await admin.from('broadcasts').delete().eq('id', broadcast.id);
      throw new Error('Payment gateway error. Please try again.');
    }

    const rzpOrder = await rzpRes.json();

    // Update broadcast with Razorpay order ID
    await admin
      .from('broadcasts')
      .update({ razorpay_order_id: rzpOrder.id })
      .eq('id', broadcast.id);

    // ── Return order info to frontend ───────────────────────────
    return new Response(
      JSON.stringify({
        success: true,
        broadcast_id: broadcast.id,
        razorpay_order_id: rzpOrder.id,
        razorpay_key_id: rzpKeyId,
        amount_paise: amountPaise,
        total_recipients: totalCount,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    // Everything used to come back as 400 with the raw internal message,
    // so the client couldn't tell "you selected no valid recipients"
    // from "the payment gateway is down" -- and internal error strings
    // leaked to the browser. Gateway/infrastructure faults are 5xx.
    const msg = (err as Error).message || 'Unknown error';
    const isServerFault = /Payment gateway error|Razorpay not configured|Could not load recipients|Failed to create/i.test(msg);
    console.error('[create-broadcast-order] Error:', err);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: isServerFault ? 502 : 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});