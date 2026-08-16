-- 000_extensions.sql
--
-- Postgres extensions the rest of the schema assumes are already present.
--
-- WHY THIS FILE EXISTS: migration 001 calls uuid_generate_v4() in almost
-- every CREATE TABLE, but no migration in the original repository ever
-- enabled the extension that provides it. It was switched on by hand in
-- the Supabase dashboard, so the migration history could not rebuild the
-- database from empty — applying 001 to a fresh project fails immediately
-- with "function uuid_generate_v4() does not exist" (SQLSTATE 42883).
--
-- Runs before 001 by filename order.
--
-- The extensions must live in `public`, not Supabase's `extensions`
-- schema: migrations are applied by a login role whose search_path does
-- not include `extensions`, so a schema-qualified install still leaves
-- 001 unable to resolve the function.
--
-- Note the DO block rather than CREATE EXTENSION IF NOT EXISTS. On a
-- Supabase project uuid-ossp may already exist in the `extensions`
-- schema, and IF NOT EXISTS would then silently do nothing — leaving the
-- function unreachable and 001 still failing. ALTER ... SET SCHEMA moves
-- an existing one; CREATE handles a genuinely fresh database.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'uuid-ossp') then
    execute 'alter extension "uuid-ossp" set schema public';
  else
    execute 'create extension "uuid-ossp" with schema public';
  end if;

  if exists (select 1 from pg_extension where extname = 'pgcrypto') then
    execute 'alter extension "pgcrypto" set schema public';
  else
    execute 'create extension "pgcrypto" with schema public';
  end if;
end
$$;
