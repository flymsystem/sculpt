-- Migration 017: enforce non-negative values on monetary columns
-- These were added in migration 012 without CHECK constraints, unlike
-- plans.price and payment_history.amount which already have CHECK(>=0)
-- in the original schema. The frontend already clamps these to >= 0,
-- but that's not a substitute for a DB-level constraint — anyone
-- calling the Supabase client directly (or a future bug) could insert
-- a negative discount/balance otherwise.
-- Run AFTER 016_card_payment_mode.sql

ALTER TABLE members DROP CONSTRAINT IF EXISTS members_discount_amount_check;
ALTER TABLE members ADD CONSTRAINT members_discount_amount_check
  CHECK (discount_amount >= 0);

ALTER TABLE members DROP CONSTRAINT IF EXISTS members_balance_due_check;
ALTER TABLE members ADD CONSTRAINT members_balance_due_check
  CHECK (balance_due >= 0);

ALTER TABLE members DROP CONSTRAINT IF EXISTS members_plan_price_check;
ALTER TABLE members ADD CONSTRAINT members_plan_price_check
  CHECK (plan_price IS NULL OR plan_price >= 0);
