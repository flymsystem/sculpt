# FOLLOW-UP PROMPT — verify, harden, commit

Paste everything below the divider into the same Claude Code session (or a fresh one in `C:\steven\sculp\sculp-fitness`).

---

Continue from the three client-demo bug fixes currently sitting **uncommitted** in the working tree (`STATUS-CLIENT-DEMO-FIX.md` has your own writeup). Do not commit anything until every task below is done.

Use the **superpowers** skills again: `superpowers:verification-before-completion` governs this whole prompt, and `superpowers:root-cause-tracing` applies to anything that turns out not to work. If a task's verification fails, stop and report — do not patch around it and carry on.

Read first: `CLAUDE.md`, `HANDOVER.md` §6, `STATUS-CLIENT-DEMO-FIX.md`, and `supabase/migrations/README.md`.

---

## Task 1 — Bug 2 (kiosk Back button) must be exercised in a real browser

You fixed this by reasoning about `window._navTo` being deleted from `LEGACY_GLOBALS` on every `router.go()`. The reasoning is sound. It is not verification, and this is the exact button the client watched fail in person — being wrong about it twice is not survivable.

This repo has a documented history of "verified by reading code and direct probes" claims that a later session disproved by actually driving the flow (see HANDOVER's 2026-08-27 QA pass 2 entry, which found four real bugs that way). Do not repeat that pattern.

1. Run the app (`npm run build && npm run preview`) and drive it with Playwright directly — you do not need the Chrome extension, `tests/` already runs headed/headless Chromium via `playwright.config.js`. If credentials are the blocker, say exactly which env vars you need and stop; do not substitute reasoning for the run.
2. The sequence that matters — the plain-load case was never the broken one:
   - log in → dashboard → **navigate to at least two other sections** → open Desk Display → press Back → must land on Overview on the **first** press.
   - Then: Desk Display → Back → Desk Display again → Back again. Twice in a row.
   - Then: Desk Display → browser Back button → must not blank-screen or strand the kiosk overlay on top of the dashboard.
3. Confirm `stopCheckinDisplay()` actually ran on exit: the QR rotation timer is cleared, the wake lock released, and `checkin-kiosk-active` removed from `#page-gym`. A Back button that navigates but leaves the timer running is only half fixed.
4. Get `tests/checkin-kiosk-exit.spec.js` genuinely passing, including the navigate-away-and-return case. If it needs credentials the environment does not have, make the test fail loudly rather than skip silently — a skipped test that reads as green is how this bug survived the last round.

**Report the actual run output.** "Should work" is not an answer to this task.

## Task 2 — Exercise the new permanent-delete path through the UI

`sculpt_delete_member_permanently` and the "Delete permanently" escalation are a brand-new **destructive** capability. So far it has only ever been driven by you, from SQL, against test rows. Before it goes anywhere near a gym owner with real members, drive it through the interface:

1. Create `ZZTEST-Perm` with a plan and a payment. Record Finance → All Time revenue before and after.
2. As **owner**: open the Remove-member modal, confirm the "Delete permanently" escalation is not reachable by accident — it must require the typed `DELETE` confirmation, and typing anything else must not delete.
3. Complete a real permanent delete through the UI. Then verify **all** of these agree the money is gone: Finance (all periods), Overview, Analytics, the Payments CSV export, the Full Data Backup, and the member's invoices.
4. As **staff** 🔒: confirm the escalation is absent from the modal *and* that calling `sculpt_delete_member_permanently` directly as a staff session is refused by the database, not just hidden in the UI. Hiding a button is not access control.
5. Confirm the cascade actually cascaded: no orphaned rows left in `payment_history`, `member_checkins`, `reminder_logs`, `invoices`, `member_login_attempts`, or the auth user (`members.user_id`) for that member. Query for them; don't assume the FKs covered everything.
6. Add a Playwright test covering owner-can / staff-cannot.

If any of 3–5 disagree, that is a finding — report it, don't quietly fix and move on.

## Task 3 — Make the GYM_CODE mismatch impossible to repeat

You corrected `GYM_CODE` in `src/lib/member-auth.js` from `SCULPT01` to `DSCULPT`. If that was only a string edit, the identical outage returns the day anyone changes the gym code in the database — and it returns in the worst possible form: **every member login fails with a message blaming the member's phone number**, with nothing in the UI indicating a configuration problem.

Fix the class, not the instance:

1. Add a check that fails **loudly and early** when the constant and the database disagree — a build-time or test-time assertion that reads `gyms.gym_code` from the live project and fails the suite on mismatch, or a boot-time console error the developer will actually see. State which you chose and why.
2. Better still, consider whether the constant needs to exist at all. It is hardcoded because the member login screen runs before there is a session to read `S.gym` from — but the edge function already receives `gymCode` and looks it up. Evaluate whether `member-signin` can resolve the single gym itself (there is exactly one gym — see CLAUDE.md "There is one gym") and stop trusting a client-supplied code entirely. If you keep the parameter, say why.
3. Confirm the `reject_reason` diagnostics you added are actually reaching the logs: trigger each rejection path (bad gym code, bad app number, bad phone) against the deployed function and paste the log lines showing the distinct reason codes. Diagnostics that were added but never observed firing are not diagnostics.
4. Confirm the client-facing error text is still byte-identical for wrong-app-number vs wrong-phone. If your diagnostics changed the response shape, status code, or timing in a way that distinguishes them, that is a member-enumeration oracle and it must be fixed before commit.

## Task 4 — Application-number safety net

Confirm, with a query, that no active member can exist with a NULL `application_number`, and that the edit path can no longer wipe one. If `member-modals.js` still sends `applicationNumber` from the readonly `#e-appnum` input on every member edit, remove that — the number is server-generated and there is no legitimate client-side write path for it. Verify by editing a member and confirming their number is unchanged and they can still log in.

## Task 5 — Commits

Only after Tasks 1–4 are verified. Do **not** squash this into one commit:

1. One commit per bug, each with its migration, its code, its test and its doc updates together.
2. A separate commit for the doc-only corrections (HANDOVER / CHECKIN-PLAN / migrations README).
3. Message body for each: what the symptom was, what the proven root cause was, how it was verified. Short.
4. Do not commit `STATUS-CLIENT-DEMO-FIX.md` into the middle of a code commit — it goes with the docs commit.
5. Run `npm run build` and the full Playwright suite before the first commit, and report pre-existing failures separately from anything you introduced.

Do not push. Tell me what is staged and stop.

## Task 6 — Kiosk security, my decision to make

Removing the 3-second hold means an unattended tablet in a public area, signed into an account that can see member phone numbers, Aadhaar photos and take payments, is now **one tap** away from anyone walking past. HANDOVER §6 currently documents the hold as the control.

Do not implement anything here yet. Instead:

1. Make sure HANDOVER.md states plainly, right now, that the kiosk is currently protected only by physical supervision of the tablet.
2. Write me a short comparison — no more than a paragraph each — of: (a) auto-return to the kiosk after 60 seconds of inactivity on the dashboard, (b) a 4-digit staff PIN on exit, (c) both. Cover what each actually prevents, what it costs staff during a busy hour, and roughly what each takes to build.

I will pick one and tell you. Do not build it unasked.

---

## What I want back

- The **actual output** of the browser run in Task 1 — not a summary of what it should do.
- The before/after numbers from Task 2, from every one of the six places listed.
- The log lines from Task 3.3.
- The list of commits you staged, and confirmation nothing was pushed.
- Anything that failed, stated plainly. A partial pass reported honestly is worth more to me than a clean-sounding one I have to re-verify at a client site.
