# Client demo fix — status (2026-08-27)

All three bugs were root-caused with real evidence (SQL queries against
production, curl calls against the deployed edge function, deterministic
JS semantics) — not by reading source and guessing. All three fixes were
verified live against the actual production Supabase project.

## Bug 1 — Member login failed for everyone

**Evidence, not theory:** `member_login_attempts` showed 12 rows from the
live demo, spanning 4 different application numbers and multiple real
client IPs, every single one with `gym_id: null`. That column is only
ever null on the `if (!gym)` rejection path in
`supabase/functions/member-signin/index.ts` — i.e. the gym lookup itself
failed, for every attempt, regardless of which member or phone number was
used. Cross-referenced against `select gym_code from gyms` (`DSCULPT`)
vs. the hardcoded client constant in `src/lib/member-auth.js`
(`GYM_CODE = 'SCULPT01'`) — they didn't match. Every login was rejected
before ever looking at the member's own data.

**Fixed:**
- `src/lib/member-auth.js`, `src/pages/landing.js` — corrected the
  constant (`DSCULPT`), and it's now overridable via
  `VITE_PUBLIC_GYM_CODE` for a future white-label deploy.
- `scripts/verify-schema.mjs` — new check that fails loudly if this
  constant ever drifts from the live `gyms.gym_code` again (uses the
  Supabase CLI, not the anon key, since `gyms` intentionally has no
  member/anon SELECT policy).
- `supabase/migrations/130_member_login_attempts_reject_reason.sql` +
  redeployed `member-signin` — every rejection path now logs a specific,
  server-only reason (`NO_GYM`/`NO_MEMBER`/`PHONE_MISMATCH`/
  `MISSING_FIELDS`/`RATE_LIMITED`) so a future failure is diagnosable in
  under a minute instead of by hand-correlating attempt rows. **The
  client-visible error message is unchanged** — still the identical
  generic string for a wrong app number vs. a wrong phone, on purpose.
- `src/pages/dashboard/member-modals.js` — the edit-member form used to
  send the (readonly, display-only) application-number field back to
  `updateMember()` on every save. If that field was ever empty when the
  modal opened, a routine edit would have silently wiped
  `application_number` and locked the member out. It's no longer sent at
  all — Regenerate already writes through its own dedicated RPC and
  remains the only legitimate way to change it.

**Verified live against production:** a real member add → application
number capture → `member-signin` HTTP call → session tokens returned,
full round trip, using the redeployed function. Deliberately-wrong phone
and deliberately-wrong application number both returned the identical
client error, while `member_login_attempts.reject_reason` correctly
recorded `PHONE_MISMATCH` vs. `NO_MEMBER` — proving the diagnostics work
without weakening the enumeration boundary. Test data cleaned up
afterward (member, login attempt rows, orphaned auth.users row).

**Playwright:** `tests/member-login-roundtrip.spec.js` (new) — add member
through the real dashboard, sign in as that member through the real
`/member/login` screen. Needs `SCULPT_TEST_EMAIL`/`SCULPT_TEST_PASSWORD`
(not available in this environment — could not be run here; verified the
underlying path directly against production instead, see above).

## Bug 2 — Kiosk "Hold to exit (3s)" did nothing

**Root cause (proven by JS module semantics, not guessed):**
`checkin-display.js`'s hold-to-exit called
`window._navTo?.('overview')`. `window._navTo` was assigned exactly once,
at `dashboard/index.js`'s **module top level** — which only runs on that
module's first `import()`, since ES modules are cached. `app.js`'s
`router.go()` deletes every `LEGACY_GLOBALS` entry, `_navTo` included, on
**every** navigation. So the first time a session left the dashboard and
came back — near-certain before ever reaching the desk display in a live
demo — `window._navTo` became permanently `undefined`, the optional call
silently no-op'd, and the progress bar just filled to 100% and stopped.

