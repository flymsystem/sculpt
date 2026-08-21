-- ─────────────────────────────────────────────────────────────────
-- 103_gym_timezone.sql
--
-- The server runs UTC; the gym runs IST (UTC+5:30). Every check-in
-- timestamp this feature writes must be converted through this column,
-- never left as CURRENT_DATE / now()::date, or a 6am IST check-in
-- lands on the previous day's row. See CLAUDE.md "timezone rule".
--
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Kolkata';

COMMENT ON COLUMN gyms.timezone IS
  'IANA timezone name. All check-in dates/times are computed as '
  '(now() AT TIME ZONE gyms.timezone), never CURRENT_DATE or client UTC.';
