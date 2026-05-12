-- 030_client_email_use_code.sql
-- Switches the unique inbound email address from the slugified-name format
-- introduced in 029 to a short, code-based format:
--   client_code 'AND001' → and001@inbox.primeandcalculate.com
--
-- Why: customer feedback — the slug-based addresses were too long for daily
-- BCC use.
--
-- Fallback: clients without a client_code keep a random short address
-- (client-<6char>@…) until a code is assigned. The UPDATE trigger
-- automatically promotes them to the code-based address as soon as a code
-- is set.

begin;

-- ---- Replace the generator ----
create or replace function public.generate_client_email_address(p_client_code text, p_name text default null)
returns text language plpgsql as $$
declare
  v_code  text;
  v_rand  text;
  v_addr  text;
  v_tries int := 0;
begin
  -- Strip everything that isn't a-z0-9 from the code (so 'AND-001' or 'AND/001'
  -- still produces 'and001') and lowercase it.
  v_code := lower(regexp_replace(coalesce(p_client_code, ''), '[^A-Za-z0-9]', '', 'g'));

  if v_code <> '' then
    v_addr := format('%s@inbox.primeandcalculate.com', v_code);
    if not exists (select 1 from public.clients where unique_email = v_addr) then
      return v_addr;
    end if;
    -- Collision (shouldn't happen since client_code is unique, but be defensive)
    return format('%s-%s@inbox.primeandcalculate.com', v_code,
      substring(regexp_replace(encode(gen_random_bytes(4), 'hex'), '[^a-z0-9]', '', 'g') from 1 for 4));
  end if;

  -- No client code yet — fall back to a short random address. Loop on collision.
  loop
    v_rand := substring(
      regexp_replace(encode(gen_random_bytes(8), 'hex'), '[^a-z0-9]', '', 'g')
      from 1 for 6
    );
    v_addr := format('client-%s@inbox.primeandcalculate.com', v_rand);
    if not exists (select 1 from public.clients where unique_email = v_addr) then
      return v_addr;
    end if;
    v_tries := v_tries + 1;
    if v_tries > 10 then
      raise exception 'Could not generate a unique fallback client email';
    end if;
  end loop;
end $$;

-- ---- Replace the INSERT trigger to use the new generator ----
create or replace function public._tg_clients_unique_email_default()
returns trigger language plpgsql as $$
begin
  if new.unique_email is null or new.unique_email = '' then
    new.unique_email := public.generate_client_email_address(new.client_code, new.name);
  end if;
  return new;
end $$;

-- ---- New UPDATE trigger: if client_code changes, sync the email ----
create or replace function public._tg_clients_sync_email_on_code_change()
returns trigger language plpgsql as $$
begin
  -- Only when client_code actually changed and is now non-empty
  if coalesce(new.client_code, '') <> coalesce(old.client_code, '')
     and new.client_code is not null and new.client_code <> '' then
    new.unique_email := public.generate_client_email_address(new.client_code, new.name);
  end if;
  return new;
end $$;

drop trigger if exists trg_clients_sync_email_on_code_change on public.clients;
create trigger trg_clients_sync_email_on_code_change
  before update of client_code on public.clients
  for each row execute function public._tg_clients_sync_email_on_code_change();

-- ---- Backfill existing rows: replace slug-based addresses with code-based ----
-- For every client with a client_code, regenerate. For clients without a code,
-- leave whatever they have (will get upgraded automatically when a code is set).
update public.clients
  set unique_email = public.generate_client_email_address(client_code, name)
  where client_code is not null and client_code <> '';

commit;
-- =============================================================
-- Verify:
--   select client_code, unique_email from clients
--    where client_code is not null order by client_code limit 10;
--   -- expect rows like  AND001  |  and001@inbox.primeandcalculate.com
-- =============================================================
