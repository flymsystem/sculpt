// Verifies the live schema against what src/ actually queries, by asking
// PostgREST — the same interface the app uses — rather than a pg_dump.
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const URL_ = env.VITE_SUPABASE_URL, KEY = env.VITE_SUPABASE_ANON_KEY;

const TABLES = ['activity_log','addon_templates','enquiries','expenses','gym_users','gyms',
  'members','members_with_status','notifications','payment_history','plans',
  'push_subscriptions','staff','staff_attendance','staff_salary_payments','reminder_logs'];

const GONE = ['broadcasts','broadcast_recipients','support_messages','gym_subscriptions','reminder_failures'];

let bad = 0;
console.log('=== tables the app queries ===');
for (const t of TABLES) {
  const r = await fetch(`${URL_}/rest/v1/${t}?select=*&limit=0`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  const ok = r.status === 200;
  if (!ok) bad++;
  console.log(`  ${ok ? 'OK     ' : 'MISSING'} ${t}${ok ? '' : '  -> ' + r.status}`);
}

console.log('\n=== removed features (must be absent) ===');
for (const t of GONE) {
  const r = await fetch(`${URL_}/rest/v1/${t}?select=*&limit=0`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  const gone = r.status !== 200;
  if (!gone) bad++;
  console.log(`  ${gone ? 'absent ' : 'PRESENT'} ${t}`);
}

console.log('\n=== RPCs exposed (from the OpenAPI spec, nothing executed) ===');
const spec = await (await fetch(`${URL_}/rest/v1/`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })).json();
const rpcs = Object.keys(spec.paths || {}).filter(p => p.startsWith('/rpc/')).map(p => p.slice(5)).sort();
for (const f of ['flym_add_member','flym_renew_member','flym_clear_balance',
                 'flym_revenue_summary','flym_revenue_monthly','flym_revenue_rows',
                 'mark_notifications_read','switch_gym']) {
  const ok = rpcs.includes(f);
  if (!ok) bad++;
  console.log(`  ${ok ? 'OK     ' : 'MISSING'} ${f}`);
}
console.log('\n  all exposed rpcs:', rpcs.join(', '));
console.log(bad === 0 ? '\nRESULT: schema matches the code.' : `\nRESULT: ${bad} problem(s).`);
