// src/lib/members.js — Production v2
// ─────────────────────────────────────────────────────────────────
// v2 FIXES (add-member delay / false-error production bug):
//  1. addMember: client-generated UUID for idempotency — safe to retry
//     if the request times out but the server already committed
//  2. addMember: on PGRST116, re-queries by known UUID instead of
//     falling back to a fake 'local_...' id (which broke payment_history FK)
//  3. Exported generateMemberId() for use in orphan-detection flow
//
// PRIOR AUDIT FIXES (preserved):
//  1. updateMember: PGRST116 handled (RLS blocks select-back)
//  2. updateMember: all fields sent including date_of_birth, gender
//  3. addMember: expiryDate only set for Trial — DB trigger handles Paid
//  4. All non-critical DB ops fire-and-forget (no await leaking errors)
//  5. Input sanitization via txt()/num()/int() helpers
//  6. Payment mode: frontend sends 'Online' not 'Online Payment'
//  7. updateMember: syncs payment_history.paid_at when join_date changes
// ─────────────────────────────────────────────────────────────────

import { supabase } from './supabase.js';

// ── Sanitizers ───────────────────────────────────────────────────
const txt = v => { const s = (v ?? '').toString().trim(); return s || null; };
const num = v => { const raw = (v ?? '').toString().replace(/,/g, ''); const n = parseFloat(raw); return isNaN(n) ? null : n; };
const int = v => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };

/**
 * Converts a YYYY-MM-DD date string into a timestamp anchored at local
 * noon, so the stored instant always falls on the intended calendar day
 * regardless of timezone offset — avoids UTC day-shift bugs when this
 * gets compared against local date filters (e.g. Finance's "Today").
 * Falls back to the current moment if no date is given.
 */
export function toPaidAtTimestamp(dateStr) {
  if (!dateStr) return new Date().toISOString();
  const d = new Date(`${dateStr}T12:00:00`);
  return isNaN(d) ? new Date().toISOString() : d.toISOString();
}

/**
 * Generate a v4 UUID on the client side.
 * Used as an idempotency key for addMember — if the request times out
 * but the server committed the row, retrying with the same id is safe
 * (PK conflict instead of duplicate).
 */
