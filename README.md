# Flym — update pack · 11 Aug 2026

Everything in one place. **Ignore every earlier zip and every earlier file card
I sent — this pack supersedes all of them.**

The folder structure below mirrors your project exactly, so you can drop
`src/`, `supabase/` and `public/` straight onto `C:\steven\flymm\FLYM PACK\`
and let Windows overwrite.

---

## STEP 1 — Drop in these 13 files (straight overwrite / new)

| File in this zip | Goes to | New or replaces |
|---|---|---|
| `src/lib/notifications.js` | `src/lib/notifications.js` | **NEW** |
| `src/lib/push.js` | `src/lib/push.js` | **NEW** |
| `src/lib/enquiries.js` | `src/lib/enquiries.js` | replaces |
| `src/components/notification-bell.js` | `src/components/notification-bell.js` | **NEW** |
| `src/components/call-button.js` | `src/components/call-button.js` | **NEW** |
| `src/styles/mobile-fixes.css` | `src/styles/mobile-fixes.css` | **NEW** |
| `src/pages/dashboard/attendance-report.js` | `src/pages/dashboard/attendance-report.js` | **NEW** |
| `src/pages/dashboard/overview.js` | `src/pages/dashboard/overview.js` | replaces |
| `src/pages/dashboard/enquiries.js` | `src/pages/dashboard/enquiries.js` | replaces |
| `src/pages/dashboard/alerts.js` | `src/pages/dashboard/alerts.js` | replaces |
| `supabase/functions/create-staff-user/index.ts` | same path | replaces |
| `supabase/functions/send-push/index.ts` | same path | **NEW** |
| `supabase/functions/generate-notifications/index.ts` | same path | **NEW** |

Plus two migrations, which are new files you just run (see Step 3):

- `supabase/migrations/031_notifications.sql`
- `supabase/migrations/032_notification_cron.sql`

---

## STEP 2 — Hand-edit 4 existing files

These are large files sitting on live member/payment paths, so `PATCHES.md`
gives exact find-and-replace blocks instead of me retyping them and risking a
silently dropped function.

Open **`PATCHES.md`** and work through it top to bottom:

- **File A** — `src/pages/dashboard/index.js` (6 edits) — wires the bell, the
  mobile CSS, and the global call handler
- **File B** — `src/pages/dashboard/backup.js` (3 edits) — adds the attendance report card
- **File C** — `src/pages/dashboard/member-modals.js` (2 edits) — hides the Aadhaar upload
- **File D** — `src/lib/auth.js` (1 edit) — surfaces the real Edge Function error
- **File E** — `.env.local` (1 line)
- **File F** — append `public/sw-push-append.js` to the **bottom** of your
  existing `public/sw.js`, then bump `CACHE_NAME` at the top of that file

> Do **not** replace `public/sw.js` — it holds your caching strategy and the
> `SKIP_WAITING` handler `index.html` depends on. Append only.

---

## STEP 3 — Backend, in this order

```bash
# 3a. Generate the push keypair
npx web-push generate-vapid-keys
#     public key  → .env.local as VITE_VAPID_PUBLIC_KEY   (Step 2, File E)
#     both keys   → Supabase secrets, below

# 3b. Secrets
supabase secrets set VAPID_PUBLIC_KEY=<public>
supabase secrets set VAPID_PRIVATE_KEY=<private>
supabase secrets set VAPID_SUBJECT=mailto:flym.system@gmail.com
supabase secrets set CRON_SECRET=<any long random string>

# 3c. Run migration 031 in the Supabase SQL editor

# 3d. Deploy functions
supabase functions deploy create-staff-user
supabase functions deploy send-push
supabase functions deploy generate-notifications --no-verify-jwt

# 3e. Edit migration 032 — replace <PROJECT_REF> and <CRON_SECRET>
#     with your real values, THEN run it in the SQL editor

# 3f. Build
npm install
npm run build
```

**Run migration 031 before 032.** 032 schedules a job that calls a function
which writes to tables 031 creates.

---

## STEP 4 — Verify

| Check | How |
|---|---|
| Staff login (#1) | Staff → Create Login. If it still fails, run `supabase functions logs create-staff-user`. **Nothing in the log = still a deploy problem, not code.** |
| Google Maps (#2) | Enquiries → Add Enquiry → Source dropdown |
| Clickable tiles (#3) | Dashboard → tap "Today's Revenue" → lands on Finance |
| iOS topbar (#4) | Open the PWA from your home screen, check Logout is tappable |
| Aadhaar (#5) | Open a member → Aadhaar Card section shows "+ Add", not a big upload box |
| Attendance PDF (#6) | Data & Backup → Staff Attendance Report → PDF Report |
| Notifications (#7) | Bell appears in topbar with a badge. Then: `select public.trigger_generate_notifications();` and check `supabase functions logs generate-notifications` |
| Call buttons (#8) | Member Alerts → green phone button; also tap any phone number anywhere |

---

## Known caveats — please sanity-check these

1. **#1 is a strong hypothesis, not a confirmed fix.** Missing
   `Access-Control-Allow-Methods` on the CORS preflight produces exactly that
   error string, but so does "function was never deployed". The log check in
   Step 4 distinguishes them.
2. **`mobile-fixes.css` was written without seeing `dashboard.css` or
   `tokens.css`.** The selectors I confirmed from `index.js` are solid; the
   modal selectors and `--surface-0` are educated guesses. If the topbar goes
   transparent or a modal looks off, send me `dashboard.css` and I'll correct it.
3. **#5 is a deviation.** You said "only show up when we click on edit" — I
   built a "+ Add" toggle inside the *member detail* modal. If you meant the
   *Edit Member* modal, send me that section of `member-modals.js`.
4. **#8 on the Members table is untested** — I never read `members.js`. It relies
   on the linkify sweep finding phone numbers as plain text, which is very
   likely but unverified.
5. **iOS push only works from the installed PWA** (Share → Add to Home Screen,
   iOS 16.4+). In a normal Safari tab the bell still works, but the Enable
   button shows a hint instead.

---

## What's in this pack

```
README.md                                    ← you are here
PATCHES.md                                   ← Step 2

public/
  sw-push-append.js                          append to public/sw.js

src/
  lib/notifications.js                       notification feed + generation
  lib/push.js                                Web Push subscribe/unsubscribe
  lib/enquiries.js                           + Google Maps source
  components/notification-bell.js            bell UI, panel, sound, realtime
  components/call-button.js                  Call buttons + phone linkify
  styles/mobile-fixes.css                    iOS safe-area + chart cropping
  pages/dashboard/attendance-report.js       attendance grid PDF + CSV
  pages/dashboard/overview.js                clickable mini-stats
  pages/dashboard/enquiries.js               Google Maps + Call button
  pages/dashboard/alerts.js                  Call button

supabase/
  migrations/031_notifications.sql           notifications + push_subscriptions
  migrations/032_notification_cron.sql       pg_cron schedule
  functions/create-staff-user/index.ts       CORS fix (#1)
  functions/send-push/index.ts               deliver push to a gym
  functions/generate-notifications/index.ts  cron generator (app-closed push)
```

Ping me with the `npm run build` output if anything throws.
