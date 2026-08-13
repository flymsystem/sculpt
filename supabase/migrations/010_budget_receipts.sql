-- Migration 010: Budget + receipt photos
-- Run AFTER 009/009b

BEGIN;

-- 1. Monthly budget on gyms table (for expense budget alerts)
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS monthly_budget NUMERIC(10,2) DEFAULT 0;

-- 2. Receipt photo URL on expenses (for receipt attachment feature)
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_url TEXT;

COMMIT;
