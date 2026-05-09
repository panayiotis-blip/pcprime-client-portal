-- Seed the single test client. Short lines — safe against paste-wrap.
truncate public.clients restart identity cascade;

insert into public.clients (client_code, name, status)
values ('221TES001', 'Test Client', 'active');

select setval(
  pg_get_serial_sequence('public.clients', 'id'),
  coalesce((select max(id) from public.clients), 1)
);
