-- =============================================================
-- Migration 129: tighten user↔client linkage + client self-update
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Two hardening fixes from the security review:
--
-- H1 (HIGH): the "user_clients admin write" policy (001:144) gated writes on
--   is_admin() — true for the lowest 'staff' tier. Linking a user to a client
--   grants access to that client's data, so any staff could give any account
--   (incl. a client login they control) access to any client. Linking is an
--   access-granting action → restrict writes to supervisor/owner.
--   (Reads stay "self or admin" via the existing separate read policy.)
--   NOTE: this does NOT affect adding/editing clients — Admin (Staff) users
--   keep full client add/edit rights; only the login↔client LINKING is
--   restricted to supervisors, which already happens in supervisor-only UI.
--
-- F4 (integrity): the "clients linked user update" policy (001:134) lets a
--   client-role user UPDATE any column of their OWN client row (fees, status,
--   tax_number, client_code…). The app only ever sends contact fields
--   (selfUpdateClient whitelist), but a direct API call could tamper with
--   firm-managed fields. Guard it at the DB so client self-updates are limited
--   to contact details; staff/admin (is_admin) and service-role are unaffected.
-- =============================================================

begin;

-- ---- H1: user_clients writes → supervisor/owner only ----
drop policy if exists "user_clients admin write" on public.user_clients;
create policy "user_clients admin write" on public.user_clients
  for all
  using (public.is_supervisor_or_higher())
  with check (public.is_supervisor_or_higher());

-- ---- F4: clients self-update limited to contact fields ----
create or replace function public.guard_client_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Firm staff/admin may edit anything; service-role / SQL editor (null uid) too.
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  -- A linked client-role user may only change their own contact details. Strip
  -- the allowed fields from both rows and require the remainder to be identical.
  if (to_jsonb(new) - '{address,phone,email,mobile,contact_person,website,city,postal_code,country,updated_at}'::text[])
     is distinct from
     (to_jsonb(old) - '{address,phone,email,mobile,contact_person,website,city,postal_code,country,updated_at}'::text[]) then
    raise exception 'Clients may only update their own contact details.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists tg_guard_client_self_update on public.clients;
create trigger tg_guard_client_self_update
  before update on public.clients
  for each row execute function public.guard_client_self_update();

commit;

-- Verify:
--   • As a client-role user: updating your own phone/address succeeds;
--     updating monthly_fee / tax_number / client_code fails.
--   • As staff/admin: all client edits still work.
--   • Only supervisor/owner can insert into user_clients.
