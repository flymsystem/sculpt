-- 0225_gym_users_is_selected.sql
--
-- Adds gym_users.is_selected, which no migration in this repository
-- creates. Migrations 020 and 021 are absent from the history — they were
-- applied straight to production and never saved.
--
-- Required by:
--   · migration 023, which rewrites get_my_gym_id() to respect it
--   · src/lib/auth.js getMyProfile(), which selects it and uses it to pick
--     the active branch for a multi-branch owner
--   · the switch_gym() RPC
--
-- Filename sorts "022" < "0225" < "023", which is the apply order.

BEGIN;

ALTER TABLE gym_users
  ADD COLUMN IF NOT EXISTS is_selected BOOLEAN NOT NULL DEFAULT FALSE;

-- At most one selected gym per user. Partial, because unselected rows are
-- expected to collide freely.
--
-- Note this is deliberately NOT the index any upsert infers against:
-- PostgREST emits ON CONFLICT (cols) with no predicate and cannot match a
-- partial index, so nothing here should be used as a conflict target.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gym_users_one_selected
  ON gym_users(user_id)
  WHERE is_selected = TRUE;

-- A single-gym owner should land on their only gym rather than none.
UPDATE gym_users gu
   SET is_selected = TRUE
 WHERE is_selected = FALSE
   AND NOT EXISTS (
     SELECT 1 FROM gym_users x
      WHERE x.user_id = gu.user_id AND x.is_selected = TRUE
   )
   AND gu.id = (
     SELECT y.id FROM gym_users y
      WHERE y.user_id = gu.user_id
      ORDER BY y.id
      LIMIT 1
   );

COMMIT;
