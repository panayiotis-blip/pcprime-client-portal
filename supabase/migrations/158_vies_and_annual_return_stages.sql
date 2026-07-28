-- =============================================================
-- Migration 158: VIES service + Company Secretarial annual-return stages
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Fills two real gaps in the scheduled-task catalogue:
--
--   * VIES Return (new service) — monthly recapitulative statement for
--     intra-EU B2B supplies, due the 15th of the following month.
--   * Company Secretarial (existing service, migration 134, had no
--     stages) — Annual Return (HE32) prepare + file stages.
--
-- Both are seeded TASK-ONLY (sends_email = false), matching the firm's
-- policy from migration 134: no stage emails clients on a guessed
-- schedule. Turn email on (and add a template) per stage in
-- Settings → Services if wanted.
--
-- The Annual Return stages default to firing in December; each company's
-- return date differs, so set the month per client on the client's
-- Services tab (or the stage schedule in Settings) as needed.
-- =============================================================

begin;

-- -----------------------------------------------------------------
-- 1. VIES Return service
-- -----------------------------------------------------------------
insert into public.service_definitions (key, label, description, ordinal) values
  ('vies', 'VIES Return',
   'Monthly recapitulative statement (VIES) for intra-EU B2B supplies — prepared from the client''s intra-EU sales and submitted by the 15th of the following month.',
   110)
on conflict (key) do nothing;

insert into public.service_stages (
  service_id, ordinal, key, label, cadence,
  default_day_of_month, default_use_last_day,
  active_months, sends_email, creates_task, task_priority
)
select s.id, v.ordinal::int, v.key::text, v.label::text, 'monthly'::text,
       v.day::int, false,
       v.months::int[], false, true, v.priority::text
from public.service_definitions s
cross join (values
  (1, 'prep',       'VIES: prepare recapitulative statement', 10, null::int[], 'medium'),
  (2, 'submission', 'VIES: submission (by 15th)',             15, null::int[], 'high')
) as v(ordinal, key, label, day, months, priority)
where s.key = 'vies'
  and not exists (
    select 1 from public.service_stages st where st.service_id = s.id and st.key = v.key
  );

-- -----------------------------------------------------------------
-- 2. Company Secretarial — Annual Return (HE32) stages
-- -----------------------------------------------------------------
insert into public.service_stages (
  service_id, ordinal, key, label, cadence,
  default_day_of_month, default_use_last_day,
  active_months, sends_email, creates_task, task_priority
)
select s.id, v.ordinal::int, v.key::text, v.label::text, 'annual'::text,
       v.day::int, false,
       v.months::int[], false, true, v.priority::text
from public.service_definitions s
cross join (values
  (1, 'annual_return_prep',   'Annual Return (HE32): prepare',             1,  '{12}'::int[], 'medium'),
  (2, 'annual_return_filing', 'Annual Return (HE32): file with Registrar', 28, '{12}'::int[], 'high')
) as v(ordinal, key, label, day, months, priority)
where s.key = 'company_secretarial'
  and not exists (
    select 1 from public.service_stages st where st.service_id = s.id and st.key = v.key
  );

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- Verify:
--   select d.key as service, s.key as stage, s.cadence, s.active_months,
--          s.creates_task, s.sends_email
--   from public.service_definitions d
--   join public.service_stages s on s.service_id = d.id
--   where d.key in ('vies','company_secretarial')
--   order by d.key, s.ordinal;
-- =============================================================
-- End of migration 158.
-- =============================================================
