// src/lib/auth.js — Production v3.1
// ─────────────────────────────────────────────────────────────────
// v3 CHANGES:
//  1. getMyProfile: supports staff role (role='staff' in gym_users)
//     Returns staffRecord with the linked staff row for staff users
//  2. subscription_tier included in gym fetch
//  3. createStaffLogin: owner creates staff auth account via Edge Function
//
// v3.1 (2026-08):
//  4. createStaffLogin now reads the Edge Function's JSON error body.
//     supabase-js buries the server's message inside error.context (a
//     Response object), so every failure previously surfaced as the same
//     unhelpful string. It also special-cases FunctionsFetchError, which
//     means the request never reached Supabase at all (not deployed /
//     CORS preflight rejected) rather than the server saying no.
// ─────────────────────────────────────────────────────────────────

import { supabase } from './supabase.js';

/**
 * Sign in with email + password.
 * Returns { user, role, gym, branches, staffRecord? } or throws.
 */
export async function signIn(email, password) {
  const { data: authData, error: authError } =
    await supabase.auth.signInWithPassword({ email: email.trim(), password });

  if (authError) {
    const m = (authError.message || '').toLowerCase();
    if (m.includes('invalid login'))       throw new Error('Incorrect email or password. Please try again.');
    if (m.includes('email not confirmed')) throw new Error('Please confirm your email before logging in.');
    if (m.includes('too many requests'))   throw new Error('Too many login attempts. Please wait a few minutes.');
    throw new Error(authError.message || 'Sign in failed. Please try again.');
  }

  const profile = await getMyProfile(authData.user.id);
  return { user: authData.user, ...profile };
}

/** Sign out. */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) console.warn('[Flym] Sign out error:', error.message);
}

/**
 * Returns the current Supabase user (validates with server).
 * Returns null if not authenticated.
 */
export async function getAuthUser() {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return null;
    return user;
  } catch {
    return null;
  }
}

/**
 * Fetch gym_user row(s) + linked gym(s) for a given user id.
 * Returns { gymUser, gym, role, branches, staffRecord? } or throws.
 *
 * Roles:
 *   - owner: gym owner (multi-branch supported)
 *   - staff: gym staff (single gym, limited access)
 */
