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

// Exposed on window so Playwright can drive these RPCs against the BUILT
// preview server (hashed filenames mean tests/*.spec.js can't `import()` a
// /src/... path there — see tests/checkin.spec.js). Same convention as the
// existing window._navTo / window.__sculptSession globals in app.js. Only
// populated once this module has actually been loaded (i.e. a check-in page
// was opened), not on every page.
if (typeof window !== 'undefined') {
  window.__sculptCheckin = { issueCheckinToken, staffCheckin };
}
