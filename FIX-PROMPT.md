# Paste this into the cloud terminal

You are working on the D Sculpt Fitness app in this repo (Vite + React + Supabase). Read CLAUDE.md and HANDOVER.md first, then fix the manual-testing findings below.

## Ground rules
- Work through the codebase yourself: locate the real component/query/RLS policy behind each item before changing anything. Do not guess at file paths.
- Fix root causes, not symptoms. If a bug is in the DB layer (schema, constraint, RLS, trigger), fix it there and add the migration under `supabase/`.
- Every DB change goes in a new, idempotent migration file. Never edit an already-applied migration.
- Do not break existing data. Backfill where a new constraint would reject existing rows, and say so.
- After each fix: state the file(s) changed, the root cause in one line, and how you verified it.
- Add or update a Playwright test in `tests/` for every functional fix that can be covered by one.
- Run `npm run lint` and the Playwright suite at the end. Everything must pass.
- Work in phases and commit after each phase with a clear message. Do not push unless I say so.
- If a fix is ambiguous or would change business rules, stop and ask me instead of picking silently.

## Phase 1 — Data integrity (members)
1. **Member phone mandatory** — required in the Add Member and Edit Member forms, validated client-side and enforced NOT NULL at the DB level (backfill/clean existing nulls first).
2. **Duplicate phone numbers** — must be rejected. Add a unique constraint (normalise the number first: strip spaces/dashes/+91 prefix consistently, decide one canonical storage format and apply it everywhere) and show a clear inline error, not a raw Postgres error. Check the soft-delete case: should a deleted member's number be reusable? Ask me if unsure.
3. **Special characters in names** — values like `<b>test</b>` and `O'Brien` must save correctly and render as plain text everywhere they appear (lists, member detail, invoices, PDFs, WhatsApp messages). Audit every `dangerouslySetInnerHTML` and every PDF/HTML string built by concatenation. Apostrophes must not break queries or PDF generation.

## Phase 2 — Photos & files
4. **Member photo upload broken** — fix upload during member creation, upload for an existing member, and photo removal (no broken image left behind; storage object deleted too). Check the Supabase storage bucket policies, not just the UI.
5. **Aadhaar photo cannot be viewed** — upload appears to succeed but the image can't be opened afterwards. Investigate the bucket path, public vs signed URL, and read policy. Fix both upload and view.

## Phase 3 — Money & plans
6. **Payment due status not updating** — once the full balance is cleared, the member must immediately show Paid everywhere (member list, member detail, dashboard, filters). Find the single source of truth for due amount and make every screen derive from it.
7. **Discount greater than plan amount accepted** — block it. Payable amount must never go negative. Validate in the UI and add a DB-level check constraint. Cover addon amounts in the same calculation.
8. **Addon not being applied** — this is the tester's handwritten finding, treat it as real even though the checklist was ticked. Trace addon selection → persistence → member creation → price calculation → invoice → payment/due calculation, and fix wherever the chain drops it.
9. **₹0 plan price rejected** — decide and implement: I want ₹0 plans to be allowed (free/trial plans). Make sure a ₹0 plan flows correctly through payment, due status and invoice.

## Phase 4 — Dates & renewals
10. **Date cannot be edited** — find the affected date field(s) and fix the edit/save flow.
11. **Active-member renewal date wrong** — when renewing a membership that is still active, the new duration must be added to the **existing expiry date**, not today's date. If the membership has already expired, calculate from today. Implement both branches, put the logic in one shared function, and unit-test it with cases: active, expired, expiring today.

## Phase 5 — Deletion & history
12. **Deleting a member with payment history fails** — deletion must never destroy historical finance/payment records. Implement/verify soft delete: the member is hidden from lists but payments, invoices and revenue reports stay intact and still reconcile.
13. **Confirm in the database** that member deletion is a soft delete (flag/timestamp), not a hard delete. Show me the actual schema and the query that proves it.

## Phase 6 — Staff permissions (verify at DB level, not just UI)
For each of these, check the RLS policies directly and then confirm through the UI. Report a table of what the policy currently allows vs what it should allow, then fix.
14. Staff must **not** be able to delete members.
15. Staff **can** collect member payments, but must **not** access the Finance page (route guard *and* RLS).
16. Staff **can** view plans, but cannot add/edit/delete them.
17. Staff **can** add expenses, but cannot edit/delete them.
18. **Rapid double renewal** — renewing twice in quick succession must not create duplicate renewal or payment entries. Add idempotency (disable-on-submit is not enough — guard at the DB/RPC level).

## Phase 7 — Workflow & messaging
19. **WhatsApp reminder template** — editing the template then sending a reminder must use the updated template. Fix the save/read path and confirm placeholders are substituted correctly.
20. **Enquiry → Converted** — clicking Converted should open the Add Member form with the enquiry's details pre-filled (name, phone, and anything else that maps), and mark the enquiry converted once the member is created.

## Phase 8 — Untested areas (verify, then fix what you find)
21. **Dashboard & analytics** — member counts, active counts, revenue totals, graphs, date-range filters, empty states, and charts on mobile. Cross-check the numbers against direct DB queries and report any mismatch.
22. **Mobile / installed app** — Android PWA install and add-to-home-screen, session resume after backgrounding, mobile sidebar and popups, PDF generation on mobile, and offline/network-error behaviour. Fix what's broken; list anything you can't test without a physical device.

## Finish with
- A summary table: finding → root cause → files changed → test covering it.
- A list of anything you could not fix or verify, and exactly what you need from me.
