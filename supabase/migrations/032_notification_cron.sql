-- ═══════════════════════════════════════════════════════════════════
-- Migration 032 — Schedule the notification generator
-- ═══════════════════════════════════════════════════════════════════
-- Calls the generate-notifications Edge Function on a schedule so
-- notifications (and push) fire even when nobody has Flym open.
--
-- ── BEFORE RUNNING THIS ───────────────────────────────────────────
--   1. Deploy the function:
--        supabase functions deploy generate-notifications --no-verify-jwt
--   2. Set the shared secret (pick any long random string):
--        supabase secrets set CRON_SECRET=<your-random-string>
--   3. Replace BOTH placeholders below:
--        <PROJECT_REF>  — your Supabase project ref
--        <CRON_SECRET>  — the same string from step 2
--
-- The secret is stored in Vault, not inline in the cron command, so it
-- doesn't sit in cron.job in plaintext for anyone with DB access to read.
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists pg_cron  with schema extensions;
create extension if not exists pg_net   with schema extensions;

-- ── Store the secret in Vault ─────────────────────────────────────
do $$
begin
  perform vault.create_secret('<CRON_SECRET>', 'flym_cron_secret', 'Shared secret for generate-notifications');
exception
  when others then
    -- Already exists — update it instead
    update vault.secrets
       set secret = '<CRON_SECRET>'
     where name = 'flym_cron_secret';
end $$;

-- ── Caller ────────────────────────────────────────────────────────
create or replace function public.trigger_generate_notifications()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'flym_cron_secret'
   limit 1;

  if v_secret is null then
    raise warning '[flym] cron secret missing — skipping notification run';
    return;
  end if;

  perform net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/generate-notifications',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'x-cron-secret', v_secret
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;

revoke all on function public.trigger_generate_notifications() from public, anon, authenticated;

-- ── Schedule: 09:00 IST daily (= 03:30 UTC; pg_cron runs in UTC) ──
-- Morning is deliberate: gym owners act on renewals at opening time,
-- and a 3am buzz would get push permission revoked fast.
select cron.unschedule('flym-generate-notifications')
  where exists (select 1 from cron.job where jobname = 'flym-generate-notifications');

select cron.schedule(
  'flym-generate-notifications',
  '30 3 * * *',
  $$select public.trigger_generate_notifications();$$
);

-- ── Verify ────────────────────────────────────────────────────────
--   select jobname, schedule, active from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 5;
--
-- ── Test it right now without waiting for 9am ─────────────────────
--   select public.trigger_generate_notifications();
--   then: supabase functions logs generate-notifications
--
-- ── Turn it off ───────────────────────────────────────────────────
--   select cron.unschedule('flym-generate-notifications');
