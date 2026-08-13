-- ─────────────────────────────────────────────────────────────────
-- Migration 003: Gym WhatsApp & Notification Settings
-- ─────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE gyms
  ADD COLUMN IF NOT EXISTS wa_template   TEXT,
  ADD COLUMN IF NOT EXISTS reminder_days INT DEFAULT 7;

UPDATE gyms
  SET wa_template =
        'Hi {name}! 👋' || chr(10) || chr(10) ||
        'Your *{plan}* at *{gym}* expires on *{date}*.' || chr(10) || chr(10) ||
        'Please renew to continue your fitness journey! 💪' || chr(10) || chr(10) ||
        'Contact us to renew.',
      reminder_days = 7
  WHERE wa_template IS NULL;

COMMIT;
