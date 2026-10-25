-- ═══════════════════════════════════════════════════════════════
-- Migration 133 — trainers/staff carry a batch: Morning or Evening
-- ═══════════════════════════════════════════════════════════════
-- The gym runs two batches a day, and the owner asked for a way to
-- tag each trainer with the batch they cover so the roster can be
-- read (and filtered) by batch instead of from memory.
--
-- One nullable text column with a CHECK, not a lookup table — there
-- are exactly two batches, and the frontend's BATCHES list in
-- dashboard/staff.js is the only writer. 'Both' exists because a
-- trainer covering a double shift is a real case, and forcing the
-- owner to pick one of the two would make the tag lie.
--
-- NULL means "not set", deliberately — every existing staff row lands
-- there, and the UI renders no badge for it rather than guessing a
-- batch nobody chose.
--
-- No RLS change: owner_* policies on `staff` already cover every
-- column, and staff logins never write their own row.
-- ═══════════════════════════════════════════════════════════════

begin;

alter table public.staff
  add column if not exists batch text;

alter table public.staff
  drop constraint if exists staff_batch_check;
alter table public.staff
  add constraint staff_batch_check
  check (batch is null or batch in ('Morning', 'Evening', 'Both'));

comment on column public.staff.batch is
  'Which daily batch this staff member covers: Morning | Evening | Both. NULL = not set.';

commit;
