# QA PASS 2 — D Sculpt Fitness (continuation)

Pass 1 ran ~24 minutes, fixed one stored XSS (`expenses-page.js:109`, `escAttr`)
and declared "no other bugs found" for P0/P1. Treat that as *not yet proven*:
much of it was verified by reading code and by direct `supabase.from()` probes,
not by driving the flows end-to-end. This pass exercises the flows that P0/P1
depends on and then finishes P2.

Read `CLAUDE.md` and `HANDOVER.md` §6 + "Pending" first. Same rules as pass 1:
reproduce → root-cause → smallest fix → regression test → re-run. No speculative
fixes. Skipped ≠ passed. Never fabricate a staff account.

## Test-data rule (new — pass 1 wrote to production)
This project has **no staging database**. Pass 1 created and deleted a member and
an expense in the live DB. From now on:
- Prefix every test record with `ZZTEST-` so it is obvious in the UI and in exports.
- Never UPDATE or DELETE a row you did not create. Never touch a real member,
  payment, receipt or expense.
- Money RPCs (`sculpt_add_member`, `sculpt_renew_member`, `sculpt_clear_balance`)
  may only be called against a `ZZTEST-` member.
- List every row you created and confirm its removal in the final report.

## Part A — actually drive the P0/P1 flows (browser, not just RPC probes)
Against `npm run preview` with the owner login, and the member portal with
`SC-0145-2PW` / `7917282929`. Real clicks, real submits, real rendered output.

1. **Money end to end on one `ZZTEST-` member.** Create → assign plan + add-on →
   partial payment → check balance → clear balance → renew while active → renew
   after expiry → same-day renew → discount larger than price → zero-price plan.
   After each step assert the number agrees in four places: member record,
   payment history, receipt, invoice. Pass 1 checked the arithmetic; check the
   *display and persistence* of it.
2. **Invoice/PDF through all three consumers** — preview iframe, browser print
   (`emulateMedia({media:'print'})`), and the html2canvas → blob → WhatsApp path.
   Fixtures: GST + several add-ons (must break to a controlled 2nd page), long
   member name, long plan name, large amount, balance due. Check the 660px /
   933px budget, no clipping, no dashboard CSS pollution, no rescaling.
   Do not assume print and html2canvas agree — render both.
3. **QR check-in lifecycle in the browser.** Kiosk: token rotation, offline
   banner appears, 3-second hold-to-exit (including pointer moving slightly
   mid-hold), 1-second hold does nothing. Member scan: valid, expired token,
   invalid code, network error mid-request, camera denied, repeat scan of a
   still-visible code, Try Again / Scan Again. Assert the scanner is *stopped*
   after every terminal outcome and that exactly one check-in request fires per
   physical scan — no "expired → success → expired".
4. **Member portal as its own app** for both an active and an expired member:
   Check In / My Plan / Receipts / Visits, refresh on each, session expiry,
   logout, direct route access while logged out, and empty vs populated states.
5. **Landing page from Plan Settings.** Edit a plan's features to include a
   comma, a quote, `&`, and a `<script>` payload → confirm the landing page
   renders readable feature text (never raw `{"featuresList":...}`, never
   executing) → then restore the plan exactly as it was. Click every nav anchor
   and confirm the page does not rebuild or replay the intro animation.

## Part B — P2, not reached in pass 1
`node scripts/qa-responsive.mjs`, `node scripts/qa-nav.mjs`, and
`node scripts/qa-dashboard.mjs` (credentialed), then walk every major route at
1600/1440/1280/1024/768/480/390/375 yourself: horizontal overflow, clipping,
overlap, offscreen buttons, tables, modals, bottom-nav overlap, touch targets,
scanner controls reachable. Then accessibility: keyboard nav, focus visibility,
form labels, modal focus + Escape, contrast, accessible names — but do not
redesign a component to satisfy a generic rule where it conflicts with the
documented architecture.

## Part C — hostile pass, not reached in pass 1
Rapid and double clicks on every submit, back/forward, refresh mid-load, refresh
right after login, duplicate submissions, offline↔online, slow network, camera
denied mid-scan, stale and expired sessions, empty-list states, very long /
unicode / emoji / script-payload input in every text field.

## Also settle these
- `member-portal-responsive.spec.js` — pass 1 called the failure a flaky test-side
  navigation race. Confirm that: run it 5× in isolation and 5× in the full suite.
  If it is a real race in the app, fix the app; if the test, fix the test and say so.
- Re-audit for the *same class* of bug as the XSS you fixed: grep every
  interpolation site into an HTML attribute across `src/pages/`, not just
  `expenses-page.js`. One missed site means there are probably others.

## Do not report
CLAUDE.md "Known non-issues", HANDOVER.md §8, `TESTING-BATCH-3.md`'s
"Known — do not report these", broken `db push`, `verify-schema.mjs` RPC section,
missing staff login, two stock photos, Settings address/GSTIN/PAN gaps.

## Report
Counts vs baseline; bugs found → fixed → remaining (severity, file:line, repro,
root cause, blocker); what you could not test and why; regression risk; and the
list of `ZZTEST-` rows created and confirmed deleted. No summaries of the docs.
