-- ─────────────────────────────────────────────────────────────────
-- Migration 002: Cardio Add-on (SUPERSEDED by 005)
-- ─────────────────────────────────────────────────────────────────
-- NOTE: cardio_addon and cardio_price were the original per-plan
-- approach. These columns are kept for backward compatibility with
-- existing rows but are NO LONGER written by the application.
-- Add-ons are now stored per-member in member_addons (migration 005).
-- ─────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS cardio_addon  BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cardio_price  NUMERIC(10,2);

ALTER TABLE gyms
  ADD COLUMN IF NOT EXISTS default_cardio_price NUMERIC(10,2) DEFAULT 500;

CREATE INDEX IF NOT EXISTS idx_members_cardio ON members(gym_id, cardio_addon)
  WHERE cardio_addon = TRUE;

COMMIT;
