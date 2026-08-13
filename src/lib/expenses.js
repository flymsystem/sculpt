import { supabase } from './supabase.js';

const txt = v => { const s = (v ?? '').toString().trim(); return s || null; };
const num = v => { const raw = (v ?? '').toString().replace(/,/g, ''); const n = parseFloat(raw); return isNaN(n) ? null : n; };
// Local (not UTC) "today" — new Date().toISOString() reads UTC, which is wrong
// for ~5.5 hours every night in IST (00:00–05:29 local is still "yesterday" in UTC).
const todayLocalISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };

/** Get expenses for a specific month (e.g. '2026-05') */
export async function getExpenses(gymId, month) {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('gym_id', gymId)
    .eq('expense_month', month)
    .order('expense_date', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ── Paging ────────────────────────────────────────────────────────
// Expense totals feed Finance, the P&L report, the year-end summary and
// the GST summary. PostgREST applies a server-side row cap of its own,
// so an un-paged query silently returns a prefix — which for money means
// a total that is simply too low, with nothing to indicate it.
//
// Ordered by (expense_date DESC, id DESC): expense_date is a DATE, so
// same-day expenses tie exactly and need a tiebreaker for paging to be
// stable, or rows shuffle between pages and the sum comes out wrong.
const EXP_PAGE = 1000;
const EXP_MAX  = 100_000;

async function fetchAllExpenses(buildQuery) {
  const out = [];
  for (let from = 0; from < EXP_MAX; from += EXP_PAGE) {
    const { data, error } = await buildQuery()
      .order('expense_date', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + EXP_PAGE - 1);
    if (error) throw error;
    const page = data || [];
    out.push(...page);
    if (page.length < EXP_PAGE) return out;
  }
  console.warn(`[Flym] expenses hit the ${EXP_MAX}-row ceiling — totals are incomplete.`);
  out._truncated = true;
  return out;
}

/** Get expenses across a date range (for Finance section) */
export async function getExpensesByRange(gymId, startDate, endDate) {
  return fetchAllExpenses(() => {
    let q = supabase.from('expenses').select('*').eq('gym_id', gymId);
    if (startDate) q = q.gte('expense_date', startDate);
    if (endDate)   q = q.lte('expense_date', endDate);
    return q;
  });
}

/** Get all expenses for a gym (for "All Time" in Finance) */
export async function getAllExpenses(gymId) {
  return fetchAllExpenses(() => supabase
    .from('expenses')
    .select('*')
    .eq('gym_id', gymId));
}

/** Get monthly expense totals for the last N months (for charts) */
export async function getMonthlyExpenseTotals(gymId, months = 6) {
  const result = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    result.push({ month: key, label: d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }) });
  }
  const firstMonth = result[0].month;
  const { data, error } = await supabase
    .from('expenses')
    .select('amount, expense_month')
    .eq('gym_id', gymId)
    .gte('expense_month', firstMonth);
  if (error) return result.map(r => ({ ...r, total: 0 }));
  const totals = {};
  (data || []).forEach(e => {
    totals[e.expense_month] = (totals[e.expense_month] || 0) + parseFloat(e.amount);
  });
  return result.map(r => ({ ...r, total: totals[r.month] || 0 }));
}

export async function addExpense(gymId, d) {
  const category = txt(d.category);
  if (!category) throw new Error('Category is required.');
  const amount = num(d.amount);
  if (amount === null || amount < 0) throw new Error('Amount must be ₹0 or more.');
  const expenseDate = txt(d.expenseDate) || todayLocalISO();
  const expenseMonth = expenseDate.slice(0, 7); // '2026-05'

  const { data, error } = await supabase.from('expenses').insert({
    gym_id: gymId,
    category,
    description: txt(d.description),
    amount,
    expense_date: expenseDate,
    expense_month: expenseMonth,
    is_recurring: !!d.isRecurring,
  }).select().single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || { id: 'local_' + Date.now(), gym_id: gymId, category, amount, expense_date: expenseDate, expense_month: expenseMonth };
}

export async function updateExpense(id, gymId, u) {
  const payload = {};
  if (u.category !== undefined)    payload.category      = txt(u.category);
  if (u.description !== undefined) payload.description    = txt(u.description);
  if (u.amount !== undefined)      payload.amount         = num(u.amount);
  if (u.expenseDate !== undefined) {
    payload.expense_date  = txt(u.expenseDate);
    payload.expense_month = payload.expense_date ? payload.expense_date.slice(0, 7) : undefined;
  }
  if (u.isRecurring !== undefined) payload.is_recurring = !!u.isRecurring;
  Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

  const { data, error } = await supabase
    .from('expenses').update(payload)
    .eq('id', id).eq('gym_id', gymId)
    .select().single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || { id, ...payload };
}

export async function deleteExpense(id, gymId) {
  const { error } = await supabase
    .from('expenses').delete()
    .eq('id', id).eq('gym_id', gymId);
  if (error) throw error;
}

/** Copy recurring expenses from one month to another */
export async function carryForwardExpenses(gymId, fromMonth, toMonth) {
  const { data: recurring, error } = await supabase
    .from('expenses')
    .select('category, description, amount, is_recurring')
    .eq('gym_id', gymId)
    .eq('expense_month', fromMonth)
    .eq('is_recurring', true);
  if (error) throw error;
  if (!recurring || recurring.length === 0) return [];

  const firstOfMonth = toMonth + '-01';
  const rows = recurring.map(e => ({
    gym_id: gymId,
    category: e.category,
    description: e.description,
    amount: e.amount,
    expense_date: firstOfMonth,
    expense_month: toMonth,
    is_recurring: true,
  }));

  const { data, error: insErr } = await supabase
    .from('expenses').insert(rows).select();
  if (insErr) throw insErr;
  return data || rows;
}

/** Expense category presets */
export const EXPENSE_CATEGORIES = [
  { id: 'rent',        label: 'Rent',         icon: '🏠' },
  { id: 'electricity', label: 'Electricity',  icon: '⚡' },
  { id: 'water',       label: 'Water',        icon: '💧' },
  { id: 'cleaning',    label: 'Cleaning',     icon: '🧹' },
  { id: 'maintenance', label: 'Maintenance',  icon: '🔧' },
  { id: 'equipment',   label: 'Equipment',    icon: '🏋️' },
  { id: 'staff',       label: 'Staff Salary', icon: '👤' },
  { id: 'trainer',     label: 'Trainer Fee',  icon: '💪' },
  { id: 'supplements', label: 'Supplements',  icon: '🥤' },
  { id: 'marketing',   label: 'Marketing',    icon: '📢' },
  { id: 'insurance',   label: 'Insurance',    icon: '🛡️' },
  { id: 'other',       label: 'Other',        icon: '📋' },
];

export function getCategoryIcon(cat) {
  const found = EXPENSE_CATEGORIES.find(c => c.label.toLowerCase() === (cat || '').toLowerCase());
  return found ? found.icon : '📋';
}
