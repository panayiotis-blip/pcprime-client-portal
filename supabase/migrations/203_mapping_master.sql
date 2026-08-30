-- =====================================================================
-- Migration 203: one master mapping, so a new client is not 204 decisions
--
-- mapping_defaults is per client, and only A&F had any. A second client
-- would arrive with two hundred accounts mapped to nothing, no profit and
-- loss, and an afternoon of clicking before anybody could look at a
-- figure. That is the thing standing between one client and all of them.
--
-- BTMS clients share a chart. Not always the whole of it, but the
-- nominal accounts -- sales, purchases, wages, the bank -- are the same
-- numbers from the same install, which is the same fact that makes
-- account-code fingerprinting work at all and the same one that makes it
-- unable to tell two clients apart.
--
-- So the master here is a code -> line list, seeded from A&F's mapping
-- because that is the one a person has been through. Seeding a client
-- copies across every code it recognises and leaves the rest alone --
-- unmapped, visible on the mapping screen, and raised by review check 7
-- as "posted to but maps to no report line". Silence would be worse: an
-- account guessed onto a plausible line is a wrong number that looks
-- right.
--
-- WHY CATEGORY IS NOT USED. BTMS's own Report Category looks like the
-- obvious key and is far too coarse: A&F's 75 "Expenses" accounts spread
-- across 24 report lines, the commonest taking 13% of them. Seeding on
-- category would map three quarters of a client's overheads to the wrong
-- line and look confident doing it.
-- =====================================================================

set search_path to reporting, public;

create table if not exists mapping_master (
  account_code text primary key,
  line_id      text not null,
  source       text not null,
  created_at   timestamptz not null default now()
);

comment on table mapping_master is
  'The practice-wide default mapping: account code to report line, for seeding a client that has no mapping of its own. Nominal accounts only -- debtors and creditors are per client and roll up to their control.';

alter table mapping_master enable row level security;

-- Practice-wide, not client-scoped, so it is readable by any member of
-- staff and writable by none of them from the application.
drop policy if exists mapping_master_read on mapping_master;
create policy mapping_master_read on mapping_master
  for select using (public.is_admin());

grant select on mapping_master to authenticated;

-- ---------------------------------------------------------------------
-- Seeded from the mapping that has actually been through a person: A&F's.
-- Debtor and creditor sub-accounts are excluded -- they are one client's
-- customers, not a chart -- but their CONTROLS are kept, because 221 and
-- 311 mean the same thing in every BTMS company.
-- ---------------------------------------------------------------------
insert into mapping_master (account_code, line_id, source)
select d.account_code, d.line_id, 'A&F mapping, draft v2'
  from mapping_defaults d
  left join coa_accounts a
    on a.client_id = d.client_id and a.code = d.account_code
 where d.client_id = (select min(c.id) from public.clients c
                       join client_settings s on s.client_id = c.id
                      where c.name ilike '%ΗΛΕΚΤΡΑΓΟΡΑ%')
   and d.line_id is not null
   and coalesce(a.account_type, '') not in ('Debtor', 'Creditor')
on conflict (account_code) do update set line_id = excluded.line_id;

-- ---------------------------------------------------------------------
-- Give a client the defaults it does not have. Never overwrites: a
-- mapping already decided for this client, whether drafted or chosen by
-- a person, is left exactly as it is.
-- ---------------------------------------------------------------------
create or replace function seed_mapping_defaults(p_client bigint)
returns table (seeded integer, already_had integer, unmapped integer)
language plpgsql security definer set search_path = reporting, public as $$
begin
  if not staff_can_access(p_client) then
    raise exception 'no access to client %', p_client;
  end if;

  with candidate as (
    -- What this client actually needs a line for: its nominal accounts,
    -- plus the controls its sub-ledger rolls up to.
    select distinct coalesce(nullif(a.control_code, ''), a.code) as code
      from coa_accounts a
     where a.client_id = p_client
       and not a.is_header
  ),
  inserted as (
    insert into mapping_defaults (client_id, account_code, line_id, source)
    select p_client, c.code, m.line_id, 'practice master'
      from candidate c
      join mapping_master m on m.account_code = c.code
     where not exists (select 1 from mapping_defaults d
                        where d.client_id = p_client and d.account_code = c.code)
    returning 1
  )
  select (select count(*) from inserted),
         (select count(*) from candidate c
           where exists (select 1 from mapping_defaults d
                          where d.client_id = p_client and d.account_code = c.code)),
         (select count(*) from candidate c
           where not exists (select 1 from mapping_master m where m.account_code = c.code)
             and not exists (select 1 from mapping_defaults d
                              where d.client_id = p_client and d.account_code = c.code))
    into seeded, already_had, unmapped;

  return next;
end $$;

comment on function seed_mapping_defaults(bigint) is
  'Copies the practice master mapping onto a client for every account code it recognises. Never overwrites an existing default. Returns what it seeded, what was already decided, and what is left for a person.';

revoke all on function seed_mapping_defaults(bigint) from public;
grant execute on function seed_mapping_defaults(bigint) to authenticated;
