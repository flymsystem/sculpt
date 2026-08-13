-- ═══════════════════════════════════════════════════════════════════
-- Migration 036 — Notifications and push work for staff, not just owners
-- ═══════════════════════════════════════════════════════════════════
-- Fixes AUDIT.md B5.
--
-- ── THE PROBLEM ────────────────────────────────────────────────────
-- Every policy in migration 031 is scoped with `gym_id = get_my_gym_id()`.
-- But get_my_gym_id() (migration 023) only ever matches role = 'owner':
--
--     select gym_id from gym_users
--      where user_id = auth.uid() and role = 'owner'
--
-- For a staff user it returns NULL, and `gym_id = NULL` is never true.
-- So for every staff member:
--   * the notification bell is permanently empty — no badge, ever
--   * mark_notifications_read() returns 0
--   * enabling push silently fails the insert
--   * the client-side sync fired on every login and had every insert
--     rejected, a wasted request storm from every staff device
--
-- Migration 030 carefully added staff policies for members, plans,
-- payments, enquiries, expenses and attendance. Migration 031 then
-- forgot the pattern entirely.
--
-- ── THE FIX ────────────────────────────────────────────────────────
-- One helper that answers "does the current user belong to this gym, in
-- any role?", used by the notification and push policies. Owners keep
-- multi-branch behaviour via is_my_gym(); staff get their single gym.
--
-- Deliberately scoped to notifications + push_subscriptions. Other
-- tables still using get_my_gym_id() (broadcasts, support_messages) are
-- owner-only *by design* and are left alone.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ── Helper ─────────────────────────────────────────────────────────
create or replace function public.is_my_gym_any_role(check_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select check_gym_id is not null and exists (
    select 1 from public.gym_users
     where user_id = auth.uid()
       and gym_id  = check_gym_id
       and role in ('owner', 'staff')
  );
$$;

grant execute on function public.is_my_gym_any_role(uuid) to authenticated;


-- ── notifications ──────────────────────────────────────────────────
-- user_id IS NULL means "everyone in this gym"; a non-null user_id
-- targets one person. That rule is unchanged.
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select using (
    is_flym_admin()
    or (
      is_my_gym_any_role(gym_id)
      and (user_id is null or user_id = auth.uid())
    )
  );

drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications
  for insert with check (
    is_flym_admin() or is_my_gym_any_role(gym_id)
  );

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update using (
    is_flym_admin()
    or (
      is_my_gym_any_role(gym_id)
      and (user_id is null or user_id = auth.uid())
    )
  );

drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete using (
    is_flym_admin() or is_my_gym_any_role(gym_id)
  );


-- ── push_subscriptions ─────────────────────────────────────────────
-- Still one row per device per user: a staff member can only ever see
-- and manage their OWN subscriptions, never a colleague's.
drop policy if exists push_subs_select on public.push_subscriptions;
create policy push_subs_select on public.push_subscriptions
  for select using (
    is_flym_admin() or (is_my_gym_any_role(gym_id) and user_id = auth.uid())
  );

drop policy if exists push_subs_insert on public.push_subscriptions;
create policy push_subs_insert on public.push_subscriptions
  for insert with check (
    is_my_gym_any_role(gym_id) and user_id = auth.uid()
  );

drop policy if exists push_subs_update on public.push_subscriptions;
create policy push_subs_update on public.push_subscriptions
  for update using (
    is_flym_admin() or (is_my_gym_any_role(gym_id) and user_id = auth.uid())
  );

drop policy if exists push_subs_delete on public.push_subscriptions;
create policy push_subs_delete on public.push_subscriptions
  for delete using (
    is_flym_admin() or (is_my_gym_any_role(gym_id) and user_id = auth.uid())
  );


-- ── mark_notifications_read() ──────────────────────────────────────
-- Was hardcoded to get_my_gym_id(), so it returned 0 for staff and the
-- badge never cleared for them.
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_count  integer;
begin
  -- Owner first (respects the selected branch), then staff.
  v_gym_id := coalesce(get_my_gym_id(), get_my_gym_id_as_staff());
  if v_gym_id is null then
    return 0;
  end if;

  update public.notifications
     set is_read = true,
         read_at = now()
   where gym_id = v_gym_id
     and is_read = false
     and (user_id is null or user_id = auth.uid())
     and (p_ids is null or id = any(p_ids));

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

commit;

-- ═══════════════════════════════════════════════════════════════════
-- VERIFY (run by hand after applying)
-- ═══════════════════════════════════════════════════════════════════
-- 1. As a STAFF user in the app: the bell shows the gym's notifications
--    and the unread badge counts down as they are read.
--
-- 2. Tenant isolation still holds. As a staff user:
--      select count(*) from notifications where gym_id = '<another-gym>';
--    Expect 0.
--
-- 3. A staff member cannot see a colleague's push subscription:
--      select count(*) from push_subscriptions;
--    Expect only rows where user_id = their own auth.uid().
--
-- 4. No policy on these two tables still references get_my_gym_id:
--      select policyname, qual, with_check from pg_policies
--       where tablename in ('notifications','push_subscriptions');
-- ═══════════════════════════════════════════════════════════════════
