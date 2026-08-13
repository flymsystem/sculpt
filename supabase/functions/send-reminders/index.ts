// supabase/functions/send-reminders/index.ts
// ─────────────────────────────────────────────────────────────────
// Runs daily at 9 AM IST via cron.
// For each gym:
//   1. Reads reminder_days and wa_template from gyms table
//   2. Finds members expiring in exactly reminder_days from today,
//      excluding Trial, deleted (is_active=false) and CANCELLED members
//   3. Skips members who already got a reminder today
//   4. Sends via WhatsApp Cloud API
//   5. Marks last_reminder_sent = today — but ONLY if a message
//      actually went out (see the 'simulated' outcome below)
//
// AUTH: shared secret in the x-cron-secret header, same as
// generate-notifications. This is called by cron, not by a user.
// ─────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')! // service role bypasses RLS
);

// WhatsApp Cloud API version. Pinned deliberately — Meta sunsets old
// versions, and when v19 goes the failure is silent from the gym's side:
// automated reminders just stop. Keep this in step with
// process-broadcast/index.ts.
const WA_API_VERSION = 'v21.0';

const DEFAULT_TEMPLATE =
  'Hi {name}! 👋\n\nYour *{plan}* at *{gym}* expires on *{date}*.\n\nPlease renew to continue your fitness journey! 💪\n\nContact us to renew.';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // ── Auth: shared secret, not a user JWT ─────────────────────────
  // This handler had NO authorization check at all. Anyone who could
  // reach the URL could trigger a platform-wide WhatsApp send across
  // every gym and burn the message quota — and if it was deployed with
  // --no-verify-jwt, that was the open internet.
  //
  // Same pattern as generate-notifications: the caller is a cron job, so
  // a shared secret is the right control, not a user token.
  const expected = Deno.env.get('CRON_SECRET');
  const provided = req.headers.get('x-cron-secret');
  if (!expected) return json({ error: 'CRON_SECRET not configured' }, 500);
  if (provided !== expected) return json({ error: 'Unauthorized' }, 401);

  try {
    const result = await runReminders();
    return json(result, 200);
  } catch (err) {
    console.error('[send-reminders] Fatal error:', err);
    return json({ error: String(err) }, 500);
  }
});

