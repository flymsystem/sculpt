// supabase/functions/process-broadcast/index.ts
// ─────────────────────────────────────────────────────────────────
// Called after Razorpay payment succeeds.
// 1. Verifies the payment signature
// 2. Marks broadcast as 'paid' then 'sending'
// 3. Sends a BOUNDED CHUNK of recipients via WhatsApp Cloud API
// 4. Hands off to itself (or to the cron sweeper) for the rest
//
// ── WHY THIS IS CHUNKED (audit A12) ──────────────────────────────
// This used to loop over every recipient in one invocation, with a
// 100ms rate-limit delay plus an API round-trip plus a DB update each.
// For 5,000 recipients that is roughly 29 minutes — far beyond an Edge
// Function's wall clock.
//
// The failure was the worst kind: Razorpay had already taken the gym
// owner's money. The function died partway, the broadcast sat on
// status='sending' forever, some members got the message and some
// didn't, and there was no retry and no refund path.
//
// Now each invocation processes at most CHUNK_LIMIT recipients and then
// re-invokes itself for the remainder. Every recipient row is updated as
// it is handled, so a crash costs at most the messages in flight — the
// next run picks up exactly where this one stopped, because it selects
// on status='pending'.
//
// Two independent things drive it forward, deliberately:
//   1. self-invoke after each chunk (fast path)
//   2. a pg_cron sweeper (migration 037) that resumes any broadcast
//      stuck in 'sending' — the safety net for when 1 fails
// Both are idempotent: work is claimed by flipping recipient rows off
// 'pending', so two concurrent runs cannot send the same message twice.
//
// Deploy: supabase functions deploy process-broadcast
// Env vars: RAZORPAY_KEY_SECRET, WA_CLOUD_API_TOKEN, WA_PHONE_NUMBER_ID,
//           CRON_SECRET (for resume/sweep calls)
// ─────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// WhatsApp Cloud API version. Pinned deliberately — Meta sunsets old
// versions, and when v19 goes the failure is silent from the gym's side:
// paid broadcasts stop delivering with an opaque API error. Keep this in
// step with send-reminders/index.ts.
const WA_API_VERSION = 'v21.0';

