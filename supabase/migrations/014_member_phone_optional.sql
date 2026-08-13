-- Migration 014: phone number is now optional when adding a member
-- Run AFTER 013_gym_phone2.sql

ALTER TABLE members ALTER COLUMN phone DROP NOT NULL;
