// supabase/functions/send-push/index.ts
// ─────────────────────────────────────────────────────────────────
// Edge Function — deliver a Web Push notification to every registered
// device for a gym.
//
// Deploy:
//   supabase functions deploy send-push
//
// Secrets required:
//   supabase secrets set VAPID_PUBLIC_KEY=...  VAPID_PRIVATE_KEY=...  VAPID_SUBJECT=mailto:[PLACEHOLDER-EMAIL]
//
// Generate the VAPID pair once with:
//   npx web-push generate-vapid-keys
// Public key ALSO goes into the frontend as VITE_VAPID_PUBLIC_KEY.
// The private key must NEVER reach the browser.
//
// Body: { gymId, title, body?, section?, tag?, userId? }
//   userId  — optional, target one user's devices only
//   section — dashboard section to open on tap (e.g. 'alerts')
//
// Dead endpoints (410 Gone / 404) are deactivated automatically so the
// subscription table doesn't rot.
// ─────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY');
    const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY');
    const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:[PLACEHOLDER-EMAIL]';

    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      // Test mode — mirrors how process-broadcast behaves without WA creds.
      console.warn('[send-push] VAPID keys not set — running in test mode, no push sent.');
      return json({ sent: 0, failed: 0, testMode: true });
    }

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

    // ── Verify the caller ───────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'No authorization header' }, 401);

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    const { gymId, title, body, section, tag, userId } = await req.json();
    if (!gymId) return json({ error: 'Missing gymId' }, 400);
    if (!title) return json({ error: 'Missing title' }, 400);

    // Caller must belong to this gym (defence in depth on top of RLS).
    const { data: membership } = await admin
      .from('gym_users')
      .select('role')
      .eq('user_id', user.id)
      .eq('gym_id', gymId)
      .limit(1)
      .maybeSingle();

    if (!membership) return json({ error: 'Forbidden: not a member of this gym' }, 403);

    // ── Collect target devices ──────────────────────────────────
    let q = admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth_key')
      .eq('gym_id', gymId)
      .eq('is_active', true);

    if (userId) q = q.eq('user_id', userId);

    const { data: subs, error: subsError } = await q;
    if (subsError) return json({ error: subsError.message }, 500);
    if (!subs || subs.length === 0) return json({ sent: 0, failed: 0 });

    const payload = JSON.stringify({
      title: String(title).slice(0, 120),
      body: String(body || '').slice(0, 240),
      section: section || '',
      tag: tag || 'sculpt-notification',
      ts: Date.now(),
    });

    // ── Send ────────────────────────────────────────────────────
    let sent = 0;
    let failed = 0;
    const deadIds: string[] = [];

    // Small concurrency cap so we don't hammer the push services.
    const CHUNK = 20;
    for (let i = 0; i < subs.length; i += CHUNK) {
      const slice = subs.slice(i, i + CHUNK);
      await Promise.all(slice.map(async (s) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: s.endpoint,
              keys: { p256dh: s.p256dh, auth: s.auth_key },
            },
            payload,
            { TTL: 3600, urgency: 'normal' },
          );
          sent++;
        } catch (err: any) {
          failed++;
          const code = err?.statusCode;
          if (code === 404 || code === 410) {
            deadIds.push(s.id);
          } else {
            console.warn('[send-push] failed:', code, err?.body || err?.message);
          }
        }
      }));
    }

    if (deadIds.length) {
      await admin
        .from('push_subscriptions')
        .update({ is_active: false })
        .in('id', deadIds);
    }

    if (sent > 0) {
      await admin
        .from('push_subscriptions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('gym_id', gymId)
        .eq('is_active', true);
    }

    return json({ sent, failed, pruned: deadIds.length });

  } catch (err: any) {
    console.error('[send-push] error:', err?.message);
    return json({ error: err?.message || 'Unknown error' }, 400);
  }
});
