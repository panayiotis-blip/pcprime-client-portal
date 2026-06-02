-- =============================================================
-- Migration 093: Split clients into individual vs company with separate
-- name fields. Existing `name` column is auto-kept in sync by a trigger so
-- nothing else in the codebase needs to change.
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================

begin;

-- ---------- Columns ----------
alter table public.clients
  add column if not exists client_type text not null default 'company'
    check (client_type in ('individual', 'company')),
  add column if not exists first_name  text,
  add column if not exists surname     text,
  add column if not exists legal_name  text;

-- ---------- Backfill from current `name` ----------
-- Companies are detected by common suffixes (Latin + Greek). Everything
-- else is treated as an individual; surname = last word, first_name = rest.
update public.clients
   set client_type = case
       when name ~  '\m(Ltd|Limited|LLC|LLP|Inc|Corp|Corporation|PLC|BV|SA|AE|Co|AEVE|EPE|OE|EE|IKE)\M' then 'company'
       when name ~  '(ΑΕ|ΕΠΕ|ΟΕ|ΕΕ|ΙΚΕ|ΑΕΒΕ)\M'                                                          then 'company'
       else 'individual'
       end
 where deleted_at is null
   and (first_name is null and surname is null and legal_name is null);

update public.clients
   set legal_name = name
 where deleted_at is null
   and client_type = 'company'
   and (legal_name is null or legal_name = '');

update public.clients
   set surname    = btrim(substring(name from '\S+$')),
       first_name = btrim(regexp_replace(name, '\s*\S+$', ''))
 where deleted_at is null
   and client_type = 'individual'
   and (surname is null or surname = '');

-- ---------- Trigger: keep `name` in sync with the structured fields ----------
create or replace function public.clients_sync_display_name()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.client_type = 'individual'
       and (coalesce(new.first_name, '') <> '' or coalesce(new.surname, '') <> '') then
      new.name := btrim(coalesce(new.first_name, '') || ' ' || coalesce(new.surname, ''));
    elsif new.client_type = 'company' and coalesce(new.legal_name, '') <> '' then
      new.name := new.legal_name;
    end if;
    return new;
  end if;

  -- UPDATE: only recompute when the structured fields (or the type) changed.
  if new.client_type is distinct from old.client_type
     or new.first_name is distinct from old.first_name
     or new.surname    is distinct from old.surname
     or new.legal_name is distinct from old.legal_name
  then
    if new.client_type = 'individual' then
      declare v_name text := btrim(coalesce(new.first_name, '') || ' ' || coalesce(new.surname, ''));
      begin
        if v_name <> '' then new.name := v_name; end if;
      end;
    else
      if coalesce(new.legal_name, '') <> '' then new.name := new.legal_name; end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists clients_sync_display_name_trg on public.clients;
create trigger clients_sync_display_name_trg
  before insert or update on public.clients
  for each row execute function public.clients_sync_display_name();

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 093.
-- =============================================================
