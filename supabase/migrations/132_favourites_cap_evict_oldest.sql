-- =============================================================
-- Migration 132: Favourites cap — evict oldest instead of blocking
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Migration 049's pin_favourite() enforced the 5-per-type cap by RAISING an
-- exception on the 6th pin ("Maximum 5 … Unpin one first."). Per UX decision,
-- pinning a 6th should instead succeed and silently drop the OLDEST favourite
-- of that type (FIFO by sort_order), so the newest thing can always be pinned.
--
-- Only the cap branch changes; everything else (idempotency, sort_order,
-- audit, grants) is preserved from migration 049.
-- =============================================================

begin;

create or replace function public.pin_favourite(
  p_favourite_type text,
  p_target_id      text,
  p_label          text default null
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_count   int;
  v_next    int;
  v_id      bigint;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_favourite_type not in ('menu_item','client') then
    raise exception 'Invalid favourite type: %', p_favourite_type;
  end if;

  -- Idempotent: if already pinned, return existing id
  select id into v_id from public.user_favourites
   where user_id = v_user_id and favourite_type = p_favourite_type and target_id = p_target_id;
  if v_id is not null then return v_id; end if;

  -- Cap = 5 per type. If full, evict the OLDEST (lowest sort_order) of this
  -- type for this user so the new pin can be added (FIFO — oldest drops off).
  select count(*) into v_count from public.user_favourites
   where user_id = v_user_id and favourite_type = p_favourite_type;
  while v_count >= 5 loop
    delete from public.user_favourites
     where id = (
       select id from public.user_favourites
        where user_id = v_user_id and favourite_type = p_favourite_type
        order by sort_order asc, id asc
        limit 1
     );
    v_count := v_count - 1;
  end loop;

  select coalesce(max(sort_order), 0) + 1 into v_next from public.user_favourites
   where user_id = v_user_id and favourite_type = p_favourite_type;

  insert into public.user_favourites (user_id, favourite_type, target_id, label, sort_order)
  values (v_user_id, p_favourite_type, p_target_id, p_label, v_next)
  returning id into v_id;

  -- Audit (only meaningful for clients per spec; menu items are noise)
  if p_favourite_type = 'client' then
    insert into public.audit_log (actor_id, action, target_type, target_id, summary)
    values (v_user_id, 'favourites.pin_client', 'clients', null,
            jsonb_build_object('client_id', p_target_id, 'label', p_label));
  end if;

  return v_id;
end $$;

revoke all on function public.pin_favourite(text, text, text) from public;
grant   execute on function public.pin_favourite(text, text, text) to authenticated;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 132.
-- =============================================================
