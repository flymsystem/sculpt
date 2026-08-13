-- ═══════════════════════════════════════════════════════════════════════════
--  FLYM — ADMIN SQL SHORTCUTS
--  Supabase Dashboard → SQL Editor → paste the query you need → Run
--
--  ⚠️  READ BEFORE USING:
--      1. Always replace placeholder values like 'GYM_CODE_HERE' or
--         'gym-id-here' with real values before running.
--      2. Queries marked 🔴 DESTRUCTIVE cannot be undone. Double-check.
--      3. To find a gym_id or member_id, use the LOOKUP queries at the top.
--      4. Run one query at a time. Never paste the entire file.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 1 — LOOKUPS  (always start here to find IDs)
-- ═══════════════════════════════════════════════════════════════════════════

-- 1.1  List ALL gyms (name, code, id, status)
SELECT id, gym_code, name, owner_name, phone, city, is_active, created_at
FROM gyms
ORDER BY created_at DESC;


-- 1.2  Find a gym by name (partial match)
SELECT id, gym_code, name, owner_name, phone, is_active
FROM gyms
WHERE name ILIKE '%GYM_NAME_HERE%';


-- 1.3  Find a gym by gym_code (exact)
SELECT id, gym_code, name, owner_name, phone, is_active
FROM gyms
WHERE gym_code = 'FLYXXXXXX';


-- 1.4  List all members of a specific gym
SELECT id, full_name, phone, email, plan_name, plan_price,
       payment_status, member_type, expiry_date, is_active, created_at
FROM members
WHERE gym_id = 'gym-id-here'
ORDER BY created_at DESC;


-- 1.5  Find a member by phone number (across all gyms)
SELECT m.id, m.full_name, m.phone, m.plan_name, m.member_type,
       g.name AS gym_name, g.gym_code
FROM members m
JOIN gyms g ON g.id = m.gym_id
WHERE m.phone LIKE '%9876543210%';


-- 1.6  Find a member by name (partial match)
SELECT m.id, m.full_name, m.phone, m.plan_name,
       g.name AS gym_name
FROM members m
JOIN gyms g ON g.id = m.gym_id
WHERE m.full_name ILIKE '%MEMBER_NAME_HERE%';


-- 1.7  List all admin/owner user accounts
SELECT gu.id, gu.role, gu.gym_id, g.name AS gym_name, g.gym_code,
       au.email, au.created_at
FROM gym_users gu
JOIN auth.users au ON au.id = gu.user_id
LEFT JOIN gyms g ON g.id = gu.gym_id
ORDER BY gu.role, au.created_at;


-- 1.8  Get full stats for a specific gym
SELECT
  g.name, g.gym_code, g.owner_name, g.phone, g.city, g.is_active,
  COUNT(m.id)                                                   AS total_members,
  COUNT(m.id) FILTER (WHERE m.is_active = TRUE)                AS active_members,
  COUNT(m.id) FILTER (WHERE m.member_type = 'Trial')           AS trial_members,
  COUNT(m.id) FILTER (WHERE m.payment_status = 'Due')          AS due_members,
  COUNT(m.id) FILTER (WHERE m.expiry_date < CURRENT_DATE
                        AND m.member_type != 'Trial')           AS expired_members,
  COALESCE(SUM(m.plan_price) FILTER (
    WHERE m.payment_status IN ('Paid','Partial')
      AND m.member_type != 'Trial'
  ), 0)                                                          AS total_revenue
FROM gyms g
LEFT JOIN members m ON m.gym_id = g.id
WHERE g.id = 'gym-id-here'
GROUP BY g.id, g.name, g.gym_code, g.owner_name, g.phone, g.city, g.is_active;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 2 — GYM MANAGEMENT
-- ═══════════════════════════════════════════════════════════════════════════

