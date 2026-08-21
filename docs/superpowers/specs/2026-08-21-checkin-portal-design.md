# QR Check-in + Member Portal — Delta Spec

Base architecture: `CHECKIN-PLAN.md` (already agreed with the client).
This file records only what changes relative to that plan, per the
client's later conversation, plus the mechanical decisions made while
reading the existing schema. Where this file and `CHECKIN-PLAN.md`
disagree, this file wins.

## Overrides to CHECKIN-PLAN.md

1. **No PIN.** Member login is application number + phone number,
   every time a fresh session is needed. §4's 4-digit PIN step is
   removed. Session persists via normal Supabase session persistence
   (refresh token in storage) so a returning member with a live
   session isn't asked again.
2. **Application numbers are auto-generated, not typed.** Format
   `SC-####-XXX`: fixed prefix `SC` (this deployment has one gym;
   `gyms.gym_code` is `SCULPT01` but the client's own example used a
   short prefix, so `SC` is used literally), a per-gym sequence
   zero-padded to 4 digits, and a 3-character random suffix drawn from
   `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (excludes `0/O/1/I/L` to avoid
   misread-on-a-phone-screen problems). The sequence alone is
   guessable; the random suffix is what keeps it from being a second
   factor in name only.
3. **"Added by" staff dropdown** on the add-member form, stored on the
   member row, sourced from the active `staff` table. Deactivating a
   staff member later must not blank the name on old member rows —
   store the value denormalised (staff name text) at write time,
   the same pattern `payment_history` already uses for staff
   attribution elsewhere in this codebase, rather than a live FK-only
   join that would need `is_active` staff to resolve.
4. **WhatsApp credential send**, mirroring the existing `wa.me`
   pattern in `member-modals.js` (~L1730, ~L1818). Message body is an
   editable template in Gym Settings, added alongside
   `DEFAULT_WA_TEMPLATE` in `state.js`, not hardcoded.
5. **Both logins move into the burger menu** on the landing page. The
   `.sc-nav-cta` "kept out of the drawer on purpose" comment (~L505,
   ~L658 in `landing.js`) gets updated, not deleted, to record this
   reversal and why. Footer "Staff & owner login" link stays as a
   secondary path.
6. **Check-ins section is two views, not one:** Attendance log (live,
   filterable, search) and Not-seen-recently (configurable threshold,
   default 21 days, WhatsApp follow-up per row). A member with no
   check-ins ever is measured from `join_date`, not treated as
   "0 days since last visit."

## Phase 2 auth mechanism (decided now, built in Phase 2)

Members have no email and no password. A Supabase session still has
to come from somewhere for RLS to apply. Plan: an Edge Function
`member-signin` (service-role) that:

1. Rate-limits by application number (e.g. 5 failed attempts / 15 min,
   stored in a small `member_login_attempts` table — not in-memory,
   since Edge Functions are stateless per-invocation).
2. Looks up the member by `gym_code` + `application_number`, compares
   phone (normalised: digits only, last 10 compared for India numbers
   with/without `+91`).
3. On match: finds or creates an `auth.users` row for that member
   (synthetic identifier, e.g. `member-<member_id>@members.internal`,
   random unguessable password known to no one), links
   `members.user_id` if not already linked, then uses
   `supabase.auth.admin.generateLink({ type: 'magiclink', ... })` and
   verifies the embedded OTP server-side to mint a real access/refresh
   token pair, which it returns to the client. The client calls
   `supabase.auth.setSession()` with those tokens.
4. On mismatch: generic "application number or phone number not
   recognised" — never reveal which field was wrong.

This is the same shape as CHECKIN-PLAN.md §4, minus the PIN step.

## Application number generation — concurrency

Generation happens inside `sculpt_add_member` (already an atomic
Postgres function per `CLAUDE.md`) so the sequence advance and the
member insert are one transaction — two staff adding members at the
same instant can't collide. A `gyms.next_application_seq` counter
column, incremented with `SELECT ... FOR UPDATE` inside the function,
avoids a race that a plain "count existing members + 1" would have.

## Out of scope for this spec

Everything else already specified in `CHECKIN-PLAN.md` §§2,3,6,7,8,9
carries over unchanged: rotating token mechanism, RLS boundary rules,
`member_checkins` schema, desk display behaviour, denied-attempt
recording, return-not-raise convention, timezone handling.
