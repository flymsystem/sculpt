-- 024_v2_settings.sql
-- Custom GST percentage, invoice terms, discount settings, password change tracking

ALTER TABLE gyms ADD COLUMN IF NOT EXISTS gst_percentage numeric DEFAULT 18;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS invoice_terms text;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS discount_enabled boolean DEFAULT false;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS default_discount_pct numeric DEFAULT 0;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

-- Refresh the members_with_status view to include these new gym columns
-- (view itself doesn't change but this ensures consistency)
