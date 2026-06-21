-- Migration 121: log outbound firm email onto the client's record
-- =================================================================
-- When staff send client-facing mail (bulk email, tax-info request, tax notice
-- broadcast, etc.) we record an outbound row in client_emails so the client can
-- SEE, in their portal Inbox, what was sent on their behalf. They can't write or
-- reply there — it's a read-only record (the read RLS in migration 029 already
-- lets a client see their own client_emails).
--
-- client_emails is service-role-write only (029: insert WITH CHECK false), so we
-- expose a SECURITY DEFINER RPC that staff (is_admin) can call to insert one
-- outbound row.

create or replace function public.log_outbound_client_email(
  p_client_id  bigint,
  p_subject    text,
  p_html       text,
  p_plain      text,
  p_recipients text[] default '{}'::text[]
) returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_id   bigint;
  v_from text;
  v_name text;
begin
  if not public.is_admin() then
    raise exception 'Not authorised to log client email';
  end if;
  if p_client_id is null then
    raise exception 'client_id is required';
  end if;

  select email, coalesce(legal_name, name) into v_from, v_name
  from public.company_settings where id = 1;

  insert into public.client_emails (
    client_id, direction, sender_email, sender_name,
    recipient_emails, subject, body_html, body_plain, received_at
  ) values (
    p_client_id, 'outbound', v_from, coalesce(v_name, 'Our office'),
    coalesce(p_recipients, '{}'::text[]), p_subject, p_html, p_plain, now()
  )
  returning id into v_id;

  return v_id;
end$$;

grant execute on function public.log_outbound_client_email(bigint, text, text, text, text[]) to authenticated;
