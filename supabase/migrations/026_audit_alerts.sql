-- 026_audit_alerts.sql
-- Audit log alerting: a pg_cron job scans audit_log every 15 minutes for
-- suspicious patterns and inserts rows into audit_alerts. The dashboard
-- shows unacknowledged alerts as a red banner.
--
-- Email notification is intentionally NOT included here; an Edge Function
-- can be added later once SMTP/Resend is configured.

-- ============================================================
-- 1. Table
-- ============================================================
create table if not exists public.audit_alerts (
  id              bigserial primary key,
  triggered_at    timestamptz not null default now(),
  severity        text not null default 'warning'
                    check (severity in ('info', 'warning', 'critical')),
  kind            text not null,
  summary         text not null,
  evidence        jsonb,
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users(id) on delete set null
);

create index if not exists audit_alerts_open_idx
  on public.audit_alerts (triggered_at desc)
  where acknowledged_at is null;

create index if not exists audit_alerts_kind_open_idx
  on public.audit_alerts (kind, triggered_at desc)
  where acknowledged_at is null;

comment on table public.audit_alerts is
  'Security alerts surfaced from audit_log patterns. Populated by scan_audit_log_for_alerts() every 15 minutes via pg_cron.';

-- ============================================================
-- 2. RLS
-- ============================================================
alter table public.audit_alerts enable row level security;

-- Anyone with audit.read can see + acknowledge alerts. Clients explicitly cannot.
drop policy if exists "audit_alerts_select" on public.audit_alerts;
create policy "audit_alerts_select"
  on public.audit_alerts
  for select to authenticated
  using (public.has_permission('audit.read'));

-- Direct INSERT is blocked — only the scan function (SECURITY DEFINER) inserts.
drop policy if exists "audit_alerts_no_insert" on public.audit_alerts;
create policy "audit_alerts_no_insert"
  on public.audit_alerts
  for insert to authenticated
  with check (false);

drop policy if exists "audit_alerts_update_ack" on public.audit_alerts;
create policy "audit_alerts_update_ack"
  on public.audit_alerts
  for update to authenticated
  using (public.has_permission('audit.read'))
  with check (public.has_permission('audit.read'));

-- ============================================================
-- 3. Scan function
-- ============================================================
-- Scans audit_log over recent windows for suspicious patterns and inserts
-- alert rows. De-duplicates: only inserts an alert of a given kind if there
-- isn't already an UNACKNOWLEDGED one of the same kind within the last hour.
create or replace function public.scan_audit_log_for_alerts()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  added int := 0;
  v_row record;
  v_count int;
