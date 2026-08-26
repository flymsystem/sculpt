-- 127_gym_audit_identity_fields.sql
--
-- Phase D (Financial & GST Audit Support Report) needs to print the legal
-- identity of the business on the report cover — legal/registered name,
-- PAN, and a registered address distinct from the free-text "Address"
-- field already used on invoices (which mixes a WhatsApp-facing mailing
-- line with, in this gym's current data, what looks like an email address
-- typo'd into the address box — not something an auditor should see
-- reused as the registered address).
--
-- `gyms.gstin` already exists (added by an earlier migration, not this
-- one) and is already populated in production — do not touch it.
-- `gyms.address` / `gyms.city` already exist too and stay exactly as they
-- are; they remain the invoice/WhatsApp-facing address. This migration
-- only adds the three fields that have no existing column to reuse:
--
--   pan                 — Permanent Account Number (income-tax ID)
--   legal_name           — registered legal/trade name, which can differ
--                          from the marketing "Gym Name" already in `name`
--   registered_address    — the address on GST/PAN registration, which an
--                          owner may want to keep separate from the
--                          shorter address shown on member-facing invoices
--
-- All three are nullable text with no default: until Steven fills them in
-- via Settings, the audit report must render an explicit "not supplied"
-- state (see backup.js) rather than inventing a value or silently
-- reusing `address`/`name` as a stand-in for a legal identity field.
ALTER TABLE gyms
  ADD COLUMN IF NOT EXISTS pan text,
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS registered_address text;