-- 2.1  Deactivate a gym (safe — does NOT delete data, owner can't log in)
UPDATE gyms
SET is_active = FALSE, updated_at = NOW()
WHERE id = 'gym-id-here';


-- 2.2  Reactivate a gym
UPDATE gyms
SET is_active = TRUE, updated_at = NOW()
WHERE id = 'gym-id-here';


-- 2.3  Update gym details (name, owner, phone, city)
UPDATE gyms
SET
  name       = 'New Gym Name',
  owner_name = 'New Owner Name',
  phone      = '+91XXXXXXXXXX',
  city       = 'City Name',
  updated_at = NOW()
WHERE id = 'gym-id-here';


-- 2.4  🔴 DESTRUCTIVE — Permanently delete a gym and ALL its data
--      (members, plans, payments, logs — everything)
--      Only use if the gym never had real data or explicitly requests deletion.
--      CASCADE handles all child tables automatically.
DELETE FROM gyms
WHERE id = 'gym-id-here';
-- After running this, also delete the user from Supabase Auth Dashboard manually.


-- 2.5  🔴 DESTRUCTIVE — Wipe ALL member data for a gym (keep the gym itself)
--      Useful for: resetting a gym after demo/testing phase before real launch
DELETE FROM reminder_logs  WHERE gym_id = 'gym-id-here';
DELETE FROM payment_history WHERE gym_id = 'gym-id-here';
DELETE FROM activity_log   WHERE gym_id = 'gym-id-here';
DELETE FROM members        WHERE gym_id = 'gym-id-here';


-- 2.6  Count how many members each gym has (platform overview)
SELECT g.name, g.gym_code, g.is_active,
       COUNT(m.id) AS total_members,
       COUNT(m.id) FILTER (WHERE m.is_active = TRUE) AS active
FROM gyms g
LEFT JOIN members m ON m.gym_id = g.id
GROUP BY g.id, g.name, g.gym_code, g.is_active
ORDER BY total_members DESC;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 3 — MEMBER MANAGEMENT
-- ═══════════════════════════════════════════════════════════════════════════

-- 3.1  View full details of a single member
SELECT * FROM members
WHERE id = 'member-id-here';


-- 3.2  Soft-delete a member (marks inactive, keeps all records)
UPDATE members
SET is_active = FALSE, updated_at = NOW()
WHERE id = 'member-id-here'
  AND gym_id = 'gym-id-here';  -- safety: scope to gym


-- 3.3  Restore a soft-deleted member
UPDATE members
SET is_active = TRUE, updated_at = NOW()
WHERE id = 'member-id-here'
  AND gym_id = 'gym-id-here';


-- 3.4  🔴 DESTRUCTIVE — Permanently delete a single member and their history
DELETE FROM reminder_logs   WHERE member_id = 'member-id-here';
DELETE FROM payment_history WHERE member_id = 'member-id-here';
DELETE FROM members         WHERE id = 'member-id-here';


-- 3.5  Fix a member's expiry date manually
UPDATE members
SET expiry_date = '2025-12-31',
    updated_at  = NOW()
WHERE id = 'member-id-here';


-- 3.6  Mark a member's payment as Paid
UPDATE members
SET payment_status = 'Paid',
    updated_at     = NOW()
WHERE id = 'member-id-here';


-- 3.7  Mark a member's payment as Due
UPDATE members
SET payment_status = 'Due',
    updated_at     = NOW()
WHERE id = 'member-id-here';


-- 3.8  Change a member's plan (update snapshot fields)
UPDATE members
SET plan_name            = 'Yearly Plan',
    plan_price           = 9999,
    plan_duration_months = 12,
    join_date            = CURRENT_DATE,   -- reset join if renewing
    updated_at           = NOW()
WHERE id = 'member-id-here';
-- Note: DB trigger auto-recalculates expiry_date after this update.


-- 3.9  Extend a member's expiry by N days
UPDATE members
SET expiry_date = expiry_date + INTERVAL '30 days',
    updated_at  = NOW()
WHERE id = 'member-id-here';


-- 3.10  List all expired members for a gym
SELECT id, full_name, phone, plan_name, expiry_date, payment_status
FROM members
WHERE gym_id = 'gym-id-here'
  AND is_active = TRUE
  AND member_type != 'Trial'
  AND expiry_date < CURRENT_DATE
ORDER BY expiry_date ASC;


-- 3.11  List members expiring in the next 7 days
SELECT id, full_name, phone, plan_name, expiry_date,
       (expiry_date - CURRENT_DATE) AS days_left
FROM members
WHERE gym_id = 'gym-id-here'
  AND is_active = TRUE
  AND member_type != 'Trial'
  AND expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
ORDER BY expiry_date ASC;


-- 3.12  List all Trial members
SELECT id, full_name, phone, join_date, expiry_date,
       (expiry_date - CURRENT_DATE) AS days_left
FROM members
WHERE gym_id = 'gym-id-here'
  AND member_type = 'Trial'
  AND is_active = TRUE
ORDER BY expiry_date ASC;


-- 3.13  Bulk-mark all expired members' payment_status as Due
UPDATE members
SET payment_status = 'Due',
    updated_at     = NOW()
WHERE gym_id = 'gym-id-here'
  AND is_active = TRUE
  AND member_type != 'Trial'
  AND expiry_date < CURRENT_DATE
  AND payment_status != 'Due';


-- 3.14  Remove add-ons from a specific member
UPDATE members
SET member_addons = NULL,
    updated_at    = NOW()
WHERE id = 'member-id-here';


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 4 — USER ACCOUNT & PASSWORD MANAGEMENT
-- ═══════════════════════════════════════════════════════════════════════════

-- 4.1  Find the auth user linked to a gym (to get their email)
SELECT au.id AS auth_user_id, au.email, au.last_sign_in_at,
       gu.role, g.name AS gym_name, g.gym_code
FROM auth.users au
JOIN gym_users gu ON gu.user_id = au.id
LEFT JOIN gyms g ON g.id = gu.gym_id
WHERE g.gym_code = 'FLYXXXXXX';


-- 4.2  Change a gym owner's password
--      Replace the email and new password below.
--      Minimum 6 characters. Use a strong password.
UPDATE auth.users
SET encrypted_password = crypt('NEW_PASSWORD_HERE', gen_salt('bf'))
WHERE email = 'owner@email.com';


-- 4.3  Change password by auth user ID (if you have the UUID)
UPDATE auth.users
SET encrypted_password = crypt('NEW_PASSWORD_HERE', gen_salt('bf'))
WHERE id = 'auth-user-id-here';


-- 4.4  Force email confirmation (if owner can't verify email)
UPDATE auth.users
SET email_confirmed_at = NOW(),
    confirmation_token  = ''
WHERE email = 'owner@email.com';


-- 4.5  Disable a user account (they can't log in)
UPDATE auth.users
SET banned_until = 'infinity'
WHERE email = 'owner@email.com';


-- 4.6  Re-enable a banned user account
UPDATE auth.users
SET banned_until = NULL
WHERE email = 'owner@email.com';


-- 4.7  Create a gym_users link (when a new auth user is added via Auth Dashboard)
--      Run this AFTER creating the user in Auth Dashboard.
INSERT INTO gym_users (user_id, gym_id, role)
VALUES (
  'auth-user-uuid-here',   -- from Auth Dashboard
  'gym-id-here',           -- from gyms table
  'owner'                  -- 'owner' or 'admin'
);


-- 4.8  Change a user's role (owner ↔ admin)
UPDATE gym_users
SET role = 'admin'   -- or 'owner'
WHERE user_id = 'auth-user-uuid-here';


-- 4.9  Remove a user's gym access (unlink without deleting the auth account)
DELETE FROM gym_users
WHERE user_id = 'auth-user-uuid-here';


-- 4.10  List all users who have not confirmed their email
SELECT id, email, created_at, email_confirmed_at
FROM auth.users
WHERE email_confirmed_at IS NULL
ORDER BY created_at DESC;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 5 — PLAN MANAGEMENT
-- ═══════════════════════════════════════════════════════════════════════════

-- 5.1  List all plans for a gym
SELECT id, name, duration_months, price, is_active, created_at
FROM plans
WHERE gym_id = 'gym-id-here'
ORDER BY duration_months;


-- 5.2  Deactivate a plan (hides it from new member signup, keeps existing member records)
UPDATE plans
SET is_active = FALSE, updated_at = NOW()
WHERE id = 'plan-id-here'
  AND gym_id = 'gym-id-here';


-- 5.3  Reactivate a plan
UPDATE plans
SET is_active = TRUE, updated_at = NOW()
WHERE id = 'plan-id-here';


-- 5.4  Update a plan's price
UPDATE plans
SET price = 1500, updated_at = NOW()
WHERE id = 'plan-id-here'
  AND gym_id = 'gym-id-here';


-- 5.5  🔴 DESTRUCTIVE — Permanently delete a plan
--      Only safe if no members are on this plan.
--      Check first: SELECT COUNT(*) FROM members WHERE plan_id = 'plan-id-here';
DELETE FROM plans
WHERE id = 'plan-id-here'
  AND gym_id = 'gym-id-here';


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 6 — FINANCE & REVENUE QUERIES
-- ═══════════════════════════════════════════════════════════════════════════

-- 6.1  Total revenue collected for a gym (all time)
SELECT
  SUM(plan_price)  AS total_collected,
  COUNT(*)         AS paid_members
FROM members
WHERE gym_id = 'gym-id-here'
  AND member_type != 'Trial'
  AND payment_status IN ('Paid', 'Partial')
  AND is_active = TRUE;


-- 6.2  Revenue this month for a gym
SELECT
  SUM(plan_price)  AS this_month_revenue,
  COUNT(*)         AS new_members_this_month
FROM members
WHERE gym_id = 'gym-id-here'
  AND member_type != 'Trial'
  AND payment_status IN ('Paid', 'Partial')
  AND DATE_TRUNC('month', join_date) = DATE_TRUNC('month', CURRENT_DATE);


-- 6.3  Total amount due (unpaid) for a gym
SELECT
  SUM(plan_price) AS total_due,
  COUNT(*)        AS due_members
FROM members
WHERE gym_id = 'gym-id-here'
  AND payment_status = 'Due'
  AND is_active = TRUE;


-- 6.4  Platform-wide revenue summary (all gyms)
SELECT
  g.name        AS gym_name,
  g.gym_code,
  COUNT(m.id)   AS total_members,
  COALESCE(SUM(m.plan_price) FILTER (
    WHERE m.payment_status IN ('Paid','Partial')
      AND m.member_type != 'Trial'
  ), 0)         AS revenue_collected,
  COALESCE(SUM(m.plan_price) FILTER (
    WHERE m.payment_status = 'Due'
  ), 0)         AS revenue_pending
FROM gyms g
LEFT JOIN members m ON m.gym_id = g.id AND m.is_active = TRUE
GROUP BY g.id, g.name, g.gym_code
ORDER BY revenue_collected DESC;


-- 6.5  Payment history for a gym (last 50 transactions)
SELECT ph.id, ph.amount, ph.payment_mode, ph.plan_name,
       ph.paid_at, m.full_name, m.phone
FROM payment_history ph
JOIN members m ON m.id = ph.member_id
WHERE ph.gym_id = 'gym-id-here'
ORDER BY ph.paid_at DESC
LIMIT 50;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 7 — DATA CLEANUP & MAINTENANCE
-- ═══════════════════════════════════════════════════════════════════════════

-- 7.1  🔴 DESTRUCTIVE — Wipe activity logs for a gym (reduce clutter)
DELETE FROM activity_log
WHERE gym_id = 'gym-id-here'
  AND created_at < NOW() - INTERVAL '90 days';


-- 7.2  🔴 DESTRUCTIVE — Wipe reminder logs for a gym
DELETE FROM reminder_logs
WHERE gym_id = 'gym-id-here'
  AND sent_at < NOW() - INTERVAL '90 days';


-- 7.3  Clear all support messages (once resolved)
DELETE FROM support_messages
WHERE is_resolved = TRUE;


-- 7.4  Mark a support message as resolved
UPDATE support_messages
SET is_resolved = TRUE
WHERE id = 'message-id-here';


-- 7.5  View all unresolved support messages
SELECT id, gym_name, gym_code, owner_name, subject, message, created_at
FROM support_messages
WHERE is_resolved = FALSE
ORDER BY created_at DESC;


-- 7.6  🔴 DESTRUCTIVE — Full platform reset (ONLY for fresh dev/staging environments)
--      NEVER run on production. Wipes everything except auth users.
/*
DELETE FROM support_messages;
DELETE FROM reminder_logs;
DELETE FROM activity_log;
DELETE FROM payment_history;
DELETE FROM members;
DELETE FROM plans;
DELETE FROM gym_users;
DELETE FROM gyms;
*/


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 8 — HEALTH CHECKS (run these to verify the DB is working correctly)
-- ═══════════════════════════════════════════════════════════════════════════

-- 8.1  Check members_with_status view is working
SELECT computed_status, COUNT(*) AS count
FROM members_with_status
GROUP BY computed_status
ORDER BY count DESC;


-- 8.2  Check gym_summary view is working
SELECT * FROM gym_summary ORDER BY total_members DESC;


-- 8.3  Find members with no expiry date (might be data entry issues)
SELECT id, full_name, phone, plan_name, member_type, join_date
FROM members
WHERE expiry_date IS NULL
  AND member_type != 'Trial'
  AND is_active = TRUE;


-- 8.4  Find orphaned gym_users (linked to a deleted/missing gym)
SELECT gu.id, gu.user_id, gu.gym_id, gu.role
FROM gym_users gu
LEFT JOIN gyms g ON g.id = gu.gym_id
WHERE g.id IS NULL;


-- 8.5  Find members whose expiry doesn't match join_date + duration
--      (data integrity check after migration)
SELECT id, full_name, join_date, plan_duration_months, expiry_date,
       (join_date + (plan_duration_months || ' months')::INTERVAL)::DATE AS expected_expiry
FROM members
WHERE is_active = TRUE
  AND member_type != 'Trial'
  AND plan_duration_months IS NOT NULL
  AND expiry_date IS NOT NULL
  AND expiry_date !=
      (join_date + (plan_duration_months || ' months')::INTERVAL)::DATE;


-- 8.6  Count records in each table (quick size check)
SELECT 'gyms'            AS table_name, COUNT(*) AS rows FROM gyms
UNION ALL
SELECT 'gym_users',       COUNT(*) FROM gym_users
UNION ALL
SELECT 'members',         COUNT(*) FROM members
UNION ALL
SELECT 'plans',           COUNT(*) FROM plans
UNION ALL
SELECT 'payment_history', COUNT(*) FROM payment_history
UNION ALL
SELECT 'reminder_logs',   COUNT(*) FROM reminder_logs
UNION ALL
SELECT 'activity_log',    COUNT(*) FROM activity_log
UNION ALL
SELECT 'support_messages',COUNT(*) FROM support_messages
ORDER BY rows DESC;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 9 — ONBOARDING A NEW GYM
-- ═══════════════════════════════════════════════════════════════════════════

-- Step 1: Create the gym row
--         (generates a gym_code automatically)
INSERT INTO gyms (gym_code, name, owner_name, phone, city, address)
VALUES (
  'FLY' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT), 1, 6)),
  'Gym Name Here',
  'Owner Full Name',
  '+91XXXXXXXXXX',
  'City',
  'Full Address'
)
RETURNING id, gym_code, name;
-- Copy the id and gym_code from the result before continuing.


-- Step 2: After creating the user in Supabase Auth Dashboard,
--         link them to the gym:
INSERT INTO gym_users (user_id, gym_id, role)
VALUES (
  'auth-user-uuid-from-auth-dashboard',
  'gym-id-from-step-1',
  'owner'
);


-- Step 3: Confirm it worked
SELECT au.email, gu.role, g.name AS gym_name, g.gym_code
FROM gym_users gu
JOIN auth.users au ON au.id = gu.user_id
JOIN gyms g ON g.id = gu.gym_id
WHERE g.id = 'gym-id-from-step-1';


-- ═══════════════════════════════════════════════════════════════════════════
-- END OF FILE
-- For support: WhatsApp +91 99457 91450
-- ═══════════════════════════════════════════════════════════════════════════
