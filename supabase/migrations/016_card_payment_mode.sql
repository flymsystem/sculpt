-- Migration 016: add "Card" as a third payment_mode option (alongside Cash, Online)
-- Run AFTER 015_cancel_membership.sql

ALTER TABLE members DROP CONSTRAINT IF EXISTS members_payment_mode_check;
ALTER TABLE members ADD CONSTRAINT members_payment_mode_check
  CHECK (payment_mode IN ('Cash','Online','Card') OR payment_mode IS NULL);

ALTER TABLE payment_history DROP CONSTRAINT IF EXISTS payment_history_payment_mode_check;
ALTER TABLE payment_history ADD CONSTRAINT payment_history_payment_mode_check
  CHECK (payment_mode IN ('Cash','Online','Card') OR payment_mode IS NULL);
