-- Migration 122: custom email templates
-- =================================================================
-- Staff-managed email templates for the bulk-email / request composers.
-- Built-in templates ship in code (emailTemplates.ts); this table holds the
-- firm's OWN templates (e.g. "Payroll information") so they can add/edit/select
-- their own. Both are merged in the composer dropdown.

create table if not exists public.email_templates (
  id         bigserial primary key,
  name       text not null,
  category   text not null default 'General',
  subject    text not null default '',
  body       text not null default '',
  is_active  boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_templates_active_idx on public.email_templates (is_active, category);

alter table public.email_templates enable row level security;

-- Internal staff manage templates; not exposed to client-portal users.
drop policy if exists email_templates_staff_all on public.email_templates;
create policy email_templates_staff_all on public.email_templates
  for all using (public.is_admin()) with check (public.is_admin());
