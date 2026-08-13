// supabase/functions/generate-notifications/index.ts
// ─────────────────────────────────────────────────────────────────
// Scheduled Edge Function — generates notifications for EVERY active gym
// and pushes a summary to each gym's registered devices.
//
// This is what makes notifications work when nobody has Flym open.
// The client-side sync in src/lib/notifications.js only runs while a tab
// is alive; this runs on a cron whether anyone is looking or not.
//
// Deploy:
//   supabase functions deploy generate-notifications --no-verify-jwt
//   (--no-verify-jwt because pg_cron calls it with the service-role key
//    in a plain header, not a user JWT — same reasoning as whatsapp-webhook.)
//
// Schedule: see migration 032. Runs daily at 09:00 IST (03:30 UTC).
//
// Secrets required:
//   CRON_SECRET        — shared secret, checked below (see migration 032)
//   VAPID_*            — already set for send-push
//
// ── DEDUPE KEYS MUST MATCH THE CLIENT ────────────────────────────
// src/lib/notifications.js builds the same keys. If they drift, a member
// gets notified twice — once by the cron, once when the owner opens the
// app. Keep these two files in sync:
//     expired:<memberId>:<expiry_date>
//     expiring:<memberId>:<expiry_date>
//     due:<memberId>:<YYYY-MM-DD>
//     bday:<memberId>:<YYYY-MM-DD>
//     enquiry:<enquiryId>
// ─────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

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

/** YYYY-MM-DD in IST — gyms are Indian, "today" must mean their today. */
function istToday(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  return ist.toISOString().split('T')[0];
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + 'T00:00:00Z').getTime();
  const b = new Date(toISO + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}

interface NotifRow {
  gym_id: string;
  type: string;
  title: string;
  body: string | null;
  link_section: string;
  ref_id: string | null;
  dedupe_key: string;
  severity: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  // ── Auth: shared secret, not a user JWT ─────────────────────
  const expected = Deno.env.get('CRON_SECRET');
  const provided = req.headers.get('x-cron-secret');
  if (!expected) return json({ error: 'CRON_SECRET not configured' }, 500);
  if (provided !== expected) return json({ error: 'Unauthorized' }, 401);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const today = istToday();
  const mmdd = today.slice(5, 10);

  const result = {
    gyms: 0,
    notificationsCreated: 0,
    pushSent: 0,
    pushFailed: 0,
    errors: [] as string[],
  };

