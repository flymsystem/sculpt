// src/lib/member-auth.js — member login, session, and portal data
import { supabase } from './supabase.js';

// 2026-08-27 client demo: member-signin used to require a client-supplied
// gymCode and match it against `gyms.gym_code` server-side. That constant
// was hardcoded here as 'SCULPT01', which never matched production's
// actual 'DSCULPT' — every member login failed at the gym-lookup step
// (member-signin/index.ts logAttempt(null, false)), for every member,
// regardless of their own data. Proven by member_login_attempts: every
// row from the live demo had gym_id = null.
//
// Fixed at the class, not the instance: CLAUDE.md is explicit that there
// is exactly one gym, so member-signin no longer reads or trusts a
// client-supplied gym code at all — it resolves the sole active gym
// itself. There is nothing left here to drift. (checkin-display.js's QR
// payload and landing.js's public-plans lookup still read `gym_code`
// for their own, unrelated reasons — scripts/verify-schema.mjs still
// checks those against the live DB.)

/**
 * Application number + phone number only. No PIN, password or OTP —
 * see supabase/functions/member-signin/index.ts for why the error
 * message here is deliberately identical for both wrong fields.
 */
export async function memberSignIn(applicationNumber, phone) {
  const res = await supabase.functions.invoke('member-signin', {
    body: {
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
