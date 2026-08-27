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

/**
 * True when an RPC failed only because migration 033 has not been applied
 * to this database yet.
 *
 * PGRST202 = PostgREST could not find the function in its schema cache.
 * 42883    = Postgres "function does not exist".
 *
 * Anything else — a validation error raised by the function, an RLS
 * refusal, a network failure — is a REAL error and must NOT be swallowed
 * into the legacy path, or a rejected payment would get retried
 * non-atomically and could double-record.
 */
function isMissingFunction(error) {
  if (!error) return false;
  const code = String(error.code || '');
  if (code === 'PGRST202' || code === '42883') return true;
  return /could not find the function|function .* does not exist/i.test(error.message || '');
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

/**
 * Every member of a gym, paged — no cap.
 *
 * `getMembers()` deliberately stops at 5,000 because that array drives
 * the dashboard UI. Exports and backups must not: a backup that quietly
 * omits members 5,001+ is worse than no backup, because the owner
 * believes they are covered. Anything that writes a file to disk should
 * use this, not S.members.
 *
 * Ordering is (join_date DESC, id DESC) rather than join_date alone —
 * join_date is a DATE, so bulk-imported members share it exactly, and
 * without a tiebreaker rows shuffle between pages and the export ends up
 * with duplicates and omissions.
 */
export async function getAllMembers(gymId) {
  const PAGE = 1000;
  const MAX  = 200_000;
  const out = [];

  for (let from = 0; from < MAX; from += PAGE) {
    const { data, error } = await supabase
      .from('members_with_status')
      .select('*')
      .eq('gym_id', gymId)
      .order('join_date', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + PAGE - 1);

    if (error) throw error;
    const page = data || [];
    out.push(...page);
    if (page.length < PAGE) return out;
  }

  console.warn(`[Sculpt] getAllMembers hit the ${MAX}-row ceiling — export is incomplete.`);
  out._truncated = true;
  return out;
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
    // Application numbers are auto-generated server-side inside
    // sculpt_add_member now — never typed. This column is kept on the
    // payload only for the pre-033 fallback insert below; the RPC call
    // ignores whatever's in p_application_number.
    application_number:   null,
    aadhar_number:        txt(d.aadharNumber),
    discount_amount:      num(d.discountAmount) || 0,
    balance_due:          num(d.balanceDue) || 0,
    added_by_staff_id:    txt(d.addedByStaffId),
    added_by_name:        txt(d.addedByName),
  };

  const amountPaidNow = d.amountPaidNow != null ? (num(d.amountPaidNow) || 0) : (payload.plan_price || 0);
  const paymentNotes  = payload.member_addons ? `Addons: ${payload.member_addons}` : null;

  // ── Preferred path: one transaction (migration 033) ─────────────
  // The member row and the joining payment commit together. Previously a
  // dropped connection between the two writes created a member whose
  // money was never recorded, undetectably.
  const rpc = await supabase.rpc('sculpt_add_member', {
    p_id:                   memberId,
    p_gym_id:               gymId,
    p_full_name:            payload.full_name,
    p_phone:                payload.phone,
    p_email:                payload.email,
    p_date_of_birth:        payload.date_of_birth,
    p_gender:               payload.gender,
    p_join_date:            payload.join_date,
    p_plan_id:              payload.plan_id,
    p_plan_name:            payload.plan_name,
    p_plan_price:           payload.plan_price,
    p_plan_duration_months: payload.plan_duration_months,
    p_member_addons:        payload.member_addons,
    p_expiry_date:          payload.expiry_date,
    p_payment_mode:         payload.payment_mode,
    p_payment_status:       payload.payment_status,
    p_member_type:          payload.member_type,
    p_notes:                payload.notes,
    p_application_number:   payload.application_number,
    p_aadhar_number:        payload.aadhar_number,
    p_discount_amount:      payload.discount_amount,
    p_balance_due:          payload.balance_due,
    p_amount_paid:          amountPaidNow,
    p_paid_at:              toPaidAtTimestamp(payload.join_date),
    p_payment_notes:        paymentNotes,
    p_added_by_staff_id:    payload.added_by_staff_id,
    p_added_by_name:        payload.added_by_name,
  });

  if (!rpc.error) {
    safeLog(gymId, 'member_added', `New member added: ${payload.full_name}`);
    // Atomic path — if we got here the payment row is committed too.
    return { ...(rpc.data || { id: memberId, ...payload }), _paymentRecorded: true };
  }

  // sculpt_add_member is what generates the application number a member
  // needs to log in — there is no safe degraded path here any more.
  // A raw insert would silently produce a member with
  // application_number = null who can never sign in, and nothing in the
  // UI would tell staff that happened. Fail loudly instead.
  //
  // IMPORTANT: PGRST202 does NOT mean "the function doesn't exist" —
  // PostgREST returns the exact same code when the function exists but
  // no overload matches the named arguments this call sent (a renamed,
  // added or removed parameter). Asserting "missing, contact support"
  // here previously sent two sessions chasing a phantom missing
  // function when the real bug was a client/server signature drift —
  // see CLAUDE.md. Only Postgres's own 42883 genuinely means "does not
  // exist"; for PGRST202, print what this file actually sent alongside
  // the server's own message (which names the signature it searched
  // for) so the two can be diffed directly instead of guessed at.
  //
  // 42883 ALSO doesn't necessarily mean sculpt_add_member is missing —
  // Postgres raises the identical code when sculpt_add_member exists
  // and runs, but calls a HELPER inside its own body that doesn't
  // exist (this happened for real: migration 104's sculpt_add_member
  // called flym_assert_payment_mode, a name migration 100 had already
  // renamed away — see 114_fix_add_member_stale_helper_call.sql).
  // rpc.error.message is Postgres's own text and already names the
  // actual missing function; pull it out instead of hardcoding
  // "sculpt_add_member" and asserting it's the culprit.
  if (rpc.error.code === '42883') {
    const missing = /function\s+(?:public\.)?"?([a-zA-Z0-9_]+)"?\(/i.exec(rpc.error.message || '')?.[1];
    const what = missing ? `the ${missing} database function` : 'a database function this call depends on';
    throw new Error(`Could not save this member: ${what} does not exist. Server said: ${rpc.error.message}`);
  }
  if (rpc.error.code === 'PGRST202') {
    const attempted = ['p_id', 'p_gym_id', 'p_full_name', 'p_phone', 'p_email', 'p_date_of_birth',
      'p_gender', 'p_join_date', 'p_plan_id', 'p_plan_name', 'p_plan_price', 'p_plan_duration_months',
      'p_member_addons', 'p_expiry_date', 'p_payment_mode', 'p_payment_status', 'p_member_type',
      'p_notes', 'p_application_number', 'p_aadhar_number', 'p_discount_amount', 'p_balance_due',
      'p_amount_paid', 'p_paid_at', 'p_payment_notes', 'p_added_by_staff_id', 'p_added_by_name'].join(', ');
    throw new Error(
      `Could not save this member: sculpt_add_member did not accept this call (PGRST202) — ` +
      `this usually means the deployed function's parameters no longer match what this file sends, ` +
      `not that the function is missing. Attempted signature: (${attempted}). Server said: ${rpc.error.message}`
    );
  }
  throw new Error(rpc.error.message || 'Could not save this member.');
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
  // Explicit expiry edit (migration 122 — set_member_expiry only
  // auto-recomputes when join_date/plan_duration_months actually change,
  // so this sticks for Paid/Unpaid too, not just Trial).
  if (u.expiryDate !== undefined) payload.expiry_date = txt(u.expiryDate);
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

  if (error && error.code !== 'PGRST116') {
    if (error.code === '23505' && /ux_members_gym_phone_active/.test(error.message || '')) {
      throw new Error('This phone number is already registered to another member at this gym.');
    }
    throw error;
  }

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
      console.warn('[Sculpt] paid_at sync failed:', e.message);
    }
  }

  safeLog(gymId, 'member_updated', `Member updated: ${payload.full_name}`);
  return data || { id: memberId, gym_id: gymId, ...payload };
}

