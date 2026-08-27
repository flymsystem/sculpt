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
console.log('\n=== member login gym code (must match src/lib/member-auth.js GYM_CODE) ===');
// 2026-08-27: GYM_CODE was hardcoded to 'SCULPT01' while the live gyms
// row was 'DSCULPT' — every member login failed at the gym-lookup step,
// silently, because member-signin returns the same generic error for
// that as for a wrong phone number. This check is the guard against
// that drift recurring undetected.
//
// CLAUDE.md is explicit that `gyms` never gets a member/anon SELECT
// policy — that's a real RLS boundary, not an oversight — so this can't
// be checked with the anon key like the tables above. It shells out to
// the Supabase CLI (`db query --linked`), which authenticates via the
// CLI's own linked-project credentials, not the anon key.
{
  const src = readFileSync('src/lib/member-auth.js', 'utf8');
  const m = src.match(/GYM_CODE\s*=\s*import\.meta\.env\.VITE_PUBLIC_GYM_CODE\s*\|\|\s*'([^']+)'/);
  const codeInSource = m?.[1];
  let liveCode = null;
  try {
    const { execSync } = await import('node:child_process');
    const out = execSync(
      `npx supabase db query --linked "select gym_code from gyms where is_active = true limit 1;" --output-format json`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const parsed = JSON.parse(out);
    liveCode = parsed?.rows?.[0]?.gym_code ?? null;
  } catch (_) { /* CLI not linked/available in this environment — reported as MISMATCH below */ }
  const ok = !!codeInSource && !!liveCode && codeInSource === liveCode;
  if (!ok) bad++;
  console.log(`  source fallback: ${codeInSource ?? '(not found)'}`);
  console.log(`  live gyms.gym_code: ${liveCode ?? '(could not query — is the Supabase CLI linked?)'}`);
  console.log(`  ${ok ? 'OK     ' : 'MISMATCH'} — every member login fails silently if these differ`);
}

console.log(bad === 0 ? '\nRESULT: schema matches the code.' : `\nRESULT: ${bad} problem(s).`);
