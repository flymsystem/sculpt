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
    const { gym_id, message, recipients } = await req.json();

    if (!gym_id || !message || !recipients || !Array.isArray(recipients) || recipients.length === 0) {
      throw new Error('Missing required fields: gym_id, message, recipients[]');
    }

    // Validate gym ownership
    const { data: ownerCheck } = await admin
      .from('gym_users')
      .select('gym_id')
      .eq('user_id', user.id)
      .eq('gym_id', gym_id)
      .single();

    if (!ownerCheck) throw new Error('Forbidden: gym_id mismatch');

    if (message.length > 4096) {
      throw new Error('Message too long (max 4096 characters)');
    }

    if (recipients.length > 5000) {
      throw new Error('Too many recipients (max 5000)');
    }

    // Filter valid recipients (must have phone)
    const validRecipients = recipients.filter(
      (r: { member_id: string; member_name: string; phone: string }) =>
        r.member_id && r.phone && r.phone.replace(/\D/g, '').length >= 10
    );

    if (validRecipients.length === 0) {
      throw new Error('No valid recipients (all missing phone numbers)');
    }

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
    const recipientRows = validRecipients.map(
      (r: { member_id: string; member_name: string; phone: string }) => ({
        broadcast_id: broadcast.id,
        member_id: r.member_id,
        member_name: r.member_name || '',
        phone: r.phone.replace(/\D/g, ''),
        status: 'pending',
      })
    );

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
    console.error('[create-broadcast-order] Error:', err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});