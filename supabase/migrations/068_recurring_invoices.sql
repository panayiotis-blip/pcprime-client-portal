-- =============================================================
-- Migration 068: Recurring invoices (Accounting — billing module, Phase A)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- A per-client recurring billing profile. Each month the firm runs
-- generate_recurring_invoices(month) which creates a DRAFT client_invoice
-- (+ lines) from every active profile not yet generated for that month.
-- The drafts are then reviewed and issued through the normal flow.
-- =============================================================

begin;

-- ---------- 1. recurring_invoices — the per-client profile ----------
create table if not exists public.recurring_invoices (
  id                   bigserial primary key,
  client_id            bigint not null references public.clients(id) on delete cascade,
  label                text,
  vat_rate             numeric(5,2) not null default 19.00 check (vat_rate >= 0 and vat_rate <= 100),
  discount_type        text check (discount_type in (null, 'percent', 'amount')),
  discount_value       numeric(12,2) check (discount_value is null or discount_value >= 0),
  active               boolean not null default true,
  last_generated_month text,                       -- 'YYYY-MM'
  notes                text,
  created_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists recurring_invoices_client_idx on public.recurring_invoices (client_id);

drop trigger if exists recurring_invoices_updated_at on public.recurring_invoices;
create trigger recurring_invoices_updated_at before update on public.recurring_invoices
  for each row execute function public.tg_set_updated_at();

drop trigger if exists tg_audit_recurring_invoices on public.recurring_invoices;
create trigger tg_audit_recurring_invoices
  after insert or update or delete on public.recurring_invoices
  for each row execute function public.tg_audit();

alter table public.recurring_invoices enable row level security;
drop policy if exists "recurring_invoices read"  on public.recurring_invoices;
drop policy if exists "recurring_invoices write" on public.recurring_invoices;
create policy "recurring_invoices read" on public.recurring_invoices
  for select using (public.is_admin());
create policy "recurring_invoices write" on public.recurring_invoices
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- 2. recurring_invoice_lines — the repeating line items ----------
create table if not exists public.recurring_invoice_lines (
  id            bigserial primary key,
  recurring_id  bigint not null references public.recurring_invoices(id) on delete cascade,
  line_no       int    not null default 1,
  line_type     text   not null default 'fixed' check (line_type in ('fixed', 'expense')),
  description   text   not null,
  quantity      numeric(12,3) not null default 1,
  unit_price    numeric(12,2) not null default 0,
  amount        numeric(12,2) not null default 0,
  vatable       boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists recurring_invoice_lines_idx
  on public.recurring_invoice_lines (recurring_id, line_no);

alter table public.recurring_invoice_lines enable row level security;
drop policy if exists "recurring_invoice_lines read"  on public.recurring_invoice_lines;
drop policy if exists "recurring_invoice_lines write" on public.recurring_invoice_lines;
create policy "recurring_invoice_lines read" on public.recurring_invoice_lines
  for select using (public.is_admin());
create policy "recurring_invoice_lines write" on public.recurring_invoice_lines
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- 3. generate_recurring_invoices — make this month's drafts ----------
create or replace function public.generate_recurring_invoices(p_month text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_rec    public.recurring_invoices%rowtype;
  v_inv_id bigint;
  v_sv     numeric(12,2);
  v_snv    numeric(12,2);
  v_disc   numeric(12,2);
  v_vat    numeric(12,2);
  v_total  numeric(12,2);
  v_count  int := 0;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.profiles
                  where id = v_uid and role in ('owner','supervisor','admin','staff')) then
    raise exception 'Staff only';
  end if;
  if p_month !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'Month must be in YYYY-MM format';
  end if;

  for v_rec in
    select * from public.recurring_invoices
    where active and last_generated_month is distinct from p_month
  loop
    select coalesce(sum(amount) filter (where vatable), 0),
           coalesce(sum(amount) filter (where not vatable), 0)
      into v_sv, v_snv
      from public.recurring_invoice_lines
     where recurring_id = v_rec.id;

    v_disc := case
      when v_rec.discount_type = 'percent'
        then round(v_sv * coalesce(v_rec.discount_value, 0) / 100, 2)
      when v_rec.discount_type = 'amount'
        then least(coalesce(v_rec.discount_value, 0), v_sv)
      else 0
    end;
    v_vat   := round((v_sv - v_disc) * v_rec.vat_rate / 100, 2);
    v_total := (v_sv - v_disc) + v_snv + v_vat;

    insert into public.client_invoices
      (client_id, status, vat_rate, discount_type, discount_value,
       subtotal_vatable, subtotal_nonvatable, discount_amount, vat_amount, total_amount,
       notes, created_by)
    values
      (v_rec.client_id, 'draft', v_rec.vat_rate, v_rec.discount_type, v_rec.discount_value,
       v_sv, v_snv, v_disc, v_vat, v_total,
       'Recurring: ' || coalesce(v_rec.label, 'monthly') || ' (' || p_month || ')', v_uid)
    returning id into v_inv_id;

    insert into public.client_invoice_lines
      (invoice_id, line_no, line_type, description, quantity, unit_price, amount, vatable)
    select v_inv_id, line_no, line_type, description, quantity, unit_price, amount, vatable
      from public.recurring_invoice_lines
     where recurring_id = v_rec.id
     order by line_no;

    update public.recurring_invoices
       set last_generated_month = p_month
     where id = v_rec.id;

    v_count := v_count + 1;
  end loop;

  insert into public.audit_log (actor_id, action, target_type, target_id, summary)
  values (v_uid, 'recurring_invoices.generate', 'recurring_invoices', null,
          jsonb_build_object('month', p_month, 'generated', v_count));

  return jsonb_build_object('month', p_month, 'generated', v_count);
end $$;

revoke all on function public.generate_recurring_invoices(text) from public;
grant   execute on function public.generate_recurring_invoices(text) to authenticated;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 068.
-- =============================================================