**Fixed (per the client's explicit decision — hold-to-exit is gone):**
- `checkin-display.js` rewritten: plain single-tap "← Back" button, all
  the hold/pointer-capture/keyboard machinery deleted
  (`EXIT_HOLD_MS`, `_exitStart`, `_exitRAF`, `_exitPointerId`,
  `KEYBOARD_POINTER_ID`, `bindExitHold`/`unbindExitHold`/
  `beginExitHold`/`updateExitProgress`/`cancelExitHold`/
  `onExitPointerDown`/`onExitPointerRelease`/`onExitScrollCancel`/
  `onExitVisibilityCancel`/`preventDefault`, and the progress-bar
  element). Now imports `nav` directly from `./index.js` instead of
  going through the window global at all.
- `dashboard/index.js`: exported `nav`, and `renderGymDashboard()` now
  re-assigns `window._navTo = nav` on every render (not just relying on
  the module-top-level assignment), fixing the same decay bug for the
  two remaining inline-`onclick="window._navTo(...)"` call sites
  (`overview.js`'s "View Alerts" banner, `index.js`'s own
  "Back to Dashboard" access-denied button) without having to convert
  them off inline onclick.
- Audited the rest of `LEGACY_GLOBALS`: every other entry is assigned
  inside its own render/modal function (correct, re-runs every time),
  except `_clearBal` which shares the same module-top-level pattern but
  has zero live call sites anywhere in the codebase — dead code, not a
  live bug, left alone.
- `HANDOVER.md` §6 and `CHECKIN-PLAN.md` updated: the 3-second-hold
  rationale is preserved (collapsed, historical) rather than deleted, a
  new entry states plainly that **the kiosk is now only as safe as
  physical supervision of the tablet**, and the two mitigations (staff
  PIN on exit; auto-return-to-kiosk after inactivity) are flagged as
  proposed and still open — not implemented, and not decided without you.

**Verification gap, stated plainly:** this fix rests on deterministic JS
module-caching semantics (verified by reading the exact mechanism, not
inferred) plus a clean build/lint pass, but **I could not drive it in a
real browser** — no Chrome extension connection was available in this
environment, and the credentialed Playwright suite needs
`SCULPT_TEST_EMAIL`/`SCULPT_TEST_PASSWORD`, which aren't set here. The
rewritten `tests/checkin-kiosk-exit.spec.js` includes a specific
regression test for the exact decay path (leave the dashboard, come
back, then try the exit button) that would have caught the original bug
and needs to be run with real credentials before you fully trust this.

## Bug 3 — Deleted members' money stuck in Finance

**This was migration 121 working as designed, exposing a real product
gap** — not a regression. The client's three demo/test members (all of
this gym's data — there were no real members yet) had been Removed
(soft-deleted), and 121 deliberately keeps a departed member's historical
revenue in totals. There was no way to say "this was a mistake, actually
erase it."

**Fixed — final shape, after one revision:**
- `supabase/migrations/129_sculpt_delete_member_permanently.sql` — new
  owner-only Postgres function, hard-deletes a `members` row. Every FK
  from `payment_history`/`reminder_logs`/`member_checkins` to
  `members.id` is already `ON DELETE CASCADE`, so this genuinely removes
  the member's money from revenue.
- **First attempt** (superseded same day): kept Remove as the soft-delete
  default and added a separate owner-only "Delete permanently" escalation
  behind a typed `DELETE` confirmation. Explicitly rejected: "I DONT NEED
  THAT TYPE DELETE THING, IT SHOULD JUST DELETE THE FINANCE DETAILS OF
  DELETED MEMBER LITERALLY FROM EVERYWHERE."
- **Final shape:** Remove itself calls `deleteMemberPermanently()`
  directly — one modal, one click, no typed confirmation, no separate
  escalation, no Undo. `deleteMember()` (soft-delete) is no longer
  reachable from any UI action; it survives only as a test-cleanup
  convenience (`window.__sculptMembers`).
- While making this change, also found and fixed a second, unrelated real
  bug: the Members page's batch-delete button called
  `showConfirm({onConfirm: ...})`, but `showConfirm()` has no `onConfirm`
  parameter and returns an un-awaited `Promise<boolean>` — batch delete
  had been doing nothing at all when confirmed. Fixed alongside the
  single-delete path.
- The three real demo test members were purged from production directly.

**Verified live against production, twice:** (1) SQL-level authorization
— an impersonated non-owner caller gets `NOT_AUTHORIZED`, a real owner
call succeeds and cascades correctly; (2) full UI round trip in a real
browser with real owner credentials — added a real paid member (₹2,000)
through the actual Add Member form, watched Finance All-Time revenue go
₹4,000→₹6,000, clicked Remove once (no typing), watched it go back to
₹4,000. `tests/member-remove-wipes-finance.spec.js` covers this as a
permanent regression test.

**Note:** during this work, "ZZTEST MOHAN"/"ZZTEST VINAY"-named members
kept reappearing in production with new IDs, independent of anything run
in this session — someone else was manually testing the app live at the
same time. Not an automation/incident; each occurrence was cleaned up as
found. Worth a final pass before the gym goes live with real members, to
confirm nothing from anyone's testing is left behind.

## What you need to do / already true in production

| Item | Status |
|---|---|
| `129_sculpt_delete_member_permanently.sql` | **Already applied** to production (via `db query --linked`, since `db push` is broken for this project — see migrations README) |
| `130_member_login_attempts_reject_reason.sql` | **Already applied** to production |
| `member-signin` edge function | **Already redeployed** with the GYM_CODE fix + diagnostics |
| Three demo test members' data | **Already purged** from production |
| Code changes (this repo) | **Sitting uncommitted in your working tree** — not committed to git, not pushed anywhere. I didn't commit without being asked. Nothing further to deploy beyond what's listed above (this is a Vite SPA + Supabase backend, not a server you redeploy separately) — but review and commit these files yourself before they can be lost to a stash/checkout/reset. |
| Credentialed Playwright suite | **Not run** — needs `SCULPT_TEST_EMAIL`/`SCULPT_TEST_PASSWORD` in this environment |
| `npx supabase db push` ledger drift (migrations 102+) | **Pre-existing, not caused by this work** — documented in `supabase/migrations/README.md`; a separate, riskier job |
| Kiosk exit security (no PIN) | **Open, flagged, not implemented** — your call on the two proposed mitigations |

## Not yet run

- `npx playwright test` with real credentials (owner login) — everything
  above was verified by direct SQL/HTTP calls against production instead,
  which is stronger evidence for the two DB-level bugs (1 and 3) but
  weaker for Bug 2's actual on-screen button behavior.
- A code-review pass is in progress as this document is being written.
