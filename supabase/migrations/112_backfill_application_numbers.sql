-- ─────────────────────────────────────────────────────────────────
-- 112_backfill_application_numbers.sql
--
-- Every existing member has application_number = NULL — confirmed
-- against production data. This is not a legacy-data artefact: the
-- generation path added in 104 (sculpt_add_member calling
-- sculpt_generate_application_number) has NOT been observed to
-- actually run for any member row yet, including ones added after
-- 104 was applied. See CLAUDE.md / the investigation notes for the
-- suspected cause (src/lib/members.js's isMissingFunction() fallback
-- silently swallowing a PostgREST "function not found" response and
-- inserting application_number = NULL directly instead of surfacing
-- an error) — that part is still being confirmed with real evidence
-- before any code changes there.
--
-- This migration only backfills existing rows. It does not fix
-- whatever is stopping new rows from getting a number — that fix, once
-- confirmed, lands separately.
--
-- Only active members get backfilled: the unique index from migration
-- 022 is `(gym_id, application_number) WHERE application_number IS
-- NOT NULL AND is_active = true`, and an inactive member can't sign in
-- regardless (member-signin filters is_active = true), so there is
-- nothing for an inactive member's number to do right now.
--
-- Uses the exact same alphabet/format as sculpt_generate_application_number
-- (migration 104) but is NOT a call to that function — it's SECURITY
-- DEFINER and gates on the caller being an owner/staff of the target
-- gym via auth.uid(), which is NULL in a migration run from the SQL
-- editor. This inlines the same generation logic instead.
--
-- Safe to run more than once — only touches rows still NULL.
-- ─────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_alphabet text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  r record;
  v_seq int;
  v_suffix text;
  v_bytes bytea;
  i int;
BEGIN
  FOR r IN
    SELECT id, gym_id FROM members
    WHERE application_number IS NULL AND is_active = true
    ORDER BY created_at
  LOOP
    UPDATE gyms SET next_application_seq = next_application_seq + 1
    WHERE id = r.gym_id
    RETURNING next_application_seq INTO v_seq;

    v_bytes := gen_random_bytes(3);
    v_suffix := '';
    FOR i IN 0..2 LOOP
      v_suffix := v_suffix || substr(v_alphabet, 1 + (get_byte(v_bytes, i) % length(v_alphabet)), 1);
    END LOOP;

    UPDATE members
    SET application_number = 'SC-' || lpad(v_seq::text, 4, '0') || '-' || v_suffix
    WHERE id = r.id;
  END LOOP;
END $$;
