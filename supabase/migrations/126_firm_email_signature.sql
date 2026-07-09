-- =============================================================
-- Migration 126: staff-readable firm email signature
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- firm_email_settings is admin-only (the admin_* RPCs gate on ownership), but
-- ANY staff member composing from the shared Inbox needs to load the firm
-- signature so it can be inserted into the message (like Outlook auto-inserts
-- your signature). This SECURITY DEFINER function exposes ONLY the two
-- signature fields (never SMTP host/user/password) to internal staff.
-- =============================================================

begin;

create or replace function public.get_firm_email_signature()
returns table (signature_html text, signature_text text)
language sql
security definer
set search_path = public
as $$
  select s.signature_html, s.signature_text
  from public.firm_email_settings s
  where public.is_admin()
  order by s.updated_at desc nulls last
  limit 1;
$$;

revoke all on function public.get_firm_email_signature() from public, anon;
grant   execute on function public.get_firm_email_signature() to authenticated;

notify pgrst, 'reload schema';

commit;

-- Verify (as a staff user, or via the dashboard as service role):
--   select * from public.get_firm_email_signature();
