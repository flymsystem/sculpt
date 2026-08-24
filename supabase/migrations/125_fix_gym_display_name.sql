-- 125_fix_gym_display_name.sql
--
-- gyms.name has been "D fitness" since the whitelabel rename — a leftover
-- from before the brand was finalised. This is what the member portal
-- topbar and the member login flow surface verbatim (sculpt_my_membership()
-- -> _membership.gym_name), so every member-facing screen showed the wrong
-- name until this ran. HANDOVER.md §"Pending" flagged this as needing an
-- explicit decision before running; the owner confirmed "D Sculpt Fitness"
-- directly in session on 2026-08-24.
--
-- Idempotent: safe to run more than once, and scoped to the one row that
-- still has the placeholder name so it never overwrites a gym that was
-- already renamed some other way.
UPDATE gyms
SET name = 'D Sculpt Fitness'
WHERE name = 'D fitness';
