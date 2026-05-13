-- 041_email_text_array_fix.sql
-- Migration 035 used a SELECT subquery inside the ALTER COLUMN ... USING
-- clause. Postgres doesn't allow that ("cannot use subquery in transform
-- expression"). Wrapping the split logic in a regular function fixes it.

begin;

-- Helper: split an email cell on ';' or ',', trim each, drop empties.
-- Returns null when nothing useful remains.
create or replace function public._split_emails(p_text text)
returns text[]
language plpgsql
immutable
as $$
declare
  v_result text[];
begin
  if nullif(trim(coalesce(p_text, '')), '') is null then
    return null;
  end if;
  select array_agg(trim(p))
    into v_result
  from unnest(regexp_split_to_array(trim(p_text), '[,;]+')) p
  where trim(p) <> '';
  if array_length(v_result, 1) is null then return null; end if;
  return v_result;
end;
$$;

-- Convert the email column from text to text[]. Skip if already text[]
-- (so this migration is idempotent if someone re-runs it).
do $$
declare
  v_type text;
begin
  select data_type into v_type
  from information_schema.columns
  where table_name = 'clients' and column_name = 'email'
    and table_schema = 'public';

  if v_type = 'text' then
    execute 'alter table public.clients
              alter column email type text[]
              using public._split_emails(email)';
  elsif v_type = 'ARRAY' then
    -- Already converted — nothing to do.
    null;
  end if;
end $$;

commit;
-- =============================================================
-- Verify:
--   select data_type, udt_name from information_schema.columns
--    where table_name='clients' and column_name='email';
--   -- expect: ARRAY / _text
--
--   select public._split_emails('a@x.com; b@y.com, c@z.com');
--   -- expect: {a@x.com,b@y.com,c@z.com}
-- =============================================================
