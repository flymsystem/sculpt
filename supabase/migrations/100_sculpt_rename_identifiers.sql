-- 100_sculpt_rename_identifiers.sql
--
-- Renames every database identifier carrying the previous product's name.
--
-- WHY ALTER FUNCTION ... RENAME AND NOT DROP + CREATE:
-- RENAME changes only the identifier. The function body, its transaction
-- boundary, the SELECT ... FOR UPDATE row lock inside clear_balance, and
-- the deliberate ABSENCE of SECURITY DEFINER (these RPCs run with the
-- caller's rights so existing RLS applies unchanged) are all preserved
-- byte for byte. A drop-and-recreate would risk losing exactly those
-- properties, which are the entire reason the money RPCs exist.
--
-- Renaming is safe here specifically because this database is new and
-- empty and the client is updated in the same commit. There is no
-- deployed frontend that could fall out of sync.
--
-- Loop rather than a hand-written list of signatures: ALTER FUNCTION
-- needs the full argument list to disambiguate, and oid::regprocedure
-- produces it exactly. It also catches helpers that are easy to miss by
-- hand — flym_assert_payment_mode, for one.

BEGIN;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname LIKE 'flym\_%'
  LOOP
    EXECUTE format('ALTER FUNCTION %s RENAME TO %I',
                   r.sig, replace(r.proname, 'flym_', 'sculpt_'));
    RAISE NOTICE 'renamed % -> %', r.proname, replace(r.proname, 'flym_', 'sculpt_');
  END LOOP;
END
$$;

-- is_flym_admin() supported the superadmin role, which this build removed.
--
-- It is renamed rather than dropped because RLS policies across the whole
-- schema reference it. Postgres records those dependencies by OID, so the
-- rename updates every policy automatically — dropping it would instead
-- require rewriting ~40 policies by hand, each one an opportunity to
-- widen access by accident.
--
-- With no 'admin' row possible in gym_users any more, it simply always
-- returns false, leaving every policy's remaining branch to do the work.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'is_flym_admin'
  ) THEN
    EXECUTE 'ALTER FUNCTION public.is_flym_admin() RENAME TO is_platform_admin';
  END IF;
END
$$;

COMMIT;
