# Paste this into the cloud terminal (step 4 — verification pass)

Migrations 114 → 123 have now been applied to production, and the `create-staff-user` and `manage-staff-login` Edge Functions have been redeployed (both ACTIVE, confirmed via `supabase functions list`). Read CLAUDE.md and HANDOVER.md, then verify the fixes from the previous session actually hold against the live database.

## Rules
- **Verify first, fix second.** For each item below, prove the current behaviour with a real query or a real test run before concluding anything. Do not mark an item passing because the code looks right.
- Report each item as PASS / FAIL / CANNOT-VERIFY with the evidence that decided it.
- If something fails, find the root cause and fix it — new migration file if the fix is in the DB, never edit an applied one.
- Do not push. Commit locally with clear messages.

## First: confirm the DB is actually where we think it is
1. Run `node scripts/verify-schema.mjs`. It should now be clean — it was written to catch exactly the drift that migrations 114–123 fixed. Report the full output.
2. Confirm migration **118** actually created its unique index rather than skipping it. 118 emits a NOTICE and skips the index if duplicate active phone numbers already exist, which would mean finding #2 is still open. Query `pg_indexes` for the index on `members(phone)` scoped to `is_active = true` and report whether it exists. If it does not, find the duplicate groups, report them to me, and stop — I need to decide how to merge those members.
3. Confirm `sculpt_renew_member` and `sculpt_clear_balance` no longer reference `flym_assert_payment_mode` or `flym_addons_to_jsonb`. Read the live function bodies out of `pg_get_functiondef`, not the migration files.

## Then: re-test the migration-dependent findings
These could not be verified end-to-end last session. Test each against the live database.

- **#2 duplicate phone** — attempt to create two active members with the same number in different formats (`9876543210` and `+91 98765 43210`). Both normalisation and rejection must work, and the user must see a clean inline error, not a raw Postgres error.
- **#4 photo upload** — upload during member creation, upload to an existing member, and removal. Test as **staff**, not just owner — the storage RLS fix in migration 120 was specifically about `get_my_gym_id()` being NULL for staff.
- **#6 due status** — clear a member's full balance and confirm Paid shows immediately in the member list, member detail, dashboard and any filters. Confirm the atomic RPC path is now taken rather than the JS fallback (check that `isMissingFunction()` is not firing).
- **#8 addon** — create a member with an addon and renew a member with an addon. Verify the addon amount reaches pricing, invoice, and the due calculation.
- **#10 expiry date edit** — edit a member's expiry date and confirm it persists across a reload rather than being overwritten by the trigger.
- **#11 renewal date** — renew an active member (new expiry must extend from existing expiry), an expired member (must calculate from today), and one expiring exactly today. `renewal-date.spec.js` covers the pure function; verify the DB half end-to-end.
- **#12 delete with history** — soft-delete a member who has payments, then confirm the payments still appear in Finance and still reconcile in revenue totals.
- **#14/#15 staff RLS** — as a staff login, confirm they cannot soft-delete a member via the API (not just the UI), and confirm `staff_read_payments` now exposes only today's payments rather than full gym history. Test via direct API calls, since the point of migration 123 was that the UI gate was not the real boundary.
- **#18 rapid double renewal** — fire two identical renewals within a second and confirm the 5-second guard rejects the second one without creating a duplicate payment row.

## Also
4. **Gym name mismatch** — the live `gyms` record says "D fitness" but `auth-flow.spec.js` expects "D Sculpt Fitness". Show me the current value and the exact UPDATE you would run, but **do not run it** — I need to confirm which name should be displayed.
5. **Staff test account** — HANDOVER notes `manoj.sculpt@gmail.com` has `login_enabled = true` but no matching `gym_users` row, so no staff login exists to test with. Now that `manage-staff-login` is deployed, check whether this can be repaired through the app. If it can, tell me the steps; if it needs SQL, show me the statement without running it. Several of the tests above need a working staff login.
6. Run `npm run build`, `npm run lint`, and the full Playwright suite with credentials (`--workers=1`). Report what passes now versus the previous run: 44 passed, 2 pre-existing failures, 12 pre-existing lint errors.

## Finish with
- A PASS / FAIL / CANNOT-VERIFY table for every item above, with the evidence for each.
- Anything still blocked, and exactly what you need from me to unblock it.
