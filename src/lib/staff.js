// src/lib/staff.js — Staff management CRUD
import { supabase } from './supabase.js';

const txt = v => { const s = (v ?? '').toString().trim(); return s || null; };
const num = v => { const raw = (v ?? '').toString().replace(/,/g, ''); const n = parseFloat(raw); return isNaN(n) ? null : n; };

// Local (not UTC) YYYY-MM-DD. `new Date().toISOString().split('T')[0]`
// reads UTC, which is the PREVIOUS day for the first 5.5 hours of every
// IST day — so a salary paid at 1am on the 1st was dated the 30th, into
// the wrong month, in the wrong expense report.
const localISODate = (d) => d.getFullYear() + '-' +
  String(d.getMonth() + 1).padStart(2, '0') + '-' +
  String(d.getDate()).padStart(2, '0');
const todayLocalISO = () => localISODate(new Date());

// ── Staff CRUD ────────────────────────────────────────────────────

export async function getStaff(gymId) {
  const { data, error } = await supabase
    .from('staff')
    .select('*')
    .eq('gym_id', gymId)
    .eq('is_active', true)
    .order('full_name', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function addStaff(gymId, d) {
  if (!txt(d.fullName)) throw new Error('Staff name is required.');
  if (!txt(d.role)) throw new Error('Role is required.');

  const payload = {
    gym_id: gymId,
    full_name: txt(d.fullName),
    phone: txt(d.phone),
    role: txt(d.role),
    aadhaar: txt(d.aadhaar),
    salary_amount: num(d.salaryAmount) || 0,
    join_date: txt(d.joinDate) || todayLocalISO(),
    notes: txt(d.notes),
  };

  const { data, error } = await supabase
    .from('staff').insert(payload).select().single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || { id: 'local_' + Date.now(), ...payload, is_active: true, created_at: new Date().toISOString() };
}

export async function updateStaff(staffId, gymId, u) {
  const payload = {};
  if (u.fullName !== undefined)     payload.full_name     = txt(u.fullName);
  if (u.phone !== undefined)        payload.phone         = txt(u.phone);
  if (u.role !== undefined)         payload.role          = txt(u.role);
  if (u.aadhaar !== undefined)      payload.aadhaar       = txt(u.aadhaar);
  if (u.salaryAmount !== undefined) payload.salary_amount = num(u.salaryAmount) || 0;
  if (u.joinDate !== undefined)     payload.join_date     = txt(u.joinDate);
  if (u.notes !== undefined)        payload.notes         = txt(u.notes);
  if (u.photoUrl !== undefined)     payload.photo_url     = txt(u.photoUrl);
  payload.updated_at = new Date().toISOString();
  Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

  const { data, error } = await supabase
    .from('staff').update(payload)
    .eq('id', staffId).eq('gym_id', gymId)
    .select().single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || { id: staffId, ...payload };
}

export async function deleteStaff(staffId, gymId) {
  const { error } = await supabase
    .from('staff').update({ is_active: false })
    .eq('id', staffId).eq('gym_id', gymId);
  if (error) throw error;
}

// ── Attendance ────────────────────────────────────────────────────

export async function getAttendance(gymId, date) {
  const { data, error } = await supabase
    .from('staff_attendance')
    .select('*, staff(full_name, role)')
    .eq('gym_id', gymId)
    .eq('date', date)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// 50 staff x 365 days is ~18,000 rows for a year report. Bounded so a
// wide date range can't quietly become a multi-megabyte download on a
// phone. The caller shows "showing first N" when the cap is hit.
export const ATTENDANCE_MAX_ROWS = 5000;

export async function getAttendanceRange(gymId, startDate, endDate) {
  const { data, error } = await supabase
    .from('staff_attendance')
    .select('*, staff(full_name, role)')
    .eq('gym_id', gymId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: false })
    .limit(ATTENDANCE_MAX_ROWS);
  if (error) throw error;
  return data || [];
}

export async function upsertAttendance(gymId, staffId, date, status, checkIn, checkOut, notes) {
  const payload = {
    gym_id: gymId,
    staff_id: staffId,
    date,
    status: txt(status) || 'Present',
    check_in: txt(checkIn) || null,
    check_out: txt(checkOut) || null,
    notes: txt(notes) || null,
  };

  const { data, error } = await supabase
    .from('staff_attendance')
    .upsert(payload, { onConflict: 'staff_id,date' })
    .select()
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || payload;
}

// ── Salary Payments ───────────────────────────────────────────────

// Salary payments accumulate forever and this fetched all of them.
// Newest first, so the cap drops the oldest history rather than the
// rows anyone is looking at.
export const SALARY_MAX_ROWS = 2000;

export async function getSalaryPayments(gymId, staffId) {
  let q = supabase
    .from('staff_salary_payments')
    .select('*, staff(full_name, role)')
    .eq('gym_id', gymId)
    .order('payment_date', { ascending: false })
    .limit(SALARY_MAX_ROWS);
  if (staffId) q = q.eq('staff_id', staffId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function addSalaryPayment(gymId, d) {
  if (!txt(d.staffId)) throw new Error('Staff member is required.');
  const amount = num(d.amount);
  if (amount === null || amount <= 0) throw new Error('Amount must be greater than zero.');

  const payload = {
    gym_id: gymId,
    staff_id: txt(d.staffId),
    amount,
    payment_date: txt(d.paymentDate) || todayLocalISO(),
    payment_mode: txt(d.paymentMode) || 'Cash',
    is_advance: !!d.isAdvance,
    notes: txt(d.notes),
  };

  // Also create a linked expense entry
  const expMonth = payload.payment_date.slice(0, 7);
  let expData = null;
  try {
    const { data: ed } = await supabase.from('expenses').insert({
      gym_id: gymId,
      category: 'Staff Salary',
      description: txt(d.staffName) ? `Salary - ${txt(d.staffName)}${d.isAdvance ? ' (Advance)' : ''}` : `Staff Salary${d.isAdvance ? ' (Advance)' : ''}`,
      amount,
      expense_date: payload.payment_date,
      expense_month: expMonth,
      is_recurring: false,
    }).select().single();
    expData = ed;
  } catch (_) { /* expense link is optional — don't block salary payment */ }

  if (expData?.id) payload.expense_id = expData.id;

  const { data, error } = await supabase
    .from('staff_salary_payments').insert(payload).select().single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || { id: 'local_' + Date.now(), ...payload, created_at: new Date().toISOString() };
}

export async function deleteSalaryPayment(paymentId, gymId) {
  // Get the linked expense first
  const { data: pay } = await supabase
    .from('staff_salary_payments')
    .select('expense_id')
    .eq('id', paymentId)
    .eq('gym_id', gymId)
    .single();

  // Delete expense if linked
  if (pay?.expense_id) {
    try {
      await supabase.from('expenses').delete()
        .eq('id', pay.expense_id).eq('gym_id', gymId);
    } catch (_) { /* silent — expense might already be gone */ }
  }

  const { error } = await supabase
    .from('staff_salary_payments').delete()
    .eq('id', paymentId).eq('gym_id', gymId);
  if (error) throw error;
}

// Test-only hook, same convention as window.__sculptMembers in
// lib/members.js — lets tests create/remove disposable staff rows
// against the built preview server without a UI form.
if (typeof window !== 'undefined') {
  window.__sculptStaff = { getStaff, addStaff, deleteStaff };
}

/** Get total paid to a staff member in a given month (YYYY-MM) */
export async function getStaffMonthlyPaid(gymId, staffId, month) {
  const startDate = month + '-01';
  const [y, mo] = month.split('-').map(Number);
  const endDate = localISODate(new Date(y, mo, 0));   // last day of month, local
  const { data, error } = await supabase
    .from('staff_salary_payments')
    .select('amount, is_advance')
    .eq('gym_id', gymId)
    .eq('staff_id', staffId)
    .gte('payment_date', startDate)
    .lte('payment_date', endDate);
  if (error) return { paid: 0, advance: 0 };
  let paid = 0, advance = 0;
  (data || []).forEach(p => {
    if (p.is_advance) advance += parseFloat(p.amount) || 0;
    else paid += parseFloat(p.amount) || 0;
  });
  return { paid, advance };
}