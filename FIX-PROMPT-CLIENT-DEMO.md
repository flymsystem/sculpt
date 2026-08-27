# FIX PROMPT — Client demo failures (2026-08-27)

Paste everything below this line into Claude Code in the `sculp-fitness` repo root.

---

You are working in `C:\steven\sculp\sculp-fitness` (D Sculpt Fitness — plain JS + Vite + Supabase, no framework).

**Context:** These three bugs were hit live in front of the paying client during an on-site demo. This is a credibility repair job, not a feature sprint. Nothing is "done" until it is verified against the real deployed Supabase project and the real built app — not against source code reading.

## 0. Use the superpowers skills — non-negotiable

Use the **superpowers** plugin skills throughout, in this order:

1. `superpowers:brainstorming` — before touching code, for Bug 3, which is a product decision, not a defect.
2. `superpowers:root-cause-tracing` — for Bugs 1 and 2. Trace each symptom to the actual failing line with real evidence (a query result, a console log, a network response). **Do not accept a plausible-looking cause from reading source.** This repo has a documented history (`supabase/migrations/112`, `114`, and the `isMissingFunction` saga in CLAUDE.md) of two separate sessions chasing a phantom cause because nobody demanded evidence.
3. `superpowers:writing-plans` — write the fix plan to `FIX-PLAN-CLIENT-DEMO.md` and get it agreed before implementing.
4. `superpowers:test-driven-development` — every fix gets a Playwright test in `tests/` that fails before and passes after.
5. `superpowers:verification-before-completion` — before you tell me anything is fixed.
6. `superpowers:requesting-code-review` — after implementation, before I look at it.

If any of those skill names don't resolve, list what superpowers skills *are* available and pick the nearest equivalents, then say which you substituted.

## 1. Read first (all of it, in this order)

Project docs — read every one, they contain the reasoning behind rules you will otherwise break:

- `CLAUDE.md` — conventions and the hard rules. Especially: application numbers are generated server-side only; member login must return the *identical* error for wrong app number vs wrong phone (enumeration oracle); money logic lives in Postgres functions and is atomic.
- `HANDOVER.md` — §6 "Things that will break it" and §7. Gym code is documented as `SCULPT01`.
- `README.md` — commands.
- `CHECKIN-PLAN.md` — the QR/kiosk design, including the hold-to-exit rationale.
- `FIX-PROMPT.md`, `FIX-PROMPT-BATCH-3.md`, `QA-PROMPT.md`, `QA-PROMPT-PASS-2.md`, `VERIFY-PROMPT.md` — prior fix rounds; item 12 of `FIX-PROMPT.md` is directly relevant to Bug 3.
- `STATUS-PHASE-A-B.md`, `STATUS-PHASE-C.md`, `STATUS-PHASE-D.md`, `STATUS-PHASE-EF.md`, `STATUS-BATCH-3.md` — what was claimed done.
- `TESTING-LIST.md`, `TESTING-BATCH-2.md`, `TESTING-BATCH-3.md`, `LANDING-CONTENT-CHECKLIST.md`.
- `supabase/migrations/README.md` — migration ordering and what is actually applied to production.

Code, for these three bugs specifically:

- `src/pages/member/login.js`, `src/lib/member-auth.js`, `supabase/functions/member-signin/index.ts`
- `src/pages/dashboard/checkin-display.js`, `src/pages/dashboard/index.js`, `src/app.js`
- `src/pages/dashboard/finance.js`, `src/pages/dashboard/overview.js`, `src/lib/members.js`, `src/pages/dashboard/member-modals.js`
- `supabase/migrations/104_member_accounts.sql`, `112_backfill_application_numbers.sql`, `118_member_phone_unique.sql`, `121_revenue_includes_deleted_members.sql`, `035_revenue_aggregation.sql`

---

# BUG 1 — Member login fails: "Application number or phone number not recognised"

**What happened:** at the client site, a real member could not sign in to the member portal. The screen showed the generic not-recognised error.

That string is `GENERIC_ERROR` in `supabase/functions/member-signin/index.ts`. It is returned from **five** different code paths, and the client cannot tell them apart by design. So the first job is instrumentation, not a fix.