/**
 * Renew a membership and record the renewal payment as ONE operation.
 *
 * Previously the renew modal did this as three separate requests:
 * update the member, clear cancelled_at, insert the payment. A phone
 * that lost signal partway through left the membership extended with
 * the money missing from Finance — and nothing could detect it later,
 * because the member record looked completely normal.
 *
 * @returns the saved member row, plus `_paymentRecorded: false` if the
 *          membership was renewed but the payment row could not be
 *          written (only reachable on the pre-033 fallback path).
 */
export async function renewMember(memberId, gymId, r) {
  const amountPaid = num(r.amountPaid) || 0;
  const paidAt     = toPaidAtTimestamp(r.joinDate);
  const addons     = r.memberAddons == null
    ? null
    : (typeof r.memberAddons === 'string' ? r.memberAddons : JSON.stringify(r.memberAddons));
  const notes      = r.paymentNotes || 'Membership renewal';

  // ── Preferred path: one transaction (migration 033) ─────────────
  const rpc = await supabase.rpc('sculpt_renew_member', {
    p_member_id:            memberId,
    p_gym_id:               gymId,
    p_plan_id:              txt(r.planId),
    p_plan_name:            txt(r.planName),
    p_plan_price:           num(r.planPrice),
    p_plan_duration_months: int(r.planDurationMonths),
    p_join_date:            txt(r.joinDate),
    p_member_addons:        addons,
    p_payment_mode:         txt(r.paymentMode),
    p_payment_status:       txt(r.paymentStatus) || 'Paid',
    p_member_type:          txt(r.memberType) || 'Paid',
    p_discount_amount:      num(r.discountAmount) || 0,
    p_balance_due:          num(r.balanceDue) || 0,
    p_amount_paid:          amountPaid,
    p_paid_at:              paidAt,
    p_payment_notes:        notes,
  });

  if (!rpc.error) {
    safeLog(gymId, 'member_renewed', `Membership renewed: ${txt(r.fullName) || memberId}`);
    return { ...(rpc.data || {}), _paymentRecorded: true };
  }
  if (!isMissingFunction(rpc.error)) throw new Error(rpc.error.message || 'Renewal failed.');

  // ── Fallback: pre-033 databases. Same sequence as before. ───────
  // skipPaidAtSync: a renewal creates a NEW payment; historic payments
  // must keep their original dates.
  const saved = await updateMember(memberId, gymId, {
    fullName: r.fullName, phone: r.phone, email: r.email,
    dateOfBirth: r.dateOfBirth, gender: r.gender, joinDate: r.joinDate,
    planId: r.planId, planName: r.planName, planPrice: r.planPrice,
    planDurationMonths: r.planDurationMonths, memberAddons: addons,
    paymentMode: r.paymentMode, paymentStatus: r.paymentStatus,
    memberType: r.memberType, notes: r.notes,
    discountAmount: r.discountAmount, balanceDue: r.balanceDue,
  }, { skipPaidAtSync: true });

  if (r.wasCancelled) {
    await supabase.from('members')
      .update({ cancelled_at: null }).eq('id', memberId).eq('gym_id', gymId);
  }

  let _paymentRecorded = true;
  if (amountPaid > 0) {
    try {
      const { error: phErr } = await supabase.from('payment_history').insert({
        gym_id: gymId, member_id: memberId,
        amount: amountPaid,
        payment_mode: txt(r.paymentMode) || 'Cash',
        plan_id: txt(r.planId), plan_name: txt(r.planName),
        paid_at: paidAt,
        notes,
      });
      if (phErr) {
        console.error('[Sculpt] CRITICAL: renewal payment_history failed:', phErr.message);
        _paymentRecorded = false;
      }
    } catch (err) {
      console.error('[Sculpt] CRITICAL: renewal payment_history threw:', err.message);
      _paymentRecorded = false;
    }
  }

  return { ...(saved || { id: memberId, gym_id: gymId }), _paymentRecorded };
}

