-- =============================================================
-- Migration 086: AI usage log (Item 6 — cost monitoring)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Records token usage for each AI document scan (extract-document) so the
-- firm can track spend over time. Cost is an ESTIMATE (tokens × published
-- per-token rate); the Anthropic console remains authoritative. Any signed-in
-- user can log their own row; only staff can read the log.
-- =============================================================

begin;

create table if not exists public.ai_usage (
  id              bigserial primary key,
  created_at      timestamptz not null default now(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete set null,
  source          text not null default 'extract-document',
  model           text,
  input_tokens    int not null default 0,
  output_tokens   int not null default 0,
  estimated_cost  numeric(10,5) not null default 0,   -- USD, estimate
  pages           int
);
create index if not exists ai_usage_created_idx on public.ai_usage (created_at desc);

alter table public.ai_usage enable row level security;
drop policy if exists "ai_usage insert own" on public.ai_usage;
drop policy if exists "ai_usage staff read" on public.ai_usage;
-- Any signed-in user logs their own usage; only staff can read.
create policy "ai_usage insert own" on public.ai_usage
  for insert with check (user_id = auth.uid());
create policy "ai_usage staff read" on public.ai_usage
  for select using (public.is_admin());

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 086.
-- =============================================================
