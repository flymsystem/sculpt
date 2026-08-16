// src/lib/notifications.js
// ─────────────────────────────────────────────────────────────────
// Notification feed — CRUD + client-side generation.
//
// Design notes:
//  * Notifications are generated CLIENT-SIDE on dashboard load and then
//    every 15 minutes while the tab is open. Every generated row carries
//    a `dedupe_key` unique per gym, so re-running the sync is idempotent
//    (migration 031 enforces this with a partial unique index).
//  * Cancelled members (`cancelled_at` set) NEVER generate notifications
//    — same rule as Finance.
//  * Every query filters by gym_id at the app layer even though RLS also
//    enforces it (defence in depth).
// ─────────────────────────────────────────────────────────────────
import { supabase } from './supabase.js';

export const NOTIF_TYPES = {
  expiring:    { icon: 'clock',  color: 'var(--amber)',  section: 'alerts' },
  expired:     { icon: 'alert',  color: 'var(--red)',    section: 'alerts' },
  payment_due: { icon: 'rupee',  color: 'var(--purple)', section: 'alerts' },
  birthday:    { icon: 'gift',   color: 'var(--brand)',  section: 'members' },
  enquiry:     { icon: 'user',   color: 'var(--blue-light)', section: 'enquiries' },
  payment:     { icon: 'rupee',  color: 'var(--green)',  section: 'finance' },
  staff:       { icon: 'users',  color: 'var(--brand)',  section: 'staff' },
  system:      { icon: 'info',   color: 'var(--text-tertiary)', section: '' },
  general:     { icon: 'info',   color: 'var(--text-tertiary)', section: '' },
};

/**
 * "Today" in IST — must match istToday() in the generate-notifications
 * Edge Function exactly. If the client used UTC, then between 00:00 and
 * 05:30 IST it would compute yesterday's date, produce a different
 * dedupe_key from the cron, and the owner would get every payment-due and
 * birthday notification twice.
 */
const todayKey = () => {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().split('T')[0];
};

/** Normalise a date column to YYYY-MM-DD — dedupe keys depend on it. */
const dateKey = (v) => (v ? String(v).slice(0, 10) : '');

// ── Read ──────────────────────────────────────────────────────────

/** Fetch the latest notifications for a gym (newest first). */
export async function getNotifications(gymId, limit = 50) {
  if (!gymId) return [];
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('gym_id', gymId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[Sculpt] getNotifications:', error.message);
    return [];
  }
  return data || [];
}

/** Count of unread notifications for this gym. */
export async function getUnreadCount(gymId) {
  if (!gymId) return 0;
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('gym_id', gymId)
    .eq('is_read', false);
  if (error) return 0;
  return count || 0;
}

// ── Write ─────────────────────────────────────────────────────────

/** Mark specific notifications (or all) as read. */
export async function markRead(ids) {
  const payload = Array.isArray(ids) && ids.length ? { p_ids: ids } : { p_ids: null };
  const { data, error } = await supabase.rpc('mark_notifications_read', payload);
  if (error) {
    console.warn('[Sculpt] markRead:', error.message);
    return 0;
  }
  return data || 0;
}

/** Delete one notification. */
export async function deleteNotification(id, gymId) {
  if (!id || !gymId) return;
  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('id', id)
    .eq('gym_id', gymId);
  if (error) throw new Error(error.message);
}

/** Delete every notification for this gym (Clear all). */
export async function clearAllNotifications(gymId) {
  if (!gymId) return;
  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('gym_id', gymId);
  if (error) throw new Error(error.message);
}

/**
 * Insert notifications, ignoring any that collide on (gym_id, dedupe_key).
 * Returns the rows that were actually created (i.e. genuinely new).
 */