// Soft delete (is_active=false, payment_history untouched) — no longer
// reachable from the UI as of 2026-08-27 (see deleteMemberPermanently
// below and its call sites in member-modals.js/members.js). Kept only as
// a test-cleanup convenience (window.__sculptMembers, used by
// tests/add-member.spec.js etc. to remove throwaway members that were
// never given a payment, so there's nothing for this to leave behind).
// Do not wire this back into a user-facing action without the product
// decision that led to migration 129 being revisited first.
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
 * Hard delete — the only member-deletion path the UI offers (client's
 * explicit call, 2026-08-27, superseding migration 121's soft-delete
 * default): erases the member row AND their payment_history (via
 * ON DELETE CASCADE, migration 129_sculpt_delete_member_permanently),
 * so they come out of Finance/Overview/Analytics/reports too. No Undo.
 * Owner-only; the RPC itself is the real gate (get_my_gym_id()), not
 * this client check.
 */
export async function deleteMemberPermanently(memberId, gymId) {
  const { data, error } = await supabase.rpc('sculpt_delete_member_permanently', {
    p_member_id: memberId,
    p_gym_id: gymId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.out_status !== 'OK') {
    throw new Error(row?.out_message || 'Permanent delete failed.');
  }
  safeLog(gymId, 'member_deleted_permanently', `Member permanently deleted, including payment history (ID: ${memberId})`);
}

/**
 * Records a payment against a member's outstanding balance_due.
 * Supports partial settlement (amountPaid < balance_due) or full settle.
 * Inserts a payment_history row and flips payment_status to 'Paid' once
 * the balance reaches zero (otherwise stays 'Partial').
 */
export async function clearBalance(memberId, gymId, amountPaid, paymentMode) {
  const paidRpc = num(amountPaid) || 0;
  const modeRpc = txt(paymentMode) || 'Cash';

  // ── Preferred path: one transaction (migration 033) ─────────────
  // Balance update + payment row commit together or not at all, and
  // FOR UPDATE inside the function serialises two devices collecting
  // against the same member.
  const rpc = await supabase.rpc('sculpt_clear_balance', {
    p_member_id:    memberId,
    p_gym_id:       gymId,
    p_amount:       paidRpc,
    p_payment_mode: modeRpc,
  });

  if (!rpc.error) {
    safeLog(gymId, 'balance_cleared', `₹${paidRpc.toLocaleString('en-IN')} balance payment recorded`);
    return { ...(rpc.data || {}), _paymentRecorded: true };
  }
  // A validation/RLS/network error is real — surface it. Only fall back
  // when the function simply isn't in the database yet.
  if (!isMissingFunction(rpc.error)) throw new Error(rpc.error.message || 'Failed to record payment.');

  // ── Fallback: pre-033 databases. Compare-and-swap, not atomic. ──
  return clearBalanceLegacy(memberId, gymId, amountPaid, paymentMode);
}

async function clearBalanceLegacy(memberId, gymId, amountPaid, paymentMode) {
  const { data: member, error: fetchErr } = await supabase
    .from('members')
    .select('balance_due, plan_id, plan_name')
    .eq('id', memberId)
    .eq('gym_id', gymId)
    .single();
  if (fetchErr) throw fetchErr;

  const rawBalance     = member?.balance_due;
  const currentBalance = parseFloat(rawBalance) || 0;
  const paid = num(amountPaid) || 0;
  if (paid <= 0) throw new Error('Enter an amount greater than zero.');
  if (paid > currentBalance) throw new Error(`Amount cannot exceed the balance due (₹${currentBalance.toLocaleString('en-IN')}).`);

  const newBalance = Math.round((currentBalance - paid) * 100) / 100;
  const newStatus  = newBalance <= 0 ? 'Paid' : 'Partial';

  // ── Compare-and-swap, not a blind write ─────────────────────────
  // This used to be read → compute in JS → write, which loses updates.
  // Two devices collecting against the same member both read the old
  // balance, and the second write silently overwrites the first: the
  // member ends up owing money they already paid, while BOTH payment
  // rows land in Finance. The books and the member's account disagree,
  // permanently, with nothing to flag it.
  //
  // Pinning the update to the balance we actually read makes the write
  // conditional. If anyone changed the row in between, zero rows match
  // and we refuse instead of clobbering.
  //
  // rawBalance is passed through verbatim (not the parsed float) so no
  // JS number formatting can drift away from the stored NUMERIC.
  let upd = supabase
    .from('members')
    .update({ balance_due: newBalance, payment_status: newStatus })
    .eq('id', memberId)
    .eq('gym_id', gymId);
  upd = (rawBalance === null || rawBalance === undefined)
    ? upd.is('balance_due', null)
    : upd.eq('balance_due', rawBalance);

  const { data: rows, error } = await upd.select('id, gym_id, balance_due, payment_status');
  if (error) throw error;

  // Zero rows can only mean the balance moved under us. It cannot mean
  // "RLS blocked the select-back" — the SELECT at the top of this
  // function already succeeded for this user on this exact row.
  if (!rows || rows.length === 0) {
    throw new Error(
      'This member’s balance was changed on another device just now. ' +
      'Close this and reopen it to see the current amount — no payment has been recorded.'
    );
  }
  const data = rows[0];

  // HARDENED: await payment_history insert — balance payments must be recorded.
  // The member's balance has already been reduced at this point, so a failure
  // here means money was collected but not recorded. The caller MUST surface
  // _paymentRecorded === false to the user; it is not safe to swallow.
  let _paymentRecorded = true;
  const { error: phErr } = await supabase.from('payment_history').insert({
    gym_id: gymId, member_id: memberId,
    amount: paid,
    payment_mode: txt(paymentMode) || 'Cash',
    plan_id: member?.plan_id || null, plan_name: member?.plan_name || null,
    notes: 'Balance payment',
  });
  if (phErr) {
    console.error('[Sculpt] CRITICAL: balance payment_history insert failed:', phErr.message);
    _paymentRecorded = false;
  }
  safeLog(gymId, 'balance_cleared', `₹${paid.toLocaleString('en-IN')} balance payment recorded`);

  return { ...data, _paymentRecorded };
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

/**
 * Reissues a member's application number (sculpt_regenerate_application_number,
 * migration 104). Deliberate action, not something that happens silently —
 * a stale WhatsApp message with the old number stops working the moment
 * this runs.
 */
export async function regenerateApplicationNumber(memberId, gymId) {
  const { data, error } = await supabase.rpc('sculpt_regenerate_application_number', {
    p_member_id: memberId,
    p_gym_id: gymId,
  });
  if (error) throw new Error(error.message || 'Could not regenerate the application number.');
  return data;
}

export async function logReminder(gymId, memberId, message) {
  safeInsert('reminder_logs', { gym_id: gymId, member_id: memberId, message: txt(message), channel: 'whatsapp' });
  safeLog(gymId, 'reminder_sent', 'WhatsApp reminder sent to member');
}

/**
 * Latest reminder_logs.created_at per member, for the current gym.
 * Used by Member Alerts (AUDIT.md C8) to show "last reminded" and to
 * cooldown-gate repeat reminders — reminder_logs is append-only (every
 * send is its own row), so this reduces client-side to the max per
 * member rather than needing a separate "last reminded" column anywhere.
 * Capped at the most recent 500 log rows for the gym; a gym sending more
 * than 500 reminders between two Alerts page loads is not a case this
 * needs to handle precisely — it would just under-report "last
 * reminded" for the oldest of that burst, not misreport it as none.
 */
export async function getLastReminders(gymId) {
  if (!gymId) return {};
  const { data, error } = await supabase
    .from('reminder_logs')
    .select('member_id, created_at')
    .eq('gym_id', gymId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) { console.warn('[Sculpt] getLastReminders:', error.message); return {}; }
  const map = {};
  (data || []).forEach(r => { if (!map[r.member_id]) map[r.member_id] = r.created_at; });
  return map;
}

// ── Payment history paging ────────────────────────────────────────
// Every revenue figure in the product (Finance, Overview, Analytics,
// P&L, GST summary, backups) is a JS sum over the array these two
// functions return. A `.limit()` here does not truncate a *list* — it
// silently truncates MONEY, with no warning anywhere in the UI.
//
// So we page through the whole result set instead of capping it.
//
// Two details that matter:
//  1. The sort must be STABLE. `paid_at` alone is not unique — addMember
//     stamps every payment at noon of the join date, so bulk-added members
//     share a timestamp exactly. With an unstable sort, rows shuffle
//     between pages and the total comes out wrong (rows counted twice or
//     skipped). Adding `id` as a tiebreaker makes the order total.
//  2. There is still a hard ceiling, but it is a *reported* one. If we
//     ever hit it the array carries `_truncated = true` so the caller can
//     say so out loud rather than quietly under-reporting revenue.
const PAY_PAGE_SIZE = 1000;
const PAY_MAX_ROWS  = 100_000;

async function fetchAllPayments(buildQuery) {
  const out = [];
  let truncated = false;

  for (let from = 0; from < PAY_MAX_ROWS; from += PAY_PAGE_SIZE) {
    const to = from + PAY_PAGE_SIZE - 1;
    const { data, error } = await buildQuery()
      .order('paid_at', { ascending: false })
      .order('id',      { ascending: false })   // stable tiebreaker — see note 1
      .range(from, to);

    if (error) throw error;
    const page = data || [];
    out.push(...page);

    if (page.length < PAY_PAGE_SIZE) return out;   // last page
    if (out.length >= PAY_MAX_ROWS) { truncated = true; break; }
  }

  if (truncated) {
    console.warn(`[Sculpt] payment history hit the ${PAY_MAX_ROWS}-row ceiling — totals are incomplete.`);
    out._truncated = true;
  }
  return out;
}

export async function getPaymentHistory(gymId) {
  // Historical payments must survive a member being deleted (FIX-PROMPT.md
  // item 12 — deletion is soft (is_active=false) and revenue reports must
  // still reconcile against the gym's real lifetime total). This used to
  // `!inner`-join and filter members.is_active=true, which silently
  // dropped a deleted member's entire payment history from every revenue
  // total the moment they were deleted. Left join instead — a payment row
  // always has a member row (FK), active or not.
  return fetchAllPayments(() => supabase
    .from('payment_history')
    .select('*, members(full_name, phone)')
    .eq('gym_id', gymId));
}

/** Get payment history for a specific month (YYYY-MM) */
export async function getPaymentsByMonth(gymId, month) {
  const startDate = month + '-01';
  const [y, mo] = month.split('-').map(Number);
  // Local (not UTC) last-day-of-month. toISOString() would shift IST
  // midnight back a day and drop the final day's payments.
  const last = new Date(y, mo, 0);
  const endDate = last.getFullYear() + '-' +
    String(last.getMonth() + 1).padStart(2, '0') + '-' +
    String(last.getDate()).padStart(2, '0');
  return fetchAllPayments(() => supabase
    .from('payment_history')
    .select('*, members(full_name, phone)')
    .eq('gym_id', gymId)
    .gte('paid_at', startDate + 'T00:00:00')
    .lte('paid_at', endDate + 'T23:59:59'));
}

// ── Server-side revenue aggregation (migration 035) ───────────────
// Each of these returns `null` — not an empty result — when migration
// 035 has not been applied. `null` means "ask the old way"; an empty
// result means "genuinely no revenue". Conflating the two would show a
// gym ₹0 instead of falling back, which is exactly the kind of silent
// wrong number this whole exercise is about.
//
// Period boundaries are always computed by the caller and passed in, so
// the server never has to decide what "this month" means and the two
// code paths cannot drift apart. See the header of migration 035.

const iso = (d) => (d instanceof Date && !isNaN(d) ? d.toISOString() : null);

/** Totals + payment-mode split for one period. */
export async function getRevenueSummary(gymId, start, end) {
  const { data, error } = await supabase.rpc('sculpt_revenue_summary', {
    p_gym_id: gymId, p_start: iso(start), p_end: iso(end),
  });
  if (error) {
    if (isMissingFunction(error)) return null;
    throw new Error(error.message || 'Could not load revenue.');
  }
  const r = Array.isArray(data) ? data[0] : data;
  return {
    total:  parseFloat(r?.total_amount)  || 0,
    count:  parseInt(r?.payment_count, 10) || 0,
    cash:   parseFloat(r?.cash_amount)   || 0,
    card:   parseFloat(r?.card_amount)   || 0,
    online: parseFloat(r?.online_amount) || 0,
  };
}

/** Totals for a list of date buckets (the 6-month chart), in one call. */
export async function getRevenueMonthly(gymId, buckets) {
  const { data, error } = await supabase.rpc('sculpt_revenue_monthly', {
    p_gym_id: gymId,
    p_starts: buckets.map(b => iso(b.start)),
    p_ends:   buckets.map(b => iso(b.end)),
  });
  if (error) {
    if (isMissingFunction(error)) return null;
    throw new Error(error.message || 'Could not load revenue trend.');
  }
  const byIndex = new Map((data || []).map(r => [Number(r.bucket_index), parseFloat(r.total_amount) || 0]));
  // generate_subscripts is 1-based.
  return buckets.map((_, i) => byIndex.get(i + 1) || 0);
}

/** One page of the revenue drill-down table. */
export async function getRevenueRows(gymId, start, end, limit = 200, offset = 0) {
  const { data, error } = await supabase.rpc('sculpt_revenue_rows', {
    p_gym_id: gymId, p_start: iso(start), p_end: iso(end),
    p_limit: limit, p_offset: offset,
  });
  if (error) {
    if (isMissingFunction(error)) return null;
    throw new Error(error.message || 'Could not load payments.');
  }
  return (data || []).map(r => ({
    memberName: r.member_name || '—',
    amount:     r.amount,
    mode:       r.payment_mode,
    planName:   r.plan_name,
    paidAt:     r.paid_at,
  }));
}

// ── Private helpers ───────────────────────────────────────────────

function safeLog(gymId, action, description) {
  supabase.from('activity_log')
    .insert({ gym_id: gymId, action, description })
    .then(() => {})
    .catch(err => console.warn('[Sculpt] activity_log insert failed:', err.message));
  // Pruning used to happen here: a DELETE of everything older than 90
  // days, fired from the browser on a random ~1% of member writes. That
  // is an unpredictable full-table delete triggered by whichever gym
  // owner happens to be using the app, and it gets slower as the table
  // grows. cleanup_old_logs() has existed since migration 001 for
  // exactly this; migration 034 finally schedules it on pg_cron.
}

function safeInsert(table, row) {
  supabase.from(table)
    .insert(row)
    .then(() => {})
    .catch(err => console.warn(`[Sculpt] ${table} insert failed:`, err.message));
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

// Test-only hook, same convention as window.__sculptCheckin in
// lib/checkin.js — lets tests/security.spec.js create/remove disposable
// members against the built preview server without a UI form.
if (typeof window !== 'undefined') {
  window.__sculptMembers = { addMember, deleteMember, deleteMemberPermanently, getMembers };
}
