# Flym — Current State

**Last updated:** 14 August 2026
**Replaces:** `HANDOVER.md`, which described a pre-deployment state and is now wrong in every particular.

This is the "what is actually true right now" document. `AUDIT.md` remains useful as the record of *why* each change was made and what was deliberately left undone.

---

## 1. Deployment model — read this first

| Piece | How it deploys |
|---|---|
| Frontend | `npm run build` locally → **manual upload of `dist/` to Cloudflare Pages** |
| Database | SQL pasted into the Supabase SQL editor |
| Edge Functions | `npx supabase functions deploy <name> --project-ref ogxqspnqtjphprqzwuye` |

**There is no git remote.** `git push` fails with "No configured push destination." The local repo at `C:\steven\flym-work` is a private safety net, nothing more. Cloudflare is not connected to GitHub and never builds anything.

Because the frontend is built locally, `VITE_*` values come from `.env.local` on Steven's machine. **Cloudflare dashboard environment variables are irrelevant** and setting them changes nothing.

`C:\steven\flymm\FLYM PACK\` is retired. `C:\steven\flym-work` is the only live working copy.

---

## 2. Database — migrations 033–037 are APPLIED

| Migration | Status | What it did |
|---|---|---|
| `033_money_integrity.sql` | ✅ applied | Transactional RPCs: `flym_add_member`, `flym_renew_member`, `flym_clear_balance` |
| `034_scale_indexes.sql` | ❌ **superseded — do not run** | Used `CREATE INDEX CONCURRENTLY`, impossible in the Supabase SQL editor |
| `034b_scale_indexes_no_concurrent.sql` | ✅ applied | Same indexes without CONCURRENTLY, in one transaction. Also set `cost_per_msg_paise` default to 150, excluded cancelled members from `get_due_reminders()`, scheduled `cleanup_old_logs()` |
| `035_revenue_aggregation.sql` | ✅ applied | `flym_revenue_summary`, `flym_revenue_monthly`, `flym_revenue_rows` |
| `036_notifications_staff_access.sql` | ✅ applied | RLS fix so staff can see notifications; retired the 15-min client upsert storm |
| `037_broadcast_resume_cron.sql` | ✅ applied | `trigger_resume_broadcasts()` + `flym-resume-broadcasts` cron job. Project ref is filled in — no placeholder |

**Next migration number is 038.**

`034` is kept in the repo only as the reference version for anyone running migrations through `psql`. Anyone applying migrations from the dashboard must use `034b`.

### Active cron jobs

```sql
select jobname, schedule, active from cron.job;
```

| Job | Schedule | Purpose |
|---|---|---|
| `flym-cleanup-old-logs` | `0 3 * * 0` | Prunes `activity_log` weekly (Sun 08:30 IST) |
| `flym-resume-broadcasts` | `*/2 * * * *` | Resumes any broadcast stuck on `paid`/`sending` |

Both verified `succeeded` in `cron.job_run_details`.

---

## 3. Edge Functions — all five deployed

| Function | Status |
|---|---|
| `create-broadcast-order` | ✅ deployed |
| `process-broadcast` | ✅ deployed |
| `send-reminders` | ✅ deployed |
| `create-gym-user` | ✅ deployed (entrypoint renamed `index.js` → `index.ts`) |
| `whatsapp-webhook` | ✅ deployed with `--no-verify-jwt` |
| `send-push` | ❌ **not deployed** |
| `generate-notifications` | ❌ **not deployed** |

`create-gym-user` had **never been deployable** before this — the CLI only accepts `index.ts` as an entrypoint, and the file was `index.js`. Whatever was live before did not include the multi-branch admin lookup fix.

### Secrets

`CRON_SECRET` is set in both required places:

- Edge Function secret — visible in `npx supabase secrets list`
- Vault, as `flym_cron_secret` — verified readable via `vault.decrypted_secrets`, length 48

VAPID keys are **not** set in Supabase. Web Push cannot work until they are and until `send-push` + `generate-notifications` are deployed.

---

## 4. Frontend — deployed, with one config fix applied after

The audited frontend was built and uploaded. A separate, **pre-existing** bug was then found and fixed:

**`vite.config.js` had `base: './'`.** Every deep-link hard refresh (`/dashboard/finance`, `/dashboard/members`, …) resolved `./assets/main-xxx.js` against the route directory, requested a file that doesn't exist, and got `index.html` back with a **200** from the catch-all rewrite. The browser parsed HTML as JavaScript and rendered a blank page. Nothing appeared as a 404, which is why it went unnoticed for so long.

Changed to `base: '/'`. Verified: built `index.html` now references `/assets/...` with zero relative references.

**This was not introduced by the audit** — `base: './'` is present in the pre-audit `vite.config.js` in Project Knowledge.

### Build verification routine

```
npm run build
npm run preview      # then hard-refresh /dashboard/finance in the preview server
```

Only upload `dist/` after the preview passes that hard refresh. After uploading, `flym.in/unstick/` clears the old service worker.

---

## 5. Revenue figures — an important correction

The audit's headline claim was that revenue was capped at 1,000 payment rows and therefore understated. **For this database, that cap was never actually hit.** Payments are queried per gym, and the largest gym has 529 payments:

| Gym | Payments |
|---|---|
| Modern Muscle 3 | 529 |
| Modern Muscle 2 | 528 |
| Brights Gym | 343 |
| Muscle Garage | 341 |
| Modern Muscle | 258 |
| Flym Fitness | 113 |
| Get Fit Fitness Zone | 81 |
| Fit and fly | 53 |

Verified: summing all rows and summing only the most recent 1,000 give **identical** totals for all 8 gyms. The 2,395 figure quoted during the audit was the total across every gym, which no Finance page ever queries at once.

The paging fix is still correct and worth keeping — it removes a real ceiling before it is ever reached — but it did not change any current number.

**Any observed change in Finance totals therefore has a different cause.** The most likely candidate is the UTC month-boundary fix, which restored the last day of each month to "This Month" and "This Year". **All Time should not have moved.** If All Time differs from the SQL below, that is unexplained and should be investigated before the numbers are trusted:

```sql
with ranked as (
  select ph.gym_id, ph.amount,
         row_number() over (partition by ph.gym_id
                            order by ph.paid_at desc, ph.id desc) as rn
    from payment_history ph
    join members m on m.id = ph.member_id and m.is_active = true
)
select g.name as gym,
       count(*) as payments,
       coalesce(sum(r.amount), 0) as all_time
  from ranked r
  join gyms g on g.id = r.gym_id
 group by g.name
 order by all_time desc;
```

---

## 6. What has never been verified in a browser

The audit work was verified by build, ESLint, code reading and bundle inspection. Some of it has now been exercised in production, but the following remain **unconfirmed**:

- Concurrent clear-balance from two devices (the `FOR UPDATE` path)
- Renewal atomicity under a dropped connection
- Broadcast over 150 recipients resuming across invocations
- Staff notification visibility after migration 036
- WhatsApp delivery receipts reaching the newly-deployed webhook
- Whether member add-ons render at all (see `members.member_addons` type question in the project instructions)

None of these block normal use. They are the tests that would confirm the riskiest changes actually behave as designed.

---

## 7. Genuinely open work

See "KNOWN OPEN ITEMS" in the project instructions for the full list with context. In short:

**Needs a decision from Steven:** members server-side pagination, the remaining inline styles, CORS origin restriction, plaintext owner passwords.

**Needs doing, no decision required:** the baseline schema dump (`npx supabase db dump --schema public > supabase/migrations/000_baseline_current.sql`). Five migrations are missing from version control and this repository currently **cannot rebuild the database** — that is the largest remaining risk in the project, and it is unrelated to any code quality issue.

**Optional:** deploy `send-push` + `generate-notifications` and set VAPID secrets to turn on Web Push.
