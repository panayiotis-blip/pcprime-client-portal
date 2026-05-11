-- 024_data_retention.sql
-- GDPR data minimisation: the raw OCR text we keep on invoices is intermediate
-- processing output, not a business record. Once the invoice has been reviewed
-- and the structured fields filled in, the raw text isn't needed. We purge it
-- after 90 days so it doesn't sit around indefinitely.
--
-- The invoice itself (file, vendor, amount, etc.) is kept the full 6 years
-- required by Cyprus tax law — only the OCR scratch text is wiped.

create extension if not exists pg_cron with schema extensions;

-- The actual cleanup, wrapped in a SECURITY DEFINER function so we can
-- (a) call it ad-hoc to verify, and (b) keep the cron schedule one-liner clean.
create or replace function public.purge_old_ocr_text()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  rows_affected int;
begin
  update public.invoices
  set raw_ocr_text = ''
  where raw_ocr_text <> ''
    and created_at < (now() - interval '90 days');
  get diagnostics rows_affected = row_count;
  return rows_affected;
end;
$$;

revoke all on function public.purge_old_ocr_text() from public;
grant execute on function public.purge_old_ocr_text() to service_role;

-- Re-schedule cleanly (idempotent: drops any prior version of the same job first).
do $$
declare
  jid bigint;
begin
  for jid in select jobid from cron.job where jobname = 'purge-old-ocr-text' loop
    perform cron.unschedule(jid);
  end loop;
end$$;

select cron.schedule(
  'purge-old-ocr-text',
  '0 3 * * *',  -- daily at 03:00 UTC (= 05:00/06:00 Cyprus time depending on DST)
  $cron$ select public.purge_old_ocr_text(); $cron$
);

comment on function public.purge_old_ocr_text() is
  'GDPR data minimisation: blanks the raw_ocr_text column on invoices older than 90 days. Runs daily via pg_cron job "purge-old-ocr-text". Safe to call manually for ad-hoc cleanup.';
