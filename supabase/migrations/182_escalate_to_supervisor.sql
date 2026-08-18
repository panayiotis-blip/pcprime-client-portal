-- =============================================================
-- Migration 182: escalate to the client's supervisor
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Migration 153 flags an overdue task and stops there: escalated_at is set,
-- and every supervisor sees the same undifferentiated red banner counting all
-- of them. With two people that reads as "we are behind". With six it reads as
-- somebody else's problem, which is how an escalation quietly becomes
-- wallpaper.
--
-- Migration 180 gave each client a supervisor. This points the escalation at
-- them:
--
--   staff_tasks.escalated_to — who this escalation belongs to, copied from
--                              the client's supervisor when it fires.
--
-- Recorded on the task rather than looked up live, deliberately. The question
-- "who was told about this" is about the moment it escalated; reassigning a
-- client six months later must not rewrite that history.
--
-- Null stays meaningful: the client has no supervisor, or the task has no
-- client at all (a hand-written to-do). Those keep showing in the firm-wide
-- overdue list, which is exactly where an unowned escalation belongs.
--
-- No auto-reassign and no priority bump, per the original decision — the
-- assignee still owns the work. This only decides whose banner it lands in.
-- =============================================================

begin;

alter table public.staff_tasks
  add column if not exists escalated_to uuid references auth.users(id) on delete set null;

comment on column public.staff_tasks.escalated_to is
  'Supervisor this overdue task was escalated to, from clients.supervisor_id at the time it fired. Null = no supervisor on the client, or no client.';

-- "What am I supervising that is late" should not scan the table.
create index if not exists staff_tasks_escalated_to_idx
  on public.staff_tasks (escalated_to, due_date)
  where escalated_to is not null and deleted_at is null;

-- -------------------------------------------------------------
-- Same job as migration 153, now naming a supervisor.
-- -------------------------------------------------------------
create or replace function public.escalate_overdue_tasks()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  update public.staff_tasks t
     set escalated_at = now(),
         escalated_to = c.supervisor_id
    from public.clients c
   where t.escalated_at is null
     and t.deleted_at is null
     and t.status in ('open', 'in_progress', 'blocked')
     and t.due_date is not null
     and t.due_date < current_date
     and c.id = t.client_id;
  get diagnostics n = row_count;

  -- Tasks with no client cannot have a supervisor, but must still escalate —
  -- the join above would silently skip them.
  update public.staff_tasks
     set escalated_at = now()
   where escalated_at is null
     and deleted_at is null
     and status in ('open', 'in_progress', 'blocked')
     and due_date is not null
     and due_date < current_date
     and client_id is null;

  return n;
end$$;

revoke all on function public.escalate_overdue_tasks() from public;
grant execute on function public.escalate_overdue_tasks() to authenticated, service_role;

-- -------------------------------------------------------------
-- Back-fill what has already escalated
-- -------------------------------------------------------------
-- Everything flagged before today has no supervisor recorded. Filling it from
-- the client's current supervisor is the best available answer and beats a
-- column that is null for every historic row.
update public.staff_tasks t
   set escalated_to = c.supervisor_id
  from public.clients c
 where t.escalated_to is null
   and t.escalated_at is not null
   and t.deleted_at is null
   and c.id = t.client_id
   and c.supervisor_id is not null;

notify pgrst, 'reload schema';

commit;

-- =============================================================
-- The cron job from 153 ('escalate-overdue-tasks', 05:00 daily) calls this
-- function by name and needs no change.
--
-- Verify:
--   select count(*) filter (where escalated_at is not null)  as escalated,
--          count(*) filter (where escalated_to is not null)  as with_supervisor
--     from public.staff_tasks where deleted_at is null;
--   -- and run it by hand:
--   select public.escalate_overdue_tasks();
-- =============================================================