async function runReminders() {
  // Today in IST (UTC+5:30)
  const nowUTC  = new Date();
  const nowIST  = new Date(nowUTC.getTime() + 5.5 * 60 * 60 * 1000);
  const todayStr = nowIST.toISOString().split('T')[0]; // YYYY-MM-DD

  console.log('[send-reminders] Running for date:', todayStr);

  // Fetch all active gyms with their settings
  const { data: gyms, error: gymErr } = await supabase
    .from('gyms')
    .select('id, name, phone, wa_template, reminder_days')
    .eq('is_active', true);

  if (gymErr) throw new Error('Failed to fetch gyms: ' + gymErr.message);
  if (!gyms?.length) return { sent: 0, skipped: 0, message: 'No active gyms' };

  let totalSent      = 0;
  let totalSkipped   = 0;
  let totalSimulated = 0;
  const log: string[] = [];

  for (const gym of gyms) {
    const reminderDays = gym.reminder_days ?? 7;
    const template     = gym.wa_template || DEFAULT_TEMPLATE;

    // Compute the target expiry date = today + reminderDays
    const targetDate = new Date(nowIST);
    targetDate.setDate(targetDate.getDate() + reminderDays);
    const targetStr = targetDate.toISOString().split('T')[0];

    // Fetch members of this gym expiring on targetDate
    // who haven't been reminded today and are not Trial/Expired
    // is_active + cancelled_at are NOT optional filters here. Without
    // them this function WhatsApps people who removed their membership
    // or were deleted, asking them to renew. Cancelled members are
    // excluded from revenue, dues, broadcasts and notifications
    // everywhere else in Flym; reminders were the one place that
    // still chased them.
    const { data: members, error: memErr } = await supabase
      .from('members')
      .select('id, full_name, phone, plan_name, expiry_date, last_reminder_sent, member_type, payment_status')
      .eq('gym_id', gym.id)
      .eq('expiry_date', targetStr)
      .eq('is_active', true)
      .is('cancelled_at', null)
      .neq('member_type', 'Trial');

    if (memErr) {
      console.error(`[send-reminders] gym ${gym.id} member fetch error:`, memErr.message);
      continue;
    }
    if (!members?.length) continue;

    for (const member of members) {
      // Skip if already reminded today (prevents duplicate sends on re-run)
      if (member.last_reminder_sent === todayStr) {
        totalSkipped++;
        continue;
      }

      // Skip if no phone number
      const phone = member.phone?.replace(/\D/g, '');
      if (!phone || phone.length < 10) {
        console.warn(`[send-reminders] member ${member.id} has no valid phone`);
        totalSkipped++;
        continue;
      }

      // Build message from template
      const expDate  = new Date(targetStr + 'T00:00:00+05:30');
      const expHuman = expDate.toLocaleDateString('en-IN', {
        day: 'numeric', month: 'long', year: 'numeric'
      });
      const message = template
        .replace(/\{name\}/g,  member.full_name || 'Member')
        .replace(/\{plan\}/g,  member.plan_name || 'membership')
        .replace(/\{gym\}/g,   gym.name)
        .replace(/\{date\}/g,  expHuman);

      // Send the reminder (wa.me deep link approach)
      const outcome = await sendWhatsAppReminder(phone, message, gym);

      // No WhatsApp credentials configured: nothing was actually sent, so
      // do NOT stamp last_reminder_sent. Stamping here meant that once
      // the API was finally configured, everyone "reminded" during the
      // unconfigured period would never be re-reminded for that cycle.
      if (outcome === 'simulated') {
        totalSimulated++;
        log.push(`○ Simulated (no WhatsApp API configured) for ${member.full_name}`);
        continue;
      }

      if (outcome === 'sent') {
        // Mark last_reminder_sent = today
        const { error: updateErr } = await supabase
          .from('members')
          .update({ last_reminder_sent: todayStr })
          .eq('id', member.id);

        if (updateErr) {
          console.error(`[send-reminders] failed to mark reminder for member ${member.id}:`, updateErr.message);
        }

        totalSent++;
        log.push(`✅ Sent to ${member.full_name} (${phone}) — gym: ${gym.name}`);
      } else {
        totalSkipped++;
        log.push(`⚠️ Failed for ${member.full_name} (${phone})`);
      }
    }
  }

  const summary = {
    date: todayStr,
    sent: totalSent,
    skipped: totalSkipped,
    simulated: totalSimulated,   // no WhatsApp credentials — nothing sent, nothing stamped
    log,
  };
  console.log('[send-reminders] Done:', summary);
  return summary;
}

// ─────────────────────────────────────────────────────────────────
// sendWhatsAppReminder
// Uses WhatsApp Cloud API if token is configured,
// otherwise logs the message (you can swap in any SMS provider here)
// ─────────────────────────────────────────────────────────────────
type SendOutcome = 'sent' | 'failed' | 'simulated';

async function sendWhatsAppReminder(
  phone: string,
  message: string,
  gym: { name: string; phone: string | null }
): Promise<SendOutcome> {
  const waToken     = Deno.env.get('WA_CLOUD_API_TOKEN');
  const waPhoneId   = Deno.env.get('WA_PHONE_NUMBER_ID');

  // ── Option A: WhatsApp Cloud API (if configured) ──────────────
  if (waToken && waPhoneId) {
    try {
      const phoneWithCountry = phone.startsWith('91') ? phone : '91' + phone;
      const res = await fetch(
        `https://graph.facebook.com/${WA_API_VERSION}/${waPhoneId}/messages`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${waToken}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to:   phoneWithCountry,
            type: 'text',
            text: { body: message },
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        console.error('[sendWhatsApp] API error:', JSON.stringify(data));
        return 'failed';
      }
      return 'sent';
    } catch (err) {
      console.error('[sendWhatsApp] fetch error:', err);
      return 'failed';
    }
  }

  // ── Option B: Log only (no API configured) ───────────────────
  // Reported as 'simulated', NOT as sent. This used to return true, so
  // the caller stamped last_reminder_sent even though no message went
  // anywhere — meaning that once the WhatsApp API was finally
  // configured, every member "reminded" during the unconfigured period
  // would never be re-reminded for that expiry cycle.
  // The gym owner still sends manually from the Member Alerts page.
  console.log('[sendWhatsApp] No API configured — would send to', phone, ':', message.slice(0, 60) + '...');
  return 'simulated';
}
