-- =============================================================
-- Migration 072: Invoice extras
--   1. Allow 'remarks' as a line_type on client_invoice_lines
--   2. Seed suggested service-line presets (idempotent)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================

begin;

-- ---------- 1. Allow 'remarks' as a line_type ----------
-- The CHECK constraint on client_invoice_lines.line_type was auto-named
-- when the table was created; we look it up by introspection, drop it,
-- and replace it with a relaxed version that includes 'remarks'.
do $$
declare
  c text;
begin
  select conname into c
    from pg_constraint
   where conrelid = 'public.client_invoice_lines'::regclass
     and contype  = 'c'
     and pg_get_constraintdef(oid) ilike '%line_type%';
  if c is not null then
    execute format('alter table public.client_invoice_lines drop constraint %I', c);
  end if;
end $$;

alter table public.client_invoice_lines
  add constraint client_invoice_lines_line_type_check
  check (line_type in ('time','fixed','expense','remarks'));

-- ---------- 2. Suggested service presets ----------
-- Idempotent: only inserts a row if no preset with the same description
-- already exists, so re-running this migration is safe.
insert into public.service_presets (description, default_price, vatable, sort_order, active)
select v.description, v.default_price, v.vatable, v.sort_order, true
  from (values
    ('Annual accounts preparation',                  null::numeric, true,  10),
    ('Annual return (HE32) filing',                  null::numeric, true,  20),
    ('Bookkeeping — monthly',                        null::numeric, true,  30),
    ('VAT return preparation (quarterly)',           null::numeric, true,  40),
    ('Income tax return — company (TD4)',            null::numeric, true,  50),
    ('Income tax return — individual (TD1)',         null::numeric, true,  60),
    ('Payroll services — monthly',                   null::numeric, true,  70),
    ('Social insurance return',                      null::numeric, true,  80),
    ('Company incorporation',                        null::numeric, true,  90),
    ('Tax advisory & consultancy',                   null::numeric, true, 100),
    ('Provisional tax submission',                   null::numeric, true, 110),
    ('Annual company levy filing',                   null::numeric, true, 120),
    ('Registered office services — annual',          null::numeric, true, 130),
    ('Director services — annual',                   null::numeric, true, 140),
    ('Statutory audit support',                      null::numeric, true, 150)
  ) as v(description, default_price, vatable, sort_order)
 where not exists (
   select 1 from public.service_presets sp
    where sp.description = v.description
 );

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 072.
-- =============================================================