export async function getMyProfile(userId) {
  const baseCols = `id, gym_code, name, owner_name, phone, city, address, email, is_active, wa_template, reminder_days`;
  const newCols  = `${baseCols}, auto_reminders_enabled, monthly_budget, gst_enabled, gstin, gst_percentage, logo_url, phone2, invoice_terms, subscription_tier`;

  let { data: gymUsers, error } = await supabase
    .from('gym_users')
    .select(`id, role, gym_id, is_selected, gyms (${newCols})`)
    .eq('user_id', userId);

  // If that errored because a column doesn't exist, transparently retry
  // with the legacy column set (pre-migration environments)
  if (error && /column .* does not exist/i.test(error.message || '')) {
    console.warn('[Flym auth] Falling back to legacy columns.');
    const retry = await supabase
      .from('gym_users')
      .select(`id, role, gym_id, is_selected, gyms (${baseCols})`)
      .eq('user_id', userId);

    if (retry.error && /is_selected/i.test(retry.error.message || '')) {
      const retry2 = await supabase
        .from('gym_users')
        .select(`id, role, gym_id, gyms (${baseCols})`)
        .eq('user_id', userId);
      gymUsers = retry2.data;
      error = retry2.error;
    } else {
      gymUsers = retry.data;
      error = retry.error;
    }
  }

  if (error) {
    console.error('[Flym auth] getMyProfile error:', error);
    throw new Error(
      'Could not load your profile. ' +
      (error.message ? `Reason: ${error.message}` : 'Please check your connection or contact support.')
    );
  }

  if (!gymUsers || gymUsers.length === 0) {
    throw new Error(
      'Account not configured. Your login exists but is not linked to a gym. ' +
      'Contact your Flym administrator.'
    );
  }

  // ── Staff users — single gym, no branches ──
  if (gymUsers[0].role === 'staff') {
    const staffRow = gymUsers[0];
    const gym = staffRow.gyms || null;

    // Block deactivated gym
    if (gym && gym.is_active === false) {
      await supabase.auth.signOut();
      throw new Error(
        'Your gym account has been deactivated. ' +
        'Please contact your gym owner.'
      );
    }

    // Fetch the linked staff record for this user
    let staffRecord = null;
    try {
      const { data: staffData } = await supabase
        .from('staff')
        .select('id, full_name, phone, role, photo_url, join_date')
        .eq('user_id', userId)
        .eq('is_active', true)
        .limit(1)
        .single();
      staffRecord = staffData;
    } catch (e) {
      console.warn('[Flym auth] Could not fetch staff record:', e.message);
    }

    if (!staffRecord) {
      await supabase.auth.signOut();
      throw new Error(
        'Your staff account has been disabled. ' +
        'Please contact your gym owner.'
      );
    }

    return {
      gymUser: staffRow,
      gym,
      role: 'staff',
      branches: [],
      staffRecord,
    };
  }

  // ── Owner — find the selected gym, or default to first ──
  let selected = gymUsers.find(gu => gu.is_selected === true);
  if (!selected) selected = gymUsers[0];

  // Block deactivated gym owners from logging in
  if (selected.gyms && selected.gyms.is_active === false) {
    const activeGym = gymUsers.find(gu => gu.gyms && gu.gyms.is_active !== false);
    if (activeGym) {
      selected = activeGym;
    } else {
      await supabase.auth.signOut();
      throw new Error(
        'Your gym account has been deactivated. ' +
        'Please contact Flym support to reactivate your account.'
      );
    }
  }

  // Build branches array (all linked gyms for the switcher)
  const branches = gymUsers
    .filter(gu => gu.role === 'owner' && gu.gyms)
    .map(gu => ({
      gym_user_id: gu.id,
      gym_id: gu.gym_id,
      name: gu.gyms.name,
      gym_code: gu.gyms.gym_code,
      city: gu.gyms.city,
      is_selected: gu.gym_id === selected.gym_id,
      is_active: gu.gyms.is_active !== false,
    }));

  return {
    gymUser: selected,
    gym:  selected.gyms || null,
    role: selected.role, // 'owner'
    branches,
  };
}

/**
 * Switch to a different gym (multi-branch).
 * Calls the switch_gym RPC which atomically updates is_selected.
 */
export async function switchGym(targetGymId) {
  const { error } = await supabase.rpc('switch_gym', { target_gym_id: targetGymId });
  if (error) throw new Error(error.message || 'Failed to switch gym.');
}

/**
 * Create a staff login account.
 * Called by the gym owner from the Staff page.
 * Calls the create-staff-user Edge Function.
 *
 * @param {string} staffId - The staff record ID
 * @param {string} email - Login email for the staff member
 * @param {string} password - Login password (min 6 chars)
 * @returns {Object} - { email, userId }
 */
export async function createStaffLogin(staffId, email, password) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await supabase.functions.invoke('create-staff-user', {
    body: { staffId, email, password },
  });

  if (res.error) {
    // supabase-js hides the server's JSON body inside error.context (a Response).
    // Without this, a 402 / 409 / 500 all surface as the same generic string
    // and there's no way to tell "already registered" from "not Pro".
    let serverMsg = '';
    try {
      const ctx = res.error.context;
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.clone().json();
        serverMsg = body?.error || '';
      }
    } catch (_) { /* body wasn't JSON — fall through */ }

    if (serverMsg) throw new Error(serverMsg);

    // FunctionsFetchError = the request never reached Supabase at all.
    // Almost always: the function isn't deployed, or the CORS preflight
    // was rejected before the browser sent the real POST.
    const raw = res.error.message || '';
    if (/failed to send a request/i.test(raw)) {
      throw new Error(
        'Could not reach the server. The create-staff-user function may not be deployed. ' +
        'Run: supabase functions deploy create-staff-user'
      );
    }
    throw new Error(raw || 'Failed to create staff login');
  }

  // Edge Function returns { email, userId } on success
  const result = res.data;
  if (result?.error) throw new Error(result.error);
  return result;
}

/** Subscribe to auth state changes. */
export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange(callback);
}
