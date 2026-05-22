-- =============================================================
-- Migration 073: Recurring invoice rework
--   1. Allow 'remarks' as a line_type on recurring_invoice_lines
--   2. Replace generate_recurring_invoices: generate the SELECTED
--      profiles for a chosen issue/due date (per-line VAT), instead of
--      "all active not yet generated for a month".
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================

begin;

-- ---------- 1. Allow 'remarks' on recurring lines ----------
do $$
declare c text;
begin
  select conname into c
    from pg_constraint
   where conrelid = 'public.recurring_invoice_lines'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%line_type%';
  if c is not null then
    execute format('alter table public.recurring_invoice_lines drop constraint %I', c);
  end if;
end $$;

alter table public.recurring_invoice_lines
  add constraint recurring_invoice_lines_line_type_check
  check (line_type in ('fixed','expense','remarks'));

-- ---------- 2. Generate selected profiles for a chosen date ----------
drop function if exists public.generate_recurring_invoices(text);

create or replace function public.generate_recurring_invoices(
  p_ids        bigint[],
  p_issue_date date,
  p_due_date   date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_rec    public.recurring_invoices%rowtype;
  v_line   public.recurring_invoice_lines%rowtype;
  v_inv_id bigint;
  v_due    date;
  v_sv     numeric(12,2);
  v_snv    numeric(12,2);
  v_disc   numeric(12,2);
  v_vat    numeric(12,2);
  v_share  numeric;
  v_net    numeric;
  v_total  numeric(12,2);
  v_count  int := 0;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.profiles
                  where id = v_uid and role in ('owner','supervisor','admin','staff')) then
    raise exception 'Staff only';
  end if;
  if p_issue_date is null then raise exception 'An issue date is required'; end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    raise exception 'Select at least one recurring profile';
  end if;

  v_due := coalesce(p_due_date, p_issue_date + 30);

  for v_rec in
    select * from public.recurring_invoices where id = any(p_ids)
  loop
    -- Remarks lines (amount 0) don't affect the subtotals.
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

    -- per-line VAT with the discount allocated pro-rata across vatable lines
    v_vat := 0;
    for v_line in
      select * from public.recurring_invoice_lines where recurring_id = v_rec.id
    loop
      if v_line.vatable then
        v_share := case when v_sv > 0 then v_line.amount / v_sv else 0 end;
        v_net   := greatest(0, v_line.amount - v_share * v_disc);
        v_vat   := v_vat + v_net * coalesce(v_line.vat_rate, 0) / 100;
      end if;
    end loop;
    v_vat   := round(v_vat, 2);
    v_total := (v_sv - v_disc) + v_snv + v_vat;

    insert into public.client_invoices
      (client_id, status, issue_date, due_date, vat_rate, discount_type, discount_value,
       subtotal_vatable, subtotal_nonvatable, discount_amount, vat_amount, total_amount,
       notes, created_by)
    values
      (v_rec.client_id, 'draft', p_issue_date, v_due, v_rec.vat_rate,
       v_rec.discount_type, v_rec.discount_value,
       v_sv, v_snv, v_disc, v_vat, v_total,
       coalesce(nullif(btrim(v_rec.notes), ''),
                'Note: Invoices outstanding for more than 15 days will carry interest at 8.5% p.a.'),
       v_uid)
    returning id into v_inv_id;

    insert into public.client_invoice_lines
      (invoice_id, line_no, line_type, description, quantity, unit_price, amount, vatable, vat_rate)
    select v_inv_id, line_no, line_type, description, quantity, unit_price, amount, vatable, vat_rate
      from public.recurring_invoice_lines
     where recurring_id = v_rec.id
     order by line_no;

    update public.recurring_invoices
       set last_generated_month = to_char(p_issue_date, 'YYYY-MM')
     where id = v_rec.id;

    v_count := v_count + 1;
  end loop;

  insert into public.audit_log (actor_id, action, target_type, target_id, summary)
  values (v_uid, 'recurring_invoices.generate', 'recurring_invoices', null,
          jsonb_build_object('issue_date', p_issue_date, 'generated', v_count));

  return jsonb_build_object('generated', v_count, 'issue_date', p_issue_date);
end $$;

revoke all on function public.generate_recurring_invoices(bigint[], date, date) from public;
grant   execute on function public.generate_recurring_invoices(bigint[], date, date) to authenticated;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 073.
-- =============================================================
