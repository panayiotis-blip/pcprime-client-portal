-- =============================================================
-- Verify whether migration 049 (UI Polish) has been applied.
-- READ-ONLY. Changes nothing. Safe to run any time.
-- Run in: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- =============================================================
-- Expect 6 rows. If every "present" value is TRUE, migration 049
-- is applied. If any are FALSE, it has not been (fully) applied.

select '1. sidebar_state column'      as item,
       exists(select 1 from information_schema.columns
              where table_schema='public'
                and table_name='user_dashboard_preferences'
                and column_name='sidebar_state') as present
union all
select '2. user_favourites table',
       exists(select 1 from information_schema.tables
              where table_schema='public' and table_name='user_favourites')
union all
select '3. pin_favourite() function',
       exists(select 1 from pg_proc where proname='pin_favourite')
union all
select '4. client_addresses table',
       exists(select 1 from information_schema.tables
              where table_schema='public' and table_name='client_addresses')
union all
select '5. clients.vat_status column',
       exists(select 1 from information_schema.columns
              where table_schema='public'
                and table_name='clients' and column_name='vat_status')
union all
select '6. clients.si_registration_date column',
       exists(select 1 from information_schema.columns
              where table_schema='public'
                and table_name='clients' and column_name='si_registration_date')
order by item;
