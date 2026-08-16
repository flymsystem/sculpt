-- 0390_addon_templates.sql
--
-- The addon_templates table, created by no migration in this repository.
-- Another casualty of the missing 008/009/020/021/026 history.
--
-- Columns taken from src/lib/addon-templates.js:
--   getAddonTemplates()  filters gym_id + is_active, orders by
--                        sort_order then name
--   addAddonTemplate()   inserts gym_id, name, default_price,
--                        is_one_time, sort_order
--   deleteAddonTemplate() sets is_active = false (soft delete, matching
--                        every table except expenses)
--
-- Must run before 0395, which rewrites this table's RLS policy.

BEGIN;

CREATE TABLE IF NOT EXISTS addon_templates (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gym_id        UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  default_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (default_price >= 0),
  is_one_time   BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_addon_templates_gym
  ON addon_templates(gym_id, is_active, sort_order);

ALTER TABLE addon_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_addon_tpl"     ON addon_templates;
DROP POLICY IF EXISTS "owner_all_own_addon_tpl" ON addon_templates;

CREATE POLICY "admin_all_addon_tpl"     ON addon_templates FOR ALL USING (is_flym_admin());
CREATE POLICY "owner_all_own_addon_tpl" ON addon_templates FOR ALL USING (gym_id = get_my_gym_id());

COMMIT;
