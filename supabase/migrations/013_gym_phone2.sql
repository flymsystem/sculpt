-- Migration 013: second gym contact number (for invoices/receipts)
-- Run AFTER 012_gst_discount_logo.sql

ALTER TABLE gyms ADD COLUMN IF NOT EXISTS phone2 TEXT;
