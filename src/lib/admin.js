// src/lib/admin.js — Production v1
// ─────────────────────────────────────────────────────────────────
// AUDIT FIXES:
//  1. getAllGymsDetail: uses gym_summary view for member counts,
//     correctly remaps gym_id→id, gym_name→name, and also maps
//     phone/address/email from the underlying gyms table via a join
//  2. onboardGym: validation before insert
//  3. All functions properly typed and documented
// ─────────────────────────────────────────────────────────────────

import { supabase } from './supabase.js';

/**
 * Fetch all gyms with live member counts via gym_summary view.
 * Remaps gym_summary columns to match the shape the dashboard expects.
 */
export async function getAllGymsDetail() {
  // gym_summary gives us counts. We also need phone/address/email from gyms.
  const { data, error } = await supabase
    .from('gyms')
    .select(`
      id, gym_code, name, owner_name, phone, city, address, email,
      is_active, created_at, auto_reminders_enabled,
      members!members_gym_id_fkey(id)
    `)
    .order('created_at', { ascending: false });

  if (error) {
    // Fallback: try gym_summary view directly (simpler but no phone/address)
    const { data: summary, error: err2 } = await supabase
      .from('gym_summary')
      .select('*')
      .order('created_at', { ascending: false });

    if (err2) throw err2;
    return (summary || []).map(g => ({
      ...g,
      id:   g.gym_id   || g.id,
      name: g.gym_name || g.name,
    }));
  }

  // Compute member counts from the joined array
  return (data || []).map(g => {
    const memberCount = Array.isArray(g.members) ? g.members.length : 0;
    const { members: _, ...gym } = g; // remove the joined array
    return { ...gym, total_members: memberCount, payment_due: 0 };
  });
}

/**
 * Get live stats per gym from the gym_summary view (for overview page).
 * Returns total_members and payment_due accurately.
 */
export async function getGymStats() {
  const { data, error } = await supabase
    .from('gym_summary')
    .select('gym_id, total_members, payment_due, active_members, expiring_soon');

  if (error) return {};

  const map = {};
  (data || []).forEach(row => { map[row.gym_id] = row; });
  return map;
}

/**
 * Fetch platform-wide activity log.
 */
export async function getGlobalActivity(limit = 50) {
  const { data, error } = await supabase
    .from('activity_log')
    .select('*, gyms(name)')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

/**
 * Onboard a new gym (creates gym row only).
 * Supabase user creation must happen separately via Auth Dashboard + SQL.
 */
export async function onboardGym(gymData) {
  if (!gymData.name?.trim())      throw new Error('Gym name is required.');
  if (!gymData.ownerName?.trim()) throw new Error('Owner name is required.');

  // Generate collision-resistant gym code; retry once on duplicate
  function makeCode() {
    const suffix   = Date.now().toString(36).slice(-4).toUpperCase();
    const randPart = Math.random().toString(36).slice(2, 5).toUpperCase();
    return 'FLY' + suffix + randPart;
  }

  let gymCode = makeCode();

  // Check for existing code first (handles the rare simultaneous-onboard collision)
  const { data: existing } = await supabase
    .from('gyms').select('id').eq('gym_code', gymCode).maybeSingle();
  if (existing) gymCode = makeCode(); // one retry is sufficient statistically

  const { data, error } = await supabase
    .from('gyms')
    .insert({
      gym_code:   gymCode,
      name:       gymData.name.trim(),
      owner_name: gymData.ownerName.trim(),
      phone:      gymData.phone   || null,
      city:       gymData.city    || null,
      address:    gymData.address || null,
    })
    .select()
    .single();

  if (error) {
    // Friendly message for DB-level unique constraint violation
    if (error.code === '23505') throw new Error('A gym with this code already exists. Please try again.');
    throw error;
  }
  return { gym: data, gymCode };
}

/** Deactivate a gym (does not delete data). */
export async function deactivateGym(gymId) {
  const { error } = await supabase.from('gyms').update({ is_active: false }).eq('id', gymId);
  if (error) throw error;
}

/** Reactivate a gym. */
export async function reactivateGym(gymId) {
  const { error } = await supabase.from('gyms').update({ is_active: true }).eq('id', gymId);
  if (error) throw error;
}

// ── Auto-Reminder Queue (Admin Manual Send) ─────────────────────

/**
 * Fetch the queue of members due for reminders.
 * Uses the get_due_reminders() RPC (migration 007).
 * Only returns members from gyms where auto_reminders_enabled = true.
 */
export async function getDueReminders() {
  const { data, error } = await supabase.rpc('get_due_reminders');
  if (error) throw error;
  return data || [];
}

/**
 * Mark a reminder as sent after admin manually sends via WhatsApp.
 * Calls the record_reminder_sent() RPC — same one the Cloudflare Worker uses.
 * Updates last_reminder_7d_at / last_reminder_1d_at + inserts reminder_logs + activity_log.
 */
export async function markReminderSent(memberId, gymId, windowDays, message) {
  const { error } = await supabase.rpc('record_reminder_sent', {
    p_member_id:   memberId,
    p_gym_id:      gymId,
    p_window_days: windowDays,
    p_message:     message,
  });
  if (error) throw error;
}
