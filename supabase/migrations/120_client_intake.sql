-- Migration 120: Client onboarding / annual-refresh questionnaire
-- =================================================================
-- A firm-initiated, tokenised public form. Staff create an intake row
-- (which mints an unguessable token) and email the link. The client
-- opens it, reviews/updates their details, and submits. The submission
-- lands in a review queue — staff approve before any live client record
-- changes (clients never silently overwrite firm data).
--
-- The table is never exposed to anon directly; an anonymous browser
-- only touches it through the two SECURITY DEFINER RPCs below, keyed by
-- the token (same trust model as the engagement-letter accept link,
-- migration 112).

create table if not exists public.client_intake_submissions (
  id           bigserial primary key,
  token        text unique not null,
  client_id    bigint references public.clients(id) on delete set null, -- null = brand-new client intake
  mode         text not null default 'refresh',   -- 'new' | 'refresh'
  status       text not null default 'pending',    -- pending | submitted | approved | rejected
  payload      jsonb,                              -- the data the client submitted
  prefill      jsonb,                              -- snapshot shown to the client (for diffing on review)
  notes        text,
  created_by   uuid,
  reviewed_by  uuid,
  expires_at   timestamptz,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  submitted_at timestamptz,
  reviewed_at  timestamptz
);

create index if not exists client_intake_token_idx  on public.client_intake_submissions (token);
create index if not exists client_intake_status_idx on public.client_intake_submissions (status);
create index if not exists client_intake_client_idx on public.client_intake_submissions (client_id);

alter table public.client_intake_submissions enable row level security;

-- Staff (any internal role) manage intake rows; clients never see the table.
drop policy if exists client_intake_staff_all on public.client_intake_submissions;
create policy client_intake_staff_all on public.client_intake_submissions
  for all using (public.is_admin()) with check (public.is_admin());

-- audit trigger (consistent with other tables, migration 007)
drop trigger if exists tg_audit_client_intake on public.client_intake_submissions;
create trigger tg_audit_client_intake
  after insert or update or delete on public.client_intake_submissions
  for each row execute function public.tg_audit();

-- -----------------------------------------------------------------
-- Public RPC: load an intake by token. Returns the form mode/status
-- plus a prefill snapshot so the client sees their current details.
-- -----------------------------------------------------------------
create or replace function public.get_client_intake_by_token(p_token text)
returns table (
  mode text,
  status text,
  expires_at timestamptz,
  prefill jsonb,
  firm_name text
)
language plpgsql security definer set search_path = public stable
as $$
begin
  if p_token is null or p_token = '' then return; end if;
  return query
    select s.mode, s.status, s.expires_at,
           coalesce(
             s.prefill,
             case when c.id is not null then jsonb_build_object(
               'name', c.name,
               'name_tax_office', c.name_tax_office,
               'tax_number', c.tax_number,
               'vat_number', c.vat_number,
               'id_number', c.id_number,
               'date_of_birth', c.date_of_birth,
               'address', c.address,
               'phone', c.phone,
               'email', c.email,
               'client_category', c.client_category
             ) else '{}'::jsonb end
           ) as prefill,
           cs.name as firm_name
    from public.client_intake_submissions s
    left join public.clients c on c.id = s.client_id
    left join public.company_settings cs on cs.id = 1
    where s.token = p_token
      and s.status in ('pending', 'submitted')
      and (s.expires_at is null or s.expires_at > now());
end$$;

grant execute on function public.get_client_intake_by_token(text) to anon, authenticated;

-- -----------------------------------------------------------------
-- Public RPC: submit an intake by token. Stores the payload and flips
-- the row to 'submitted'. Idempotent-ish: a second submit overwrites
-- the payload while still pending/submitted. Approval is staff-side.
-- -----------------------------------------------------------------
create or replace function public.submit_client_intake_by_token(
  p_token text, p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_id bigint; v_status text; v_exp timestamptz;
begin
  if p_token is null or p_token = '' then
    return jsonb_build_object('ok', false, 'error', 'missing token');
  end if;

  select id, status, expires_at into v_id, v_status, v_exp
  from public.client_intake_submissions
  where token = p_token;

  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'link not found');
  end if;
  if v_exp is not null and v_exp <= now() then
    return jsonb_build_object('ok', false, 'error', 'this link has expired');
  end if;
  if v_status not in ('pending', 'submitted') then
    return jsonb_build_object('ok', false, 'error', 'this form is no longer open');
  end if;

  update public.client_intake_submissions set
    payload = p_payload,
    status = 'submitted',
    submitted_at = now()
  where id = v_id;

  return jsonb_build_object('ok', true);
end$$;

grant execute on function public.submit_client_intake_by_token(text, jsonb) to anon, authenticated;
