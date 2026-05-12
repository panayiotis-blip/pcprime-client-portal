-- 029_client_emails.sql
-- Email integration: each client gets a unique inbound email address. Emails
-- BCC'd or forwarded to that address are captured via Mailgun → Edge Function
-- → these tables. Attachments live in a dedicated private Storage bucket.
--
-- The webhook Edge Function uses service_role (bypasses RLS) to insert; from
-- the authenticated app, INSERT is blocked and SELECT is gated on
-- clients.read + the user_clients linkage (same pattern as documents).

begin;

-- =============================================================
-- 1. unique_email column on clients + generator + auto-fill trigger
-- =============================================================

-- Slugify a client name into something safe for the local-part of an email.
-- Strips Greek/non-ASCII, lowercases, collapses non-[a-z0-9] to '-', trims
-- leading/trailing hyphens, caps at 30 chars. Falls back to 'client' if the
-- slug ends up empty.
create or replace function public._slugify_for_email(p_name text)
returns text language plpgsql immutable as $$
declare
  s text;
begin
  s := lower(coalesce(p_name, ''));
  -- Strip everything that isn't a-z, 0-9, space, or hyphen (so Greek, accents, punctuation all go)
  s := regexp_replace(s, '[^a-z0-9 -]', '', 'g');
  -- Collapse whitespace/hyphens to single hyphen
  s := regexp_replace(trim(s), '[\s-]+', '-', 'g');
  s := substring(s from 1 for 30);
  s := trim(both '-' from s);
  if s = '' then s := 'client'; end if;
  return s;
end $$;

-- Returns a unique email address for a client name. Loops on collision —
-- with 6 chars of base36 (~2.1B options) collisions are vanishingly rare,
-- but the loop guards against the edge case.
create or replace function public.generate_client_email_address(p_name text)
returns text language plpgsql as $$
declare
  v_slug text;
  v_addr text;
  v_rand text;
  v_tries int := 0;
begin
  v_slug := public._slugify_for_email(p_name);
  loop
    -- 6 chars of base36 alphanumeric
    v_rand := substring(
      regexp_replace(encode(gen_random_bytes(8), 'hex'), '[^a-z0-9]', '', 'g')
      from 1 for 6
    );
    v_addr := format('client-%s-%s@inbox.primeandcalculate.com', v_slug, v_rand);
    -- Check collision against existing clients
    if not exists (select 1 from public.clients where unique_email = v_addr) then
      return v_addr;
    end if;
    v_tries := v_tries + 1;
    if v_tries > 10 then
      raise exception 'Could not generate a unique client email after 10 attempts';
    end if;
  end loop;
end $$;

-- Add the column (unique constraint — no two clients share an address)
alter table public.clients
  add column if not exists unique_email text unique;

-- Trigger: on INSERT auto-fill unique_email if NULL.
create or replace function public._tg_clients_unique_email_default()
returns trigger language plpgsql as $$
begin
  if new.unique_email is null or new.unique_email = '' then
    new.unique_email := public.generate_client_email_address(new.name);
  end if;
  return new;
end $$;

drop trigger if exists trg_clients_unique_email_default on public.clients;
create trigger trg_clients_unique_email_default
  before insert on public.clients
  for each row execute function public._tg_clients_unique_email_default();

-- Backfill existing rows
update public.clients
  set unique_email = public.generate_client_email_address(name)
  where unique_email is null;

-- =============================================================
-- 2. client_emails table
-- =============================================================
create table if not exists public.client_emails (
  id               bigserial primary key,
  client_id        bigint not null references public.clients(id) on delete cascade,
  direction        text not null check (direction in ('inbound', 'outbound')),
  sender_email     text,
  sender_name      text,
  recipient_emails text[] default '{}'::text[],
  cc_emails        text[] default '{}'::text[],
  subject          text,
  body_html        text,
  body_plain       text,
  received_at      timestamptz not null default now(),
  attachment_count int not null default 0,
  raw_message_id   text,  -- RFC 822 Message-ID (for dedup + future threading)
  created_at       timestamptz not null default now()
);

