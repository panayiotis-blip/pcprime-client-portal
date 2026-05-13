-- 039_bulk_import_prep.sql
-- Preparation for Part D bulk import:
--   1. Add platform_credentials.sub_type column (used to distinguish
--      multiple Taxisnet entries per client — Tax / VAT / VAT-Old / etc.).
--   2. Extend tg_audit() to honour a session-scoped flag 'app.bulk_audit_off',
--      so the bulk-import RPC can suppress per-row audit entries and write
--      a single summary instead. Per user direction in v3 spec.

begin;

-- ---- 1. platform_credentials.sub_type ----
alter table public.platform_credentials
  add column if not exists sub_type text;

comment on column public.platform_credentials.sub_type is
  'Optional sub-classification — e.g. Taxisnet has Tax / VAT / VAT-Old / Cleaning. Free text; populated by bulk import and by future credential form additions.';

-- ---- 2. Update tg_audit to skip when app.bulk_audit_off = 'on' ----
-- Body otherwise unchanged from migration 007.
create or replace function public.tg_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_action     text;
  v_target_id  text;
  v_summary    jsonb;
  v_email      text;
  v_old_jsonb  jsonb;
  v_new_jsonb  jsonb;
  v_off        text;
begin
  -- Bypass per-row auditing if the current transaction has the flag set.
  -- The bulk-import RPC sets this for its duration and writes one summary
  -- audit row at the end.
  begin
    v_off := current_setting('app.bulk_audit_off', true);
    if v_off = 'on' then
      if TG_OP = 'DELETE' then return old; else return new; end if;
    end if;
  exception when others then
    -- current_setting fails harmlessly if the GUC wasn't set; continue auditing.
    null;
  end;

  if TG_OP = 'INSERT' then
    v_new_jsonb := to_jsonb(new);
    v_action := TG_TABLE_NAME || '.create';
    v_target_id := v_new_jsonb ->> 'id';
    v_summary := jsonb_build_object('new', v_new_jsonb);
  elsif TG_OP = 'UPDATE' then
    v_old_jsonb := to_jsonb(old);
    v_new_jsonb := to_jsonb(new);
    v_action := TG_TABLE_NAME || '.update';
    v_target_id := v_new_jsonb ->> 'id';
    if (v_old_jsonb ? 'deleted_at') and (v_new_jsonb ? 'deleted_at') then
      if (v_old_jsonb ->> 'deleted_at') is null and (v_new_jsonb ->> 'deleted_at') is not null then
        v_action := TG_TABLE_NAME || '.delete';
      elsif (v_old_jsonb ->> 'deleted_at') is not null and (v_new_jsonb ->> 'deleted_at') is null then
        v_action := TG_TABLE_NAME || '.restore';
      end if;
    end if;
    v_summary := jsonb_build_object('old', v_old_jsonb, 'new', v_new_jsonb);
  elsif TG_OP = 'DELETE' then
    v_old_jsonb := to_jsonb(old);
    v_action := TG_TABLE_NAME || '.hard_delete';
    v_target_id := v_old_jsonb ->> 'id';
    v_summary := jsonb_build_object('old', v_old_jsonb);
  end if;

  select email into v_email from auth.users where id = auth.uid();

  begin
    insert into public.audit_log (actor_id, actor_email, action, target_type, target_id, summary)
    values (auth.uid(), v_email, v_action, TG_TABLE_NAME, v_target_id, v_summary);
  exception when others then
    raise warning 'audit_log insert failed for % on %: %', TG_OP, TG_TABLE_NAME, sqlerrm;
  end;

  if TG_OP = 'DELETE' then return old; else return new; end if;
end;
$$;

commit;
