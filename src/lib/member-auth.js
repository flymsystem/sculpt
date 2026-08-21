// src/lib/member-auth.js — member login, session, and portal data
import { supabase } from './supabase.js';

// One gym, one code — see CLAUDE.md "There is one gym." The member
// login screen has no logged-in session to read S.gym from (it runs
// before sign-in), so this is the one place that value is hardcoded
// rather than read off state, mirroring the desk display's use of
// S.gym.gym_code for the same SCULPT1:<gym_code>:<token> payload.
export const GYM_CODE = 'SCULPT01';

/**
 * Application number + phone number only. No PIN, password or OTP —
 * see supabase/functions/member-signin/index.ts for why the error
 * message here is deliberately identical for both wrong fields.
 */
export async function memberSignIn(applicationNumber, phone) {
  const res = await supabase.functions.invoke('member-signin', {
    body: {
      gymCode: GYM_CODE,
      applicationNumber: (applicationNumber || '').trim(),
      phone: (phone || '').trim(),
    },
  });

  if (res.error) {
    let serverMsg = '';
    try {
      const ctx = res.error.context;
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.clone().json();
        serverMsg = body?.error || '';
      }
    } catch (_) { /* body wasn't JSON — fall through */ }

    if (serverMsg) throw new Error(serverMsg);

    const raw = res.error.message || '';
    if (/failed to send a request/i.test(raw)) {
      throw new Error('Could not reach the server. Please check your connection and try again.');
    }
    throw new Error(raw || 'Sign in failed. Please try again.');
  }

  const result = res.data;
  if (result?.error) throw new Error(result.error);
  if (!result?.access_token || !result?.refresh_token) {
    throw new Error('Sign in failed. Please try again.');
  }

  const { error: setErr } = await supabase.auth.setSession({
    access_token: result.access_token,
    refresh_token: result.refresh_token,
  });
  if (setErr) throw new Error(setErr.message || 'Could not start your session.');

  return true;
}

export async function memberSignOut() {
  const { error } = await supabase.auth.signOut();
  if (error) console.warn('[Sculpt] Member sign out error:', error.message);
}

/**
 * Returns the signed-in member's own membership summary, or null if
 * this session isn't a member (used by app.js boot() to tell a member
 * session apart from a broken/unconfigured one).
 */
export async function getMyMembership() {
  const { data, error } = await supabase.rpc('sculpt_my_membership');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row || null;
}

export async function getMyVisits(limit = 20) {
  const { data, error } = await supabase.rpc('sculpt_my_visits', { p_limit: limit });
  if (error) throw error;
  return data || [];
}

export async function getMyReceipts() {
  const { data, error } = await supabase.rpc('sculpt_my_receipts');
  if (error) throw error;
  return data || [];
}

// Test-only hooks, same convention as window.__sculptCheckin in
// lib/checkin.js — Playwright drives the built preview server, which
// has hashed filenames and can't `import()` a /src/... path directly.
// __sculptSupabase is the raw client, used by tests/security.spec.js to
// exercise RLS directly (e.g. "can a member session SELECT from gyms").
if (typeof window !== 'undefined') {
  window.__sculptMemberAuth = { memberSignIn, memberSignOut, getMyMembership, getMyVisits, getMyReceipts };
  window.__sculptSupabase = supabase;
}