begin
  -- Helper: raise an alert if no unacknowledged one of same kind in last hour
  -- (inlined per-rule below since plpgsql can't take procedure as parameter cleanly)

  -- ---- Rule 1: credential reveal burst ----
  -- 5+ platform_credentials.reveal in last 30 min by same actor
  for v_row in
    select actor_email, count(*)::int as cnt
    from public.audit_log
    where action = 'platform_credentials.reveal'
      and created_at > (now() - interval '30 minutes')
    group by actor_email
    having count(*) >= 5
  loop
    if not exists (
      select 1 from public.audit_alerts
      where kind = 'credential_reveal_burst'
        and acknowledged_at is null
        and triggered_at > (now() - interval '1 hour')
    ) then
      insert into public.audit_alerts (severity, kind, summary, evidence)
      values (
        'critical',
        'credential_reveal_burst',
        format('%s revealed %s platform credentials in the last 30 minutes', v_row.actor_email, v_row.cnt),
        jsonb_build_object('actor_email', v_row.actor_email, 'count', v_row.cnt, 'window_minutes', 30, 'threshold', 5)
      );
      added := added + 1;
    end if;
  end loop;

  -- ---- Rule 2: mass client delete ----
  select count(*)::int into v_count
  from public.audit_log
  where action = 'clients.delete'
    and created_at > (now() - interval '30 minutes');
  if v_count >= 3 then
    if not exists (
      select 1 from public.audit_alerts
      where kind = 'mass_client_delete'
        and acknowledged_at is null
        and triggered_at > (now() - interval '1 hour')
    ) then
      insert into public.audit_alerts (severity, kind, summary, evidence)
      values (
        'critical',
        'mass_client_delete',
        format('%s clients deleted in the last 30 minutes', v_count),
        jsonb_build_object('count', v_count, 'window_minutes', 30, 'threshold', 3)
      );
      added := added + 1;
    end if;
  end if;

  -- ---- Rule 3: mass document delete ----
  select count(*)::int into v_count
  from public.audit_log
  where action = 'documents.delete'
    and created_at > (now() - interval '30 minutes');
  if v_count >= 10 then
    if not exists (
      select 1 from public.audit_alerts
      where kind = 'mass_document_delete'
        and acknowledged_at is null
        and triggered_at > (now() - interval '1 hour')
    ) then
      insert into public.audit_alerts (severity, kind, summary, evidence)
      values (
        'warning',
        'mass_document_delete',
        format('%s documents deleted in the last 30 minutes', v_count),
        jsonb_build_object('count', v_count, 'window_minutes', 30, 'threshold', 10)
      );
      added := added + 1;
    end if;
  end if;

  -- ---- Rule 4: platform credential write ----
  -- Any create/update on platform_credentials in last 30 min — these should be rare.
  select count(*)::int into v_count
  from public.audit_log
  where action in ('platform_credentials.create', 'platform_credentials.update')
    and created_at > (now() - interval '30 minutes');
  if v_count >= 1 then
    if not exists (
      select 1 from public.audit_alerts
      where kind = 'platform_credentials_write'
        and acknowledged_at is null
        and triggered_at > (now() - interval '1 hour')
    ) then
      insert into public.audit_alerts (severity, kind, summary, evidence)
      values (
        'info',
        'platform_credentials_write',
        format('%s platform credential record(s) created or updated in the last 30 minutes — verify intentional', v_count),
        jsonb_build_object('count', v_count, 'window_minutes', 30)
      );
      added := added + 1;
    end if;
  end if;

  -- ---- Rule 5: permission matrix change ----
  -- Edits to user_permissions / role_permission_defaults are rare and high-impact.
  select count(*)::int into v_count
  from public.audit_log
  where action in ('user_permissions.create', 'user_permissions.update', 'user_permissions.delete',
                   'role_permission_defaults.update')
    and created_at > (now() - interval '30 minutes');
  if v_count >= 1 then
    if not exists (
      select 1 from public.audit_alerts
      where kind = 'permission_change'
        and acknowledged_at is null
        and triggered_at > (now() - interval '1 hour')
    ) then
      insert into public.audit_alerts (severity, kind, summary, evidence)
      values (
        'warning',
        'permission_change',
        format('%s permission setting(s) changed in the last 30 minutes — verify intentional', v_count),
        jsonb_build_object('count', v_count, 'window_minutes', 30)
      );
      added := added + 1;
    end if;
  end if;

  return added;
end $$;

revoke all on function public.scan_audit_log_for_alerts() from public;
grant   execute on function public.scan_audit_log_for_alerts() to service_role;

comment on function public.scan_audit_log_for_alerts() is
  'Scans recent audit_log entries for suspicious patterns and inserts rows into audit_alerts. De-duplicates by kind over a 1-hour window. Runs every 15 minutes via pg_cron job audit-alerts-scan. Safe to call manually for testing.';

-- ============================================================
-- 4. Acknowledge function
-- ============================================================
create or replace function public.acknowledge_audit_alert(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('audit.read') then
    raise exception 'audit.read permission required';
  end if;
  update public.audit_alerts
  set acknowledged_at = now(),
      acknowledged_by = auth.uid()
  where id = p_id and acknowledged_at is null;
end $$;

revoke all on function public.acknowledge_audit_alert(bigint) from public;
grant   execute on function public.acknowledge_audit_alert(bigint) to authenticated;

-- ============================================================
-- 5. pg_cron schedule (every 15 minutes)
-- ============================================================
do $$
declare
  jid bigint;
begin
  for jid in select jobid from cron.job where jobname = 'audit-alerts-scan' loop
    perform cron.unschedule(jid);
  end loop;
end$$;

select cron.schedule(
  'audit-alerts-scan',
  '*/15 * * * *',  -- every 15 minutes
  $cron$ select public.scan_audit_log_for_alerts(); $cron$
);
