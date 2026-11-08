-- Moje kancelář (náhrada původního YeY). Vlastní schéma v projektu „YeY - Online Office“ (hkzhjoveiqadezmvksdz),
-- aby se nemíchalo s tabulkami původního YeY v public. Nasazeno 2026-11-08.
create schema if not exists online_kancelar;
comment on schema online_kancelar is 'Moje kancelář – nová online verze YeY (repo petrnepomucky/yey, kancelar.yey.cz). Tabulky přenesené z projektu Kancelář řemeslníků online; RLS povinné na každé tabulce.';
grant usage on schema online_kancelar to anon, authenticated, service_role;
alter default privileges in schema online_kancelar grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema online_kancelar grant all on tables to service_role;
alter default privileges in schema online_kancelar grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema online_kancelar grant execute on functions to authenticated, service_role;
alter default privileges in schema online_kancelar revoke execute on functions from public;
