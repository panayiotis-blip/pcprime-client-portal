-- Migration 110: Platform sites catalogue
-- =========================================
-- Firm-level list of platforms (TFA, Ergani, JCC, GESY, banks, etc.)
-- with their login URLs. Per-client credentials now reference one of
-- these, so the URL is stored once and the client record only adds
-- username + password + notes.
--
-- Existing free-text 'platform' column is kept for backwards compat and
-- as a label fallback when no site is linked (legacy rows).

-- ---------- 1. platform_sites ----------
create table if not exists public.platform_sites (
  id bigserial primary key,
  name text not null unique,
  url text,
  notes text,
  ordinal int not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.platform_sites enable row level security;

drop policy if exists "platform_sites read" on public.platform_sites;
create policy "platform_sites read" on public.platform_sites
  for select using (public.is_admin());

drop policy if exists "platform_sites write" on public.platform_sites;
create policy "platform_sites write" on public.platform_sites
  for all using (public.is_supervisor_or_higher())
  with check (public.is_supervisor_or_higher());

-- updated_at trigger
drop trigger if exists platform_sites_updated_at on public.platform_sites;
create trigger platform_sites_updated_at before update on public.platform_sites
  for each row execute function public.tg_set_updated_at();

-- ---------- 2. Seed common Cyprus platforms (idempotent) ----------
insert into public.platform_sites (name, url, notes, ordinal) values
  ('TFA (Tax For All)',              'https://taxforall.mof.gov.cy/',                      'TaxisNet replacement portal', 10),
  ('Social Insurance',               'https://www.sid.mlsi.gov.cy/',                       null, 20),
  ('Ergani',                         'https://www.ergani.gov.cy/',                         null, 30),
  ('CY Login',                       'https://cyloginportal.gov.cy/',                      null, 40),
  ('JCC',                            'https://www.jccsmart.com/',                          null, 50),
  ('VAT (VIES)',                     'https://ec.europa.eu/taxation_customs/vies/',        null, 60),
  ('General Healthcare System (GESY)','https://www.gesy.org.cy/',                          null, 70),
  ('Bank Portal',                    null,                                                 'Set URL per credential - many banks', 80),
  ('Other',                          null,                                                 'Free-text platform / one-off URL', 99)
on conflict (name) do nothing;

-- ---------- 3. Link from credentials ----------
alter table public.platform_credentials
  add column if not exists platform_site_id bigint
    references public.platform_sites(id) on delete set null;

-- Optional per-credential URL — used when site has no URL (e.g. Bank Portal)
-- or the user picked Other.
alter table public.platform_credentials
  add column if not exists url text;

create index if not exists platform_credentials_site_idx
  on public.platform_credentials (platform_site_id)
  where platform_site_id is not null;
