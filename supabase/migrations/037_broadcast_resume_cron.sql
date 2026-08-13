-- ═══════════════════════════════════════════════════════════════════
-- Migration 037 — Safety net for stalled broadcasts
-- ═══════════════════════════════════════════════════════════════════
-- Completes AUDIT.md A12.
--
-- process-broadcast now sends in bounded chunks and hands off to itself
-- for the remainder. That self-invoke is the fast path — but if it ever
-- fails (cold start, transient network, a deploy mid-send), the
-- broadcast would sit on status='sending' forever with the gym owner's
-- money already taken.
--
-- This is the net: every 2 minutes, nudge the function to pick up the
-- oldest broadcast still in 'paid' or 'sending'. Calling it with no
-- broadcast_id puts it in sweep mode, where it finds one itself.
--
-- It is safe to run alongside the self-invoke chain. Work is claimed by
-- flipping recipient rows off status='pending' one at a time, so two
-- overlapping runs cannot send the same message twice — the second run
-- simply finds fewer pending rows. When nothing is mid-send the call
-- returns "Nothing to resume" and costs essentially nothing.
--
-- ── BEFORE RUNNING THIS ───────────────────────────────────────────
--   1. Deploy the function:  supabase functions deploy process-broadcast
--   2. CRON_SECRET must be set (generate-notifications already needs
--      it):                  supabase secrets set CRON_SECRET=<value>
--   3. Replace <PROJECT_REF> below with your Supabase project ref.
--
-- The secret is read from Vault, the same way migration 032 does it, so
-- it isn't sitting in cron.job in plaintext.
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

create or replace function public.trigger_resume_broadcasts()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
  v_pending int;
begin
  -- Cheap guard: don't wake the function when there is nothing to do.
  select count(*) into v_pending
    from public.broadcasts
   where status in ('paid', 'sending');

  if v_pending = 0 then
    return;
  end if;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'flym_cron_secret'
   limit 1;

  if v_secret is null then
    raise warning '[flym] cron secret missing - cannot resume broadcasts';
    return;
  end if;

  perform net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/process-broadcast',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'x-cron-secret', v_secret
               ),
    body    := '{}'::jsonb,          -- no broadcast_id = sweep mode
    timeout_milliseconds := 120000
  );
end;
$$;

revoke all on function public.trigger_resume_broadcasts() from public, anon, authenticated;

select cron.unschedule('flym-resume-broadcasts')
  where exists (select 1 from cron.job where jobname = 'flym-resume-broadcasts');

select cron.schedule(
  'flym-resume-broadcasts',
  '*/2 * * * *',
  $$select public.trigger_resume_broadcasts();$$
);

-- ═══════════════════════════════════════════════════════════════════
-- VERIFY
-- ═══════════════════════════════════════════════════════════════════
--   select jobname, schedule, active from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 5;
--
-- Force a stall to prove the net works: start a broadcast, then while
-- it is sending run
--     update broadcasts set status = 'sending' where id = '<id>';
-- and confirm within ~2 minutes that sent_count starts climbing again
-- and the status eventually reaches 'completed'.
--
-- Turn it off:  select cron.unschedule('flym-resume-broadcasts');
-- ═══════════════════════════════════════════════════════════════════
