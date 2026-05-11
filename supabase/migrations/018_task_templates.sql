-- =============================================================
-- Migration 018: Recurring task templates
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Two new tables:
--   task_templates       — the template (name + description)
--   task_template_items  — individual tasks inside a template
--                          (title, priority, days_offset, default_assignee)
--
-- Plus apply_task_template() SECURITY DEFINER RPC that spawns one
-- staff_tasks row per item for a chosen client + apply-date.
--
-- RLS:
--   READ        → any internal staff (is_admin)
--   WRITE       → supervisor + owner (is_supervisor_or_higher)
--   APPLY (RPC) → any internal staff
--
-- Audit triggers reuse the existing tg_audit() from migration 007.
-- =============================================================

begin;

-- -------------------------------------------------------------
-- 1. task_templates
-- -------------------------------------------------------------
create table if not exists public.task_templates (
  id          bigserial primary key,
  name        text not null,
  description text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists task_templates_updated_at on public.task_templates;
create trigger task_templates_updated_at before update on public.task_templates
  for each row execute function public.tg_set_updated_at();

drop trigger if exists tg_audit_task_templates on public.task_templates;
create trigger tg_audit_task_templates
  after insert or update or delete on public.task_templates
  for each row execute function public.tg_audit();

alter table public.task_templates enable row level security;

drop policy if exists "task_templates read"  on public.task_templates;
drop policy if exists "task_templates write" on public.task_templates;

create policy "task_templates read" on public.task_templates
  for select using (public.is_admin());

create policy "task_templates write" on public.task_templates
  for all using (public.is_supervisor_or_higher())
  with check (public.is_supervisor_or_higher());

-- -------------------------------------------------------------
-- 2. task_template_items
-- -------------------------------------------------------------
create table if not exists public.task_template_items (
  id                bigserial primary key,
  template_id       bigint not null references public.task_templates(id) on delete cascade,
  ordinal           int    not null default 0,
  title             text   not null,
  description       text,
  default_priority  text   not null default 'medium'
                     check (default_priority in ('low','medium','high','urgent')),
  days_offset       int,
  default_assignee  uuid references auth.users(id) on delete set null
);

create index if not exists task_template_items_template_idx
  on public.task_template_items (template_id, ordinal);

drop trigger if exists tg_audit_task_template_items on public.task_template_items;
create trigger tg_audit_task_template_items
  after insert or update or delete on public.task_template_items
  for each row execute function public.tg_audit();

alter table public.task_template_items enable row level security;

drop policy if exists "task_template_items read"  on public.task_template_items;
drop policy if exists "task_template_items write" on public.task_template_items;

create policy "task_template_items read" on public.task_template_items
  for select using (public.is_admin());

create policy "task_template_items write" on public.task_template_items
  for all using (public.is_supervisor_or_higher())
  with check (public.is_supervisor_or_higher());

-- -------------------------------------------------------------
-- 3. apply_task_template — bulk-spawn staff_tasks from a template
-- -------------------------------------------------------------
create or replace function public.apply_task_template(
  p_template_id        bigint,
  p_client_id          bigint default null,
  p_apply_date         date default current_date,
  p_assignee_override  uuid default null
) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
  v_actor uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'staff role required';
  end if;
  if v_actor is null then
    raise exception 'not signed in';
  end if;

  insert into public.staff_tasks (
    title, description, client_id, assigned_to, created_by,
    due_date, priority, status
  )
  select
    i.title,
    i.description,
    p_client_id,
    coalesce(p_assignee_override, i.default_assignee),
    v_actor,
    case when i.days_offset is not null then p_apply_date + i.days_offset else null end,
    i.default_priority,
    'open'
  from public.task_template_items i
  where i.template_id = p_template_id
  order by i.ordinal, i.id;

  get diagnostics v_count = row_count;

  -- Best-effort audit entry. Individual staff_tasks inserts also fire
  -- the tg_audit trigger; this gives us a single high-level event too.
  begin
    insert into public.audit_log (actor_id, actor_email, action, target_type, target_id, summary)
    select
      v_actor,
      (select email from auth.users where id = v_actor),
      'task_template.apply',
      'task_templates',
      p_template_id::text,
      jsonb_build_object(
        'client_id',     p_client_id,
        'apply_date',    p_apply_date,
        'tasks_created', v_count
      );
  exception when others then
    raise warning 'audit_log insert failed: %', sqlerrm;
  end;

  return v_count;
end $$;
revoke execute on function public.apply_task_template(bigint, bigint, date, uuid) from public, anon;
grant   execute on function public.apply_task_template(bigint, bigint, date, uuid) to authenticated;

commit;
-- =============================================================
-- End of migration 018.
-- =============================================================
