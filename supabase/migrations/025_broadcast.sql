-- ─────────────────────────────────────────────────────────────────
-- Migration 025: Broadcast messaging (bulk WhatsApp via Cloud API)
-- Depends on: 024_v2_settings
-- ─────────────────────────────────────────────────────────────────

BEGIN;

-- ── Broadcasts table (one row per campaign) ─────────────────────
CREATE TABLE IF NOT EXISTS broadcasts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id         uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  message        text NOT NULL,
  total_recipients int NOT NULL DEFAULT 0,
  sent_count     int NOT NULL DEFAULT 0,
  failed_count   int NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'payment_pending'
    CHECK (status IN ('payment_pending','paid','sending','completed','partially_failed','failed')),
  -- Razorpay payment fields
  razorpay_order_id   text,
  razorpay_payment_id text,
  amount_paise        int NOT NULL DEFAULT 0,  -- total cost in paise (INR × 100)
  cost_per_msg_paise  int NOT NULL DEFAULT 90, -- per-message cost in paise
  -- Timestamps
  created_at     timestamptz NOT NULL DEFAULT now(),
  paid_at        timestamptz,
  started_at     timestamptz,
  completed_at   timestamptz
);

-- Index for gym-scoped queries + ordering
CREATE INDEX IF NOT EXISTS idx_broadcasts_gym_created
  ON broadcasts (gym_id, created_at DESC);

-- ── Broadcast recipients (one row per member per broadcast) ─────
CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id   uuid NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  member_id      uuid NOT NULL,
  member_name    text NOT NULL DEFAULT '',
  phone          text NOT NULL,
  status         text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','failed')),
  error_message  text,
  sent_at        timestamptz
);

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast
  ON broadcast_recipients (broadcast_id, status);

-- ── RLS ─────────────────────────────────────────────────────────

ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcast_recipients ENABLE ROW LEVEL SECURITY;

-- Broadcasts: gym owners can read/insert their own
DROP POLICY IF EXISTS "Owners read own broadcasts" ON broadcasts;
CREATE POLICY "Owners read own broadcasts" ON broadcasts
  FOR SELECT USING (gym_id = get_my_gym_id());

DROP POLICY IF EXISTS "Owners insert own broadcasts" ON broadcasts;
CREATE POLICY "Owners insert own broadcasts" ON broadcasts
  FOR INSERT WITH CHECK (gym_id = get_my_gym_id());

-- Broadcasts: Edge Functions (service role) can update any row
-- (service role bypasses RLS, no policy needed)

-- Recipients: gym owners can read recipients of their broadcasts
DROP POLICY IF EXISTS "Owners read own broadcast recipients" ON broadcast_recipients;
CREATE POLICY "Owners read own broadcast recipients" ON broadcast_recipients
  FOR SELECT USING (
    broadcast_id IN (SELECT id FROM broadcasts WHERE gym_id = get_my_gym_id())
  );

DROP POLICY IF EXISTS "Owners insert own broadcast recipients" ON broadcast_recipients;
CREATE POLICY "Owners insert own broadcast recipients" ON broadcast_recipients
  FOR INSERT WITH CHECK (
    broadcast_id IN (SELECT id FROM broadcasts WHERE gym_id = get_my_gym_id())
  );

-- Admin policies
DROP POLICY IF EXISTS "Admins read all broadcasts" ON broadcasts;
CREATE POLICY "Admins read all broadcasts" ON broadcasts
  FOR SELECT USING (is_flym_admin());

DROP POLICY IF EXISTS "Admins read all broadcast recipients" ON broadcast_recipients;
CREATE POLICY "Admins read all broadcast recipients" ON broadcast_recipients
  FOR SELECT USING (is_flym_admin());

COMMIT;
