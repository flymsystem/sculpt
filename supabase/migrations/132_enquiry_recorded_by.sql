-- ═══════════════════════════════════════════════════════════════
-- Migration 132 — enquiries record WHO took them, so the owner can
-- see "Recorded by <staff name>" once staff logins start adding them
-- ═══════════════════════════════════════════════════════════════
-- Staff logins are gaining a second page: Enquiries (add + edit).
-- The RLS for that already exists — staff_insert_enquiries,
-- staff_read_enquiries and staff_update_enquiries all shipped in the
-- baseline — so this migration is only about attribution.
--
-- Two columns, not one:
--
--   created_by      the auth user id. The durable, joinable fact.
--   created_by_name a NAME SNAPSHOT, resolved at insert time.
--
-- The snapshot is deliberate. Removing a staff member is a soft
-- delete (`staff.is_active = false`) and deleting their login is a
-- genuine auth-user delete, either of which would leave a join-only
-- attribution rendering as blank or "Unknown" months later — the
-- owner would lose the answer to "who took this walk-in?" for every
-- enquiry the person ever recorded. A snapshot keeps reading
-- correctly after the person is gone, which is exactly when the
-- question gets asked.
--
-- Both are stamped by a BEFORE INSERT trigger rather than sent by the
-- client. A staff browser could otherwise put any name it liked in
-- the owner's list — attribution the person being attributed can
-- edit is not attribution. The client sends name/phone/source/notes
-- and nothing else; lib/enquiries.js is unchanged on the write path.
--
-- Rows that predate this migration keep NULL in both columns and the
-- UI shows nothing for them, rather than guessing "Owner" for
-- enquiries nobody recorded an author for.
-- ═══════════════════════════════════════════════════════════════

begin;

alter table public.enquiries
  add column if not exists created_by uuid,
  add column if not exists created_by_name text;

comment on column public.enquiries.created_by is
  'auth.uid() of whoever inserted the row. Stamped server-side by sculpt_stamp_enquiry_author(); never supplied by the client.';
comment on column public.enquiries.created_by_name is
  'Display-name snapshot taken at insert time (staff.full_name, or ''Owner''). Snapshot, not a join, so attribution survives the staff member being removed.';

-- ── Author stamp ────────────────────────────────────────────────
-- SECURITY DEFINER because a staff caller cannot itself read the
-- `staff` row it is about to be named after under its own RLS in
-- every path, and because the whole point is that the value does not
-- come from the caller.
--
-- Note the alias on the staff lookup. `created_by_name` is a column
-- of the row being inserted AND would be a perfectly good name for a
-- variable here; qualifying `s.full_name` keeps this free of the
-- ambiguity class that bit sculpt_issue_checkin_token() and friends
-- (see migration 111 and CLAUDE.md).
create or replace function public.sculpt_stamp_enquiry_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text;
begin
  -- A NULL uid means this insert came from a service-role/back-office
  -- context (a backup restore, a seed). Leave both columns NULL rather
  -- than inventing an author for it.
  if v_uid is null then
    return new;
  end if;

  new.created_by := v_uid;

  select s.full_name into v_name
    from public.staff s
   where s.user_id = v_uid
     and s.gym_id  = new.gym_id
   limit 1;

  -- No staff row for this uid in this gym: under `Owners see own gym
  -- enquiries` the only other caller who can insert here is the gym's
  -- own owner, so label it as such. `gyms` has no owner_id column to
  -- read a nicer name from (ownership lives in gym_users) and
  -- gyms.owner_name is the gym's proprietor, not necessarily the
  -- person logged in — "Owner" is the honest label.
  if v_name is null then
    v_name := 'Owner';
  end if;

  new.created_by_name := v_name;
  return new;
end;
$$;

comment on function public.sculpt_stamp_enquiry_author() is
  'BEFORE INSERT on enquiries: stamps created_by = auth.uid() and created_by_name from the caller''s staff.full_name (else ''Owner''). Server-side on purpose — a staff session must not be able to choose the name the owner sees against the enquiries it records.';

drop trigger if exists trg_enquiries_stamp_author on public.enquiries;
create trigger trg_enquiries_stamp_author
  before insert on public.enquiries
  for each row execute function public.sculpt_stamp_enquiry_author();

commit;
