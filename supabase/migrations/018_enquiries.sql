-- 018_enquiries.sql
-- Walk-in enquiry tracking for gym owners

-- ── Table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS enquiries (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  gym_id        uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  name          text NOT NULL,
  phone         text,
  source        text DEFAULT 'Walk-in',    -- Walk-in | Instagram | Referral | Google | Other
  status        text DEFAULT 'New',         -- New | Contacted | Converted | Lost
  notes         text,
  created_at    timestamptz DEFAULT now(),
  followed_up_at timestamptz,
  is_active     boolean DEFAULT true
);

-- ── Indexes ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_enquiries_gym_id ON enquiries(gym_id);
CREATE INDEX IF NOT EXISTS idx_enquiries_status ON enquiries(status);
CREATE INDEX IF NOT EXISTS idx_enquiries_created ON enquiries(created_at DESC);

-- ── RLS ──────────────────────────────────────────────
ALTER TABLE enquiries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners see own gym enquiries" ON enquiries;
CREATE POLICY "Owners see own gym enquiries" ON enquiries
  FOR ALL USING (gym_id = get_my_gym_id());

DROP POLICY IF EXISTS "Admin full access to enquiries" ON enquiries;
CREATE POLICY "Admin full access to enquiries" ON enquiries
  FOR ALL USING (is_flym_admin());