export function generateMemberId() {
  // crypto.randomUUID is available in all modern browsers and secure contexts
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older browsers (shouldn't hit in production but safe)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Check if a phone number already exists for an active member in this gym.
 * Returns the member name if found, null if no duplicate.
 * Skips check for empty/null phone and optionally excludes a member id (for edit).
 */
export async function checkDuplicatePhone(gymId, phone, excludeMemberId) {
  if (!phone) return null;
  const clean = phone.replace(/\D/g, '').slice(-10);
  if (clean.length !== 10) return null;

  // Match with or without +91 prefix
  const variants = [`+91${clean}`, clean];

  let query = supabase
    .from('members')
    .select('id, full_name, phone')
    .eq('gym_id', gymId)
    .eq('is_active', true)
    .in('phone', variants)
    .limit(1);

  if (excludeMemberId) {
    query = query.neq('id', excludeMemberId);
  }

  const { data } = await query;
  return data && data.length > 0 ? data[0].full_name : null;
}

export async function getMembers(gymId) {
  // Fetches up to 5000 active members (via the members_with_status view
  // which filters is_active = true). For gyms approaching this limit,
  // implement server-side pagination with .range(from, to).
  const { data, error } = await supabase
    .from('members_with_status')
    .select('*')
    .eq('gym_id', gymId)
    .order('join_date', { ascending: false })
    .limit(5000);
  if (error) throw error;
  return data || [];
}

/**
 * Check if a member with a specific client-generated id already exists.
 * Used for orphan detection — if addMember's request timed out, the
 * member may already be in the DB.
 */
export async function findMemberById(gymId, memberId) {
  try {
    const { data } = await supabase
      .from('members')
      .select('id, full_name, plan_name, plan_price, payment_mode, payment_status, member_type, balance_due, is_active, created_at')
      .eq('id', memberId)
      .eq('gym_id', gymId)
      .limit(1)
      .single();
    return data || null;
  } catch (_) {
    return null;
  }
}

export async function addMember(gymId, d) {
  // Validate required fields
  if (!txt(d.fullName)) throw new Error('Full name is required');
  if (!txt(d.joinDate)) throw new Error('Join date is required');

  // Use client-generated UUID if provided (idempotency key).
  // If the request times out but the server committed, the same id
  // prevents duplicates on retry (PK conflict).
  const memberId = d._clientId || generateMemberId();

  const payload = {
    id:                   memberId,
    gym_id:               gymId,
    full_name:            txt(d.fullName),
    phone:                txt(d.phone),
    email:                txt(d.email),
    date_of_birth:        txt(d.dateOfBirth),
    gender:               txt(d.gender),
    join_date:            txt(d.joinDate),
    plan_id:              txt(d.planId),
    plan_name:            txt(d.planName),
    plan_price:           num(d.planPrice),
    plan_duration_months: int(d.planDurationMonths),
    member_addons:        d.memberAddons != null
                            ? (typeof d.memberAddons === 'string' ? d.memberAddons : JSON.stringify(d.memberAddons))
                            : null,
    // Only set explicit expiry for Trial — DB trigger computes it for Paid plans
    expiry_date:          d.memberType === 'Trial' ? txt(d.expiryDate) : null,
    payment_mode:         txt(d.paymentMode),
    payment_status:       txt(d.paymentStatus) || 'Paid',
    member_type:          txt(d.memberType)    || 'Paid',
    notes:                txt(d.notes),
    application_number:   txt(d.applicationNumber),
    aadhar_number:        txt(d.aadharNumber),
    discount_amount:      num(d.discountAmount) || 0,
    balance_due:          num(d.balanceDue) || 0,
  };

  const { data, error } = await supabase
    .from('members')
    .insert(payload)
    .select()
    .single();

  // PGRST116 = insert succeeded but RLS blocked the SELECT-back
  if (error && error.code !== 'PGRST116') throw error;

  // If PGRST116 (data is null), re-query by our known UUID instead of
  // falling back to a fake 'local_...' id. The fake id broke the
  // payment_history FK insert because it's not a valid UUID.
  let saved = data;
  if (!saved) {
    try {
      const { data: refetched } = await supabase
        .from('members')
        .select('*')
        .eq('id', memberId)
        .eq('gym_id', gymId)
        .single();
      saved = refetched;
    } catch (_) { /* fall through to synthetic */ }
  }
  if (!saved) {
    // Last resort: use the known UUID (not a fake local_ id)
    saved = { id: memberId, ...payload, is_active: true, created_at: new Date().toISOString() };
  }

  safeLog(gymId, 'member_added', `New member added: ${payload.full_name}`);

  // Record only the amount actually collected now (may be partial — balance_due tracks the rest)
  // HARDENED: await insert + flag result so UI can warn on failure
  const amountPaidNow = d.amountPaidNow != null ? (num(d.amountPaidNow) || 0) : (payload.plan_price || 0);
  saved._paymentRecorded = true; // default true (no payment needed = success)
  if (amountPaidNow > 0 && d.memberType !== 'Trial') {
    try {
      const { error: phErr } = await supabase.from('payment_history').insert({
        gym_id: gymId, member_id: saved.id,
        amount: amountPaidNow,
        payment_mode: payload.payment_mode,
        plan_id: payload.plan_id, plan_name: payload.plan_name,
        paid_at: toPaidAtTimestamp(payload.join_date),
        notes: payload.member_addons ? `Addons: ${payload.member_addons}` : null,
      });
      if (phErr) {
        console.error('[Flym] CRITICAL: payment_history insert failed for', payload.full_name, ':', phErr.message);
        saved._paymentRecorded = false;
      }
    } catch (err) {
      console.error('[Flym] CRITICAL: payment_history insert threw for', payload.full_name, ':', err.message);
      saved._paymentRecorded = false;
    }
  }

  return saved;
}

export async function updateMember(memberId, gymId, u, opts = {}) {
  const payload = {
    full_name:            txt(u.fullName),
    phone:                txt(u.phone),
    email:                txt(u.email),
    date_of_birth:        txt(u.dateOfBirth),
    gender:               txt(u.gender),
    join_date:            txt(u.joinDate),
    plan_id:              txt(u.planId),
    plan_name:            txt(u.planName),
    plan_price:           num(u.planPrice),
    plan_duration_months: int(u.planDurationMonths),
    member_addons:        u.memberAddons !== undefined
                            ? (u.memberAddons == null ? null : typeof u.memberAddons === 'string' ? u.memberAddons : JSON.stringify(u.memberAddons))
                            : undefined,
    payment_mode:         txt(u.paymentMode),
    payment_status:       txt(u.paymentStatus) || 'Paid',
    member_type:          txt(u.memberType)    || 'Paid',
    notes:                txt(u.notes),
    application_number:   u.applicationNumber !== undefined ? txt(u.applicationNumber) : undefined,
    aadhar_number:        u.aadharNumber !== undefined ? txt(u.aadharNumber) : undefined,
    discount_amount:      u.discountAmount !== undefined ? (num(u.discountAmount) || 0) : undefined,
    balance_due:          u.balanceDue     !== undefined ? (num(u.balanceDue)     || 0) : undefined,
  };
  // For Trial: set explicit expiry; for Paid/Unpaid: DB trigger recalculates
  if (u.memberType === 'Trial') payload.expiry_date = txt(u.expiryDate);
  // Remove undefined keys (member_addons may be undefined if not provided)
  Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

  // ── Detect join_date change (for paid_at sync below) ──────────
  let oldJoinDate = null;
  if (payload.join_date) {
    try {
      const { data: prev } = await supabase.from('members')
        .select('join_date').eq('id', memberId).eq('gym_id', gymId).single();
      oldJoinDate = prev?.join_date || null;
    } catch(e) { /* best-effort — don't block edit */ }
  }

  const { data, error } = await supabase
    .from('members')
    .update(payload)
    .eq('id', memberId)
    .eq('gym_id', gymId)
    .select()
    .single();

  if (error && error.code !== 'PGRST116') throw error;

  // ── Sync payment_history.paid_at when join_date changes ─────────
  // addMember() stamps paid_at to noon of join_date. If the gym owner
  // later corrects join_date via Edit, the corresponding payment record
  // must move too — otherwise Finance shows revenue on the wrong day.
  // Targets only records whose paid_at falls on the OLD join_date,
  // so balance payments (stamped NOW()) and unrelated records are safe.
  // SKIP during renewals — renew creates a NEW payment record; old records
  // must keep their original dates. Pass { skipPaidAtSync: true } from renew.
  if (!opts.skipPaidAtSync && payload.join_date && oldJoinDate && payload.join_date !== oldJoinDate) {
    try {
      await supabase.from('payment_history')
        .update({ paid_at: toPaidAtTimestamp(payload.join_date) })
        .eq('member_id', memberId)
        .eq('gym_id', gymId)
        .gte('paid_at', oldJoinDate + 'T00:00:00')
        .lte('paid_at', oldJoinDate + 'T23:59:59');
    } catch(e) {
      console.warn('[Flym] paid_at sync failed:', e.message);
    }
  }

  safeLog(gymId, 'member_updated', `Member updated: ${payload.full_name}`);
  return data || { id: memberId, gym_id: gymId, ...payload };
}

export async function deleteMember(memberId, gymId) {
  const { error } = await supabase
    .from('members')
    .update({ is_active: false })
    .eq('id', memberId)
    .eq('gym_id', gymId);
  if (error) throw error;
  safeLog(gymId, 'member_deleted', `Member deactivated (ID: ${memberId})`);
}

/**
 * Records a payment against a member's outstanding balance_due.
 * Supports partial settlement (amountPaid < balance_due) or full settle.
 * Inserts a payment_history row and flips payment_status to 'Paid' once
 * the balance reaches zero (otherwise stays 'Partial').
 */
export async function clearBalance(memberId, gymId, amountPaid, paymentMode) {
  const { data: member, error: fetchErr } = await supabase
    .from('members')
    .select('balance_due, plan_id, plan_name')
    .eq('id', memberId)
    .eq('gym_id', gymId)
    .single();
  if (fetchErr) throw fetchErr;

  const currentBalance = parseFloat(member?.balance_due) || 0;
  const paid = num(amountPaid) || 0;
  if (paid <= 0) throw new Error('Enter an amount greater than zero.');
  if (paid > currentBalance) throw new Error(`Amount cannot exceed the balance due (₹${currentBalance.toLocaleString('en-IN')}).`);

  const newBalance = Math.round((currentBalance - paid) * 100) / 100;
  const newStatus  = newBalance <= 0 ? 'Paid' : 'Partial';

  const { data, error } = await supabase
    .from('members')
    .update({ balance_due: newBalance, payment_status: newStatus })
    .eq('id', memberId)
    .eq('gym_id', gymId)
    .select()
    .single();
  if (error && error.code !== 'PGRST116') throw error;

  // HARDENED: await payment_history insert — balance payments must be recorded
  const { error: phErr } = await supabase.from('payment_history').insert({
    gym_id: gymId, member_id: memberId,
    amount: paid,
    payment_mode: txt(paymentMode) || 'Cash',
    plan_id: member?.plan_id || null, plan_name: member?.plan_name || null,
    notes: 'Balance payment',
  });
  if (phErr) {
    console.error('[Flym] CRITICAL: balance payment_history insert failed:', phErr.message);
    // Don't throw — member balance was already updated. But warn loudly.
  }
  safeLog(gymId, 'balance_cleared', `₹${paid.toLocaleString('en-IN')} balance payment recorded`);

  return data || { id: memberId, gym_id: gymId, balance_due: newBalance, payment_status: newStatus };
}

/**
 * Cancels a member's membership WITHOUT deleting/hiding them.
 * The member stays in the active list with a "Cancelled" badge —
 * distinct from deleteMember() which soft-deletes (is_active=false)
 * and removes them from view entirely.
 */
export async function cancelMembership(memberId, gymId) {
  const { data, error } = await supabase
    .from('members')
    .update({ cancelled_at: new Date().toISOString() })
    .eq('id', memberId)
    .eq('gym_id', gymId)
    .select()
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  safeLog(gymId, 'membership_cancelled', `Membership cancelled (ID: ${memberId})`);
  return data || { id: memberId, gym_id: gymId, cancelled_at: new Date().toISOString() };
}

/** Undoes cancelMembership — clears cancelled_at. */
export async function reactivateMembership(memberId, gymId) {
  const { data, error } = await supabase
    .from('members')
    .update({ cancelled_at: null })
    .eq('id', memberId)
    .eq('gym_id', gymId)
    .select()
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  safeLog(gymId, 'membership_reactivated', `Membership reactivated (ID: ${memberId})`);
  return data || { id: memberId, gym_id: gymId, cancelled_at: null };
}

export async function logReminder(gymId, memberId, message) {
  safeInsert('reminder_logs', { gym_id: gymId, member_id: memberId, message: txt(message), channel: 'whatsapp' });
  safeLog(gymId, 'reminder_sent', 'WhatsApp reminder sent to member');
}

export async function getPaymentHistory(gymId) {
  // !inner = inner join — excludes payments whose member was soft-deleted
  // (is_active=false). Without this, deleted members' payments still count
  // in Finance revenue and Overview stats.
  const { data, error } = await supabase
    .from('payment_history')
    .select('*, members!inner(full_name, phone)')
    .eq('gym_id', gymId)
    .eq('members.is_active', true)
    .order('paid_at', { ascending: false })
    .limit(1000);
  if (error) throw error;
  return data || [];
}

/** Get payment history for a specific month (YYYY-MM) */
export async function getPaymentsByMonth(gymId, month) {
  const startDate = month + '-01';
  const [y, mo] = month.split('-').map(Number);
  const endDate = new Date(y, mo, 0).toISOString().split('T')[0]; // last day of month
  const { data, error } = await supabase
    .from('payment_history')
    .select('*, members!inner(full_name, phone)')
    .eq('gym_id', gymId)
    .eq('members.is_active', true)
    .gte('paid_at', startDate + 'T00:00:00')
    .lte('paid_at', endDate + 'T23:59:59')
    .order('paid_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ── Private helpers ───────────────────────────────────────────────

function safeLog(gymId, action, description) {
  supabase.from('activity_log')
    .insert({ gym_id: gymId, action, description })
    .then(() => {})
    .catch(err => console.warn('[Flym] activity_log insert failed:', err.message));
  // Prune rows older than 90 days (fire-and-forget, ~1% of calls)
  if (Math.random() < 0.01) {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    supabase.from('activity_log')
      .delete()
      .eq('gym_id', gymId)
      .lt('created_at', cutoff)
      .then(() => {})
      .catch(() => {});
  }
}

function safeInsert(table, row) {
  supabase.from(table)
    .insert(row)
    .then(() => {})
    .catch(err => console.warn(`[Flym] ${table} insert failed:`, err.message));
}

export async function getGymActivity(gymId, limit = 20) {
  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .eq('gym_id', gymId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}