The five paths that produce it:
1. Missing `gymCode` / `applicationNumber` / `phone` in the request body.
2. **Gym lookup failed** — no row in `gyms` where `gym_code = 'SCULPT01'` AND `is_active = true`. `GYM_CODE` is hardcoded in `src/lib/member-auth.js`. If production's `gyms.gym_code` is anything else (`SCULPT1`, `SCULPT-01`, lowercase, trailing space) or `is_active` is false, *every* member login fails and the message blames the member's phone.
3. **Member lookup failed** — no row matching `gym_id` + `application_number` + `is_active = true` + `login_enabled = true`. Note `login_enabled` (migration 104) defaults true but can be turned off; and `application_number` may be **NULL** on the row.
4. **Phone mismatch** — `normalizePhone` keeps the last 10 digits of both sides, so `+91` prefixes are handled. It fails if the stored phone is empty/NULL, has fewer than 10 digits, or the member typed a different number than the one on file.
5. Rate limit already tripped (that one returns a different message, but check `member_login_attempts` anyway — 5 failures in 15 min by IP **or** by application number locks it out, and the demo attempts themselves may have tripped it).

**Highest-probability cause, based on the repo's own record:** migration `112_backfill_application_numbers.sql` states that *every* existing member had `application_number = NULL`, and that the generation path in `sculpt_add_member` "has NOT been observed to actually run for any member row yet." `src/lib/members.js` `addMember()` now throws loudly instead of falling back to a raw insert — but that only protects members added *after* that change. **Members added before it, or by the backfill, or via any other path, may still have NULL or a number nobody ever showed the staff.**

Second-highest: the deployed edge function is stale. `supabase/functions/member-signin/index.ts` is dated well before the current migrations. Check what is actually deployed.

**Do this:**

1. Run these against production (`supabase db` / SQL editor) and paste the real output into your findings — do not paraphrase:
   ```sql
   select id, gym_code, is_active, name, next_application_seq from gyms;
   select id, full_name, phone, application_number, is_active, login_enabled, user_id, created_at
     from members order by created_at desc limit 20;
   select count(*) filter (where application_number is null) as null_appnum,
          count(*) filter (where phone is null or length(regexp_replace(phone,'\D','','g')) < 10) as bad_phone,
          count(*) filter (where login_enabled = false) as login_off,
          count(*) as total
     from members where is_active = true;
   select * from member_login_attempts order by created_at desc limit 30;
   ```
2. Confirm which version of `member-signin` is deployed (`supabase functions list`, and check its logs for the demo timestamps — the function `console.error`s on the internal failures).
3. **Add server-side diagnostics without weakening the security boundary.** The client response must stay a single generic string — that rule is not negotiable, it exists to stop member enumeration. But the function must `console.error` a distinct, greppable reason code on each rejection path (`REJECT_NO_GYM`, `REJECT_NO_MEMBER`, `REJECT_PHONE`, `REJECT_MISSING_FIELDS`) so the next failure is diagnosable in 30 seconds from the Supabase function logs instead of a two-hour guess. Also persist the reason to `member_login_attempts` in a new nullable `reject_reason` column (new migration) — that table is already server-only.
4. Then fix the actual root cause you proved. Likely combination of:
   - A migration that backfills any remaining NULL `application_number` for active members and, critically, **prevents the NULL state from recurring** — add `CHECK`/`NOT NULL` enforcement or a trigger so a member row can never be created without one.
   - Making `GYM_CODE` not a hardcoded literal that can silently drift from the database. At minimum, add a build/test assertion that the constant matches the row in `gyms`.
   - Redeploying `member-signin`.