  try {
    // ── Every active gym ────────────────────────────────────
    const { data: gyms, error: gymsError } = await admin
      .from('gyms')
      .select('id, name, reminder_days, is_active')
      .eq('is_active', true);

    if (gymsError) return json({ error: gymsError.message }, 500);
    if (!gyms?.length) return json(result);

    // VAPID is optional — without it we still create notifications
    // (the bell will show them), we just can't push. Mirrors the
    // test-mode behaviour of process-broadcast.
    const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY');
    const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY');
    const canPush = !!(VAPID_PUBLIC && VAPID_PRIVATE);
    if (canPush) {
      webpush.setVapidDetails(
        Deno.env.get('VAPID_SUBJECT') || 'mailto:flym.system@gmail.com',
        VAPID_PUBLIC!, VAPID_PRIVATE!,
      );
    }

    for (const gym of gyms) {
      result.gyms++;
      const reminderDays = Number(gym.reminder_days) || 7;
      const rows: NotifRow[] = [];

      try {
        // ── Members ───────────────────────────────────────
        // cancelled_at IS NULL — cancelled members are never chased,
        // same rule as Finance, Broadcast and the client sync.
        const { data: members } = await admin
          .from('members')
          .select('id, full_name, expiry_date, payment_status, balance_due, plan_price, plan_name, date_of_birth, cancelled_at, is_active')
          .eq('gym_id', gym.id)
          .eq('is_active', true)
          .is('cancelled_at', null);

        (members || []).forEach((m: any) => {
          const name = m.full_name || 'Member';

          // Expiry — time axis
          if (m.expiry_date) {
            const exp = String(m.expiry_date).slice(0, 10);
            const days = daysBetween(today, exp);

            if (days < 0 && days >= -30) {
              rows.push({
                gym_id: gym.id,
                type: 'expired',
                severity: 'critical',
                title: `${name} — membership expired`,
                body: `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago. Tap to renew.`,
                link_section: 'alerts',
                ref_id: m.id,
                dedupe_key: `expired:${m.id}:${exp}`,
              });
            } else if (days >= 0 && days <= reminderDays) {
              rows.push({
                gym_id: gym.id,
                type: 'expiring',
                severity: 'warning',
                title: `${name} — expiring ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}`,
                body: `${m.plan_name || 'Membership'} ends on ${exp}.`,
                link_section: 'alerts',
                ref_id: m.id,
                dedupe_key: `expiring:${m.id}:${exp}`,
              });
            }
          }

          // Payment — money axis, independent of expiry
          if (m.payment_status === 'Due' || m.payment_status === 'Partial') {
            const bal = m.balance_due != null
              ? Number(m.balance_due)
              : Number(m.plan_price) || 0;
            if (bal > 0) {
              rows.push({
                gym_id: gym.id,
                type: 'payment_due',
                severity: 'warning',
                title: `${name} — ₹${bal.toLocaleString('en-IN')} pending`,
                body: m.payment_status === 'Partial'
                  ? 'Partial payment received. Balance still outstanding.'
                  : 'No payment collected yet.',
                link_section: 'alerts',
                ref_id: m.id,
                dedupe_key: `due:${m.id}:${today}`,
              });
            }
          }

          // Birthday
          if (m.date_of_birth && String(m.date_of_birth).slice(5, 10) === mmdd) {
            rows.push({
              gym_id: gym.id,
              type: 'birthday',
              severity: 'info',
              title: `🎂 ${name} has a birthday today`,
              body: 'Send them a quick wish on WhatsApp.',
              link_section: 'members',
              ref_id: m.id,
              dedupe_key: `bday:${m.id}:${today}`,
            });
          }
        });

        // ── Enquiries not followed up ─────────────────────
        const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
        const { data: enquiries } = await admin
          .from('enquiries')
          .select('id, name, source, created_at')
          .eq('gym_id', gym.id)
          .eq('is_active', true)
          .eq('status', 'New')
          .gte('created_at', weekAgo);

        (enquiries || []).forEach((e: any) => {
          rows.push({
            gym_id: gym.id,
            type: 'enquiry',
            severity: 'info',
            title: `New enquiry — ${e.name || 'Walk-in'}`,
            body: `Source: ${e.source || 'Walk-in'}. Not followed up yet.`,
            link_section: 'enquiries',
            ref_id: e.id,
            dedupe_key: `enquiry:${e.id}`,
          });
        });

        if (!rows.length) continue;

        // ── Insert, skipping anything already generated ───
        const { data: created, error: insertError } = await admin
          .from('notifications')
          .upsert(rows, { onConflict: 'gym_id,dedupe_key', ignoreDuplicates: true })
          .select();

        if (insertError) {
          result.errors.push(`${gym.name}: ${insertError.message}`);
          continue;
        }
        if (!created?.length) continue;
        result.notificationsCreated += created.length;

        // ── One summary push per gym ──────────────────────
        if (!canPush) continue;

        const { data: subs } = await admin
          .from('push_subscriptions')
          .select('id, endpoint, p256dh, auth_key')
          .eq('gym_id', gym.id)
          .eq('is_active', true);

        if (!subs?.length) continue;

        const title = created.length === 1
          ? created[0].title
          : `${created.length} things need your attention`;
        const body = created.length === 1
          ? (created[0].body || '')
          : created.slice(0, 3).map((n: any) => n.title).join(' · ');

        const payload = JSON.stringify({
          title: String(title).slice(0, 120),
          body: String(body).slice(0, 240),
          section: 'alerts',
          tag: 'flym-daily',
          ts: Date.now(),
        });

        const dead: string[] = [];
        await Promise.all(subs.map(async (s: any) => {
          try {
            await webpush.sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } },
              payload,
              { TTL: 21600, urgency: 'normal' },
            );
            result.pushSent++;
          } catch (err: any) {
            result.pushFailed++;
            if (err?.statusCode === 404 || err?.statusCode === 410) dead.push(s.id);
          }
        }));

        if (dead.length) {
          await admin.from('push_subscriptions')
            .update({ is_active: false }).in('id', dead);
        }

      } catch (gymErr: any) {
        result.errors.push(`${gym.name}: ${gymErr?.message}`);
      }
    }

    // Housekeeping — keep the table from growing forever
    await admin.rpc('prune_old_notifications').catch(() => {});

    console.log('[generate-notifications]', JSON.stringify(result));
    return json(result);

  } catch (err: any) {
    console.error('[generate-notifications] fatal:', err?.message, err?.stack);
    return json({ error: err?.message || 'Unknown error', partial: result }, 500);
  }
});
