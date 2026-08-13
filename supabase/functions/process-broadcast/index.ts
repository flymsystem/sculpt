// supabase/functions/process-broadcast/index.ts
// ─────────────────────────────────────────────────────────────────
// Called after Razorpay payment succeeds.
// 1. Verifies the payment signature
// 2. Marks broadcast as 'paid' then 'sending'
// 3. Loops through recipients, calls WhatsApp Cloud API
// 4. Updates per-recipient status + broadcast counters
//
// Deploy: supabase functions deploy process-broadcast
// Env vars: RAZORPAY_KEY_SECRET, WA_CLOUD_API_TOKEN, WA_PHONE_NUMBER_ID
// ─────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// WhatsApp Cloud API version. Pinned deliberately — Meta sunsets old
// versions, and when v19 goes the failure is silent from the gym's side:
// paid broadcasts stop delivering with an opaque API error. Keep this in
// step with send-reminders/index.ts.
const WA_API_VERSION = 'v21.0';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── Auth ─────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('No authorization header');

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) throw new Error('Unauthorized');

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );

    // ── Parse request ───────────────────────────────────────────
    const {
      broadcast_id,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = await req.json();

    if (!broadcast_id || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      throw new Error('Missing payment verification fields');
    }

    // ── Verify Razorpay signature ───────────────────────────────
    const rzpSecret = Deno.env.get('RAZORPAY_KEY_SECRET');
    if (!rzpSecret) throw new Error('Razorpay not configured');

    const expectedBody = `${razorpay_order_id}|${razorpay_payment_id}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(rzpSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(expectedBody)
    );
    const expectedSig = Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    if (expectedSig !== razorpay_signature) {
      // Payment verification failed — do NOT send messages
      await admin.from('broadcasts').update({
        status: 'failed',
        razorpay_payment_id,
      }).eq('id', broadcast_id);
      throw new Error('Payment verification failed — signature mismatch');
    }

    // ── Fetch broadcast and verify ownership ────────────────────
    const { data: broadcast, error: bErr } = await admin
      .from('broadcasts')
      .select('*')
      .eq('id', broadcast_id)
      .single();

    if (bErr || !broadcast) throw new Error('Broadcast not found');

    // Verify the user owns this gym
    const { data: ownerCheck } = await admin
      .from('gym_users')
      .select('gym_id')
      .eq('user_id', user.id)
      .eq('gym_id', broadcast.gym_id)
      .single();

    if (!ownerCheck) throw new Error('Forbidden: gym_id mismatch');

    // Prevent double-processing
    if (broadcast.status !== 'payment_pending') {
      return new Response(
        JSON.stringify({ success: true, message: 'Broadcast already processed', broadcast_id }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Mark as paid ────────────────────────────────────────────
    await admin.from('broadcasts').update({
      status: 'paid',
      razorpay_payment_id,
      paid_at: new Date().toISOString(),
    }).eq('id', broadcast_id);

    // ── Start sending ───────────────────────────────────────────
    await admin.from('broadcasts').update({
      status: 'sending',
      started_at: new Date().toISOString(),
    }).eq('id', broadcast_id);

    // Fetch gym name for message personalization
    const { data: gym } = await admin
      .from('gyms')
      .select('name')
      .eq('id', broadcast.gym_id)
      .single();

    const gymName = gym?.name || 'our gym';

    // Fetch all pending recipients
    const { data: recipients, error: rErr } = await admin
      .from('broadcast_recipients')
      .select('*')
      .eq('broadcast_id', broadcast_id)
      .eq('status', 'pending')
      .order('id');

    if (rErr) throw new Error('Failed to fetch recipients: ' + rErr.message);
    if (!recipients || recipients.length === 0) {
      await admin.from('broadcasts').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      }).eq('id', broadcast_id);
      return new Response(
        JSON.stringify({ success: true, sent: 0, failed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── WhatsApp Cloud API config ───────────────────────────────
    const waToken = Deno.env.get('WA_CLOUD_API_TOKEN');
    const waPhoneId = Deno.env.get('WA_PHONE_NUMBER_ID');

    let sentCount = 0;
    let failedCount = 0;

    for (const recipient of recipients) {
      // Personalize message: replace {name} with member name
      const personalizedMsg = broadcast.message
        .replace(/\{name\}/g, recipient.member_name || 'Member')
        .replace(/\{gym\}/g, gymName);

      const phone = recipient.phone.startsWith('91')
        ? recipient.phone
        : '91' + recipient.phone;

      let success = false;
      let errorMsg = '';

      if (waToken && waPhoneId) {
        // ── Send via WhatsApp Cloud API ─────────────────────────
        try {
          const waRes = await fetch(
            `https://graph.facebook.com/${WA_API_VERSION}/${waPhoneId}/messages`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${waToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: phone,
                type: 'text',
                text: { body: personalizedMsg },
              }),
            }
          );

          if (waRes.ok) {
            success = true;
          } else {
            const errData = await waRes.json().catch(() => ({}));
            errorMsg = errData?.error?.message || `HTTP ${waRes.status}`;
            console.error(`[process-broadcast] WA API error for ${phone}:`, errorMsg);
          }
        } catch (fetchErr) {
          errorMsg = (fetchErr as Error).message || 'Network error';
          console.error(`[process-broadcast] WA fetch error for ${phone}:`, errorMsg);
        }
      } else {
        // No WA API configured — log-only mode for testing
        console.log(`[process-broadcast] Would send to ${phone}: ${personalizedMsg.slice(0, 80)}...`);
        success = true; // Mark as sent in test mode
        errorMsg = '';
      }

      // Update recipient status
      if (success) {
        sentCount++;
        await admin.from('broadcast_recipients').update({
          status: 'sent',
          sent_at: new Date().toISOString(),
        }).eq('id', recipient.id);
      } else {
        failedCount++;
        await admin.from('broadcast_recipients').update({
          status: 'failed',
          error_message: errorMsg.slice(0, 500),
        }).eq('id', recipient.id);
      }

      // Update broadcast counters every 25 messages
      if ((sentCount + failedCount) % 25 === 0) {
        await admin.from('broadcasts').update({
          sent_count: sentCount,
          failed_count: failedCount,
        }).eq('id', broadcast_id);
      }

      // Rate limiting: ~10 messages/second to stay well within Meta limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // ── Final update ────────────────────────────────────────────
    const finalStatus = failedCount === 0
      ? 'completed'
      : sentCount === 0
        ? 'failed'
        : 'partially_failed';

    await admin.from('broadcasts').update({
      status: finalStatus,
      sent_count: sentCount,
      failed_count: failedCount,
      completed_at: new Date().toISOString(),
    }).eq('id', broadcast_id);

    // Log activity
    await admin.from('activity_log').insert({
      gym_id: broadcast.gym_id,
      action: 'broadcast_sent',
      description: `Broadcast sent: ${sentCount} delivered, ${failedCount} failed`,
    }).catch(() => {});

    return new Response(
      JSON.stringify({
        success: true,
        broadcast_id,
        sent: sentCount,
        failed: failedCount,
        status: finalStatus,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[process-broadcast] Error:', err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