5. **Staff-facing repair:** staff currently only see the application number in the one-time "Member Added" success modal, which is opened *after* `_nav('members')` re-renders the page (`src/pages/dashboard/member-modals.js` ~line 527-538) and only if `saved.application_number` is truthy — so if the RPC's returned row omits it, staff never see it and never know. Make the application number impossible to miss: always visible in the member row / detail modal (it is, at line 1473, but only when non-null), and add a visible warning badge on any member whose `application_number` is NULL or whose `login_enabled` is false, with a one-click "Generate application number" action wired to `sculpt_regenerate_application_number`.
6. **Also check the edit path:** `src/pages/dashboard/member-modals.js` line ~965 sends `applicationNumber: document.getElementById('e-appnum')?.value.trim() || null` from a **readonly** input on every member edit, and `updateMember()` in `src/lib/members.js` (~line 333) writes it through whenever it is not `undefined`. If that input is ever empty when the modal opens (member loaded from a stale `S.members`, or a member whose number was NULL), **editing a member wipes their application number and locks them out**. Prove whether this can happen; if it can, stop sending the field on edit at all — the number is server-generated and there is no legitimate client-side write path for it.

**Acceptance:** create a member through the real UI, capture the application number, sign in as that member in an incognito window, land on the portal. Then repeat for a member created *before* today. Add a Playwright test in `tests/` covering the full add-member → member-login round trip.

---

# BUG 2 — "Hold to exit (3s)" on the desk display doesn't work. Remove it, use a plain Back button.

**Client decision, already made — do not argue it back:** the hold-to-exit gesture is gone. Replace it with an ordinary, single-tap **← Back** button that returns to the dashboard overview.

**But first, spend ten minutes finding out why it didn't work**, because the same root cause probably breaks other buttons. There is a strong candidate already visible:

`src/pages/dashboard/checkin-display.js` `updateExitProgress()` ends with:
```js
stopCheckinDisplay();
window._navTo?.('overview');
```
`window._navTo` is assigned **once, at module top level** in `src/pages/dashboard/index.js` (line 52) — it only runs on first import. And `src/app.js` (~line 179-185, deleted at ~line 285) lists `'_navTo'` in `LEGACY_GLOBALS` and does `delete window[k]` on **every** `router.go()`. So after any navigation that re-enters the dashboard route once `index.js` is already imported, `window._navTo` is `undefined` — the optional-call `?.()` swallows it silently, the progress bar fills to 100%, and **nothing happens**. That matches the symptom exactly.

Verify that with a real console log before believing it. Then:

1. Replace the hold button with a plain `<button id="checkin-exit">← Back</button>` — single click/tap, same top-right position, same visual weight, keyboard accessible, no progress bar.
2. **Navigate via the imported `nav` function directly**, not `window._navTo`. `checkin-display.js` is in the same directory as `index.js`; importing `nav` (export it if it isn't exported) removes the window-global dependency entirely.
3. Delete all the now-dead hold machinery: `EXIT_HOLD_MS`, `_exitStart`, `_exitRAF`, `_exitPointerId`, `KEYBOARD_POINTER_ID`, `bindExitHold`, `unbindExitHold`, `beginExitHold`, `updateExitProgress`, `cancelExitHold`, `onExitPointerDown`, `onExitPointerRelease`, `onExitScrollCancel`, `onExitVisibilityCancel`, `preventDefault`, and the `#checkin-exit-progress` element. Leave the wake-lock, rotation and `checkin-kiosk-active` logic alone.
4. Update the `aria-label`, and update `HANDOVER.md` §6 and `CHECKIN-PLAN.md` in the same commit — both document the 3-second hold as a security control. **Write down, in HANDOVER, what replaces it.** The original rationale was real: this tablet sits unattended in a public area, signed into an account that can see member phone numbers, Aadhaar photos, and take payments. A one-tap exit hands that to any passerby. State plainly in HANDOVER that the kiosk is now only as safe as physical supervision of the tablet, and raise with me (do not implement unasked) the two obvious mitigations: a 4-digit staff PIN on exit, or auto-returning to the kiosk after N seconds of inactivity on the dashboard.
5. **Audit every other use of `window._navTo` and the rest of `LEGACY_GLOBALS`** for the same delete-on-navigate bug — `src/pages/dashboard/overview.js` line 71 and `src/pages/dashboard/index.js` line 252 both use it in inline `onclick` handlers. Either re-assign the globals inside `renderGymDashboard()` (so re-entry restores them) or move them off `window` entirely. Report which you chose and why.
6. Existing tests `tests/checkin-kiosk-exit.spec.js` will fail — rewrite them for the new behaviour rather than deleting them.

---

# BUG 3 — Deleted 3 members, finance still shows their money after refresh

**This is not a bug. It is migration `121_revenue_includes_deleted_members.sql` working exactly as specified — and that makes it a product problem, which is worse.**

Read migration 121 in full. It was written deliberately, against `FIX-PROMPT.md` item 12, so that soft-deleting a member no longer erases their historical payments from revenue totals. `sculpt_revenue_summary`, `sculpt_revenue_monthly` and `sculpt_revenue_rows` now aggregate `payment_history` directly with **no join to `members` at all**. Member deletion is a soft delete (`is_active = false` in `deleteMember()`, `src/lib/members.js` line 484) and `payment_history` rows are never touched. So the money stays. Permanently. That is correct accounting and it is what the client just experienced as "the app is broken."

**Use `superpowers:brainstorming` here and bring me options before writing code.** Do not silently revert 121 — that would re-break a previously-fixed data-integrity issue.

The real problem is that there are two different intents the UI cannot currently distinguish:

- **"This person left the gym"** → keep every rupee they ever paid in lifetime revenue. Current behaviour. Correct.
- **"This was a mistake / test entry, erase it"** → the payment should never have existed and must come off the books.

The app offers only the first, and calls it "Delete", which is why the client expected the second.

Things to work through and put in the plan:

1. **Make the current behaviour legible.** Finance and Overview should state, where the totals are shown, that revenue includes members who have since been removed — and let the user see the breakdown (e.g. "₹X from 3 removed members"). Nobody should have to guess whether the number is wrong.
2. **Give staff a real way to reverse a mistaken entry.** Options to weigh: a proper reversal/void that writes a compensating record and shows in an audit trail (accounting-correct, keeps history); a hard-delete "remove permanently, including payments" path gated to the owner role with an explicit typed confirmation (matches the client's mental model, destroys evidence); or a "test mode / demo data" flag so seeded rows can be purged in one action without touching real money. Recommend one, with the trade-off stated plainly.
3. **Rename the destructive action** so the label matches what it does. "Delete" currently means "deactivate". Consider "Remove member" / "Mark as left" for the soft delete, keeping "Delete permanently" for whatever you build in step 2.
4. Whatever you build, `payment_history`, `invoices` and the revenue functions must still reconcile with each other afterward. Add a test that proves it.
5. Check whether the same soft-delete/keep-revenue asymmetry shows up in Analytics, the backup/export in `src/pages/dashboard/backup.js`, invoices, and the check-in reports. If deleting a member leaves them in some views and not others, list every place.

---

## Constraints for all three

- Match the surrounding code style. This codebase writes long "why" comments citing the specific bug that motivated the code — keep that voice, do not strip existing comments.
- Every user-typed string goes through `escHtml()`.
- Money and membership logic stays in Postgres functions. Do not reimplement its arithmetic in JS.
- New migrations get the next number in sequence, are idempotent (safe to re-run), and are documented in `supabase/migrations/README.md`.
- Do not widen static imports into `landing.js`, `login.js`, or the PDF engine.
- No changes to the member-login error message shape (see Bug 1 step 3).

## Deliverables

1. `FIX-PLAN-CLIENT-DEMO.md` — the agreed plan, before implementation.
2. The fixes, each with a failing-then-passing Playwright test.
3. `npm run build` clean, full `npx playwright test` suite green (report any pre-existing failures separately rather than "fixing" them by deletion).
4. Updated `HANDOVER.md` and `CHECKIN-PLAN.md` for the kiosk change; updated `CLAUDE.md` if any invariant changed.
5. A short `STATUS-CLIENT-DEMO-FIX.md`: what was actually wrong (with the evidence, not the theory), what changed, what is still open, and what needs to be redeployed to Supabase — separate the "code pushed" steps from the "you must run this migration / redeploy this edge function" steps, because two of these three bugs are almost certainly environment drift rather than source bugs.

**Verify before you report.** For each of the three, do the thing the client did, in a browser, against the real deployment. Reading the diff is not verification.