export async function createNotifications(gymId, rows) {
  if (!gymId || !rows || !rows.length) return [];
  const payload = rows.map(r => ({
    gym_id:       gymId,
    user_id:      r.userId || null,
    type:         r.type || 'general',
    title:        r.title,
    body:         r.body || null,
    link_section: r.linkSection || NOTIF_TYPES[r.type]?.section || null,
    ref_id:       r.refId || null,
    // Never null — the unique index is (gym_id, dedupe_key) with no
    // predicate, so a null here would collide across unrelated rows.
    dedupe_key:   r.dedupeKey || `adhoc:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
    severity:     r.severity || 'info',
  }));

  const { data, error } = await supabase
    .from('notifications')
    .upsert(payload, { onConflict: 'gym_id,dedupe_key', ignoreDuplicates: true })
    .select();

  if (error) {
    console.warn('[Sculpt] createNotifications:', error.message);
    return [];
  }
  return data || [];
}

// ── Generation ────────────────────────────────────────────────────

/**
 * Build the notification rows implied by the current member/enquiry data.
 * Pure function — no network. Exported so it can be unit-tested.
 *
 * @param {Array}  members      S.members
 * @param {Array}  enquiries    S.enquiries
 * @param {number} reminderDays gym.reminder_days (default 7)
 */
export function buildNotificationRows(members = [], enquiries = [], reminderDays = 7) {
  const rows = [];
  const day = todayKey();
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const nameOf = m => m.full_name || m.name || 'Member';

  members.forEach(m => {
    // Cancelled members are never chased.
    if (m.cancelled_at) return;
    if (m.is_active === false) return;

    const raw = dateKey(m.expiry_date);
    const exp = raw ? new Date(raw + 'T00:00:00') : null;
    if (exp && !isNaN(exp)) {
      exp.setHours(0, 0, 0, 0);
      const days = Math.round((exp - now) / 86400000);

      if (days < 0 && days >= -30) {
        rows.push({
          type: 'expired',
          severity: 'critical',
          title: `${nameOf(m)} — membership expired`,
          body: `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago. Tap to renew.`,
          linkSection: 'alerts',
          refId: m.id,
          dedupeKey: `expired:${m.id}:${raw}`,
        });
      } else if (days >= 0 && days <= reminderDays) {
        rows.push({
          type: 'expiring',
          severity: 'warning',
          title: `${nameOf(m)} — expiring ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}`,
          body: `${m.plan_name || 'Membership'} ends on ${raw}.`,
          linkSection: 'alerts',
          refId: m.id,
          dedupeKey: `expiring:${m.id}:${raw}`,
        });
      }
    }

    // Payment due — money axis, independent of time axis.
    if (m.payment_status === 'Due' || m.payment_status === 'Partial') {
      const bal = m.balance_due != null ? Number(m.balance_due) : Number(m.plan_price) || 0;
      if (bal > 0) {
        rows.push({
          type: 'payment_due',
          severity: 'warning',
          title: `${nameOf(m)} — ₹${bal.toLocaleString('en-IN')} pending`,
          body: m.payment_status === 'Partial'
            ? 'Partial payment received. Balance still outstanding.'
            : 'No payment collected yet.',
          linkSection: 'alerts',
          refId: m.id,
          dedupeKey: `due:${m.id}:${day}`,
        });
      }
    }

    // Birthday today
    if (m.date_of_birth) {
      const dob = String(m.date_of_birth);
      if (dob.length >= 10 && dob.slice(5, 10) === day.slice(5, 10)) {
        rows.push({
          type: 'birthday',
          severity: 'info',
          title: `🎂 ${nameOf(m)} has a birthday today`,
          body: 'Send them a quick wish on WhatsApp.',
          linkSection: 'members',
          refId: m.id,
          dedupeKey: `bday:${m.id}:${day}`,
        });
      }
    }
  });

  // New enquiries that have not been followed up yet
  (enquiries || []).forEach(e => {
    if (e.is_active === false) return;
    if (e.status !== 'New') return;
    if (!e.created_at) return;
    const age = (Date.now() - new Date(e.created_at).getTime()) / 86400000;
    if (age > 7) return; // only nag about recent ones
    rows.push({
      type: 'enquiry',
      severity: 'info',
      title: `New enquiry — ${e.name || 'Walk-in'}`,
      body: `Source: ${e.source || 'Walk-in'}. Not followed up yet.`,
      linkSection: 'enquiries',
      refId: e.id,
      dedupeKey: `enquiry:${e.id}`,
    });
  });

  return rows;
}

/**
 * Generate + persist notifications for the current data set.
 * Returns the newly created rows (empty array if nothing new).
 *
 * ── NO LONGER CALLED FROM THE UI ─────────────────────────────────
 * The notification bell used to run this every 15 minutes from the
 * browser. At scale that is a multi-megabyte upsert fired from a phone
 * on a loop. Generation now belongs to the generate-notifications Edge
 * Function, which does the same job server-side on a nightly cron for
 * every gym, open tab or not.
 *
 * Kept because buildNotificationRows() above is the readable reference
 * for the notification rules and their dedupe-key formats, which must
 * stay byte-identical to the Edge Function. If you ever need a
 * client-triggered refresh, prefer calling the Edge Function for one gym
 * over reintroducing this loop.
 */
export async function syncNotifications(gymId, members, enquiries, reminderDays) {
  if (!gymId) return [];
  try {
    const rows = buildNotificationRows(members, enquiries, reminderDays);
    if (!rows.length) return [];
    return await createNotifications(gymId, rows);
  } catch (err) {
    console.warn('[Sculpt] syncNotifications:', err.message);
    return [];
  }
}

// ── Realtime ──────────────────────────────────────────────────────

/**
 * Subscribe to INSERTs on notifications for this gym.
 * Returns an unsubscribe function — ALWAYS call it on teardown.
 */
export function subscribeToNotifications(gymId, onInsert) {
  if (!gymId || typeof onInsert !== 'function') return () => {};
  let channel;
  try {
    channel = supabase
      .channel(`sculpt-notifications-${gymId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `gym_id=eq.${gymId}` },
        payload => { try { onInsert(payload.new); } catch (_) {} }
      )
      .subscribe();
  } catch (err) {
    console.warn('[Sculpt] realtime subscribe failed:', err.message);
    return () => {};
  }
  return () => {
    try { supabase.removeChannel(channel); } catch (_) {}
  };
}
