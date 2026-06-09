-- Migration 104: Engagement letters
-- ===================================
-- Versioned engagement-letter records per client. A draft is editable
-- until it's sent; once sent, the row is locked and any annual update
-- creates a new version (v2, v3, …) leaving the prior version intact
-- for the audit trail.

create table if not exists public.engagement_letters (
  id bigserial primary key,
  client_id bigint not null references public.clients(id) on delete cascade,
  version int not null default 1,

  status text not null default 'draft'
    check (status in ('draft', 'sent', 'accepted', 'expired', 'superseded')),

  -- Coverage window — annual by default; effective_to can be left null
  -- for open-ended engagements.
  effective_from date,
  effective_to   date,

  -- Selected services as a JSON array. Each item is:
  --   { service_id, service_key, service_label, annual_fee, scope_notes }
  -- Stored as a snapshot so the letter doesn't drift if a service's label
  -- is renamed after issue.
  services jsonb not null default '[]'::jsonb,
  -- Convenience aggregate so list views don't have to sum across services
  total_annual_fee numeric not null default 0,
  currency text not null default 'EUR',

  -- Letter body. intro_text + a per-service block (auto-built from
  -- services jsonb) + terms_text — all editable while draft.
  intro_text text,
  terms_text text,
  -- Internal notes (NOT on the letter the client sees).
  notes text,

  -- Send + accept tracking
  sent_at timestamptz,
  sent_to_email text,
  sent_by uuid references auth.users(id) on delete set null,

  accepted_at timestamptz,
  accepted_method text check (accepted_method is null or accepted_method in ('email_reply','portal_click')),
  accepted_signature text,  -- typed name (portal flow) or noted by staff
  accepted_ip text,
  accepted_notes text,

  expired_at timestamptz,
  superseded_by bigint references public.engagement_letters(id) on delete set null,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),

  unique (client_id, version)
);

create index if not exists engagement_letters_client_idx
  on public.engagement_letters (client_id, version desc);

create index if not exists engagement_letters_status_idx
  on public.engagement_letters (status) where status in ('draft', 'sent');

-- updated_at trigger
drop trigger if exists engagement_letters_updated_at on public.engagement_letters;
create trigger engagement_letters_updated_at before update on public.engagement_letters
  for each row execute function public.tg_set_updated_at();

-- Audit trigger (same pattern as the other audited tables)
drop trigger if exists tg_audit_engagement_letters on public.engagement_letters;
create trigger tg_audit_engagement_letters
  after insert or update or delete on public.engagement_letters
  for each row execute function public.tg_audit();

alter table public.engagement_letters enable row level security;

-- READ: any internal staff, OR the client themselves (for in-portal viewing
-- and click-to-accept later).
drop policy if exists "engagement_letters read" on public.engagement_letters;
create policy "engagement_letters read" on public.engagement_letters
  for select using (
    public.is_admin()
    or public.user_can_access_client(client_id)
  );

-- WRITE: staff only.
drop policy if exists "engagement_letters write" on public.engagement_letters;
create policy "engagement_letters write" on public.engagement_letters
  for all using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------
-- Helper: next version number for a client (so the UI doesn't have
-- to compute it client-side — race-safe).
-- ---------------------------------------------------------------
create or replace function public.next_engagement_letter_version(p_client_id bigint)
returns int language sql stable security definer set search_path = public
as $$
  select coalesce(max(version), 0) + 1
  from public.engagement_letters
  where client_id = p_client_id;
$$;

grant execute on function public.next_engagement_letter_version(bigint) to authenticated;

-- ---------------------------------------------------------------
-- Helper: mark the prior accepted/sent letter as superseded when a
-- new one is sent. Idempotent.
-- ---------------------------------------------------------------
create or replace function public.supersede_prior_engagement_letters(
  p_client_id bigint, p_new_id bigint
) returns int language plpgsql security definer set search_path = public
as $$
declare
  v_count int := 0;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  update public.engagement_letters
     set status = 'superseded', superseded_by = p_new_id
   where client_id = p_client_id
     and id <> p_new_id
     and status in ('sent', 'accepted');

  get diagnostics v_count = row_count;
  return v_count;
end$$;

grant execute on function public.supersede_prior_engagement_letters(bigint, bigint) to authenticated;
