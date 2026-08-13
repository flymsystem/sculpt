-- ═══════════════════════════════════════════════════════════════════
-- Migration 031 — Notifications + Web Push subscriptions
-- ═══════════════════════════════════════════════════════════════════
-- Adds:
--   1. notifications          — in-app notification feed (bell icon)
--   2. push_subscriptions     — Web Push endpoints per device
--   3. RLS scoped by gym via get_my_gym_id() / is_flym_admin()
--   4. mark_notifications_read() helper
--
-- Notes:
--   * dedupe_key makes notification generation idempotent — the client
--     can re-run its sync on every load without creating duplicates.
--   * user_id NULL means "everyone in this gym". A non-null user_id
--     targets one specific user (e.g. a single staff member).
--   * Cancelled members must never generate notifications — the client
--     filters them out before insert (see src/lib/notifications.js).
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. notifications ──────────────────────────────────────────────
create table if not exists public.notifications (
  id            uuid primary key default gen_random_uuid(),
  gym_id        uuid not null references public.gyms(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete cascade,

  type          text not null default 'general',
  title         text not null,
  body          text,

  -- where the bell should navigate when this notification is tapped
  link_section  text,
  ref_id        uuid,

  -- Idempotency key, unique per gym. e.g. 'expiring:<member_id>:2026-08-11'
  -- NOT NULL with a random default on purpose: a PARTIAL unique index
  -- (…where dedupe_key is not null) cannot be used as an ON CONFLICT
  -- inference target unless the predicate is repeated in the statement,
  -- and PostgREST never emits that predicate. A plain unique index is the
  -- only thing supabase-js .upsert({ onConflict }) can actually match.
  dedupe_key    text not null default gen_random_uuid()::text,

  severity      text not null default 'info',
  is_read       boolean not null default false,
  read_at       timestamptz,
  created_at    timestamptz not null default now(),

  constraint notifications_severity_chk
    check (severity in ('info','success','warning','critical')),
  constraint notifications_type_chk
    check (type in (
      'expiring','expired','payment_due','birthday',
      'enquiry','payment','broadcast','staff','system','general'
    ))
);

-- One row per (gym, dedupe_key). Must be a FULL unique index — see the
-- column comment above for why a partial one breaks the upsert.
create unique index if not exists notifications_gym_dedupe_uidx
  on public.notifications (gym_id, dedupe_key);

create index if not exists notifications_gym_created_idx
  on public.notifications (gym_id, created_at desc);

create index if not exists notifications_gym_unread_idx
  on public.notifications (gym_id, is_read)
  where is_read = false;

alter table public.notifications enable row level security;

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select using (
    is_flym_admin()
    or (
      gym_id = get_my_gym_id()
      and (user_id is null or user_id = auth.uid())
    )
  );

drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications
  for insert with check (
    is_flym_admin() or gym_id = get_my_gym_id()
  );

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update using (
    is_flym_admin()
    or (
      gym_id = get_my_gym_id()
      and (user_id is null or user_id = auth.uid())
    )
  );

drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete using (
    is_flym_admin() or gym_id = get_my_gym_id()
  );


-- ── 2. push_subscriptions ─────────────────────────────────────────
create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  gym_id        uuid not null references public.gyms(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,

  endpoint      text not null,
  p256dh        text not null,
  auth_key      text not null,

  user_agent    text,
  is_active     boolean not null default true,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now()
);

create unique index if not exists push_subscriptions_endpoint_uidx
  on public.push_subscriptions (endpoint);

create index if not exists push_subscriptions_gym_idx
  on public.push_subscriptions (gym_id) where is_active = true;

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subs_select on public.push_subscriptions;
create policy push_subs_select on public.push_subscriptions
  for select using (
    is_flym_admin() or (gym_id = get_my_gym_id() and user_id = auth.uid())
  );

drop policy if exists push_subs_insert on public.push_subscriptions;
create policy push_subs_insert on public.push_subscriptions
  for insert with check (
    gym_id = get_my_gym_id() and user_id = auth.uid()
  );

drop policy if exists push_subs_update on public.push_subscriptions;
create policy push_subs_update on public.push_subscriptions
  for update using (
    is_flym_admin() or (gym_id = get_my_gym_id() and user_id = auth.uid())
  );

drop policy if exists push_subs_delete on public.push_subscriptions;
create policy push_subs_delete on public.push_subscriptions
  for delete using (
    is_flym_admin() or (gym_id = get_my_gym_id() and user_id = auth.uid())
  );


-- ── 3. Helper: mark notifications read ────────────────────────────
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
  v_gym_id := get_my_gym_id();
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


-- ── 4. Housekeeping: drop notifications older than 60 days ────────
create or replace function public.prune_old_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.notifications
   where created_at < now() - interval '60 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ── 5. Realtime ───────────────────────────────────────────────────
-- Lets the bell update live without polling.
do $$
begin
  begin
    alter publication supabase_realtime add table public.notifications;
  exception when duplicate_object then null;
  end;
end $$;
