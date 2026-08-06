-- =============================================================
-- Migration 175: notices to clients
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- The firm needs to tell clients things: a Tax Department deadline, a change of
-- practice, an office closure. Until now that meant an email each, with no
-- record in the portal and no way to see who had read it.
--
--   * client_notice           — the notice itself: title, body, optional file.
--                              audience 'all' reaches every client; 'selected'
--                              reaches the clients listed alongside it.
--   * client_notice_recipient — which clients a 'selected' notice is for.
--   * client_notice_read      — first time a client opened it, so the firm can
--                              see who has not.
--
-- WHO SEES WHAT. A client reads a notice addressed to them and nothing else,
-- and can only ever write their own read receipt — the policy pins the row to a
-- client they can access, so a receipt cannot be forged for anyone else.
-- Publishing, editing and withdrawing are firm-staff only.
--
-- Draft until published: published_at is null while it is being written, so a
-- half-finished notice is never visible to a client.
-- =============================================================

begin;

create table if not exists public.client_notice (
  id            bigserial primary key,
  title         text not null,
  body          text,
  audience      text not null default 'all' check (audience in ('all', 'selected')),
  category      text,                    -- e.g. 'Tax Department', 'Practice'
  file_name     text,
  storage_path  text,
  mime_type     text,
  published_at  timestamptz,             -- null = draft, not visible to clients
  expires_at    timestamptz,             -- optional: stops showing after this
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.client_notice_recipient (
  notice_id  bigint not null references public.client_notice(id) on delete cascade,
  client_id  bigint not null references public.clients(id) on delete cascade,
  primary key (notice_id, client_id)
);

create table if not exists public.client_notice_read (
  notice_id  bigint not null references public.client_notice(id) on delete cascade,
  client_id  bigint not null references public.clients(id) on delete cascade,
  user_id    uuid   references auth.users(id) on delete set null,
  read_at    timestamptz not null default now(),
  primary key (notice_id, client_id)
);

create index if not exists client_notice_published_idx on public.client_notice (published_at desc);
create index if not exists client_notice_recipient_client_idx on public.client_notice_recipient (client_id);

comment on table public.client_notice is
  'Notices the firm publishes to clients (migration 175). audience all|selected; published_at null = draft. Read receipts in client_notice_read.';

-- -------------------------------------------------------------
-- Does the caller have a client this notice is addressed to?
-- SECURITY DEFINER so the policy can look at the recipient list without the
-- caller needing to read that table directly.
-- -------------------------------------------------------------
create or replace function public.notice_is_for_me(nid bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.client_notice n
    where n.id = nid
      and n.published_at is not null
      and (n.expires_at is null or n.expires_at > now())
      and (
        n.audience = 'all'
        or exists (
          select 1 from public.client_notice_recipient r
          join public.user_clients uc on uc.client_id = r.client_id
          where r.notice_id = n.id and uc.user_id = auth.uid()
        )
      )
  );
$$;

-- -------------------------------------------------------------
-- RLS
-- -------------------------------------------------------------
alter table public.client_notice           enable row level security;
alter table public.client_notice_recipient enable row level security;
alter table public.client_notice_read      enable row level security;

-- Staff see everything including drafts; a client sees only a published notice
-- addressed to them.
drop policy if exists "client_notice read"  on public.client_notice;
drop policy if exists "client_notice write" on public.client_notice;
create policy "client_notice read" on public.client_notice
  for select using (public.is_admin() or public.notice_is_for_me(id));
create policy "client_notice write" on public.client_notice
  for all using (public.is_admin()) with check (public.is_admin());

-- The recipient list is the firm's own working data.
drop policy if exists "client_notice_recipient staff" on public.client_notice_recipient;
create policy "client_notice_recipient staff" on public.client_notice_recipient
  for all using (public.is_admin()) with check (public.is_admin());

-- Receipts: staff read them all; a client may record one for a client they can
-- access, for a notice actually addressed to them, and read their own back.
drop policy if exists "client_notice_read read"   on public.client_notice_read;
drop policy if exists "client_notice_read insert" on public.client_notice_read;
create policy "client_notice_read read" on public.client_notice_read
  for select using (public.is_admin() or public.user_can_access_client(client_id));
create policy "client_notice_read insert" on public.client_notice_read
  for insert with check (
    public.user_can_access_client(client_id) and public.notice_is_for_me(notice_id)
  );

drop trigger if exists client_notice_updated on public.client_notice;
create trigger client_notice_updated before update on public.client_notice
  for each row execute function public.tg_set_updated_at();

-- -------------------------------------------------------------
-- Attachment storage: private bucket, staff write, addressee reads.
-- -------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('client-notices', 'client-notices', false)
on conflict (id) do nothing;

drop policy if exists "client-notices read"   on storage.objects;
drop policy if exists "client-notices write"  on storage.objects;
drop policy if exists "client-notices delete" on storage.objects;
-- Files are stored as <noticeId>/<file>, so the folder identifies the notice
-- and the same addressee test decides who may fetch it.
create policy "client-notices read" on storage.objects
  for select using (bucket_id = 'client-notices'
    and (public.is_admin() or public.notice_is_for_me((storage.foldername(name))[1]::bigint)));
create policy "client-notices write" on storage.objects
  for insert with check (bucket_id = 'client-notices' and public.is_admin());
create policy "client-notices delete" on storage.objects
  for delete using (bucket_id = 'client-notices' and public.is_admin());

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- Verify:
--   select tablename, policyname, cmd from pg_policies
--    where tablename like 'client_notice%' order by tablename, policyname;
--   select public.notice_is_for_me(0);            -- false, no such notice
--   select id, name, public from storage.buckets where id = 'client-notices';
-- =============================================================
-- End of migration 175.
-- =============================================================