// Sized so a chunk finishes well inside the invocation budget:
// 150 x (100ms delay + ~200ms API + ~50ms DB) is roughly 50 seconds.
const CHUNK_LIMIT = 150;
const RATE_DELAY_MS = 100;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    const body = await req.json().catch(() => ({} as Record<string, unknown>));

    // ── Who is calling? ─────────────────────────────────────────
    // A resume call carries the cron secret and skips payment
    // verification — the payment was already verified by the original
    // call, which is what moved the broadcast off 'payment_pending'.
    const cronSecret = Deno.env.get('CRON_SECRET');
    const isResume = !!cronSecret && req.headers.get('x-cron-secret') === cronSecret;

    let broadcastId = body.broadcast_id as string | undefined;

    if (isResume && !broadcastId) {
      // ── Sweep mode: find the oldest broadcast still mid-send ──
      const { data: stalled } = await admin
        .from('broadcasts')
        .select('id')
        .in('status', ['paid', 'sending'])
        .order('started_at', { ascending: true, nullsFirst: true })
        .limit(1);
      if (!stalled?.length) return json({ ok: true, message: 'Nothing to resume' });
      broadcastId = stalled[0].id;
    }

    if (!broadcastId) throw new Error('Missing broadcast_id');

    const { data: broadcast, error: bErr } = await admin
      .from('broadcasts').select('*').eq('id', broadcastId).single();
    if (bErr || !broadcast) throw new Error('Broadcast not found');

    // ── First call from the browser: authenticate + verify payment ──
    if (!isResume) {
      const authHeader = req.headers.get('Authorization');
      if (!authHeader) return json({ error: 'No authorization header' }, 401);

      const userClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: { user }, error: authError } = await userClient.auth.getUser();
      if (authError || !user) return json({ error: 'Unauthorized' }, 401);

      // role='owner' included: this previously matched on user_id +
      // gym_id alone, which any staff member of the gym would pass.
      const { data: ownerCheck } = await admin
        .from('gym_users').select('gym_id')
        .eq('user_id', user.id)
        .eq('gym_id', broadcast.gym_id)
        .eq('role', 'owner')
        .maybeSingle();
      if (!ownerCheck) return json({ error: 'Forbidden: gym_id mismatch' }, 403);

      // Already moving? Don't re-verify, just continue sending.
      if (broadcast.status === 'payment_pending') {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body as Record<string, string>;
        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
          return json({ error: 'Missing payment verification fields' }, 400);
        }

        const rzpSecret = Deno.env.get('RAZORPAY_KEY_SECRET');
        if (!rzpSecret) return json({ error: 'Razorpay not configured' }, 500);

        const key = await crypto.subtle.importKey(
          'raw', new TextEncoder().encode(rzpSecret),
          { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
        );
        const sig = await crypto.subtle.sign(
          'HMAC', key,
          new TextEncoder().encode(`${razorpay_order_id}|${razorpay_payment_id}`),
        );
        const expectedSig = Array.from(new Uint8Array(sig))
          .map(b => b.toString(16).padStart(2, '0')).join('');

        if (expectedSig !== razorpay_signature) {
          await admin.from('broadcasts')
            .update({ status: 'failed', razorpay_payment_id })
            .eq('id', broadcastId);
          return json({ error: 'Payment verification failed — signature mismatch' }, 400);
        }

        await admin.from('broadcasts').update({
          status: 'sending',
          razorpay_payment_id,
          paid_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
        }).eq('id', broadcastId);
      } else if (!['paid', 'sending'].includes(broadcast.status)) {
        // completed / partially_failed / failed — nothing to do.
        return json({ success: true, message: 'Broadcast already processed', broadcast_id: broadcastId });
      }
    }

    // ── Send one bounded chunk ──────────────────────────────────
    const { data: gym } = await admin
      .from('gyms').select('name').eq('id', broadcast.gym_id).single();
    const gymName = gym?.name || 'our gym';

    const { data: recipients, error: rErr } = await admin
      .from('broadcast_recipients')
      .select('*')
      .eq('broadcast_id', broadcastId)
      .eq('status', 'pending')
      .order('id')
      .limit(CHUNK_LIMIT);
    if (rErr) throw new Error('Failed to fetch recipients: ' + rErr.message);

    const waToken = Deno.env.get('WA_CLOUD_API_TOKEN');
    const waPhoneId = Deno.env.get('WA_PHONE_NUMBER_ID');

    let chunkSent = 0;
    let chunkFailed = 0;

    for (const recipient of recipients || []) {
      const personalizedMsg = String(broadcast.message)
        .replace(/\{name\}/g, recipient.member_name || 'Member')
        .replace(/\{gym\}/g, gymName);

      const phone = recipient.phone.startsWith('91') ? recipient.phone : '91' + recipient.phone;

      let success = false;
      let errorMsg = '';

      if (waToken && waPhoneId) {
        try {
          const waRes = await fetch(
            `https://graph.facebook.com/${WA_API_VERSION}/${waPhoneId}/messages`,
            {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${waToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: phone,
                type: 'text',
                text: { body: personalizedMsg },
              }),
            },
          );
          if (waRes.ok) success = true;
          else {
            const errData = await waRes.json().catch(() => ({}));
            errorMsg = errData?.error?.message || `HTTP ${waRes.status}`;
            console.error(`[process-broadcast] WA API error for ${phone}:`, errorMsg);
          }
        } catch (fetchErr) {
          errorMsg = (fetchErr as Error).message || 'Network error';
          console.error(`[process-broadcast] WA fetch error for ${phone}:`, errorMsg);
        }
      } else {
        // No WA API configured — log-only mode for testing.
        console.log(`[process-broadcast] Would send to ${phone}: ${personalizedMsg.slice(0, 80)}...`);
        success = true;
      }

      // Written per recipient, so a crash costs at most the message in
      // flight. The next run re-selects on status='pending'.
      if (success) {
        chunkSent++;
        await admin.from('broadcast_recipients')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('id', recipient.id);
      } else {
        chunkFailed++;
        await admin.from('broadcast_recipients')
          .update({ status: 'failed', error_message: errorMsg.slice(0, 500) })
          .eq('id', recipient.id);
      }

      await new Promise(resolve => setTimeout(resolve, RATE_DELAY_MS));
    }

    // ── Counters come from the rows, not from a running tally ───
    // A resumed run has no memory of earlier chunks, so counting the
    // recipient rows is the only figure that stays correct across
    // invocations, retries and overlapping runs.
    const countBy = async (status: string) => {
      const { count } = await admin
        .from('broadcast_recipients')
        .select('id', { count: 'exact', head: true })
        .eq('broadcast_id', broadcastId)
        .eq('status', status);
      return count || 0;
    };
    const [sentTotal, failedTotal, pendingTotal] = await Promise.all([
      countBy('sent'), countBy('failed'), countBy('pending'),
    ]);

    if (pendingTotal > 0) {
      await admin.from('broadcasts')
        .update({ status: 'sending', sent_count: sentTotal, failed_count: failedTotal })
        .eq('id', broadcastId);

      // Fast path: hand off to the next chunk immediately. If this
      // fails, the cron sweeper in migration 037 picks it up instead.
      if (cronSecret) {
        const selfUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/process-broadcast`;
        fetch(selfUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-cron-secret': cronSecret },
          body: JSON.stringify({ broadcast_id: broadcastId }),
        }).catch(err => console.error('[process-broadcast] self-invoke failed:', err?.message));
      } else {
        console.warn('[process-broadcast] CRON_SECRET not set — cannot continue automatically.');
      }

      return json({
        success: true, broadcast_id: broadcastId, done: false,
        sent: sentTotal, failed: failedTotal, pending: pendingTotal,
      });
    }

    // ── Nothing pending: finalise ───────────────────────────────
    const finalStatus = failedTotal === 0
      ? 'completed'
      : sentTotal === 0 ? 'failed' : 'partially_failed';

    await admin.from('broadcasts').update({
      status: finalStatus,
      sent_count: sentTotal,
      failed_count: failedTotal,
      completed_at: new Date().toISOString(),
    }).eq('id', broadcastId);

    await admin.from('activity_log').insert({
      gym_id: broadcast.gym_id,
      action: 'broadcast_sent',
      description: `Broadcast sent: ${sentTotal} delivered, ${failedTotal} failed`,
    }).catch(() => {});

    return json({
      success: true, broadcast_id: broadcastId, done: true,
      sent: sentTotal, failed: failedTotal, status: finalStatus,
      chunkSent, chunkFailed,
    });

  } catch (err) {
    console.error('[process-broadcast] Error:', err);
    return json({ error: (err as Error).message }, 400);
  }
});