create index if not exists client_emails_client_received_idx
  on public.client_emails (client_id, received_at desc);

-- Dedup: if Mailgun retries we don't double-insert the same raw_message_id
-- for the same client. Allow nulls (some emails lack Message-ID).
create unique index if not exists client_emails_dedup_idx
  on public.client_emails (client_id, raw_message_id)
  where raw_message_id is not null;

comment on table public.client_emails is
  'Emails captured for a client via Mailgun inbound parse. INSERT blocked from authenticated users — only the inbound-email Edge Function (service_role) writes.';

-- =============================================================
-- 3. client_email_attachments table
-- =============================================================
create table if not exists public.client_email_attachments (
  id           bigserial primary key,
  email_id     bigint not null references public.client_emails(id) on delete cascade,
  filename     text not null,
  mime_type    text,
  size_bytes   int,
  storage_path text not null,
  created_at   timestamptz not null default now()
);

create index if not exists client_email_attachments_email_idx
  on public.client_email_attachments (email_id);

-- =============================================================
-- 4. RLS
-- =============================================================
alter table public.client_emails enable row level security;
alter table public.client_email_attachments enable row level security;

-- Read: same gate as documents — clients.read perm + user_clients linkage
-- OR clients.read_all (covers internal-firm roles).
drop policy if exists "client_emails_read" on public.client_emails;
create policy "client_emails_read"
  on public.client_emails for select to authenticated
  using (
    public.has_permission('clients.read') and (
      public.has_permission('clients.read_all')
      or exists (
        select 1 from public.user_clients uc
        where uc.client_id = client_emails.client_id
          and uc.user_id = auth.uid()
      )
    )
  );

-- INSERT/UPDATE/DELETE blocked for authenticated. service_role bypasses RLS.
drop policy if exists "client_emails_no_write" on public.client_emails;
create policy "client_emails_no_write"
  on public.client_emails for insert to authenticated with check (false);

drop policy if exists "client_email_attachments_read" on public.client_email_attachments;
create policy "client_email_attachments_read"
  on public.client_email_attachments for select to authenticated
  using (
    exists (
      select 1 from public.client_emails ce
      where ce.id = client_email_attachments.email_id
        and public.has_permission('clients.read')
        and (
          public.has_permission('clients.read_all')
          or exists (
            select 1 from public.user_clients uc
            where uc.client_id = ce.client_id and uc.user_id = auth.uid()
          )
        )
    )
  );

drop policy if exists "client_email_attachments_no_write" on public.client_email_attachments;
create policy "client_email_attachments_no_write"
  on public.client_email_attachments for insert to authenticated with check (false);

-- =============================================================
-- 5. Storage bucket: client-email-attachments
-- =============================================================
insert into storage.buckets (id, name, public)
values ('client-email-attachments', 'client-email-attachments', false)
on conflict (id) do nothing;

-- Path format: <client_id>/<email_id>/<attachment-index>__<safe-filename>
drop policy if exists "client-email-attachments read"   on storage.objects;
drop policy if exists "client-email-attachments write"  on storage.objects;
drop policy if exists "client-email-attachments update" on storage.objects;
drop policy if exists "client-email-attachments delete" on storage.objects;

create policy "client-email-attachments read"
  on storage.objects for select using (
    bucket_id = 'client-email-attachments'
    and public.has_permission('clients.read')
    and (
      public.has_permission('clients.read_all')
      or exists (
        select 1 from public.user_clients uc
        where uc.client_id = (storage.foldername(name))[1]::bigint
          and uc.user_id = auth.uid()
      )
    )
  );

-- INSERT/UPDATE/DELETE on storage objects in this bucket: blocked for
-- authenticated. Only service_role writes (via the Edge Function).
create policy "client-email-attachments no write"
  on storage.objects for insert with check (
    bucket_id = 'client-email-attachments' and false
  );

commit;
-- =============================================================
-- End of migration 029.
--
-- Verify:
--   select count(*) from public.clients where unique_email is null;  -- expect 0
--   select unique_email from public.clients limit 5;
--   select bucket_id from storage.buckets where id = 'client-email-attachments';
-- =============================================================
