// supabase/functions/send-reminders/index.ts
// ─────────────────────────────────────────────────────────────────
// Runs daily at 9 AM IST via cron.
// For each gym:
//   1. Reads reminder_days and wa_template from gyms table
//   2. Finds members expiring in exactly reminder_days from today
//   3. Skips members who already got a reminder today
//   4. Sends WhatsApp message via Cloud API
//   5. Marks last_reminder_sent = today
//
// Deploy: supabase functions deploy send-reminders
// Env vars: WA_CLOUD_API_TOKEN, WA_PHONE_NUMBER_ID
// ─────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const WA_API_VERSION = 'v21.0';

const DEFAULT_TEMPLATE =
  'Hi {name}! 👋\n\nYour *{plan}* at *{gym}* expires on *{date}*.\n\nPlease renew to continue your fitness journey! 💪\n\nContact us to renew.';

Deno.serve(async (_req) => {
  // Allow manual trigger via POST (for testing) or scheduled cron
  try {
    const result = await runReminders();
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[send-reminders] Fatal error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

async function runReminders() {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  );

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

  let totalSent    = 0;
  let totalSkipped = 0;
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
    const { data: members, error: memErr } = await supabase
      .from('members')
      .select('id, full_name, phone, plan_name, expiry_date, last_reminder_sent, member_type, payment_status')
      .eq('gym_id', gym.id)
      .eq('expiry_date', targetStr)
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

      // Send the reminder
      const sent = await sendWhatsAppReminder(phone, message, supabase);

      if (sent) {
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

  const summary = { date: todayStr, sent: totalSent, skipped: totalSkipped, log };
  console.log('[send-reminders] Done:', summary);
  return summary;
}

// ─────────────────────────────────────────────────────────────────
// sendWhatsAppReminder
// Uses WhatsApp Cloud API if token is configured,
// otherwise logs the message (you can swap in any SMS provider here)
// ─────────────────────────────────────────────────────────────────
async function sendWhatsAppReminder(
  phone: string,
  message: string,
  _supabase: ReturnType<typeof createClient>
): Promise<boolean> {
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
        return false;
      }
      return true;
    } catch (err) {
      console.error('[sendWhatsApp] fetch error:', err);
      return false;
    }
  }

  // ── Option B: Log only (no API configured) ───────────────────
  // In this mode the cron still runs and marks last_reminder_sent
  // so you know who would have been notified.
  console.log('[sendWhatsApp] No API configured — would send to', phone, ':', message.slice(0, 60) + '...');
  return true; // still marks as "reminded" so it doesn't repeat
}
