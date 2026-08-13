-- ─────────────────────────────────────────────────────────────────
-- Migration 004: Automated Reminder Tracking
-- ─────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS last_reminder_sent DATE;

-- Covers expiry-alert queries (gym_id + expiry range)
CREATE INDEX IF NOT EXISTS idx_members_expiry
  ON members (expiry_date, gym_id);

-- Covers "who was reminded recently" queries
CREATE INDEX IF NOT EXISTS idx_members_reminder
  ON members (last_reminder_sent, gym_id);

COMMIT;
