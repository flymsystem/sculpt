-- 0095_missing_baseline.sql
--
-- Objects the application queries that NO migration in this repository
-- ever created. In the original project they were applied straight to
-- production and never written down (migrations 008 and 009 are absent
-- from the history), which is why the repo could not rebuild its own
-- database from empty.
--
-- Derived by enumerating every .from() / .select() / .insert() call in
-- src/ and diffing against the schema that actually materialised — not
-- by trusting the migration folder.
--
-- Filename sorts between 005 and 010: "005" < "0095" < "010" as strings,
-- which is the order the CLI applies them in. It must run before 010,
-- which does ALTER TABLE expenses ADD COLUMN receipt_url.

BEGIN;

-- ── expenses ─────────────────────────────────────────────────────
-- Columns taken from src/lib/expenses.js: addExpense() inserts
-- gym_id, category, description, amount, expense_date, expense_month,
-- is_recurring; queries filter on expense_month and expense_date and
-- order by expense_date desc.
--
-- expense_month is a denormalised 'YYYY-MM' string the client derives
-- from expense_date. It is stored rather than computed because the
-- month filter is the single hottest query on the Expenses page.
CREATE TABLE IF NOT EXISTS expenses (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gym_id        UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  category      TEXT,
  description   TEXT,
  amount        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  expense_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  expense_month TEXT,
  is_recurring  BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_gym_month
  ON expenses(gym_id, expense_month);
CREATE INDEX IF NOT EXISTS idx_expenses_gym_date
  ON expenses(gym_id, expense_date DESC);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_expenses"       ON expenses;
DROP POLICY IF EXISTS "owner_all_own_expenses"   ON expenses;

-- Same shape as every other gym-scoped table in 001.
CREATE POLICY "admin_all_expenses"     ON expenses FOR ALL USING (is_flym_admin());
CREATE POLICY "owner_all_own_expenses" ON expenses FOR ALL USING (gym_id = get_my_gym_id());

-- ── plans.is_featured ────────────────────────────────────────────
-- Read by plans.js (Plans Showcase highlight) and exported by
-- backup.js. Created by no migration in the repo.
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE;

COMMIT;
