-- =============================================================
-- Migration 080: Client self-signup applications (Item 12)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Prospective clients apply via a public form; the firm reviews and approves
-- before any portal account is created. Applications are inserted by the
-- submit-application edge function (service role) — the table is NOT publicly
-- readable. Staff read/update; on approval the firm creates the client +
-- sends the portal invite through the existing flow.
-- =============================================================

begin;

create table if not exists public.portal_applications (
  id                  bigserial primary key,
  business_name       text not null,
  business_type       text,
  contact_person      text,
  email               text not null,
  phone               text,
  vat_number          text,
  registration_number text,
  address             text,
  services_wanted     text,
  notes               text,
  terms_accepted      boolean not null default false,
  status              text not null default 'pending'
                        check (status in ('pending', 'approved', 'rejected')),
  review_notes        text,
  created_client_id   bigint references public.clients(id) on delete set null,
  reviewed_by         uuid references auth.users(id) on delete set null,
  reviewed_at         timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists portal_applications_status_idx on public.portal_applications (status, created_at desc);

drop trigger if exists tg_audit_portal_applications on public.portal_applications;
create trigger tg_audit_portal_applications
  after insert or update or delete on public.portal_applications
  for each row execute function public.tg_audit();

alter table public.portal_applications enable row level security;
drop policy if exists "portal_applications staff read"   on public.portal_applications;
drop policy if exists "portal_applications staff update" on public.portal_applications;
create policy "portal_applications staff read" on public.portal_applications
  for select using (public.is_admin());
create policy "portal_applications staff update" on public.portal_applications
  for update using (public.is_admin()) with check (public.is_admin());
-- No INSERT / anon policy: applications are inserted by the submit-application
-- edge function via the service role (so the public never touches the table).

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 080.
-- =============================================================
