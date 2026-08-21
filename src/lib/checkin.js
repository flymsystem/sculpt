// src/lib/checkin.js — rotating QR tokens + check-in RPC wrappers
import { supabase } from './supabase.js';

export async function issueCheckinToken() {
  const { data, error } = await supabase.rpc('sculpt_issue_checkin_token');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('No token returned.');
  return { token: row.token, expiresAt: row.expires_at };
}

export async function staffCheckin(token) {
  const { data, error } = await supabase.rpc('sculpt_staff_checkin', { p_token: token });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('No response from check-in.');
  return { status: row.status, message: row.message };
}

export async function memberCheckin(token) {
  const { data, error } = await supabase.rpc('sculpt_member_checkin', { p_token: token });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('No response from check-in.');
  return { status: row.status, message: row.message };
}

export async function manualCheckin(memberId, gymId) {
  const { data, error } = await supabase.rpc('sculpt_manual_checkin', { p_member_id: memberId, p_gym_id: gymId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('No response from check-in.');
  return { status: row.status, message: row.message };
}

export async function getCheckinFollowup(gymId, thresholdDays) {
  const { data, error } = await supabase.rpc('sculpt_checkin_followup', {
    p_gym_id: gymId,
    p_threshold_days: thresholdDays ?? null,
  });
  if (error) throw error;
  return data || [];
}

// Bounded the same way getAttendanceRange in lib/staff.js is bounded —
// a wide date range on a busy gym could otherwise become a multi-
// megabyte fetch on a phone.
export const CHECKIN_LOG_MAX_ROWS = 2000;

export async function getAttendanceLog(gymId, { startDate, endDate, search, limit = CHECKIN_LOG_MAX_ROWS } = {}) {
  let q = supabase
    .from('member_checkins')
    .select('id, checked_in_at, status, source, member_id, members(full_name, phone)')
    .eq('gym_id', gymId)
    .order('checked_in_at', { ascending: false })
    .limit(limit);
  if (startDate) q = q.gte('checked_in_at', startDate);
  if (endDate) q = q.lte('checked_in_at', endDate);

  const { data, error } = await q;
  if (error) throw error;
  let rows = data || [];
  if (search && search.trim()) {
    const s = search.trim().toLowerCase();
    rows = rows.filter(r => (r.members?.full_name || '').toLowerCase().includes(s));
  }
  return rows;
}

/**
 * Live-updates the attendance log: calls onInsert(row) for every new
 * member_checkins row in this gym. Returns an unsubscribe function —
 * callers must invoke it on page teardown, same convention as
 * stopCheckinDisplay/stopCheckinScan.
 */
export function subscribeAttendanceLog(gymId, onInsert) {
  const channel = supabase
    .channel(`member_checkins_${gymId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'member_checkins', filter: `gym_id=eq.${gymId}` },
      (payload) => onInsert(payload.new)
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}

// Exposed on window so Playwright can drive these RPCs against the BUILT
// preview server (hashed filenames mean tests/*.spec.js can't `import()` a
// /src/... path there — see tests/checkin.spec.js). Same convention as the
// existing window._navTo / window.__sculptSession globals in app.js. Only
// populated once this module has actually been loaded (i.e. a check-in page
// was opened), not on every page.
if (typeof window !== 'undefined') {
  window.__sculptCheckin = { issueCheckinToken, staffCheckin };
}
