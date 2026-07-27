-- =============================================================
-- Migration 146: Configurable data-retention schedule + auto-purge
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- GDPR storage limitation. Adds an owner-configurable retention period
-- (in days) per OPERATIONAL / LOG data category, and a daily pg_cron job
-- that purges anything older. Accounting/business records (clients,
-- invoices, documents, tax filings, engagement letters, time entries) are
-- NEVER touched here — Cyprus law requires ~6–7y retention; those are
-- handled at end-of-relationship by the erasure workflow.
--
-- retention_days is a jsonb map { category: days }. A null/absent/0 value
-- means "keep indefinitely". Defaults purge the clearly-intermediate logs
-- and keep the record-ish ones off until the owner opts in.
--
-- Supersedes the standalone OCR job from migration 024 (that cron is
-- unscheduled here; this function now owns OCR too, at the configured age).
-- =============================================================

begin;

alter table public.company_settings
  add column if not exists retention_days jsonb not null default jsonb_build_object(
    'ocr_text',            90,
    'service_runs',        365,
    'ai_usage',            365,
    'audit_alerts',        365,
    'portal_applications', 365,
    'audit_log',           null,
    'call_logs',           null,
    'inbox_emails',        null,
    'client_emails',       null
  );

create or replace function public.purge_by_retention()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg jsonb;
  d int;
  n int;
  summary jsonb := '{}'::jsonb;
begin
  -- Allow cron/service-role (auth.uid() null); block ordinary users.
  if auth.uid() is not null and not public.is_supervisor_or_higher() then
    raise exception 'not authorized';
  end if;

  select coalesce(retention_days, '{}'::jsonb) into cfg
    from public.company_settings where id = 1;

  d := nullif(cfg->>'ocr_text', '')::int;
  if d is not null and d > 0 then
    update public.invoices set raw_ocr_text = ''
      where raw_ocr_text <> '' and created_at < now() - make_interval(days => d);
    get diagnostics n = row_count; summary := summary || jsonb_build_object('ocr_text', n);
  end if;

  d := nullif(cfg->>'service_runs', '')::int;
  if d is not null and d > 0 then
    delete from public.service_runs where scheduled_date < current_date - d;
    get diagnostics n = row_count; summary := summary || jsonb_build_object('service_runs', n);
  end if;

  d := nullif(cfg->>'ai_usage', '')::int;
  if d is not null and d > 0 then
    delete from public.ai_usage where created_at < now() - make_interval(days => d);
    get diagnostics n = row_count; summary := summary || jsonb_build_object('ai_usage', n);
  end if;

  d := nullif(cfg->>'audit_alerts', '')::int;
  if d is not null and d > 0 then
    delete from public.audit_alerts where triggered_at < now() - make_interval(days => d);
    get diagnostics n = row_count; summary := summary || jsonb_build_object('audit_alerts', n);
  end if;

  d := nullif(cfg->>'portal_applications', '')::int;
  if d is not null and d > 0 then
    delete from public.portal_applications
      where status <> 'pending' and created_at < now() - make_interval(days => d);
    get diagnostics n = row_count; summary := summary || jsonb_build_object('portal_applications', n);
  end if;

  d := nullif(cfg->>'audit_log', '')::int;
  if d is not null and d > 0 then
    delete from public.audit_log where ts < now() - make_interval(days => d);
    get diagnostics n = row_count; summary := summary || jsonb_build_object('audit_log', n);
  end if;

  d := nullif(cfg->>'call_logs', '')::int;
  if d is not null and d > 0 then
    delete from public.call_logs where call_at < now() - make_interval(days => d);
    get diagnostics n = row_count; summary := summary || jsonb_build_object('call_logs', n);
  end if;

  d := nullif(cfg->>'inbox_emails', '')::int;
  if d is not null and d > 0 then
    delete from public.inbox_emails where received_at < now() - make_interval(days => d);
    get diagnostics n = row_count; summary := summary || jsonb_build_object('inbox_emails', n);
  end if;

  d := nullif(cfg->>'client_emails', '')::int;
  if d is not null and d > 0 then
    delete from public.client_emails where received_at < now() - make_interval(days => d);
    get diagnostics n = row_count; summary := summary || jsonb_build_object('client_emails', n);
  end if;

  insert into public.audit_log (action, summary)
  values ('data.retention_purge', summary);

  return summary;
end;
$$;

revoke all on function public.purge_by_retention() from public;
grant execute on function public.purge_by_retention() to authenticated, service_role;

-- Retire the standalone OCR cron (migration 024) — this function owns OCR now.
do $$
declare jid bigint;
begin
  for jid in select jobid from cron.job where jobname in ('purge-old-ocr-text', 'purge-by-retention') loop
    perform cron.unschedule(jid);
  end loop;
end$$;

select cron.schedule(
  'purge-by-retention',
  '15 3 * * *',  -- daily at 03:15 UTC
  $cron$ select public.purge_by_retention(); $cron$
);

comment on function public.purge_by_retention() is
  'GDPR retention: purges operational/log data older than the per-category periods in company_settings.retention_days. Never touches accounting records. Daily via pg_cron "purge-by-retention"; safe to call manually.';

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 146.
-- =============================================================
