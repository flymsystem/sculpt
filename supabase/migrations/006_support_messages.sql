-- ─────────────────────────────────────────────────────────────────
-- Migration 006: Support Messages Table
-- Required by the Contact Us page which inserts to this table.
-- ─────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS support_messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gym_id      UUID REFERENCES gyms(id) ON DELETE SET NULL,
  gym_name    TEXT,
  gym_code    TEXT,
  owner_name  TEXT,
  subject     TEXT,
  message     TEXT NOT NULL,
  is_resolved BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;

-- Gym owners can insert their own messages
CREATE POLICY "owner_insert_support" ON support_messages
  FOR INSERT WITH CHECK (gym_id = get_my_gym_id() OR gym_id IS NULL);

-- Admins can read and manage all messages
CREATE POLICY "admin_all_support" ON support_messages
  FOR ALL USING (is_flym_admin());

CREATE INDEX IF NOT EXISTS idx_support_messages_gym_id    ON support_messages(gym_id);
CREATE INDEX IF NOT EXISTS idx_support_messages_created   ON support_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_messages_resolved  ON support_messages(is_resolved);

COMMIT;
