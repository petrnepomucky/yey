-- Výpis struktury schématu public (tabulky, klíče, indexy, RLS, politiky, funkce, triggery, pohledy).
-- Spustit v Supabase → SQL Editor projektu „Kancelář řemeslníků online“, výsledek (jedna buňka) zkopírovat.
with
tabulky as (
  select 1 as poradi, c.relname as klic,
    'create table public.' || quote_ident(c.relname) || E' (\n  ' ||
    string_agg(quote_ident(a.attname) || ' ' || format_type(a.atttypid, a.atttypmod)
      || case when a.attidentity in ('a','d') then ' generated ' || case a.attidentity when 'a' then 'always' else 'by default' end || ' as identity' else '' end
      || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
      || case when a.attnotnull then ' not null' else '' end, E',\n  ' order by a.attnum) || E'\n);' as ddl
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
  where n.nspname = 'public' and c.relkind = 'r'
  group by c.relname
),
omezeni as (
  select case con.contype when 'p' then 2 when 'u' then 3 when 'c' then 3 else 4 end, con.conname,
    'alter table ' || con.conrelid::regclass || ' add constraint ' || quote_ident(con.conname) || ' ' || pg_get_constraintdef(con.oid) || ';'
  from pg_constraint con join pg_namespace n on n.oid = con.connamespace
  where n.nspname = 'public' and con.contype in ('p','u','f','c')
),
indexy as (
  select 5, i.indexname, i.indexdef || ';'
  from pg_indexes i
  where i.schemaname = 'public'
    and not exists (select 1 from pg_constraint c where c.conname = i.indexname)
),
pohledy as (
  select 6, c.relname, 'create or replace view public.' || quote_ident(c.relname) || ' as ' || pg_get_viewdef(c.oid, true)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
),
funkce as (
  select 7, p.proname, pg_get_functiondef(p.oid) || ';'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  left join pg_depend dep on dep.objid = p.oid and dep.deptype = 'e'
  where n.nspname = 'public' and dep.objid is null and p.prokind in ('f','p')
),
rls as (
  select 8, c.relname, 'alter table public.' || quote_ident(c.relname) || ' enable row level security;'
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
),
politiky as (
  select 9, tablename || '.' || policyname,
    'create policy ' || quote_ident(policyname) || ' on public.' || quote_ident(tablename)
    || ' as ' || permissive || ' for ' || cmd || ' to ' || array_to_string(roles, ', ')
    || coalesce(' using (' || qual || ')', '') || coalesce(' with check (' || with_check || ')', '') || ';'
  from pg_policies where schemaname = 'public'
),
triggery as (
  select 10, t.tgname, pg_get_triggerdef(t.oid) || ';'
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal
),
prava as (
  select 11, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    '-- execute ' || p.proname || ': ' || coalesce(array_to_string(p.proacl, ' '), 'výchozí')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  left join pg_depend dep on dep.objid = p.oid and dep.deptype = 'e'
  where n.nspname = 'public' and dep.objid is null
),
vse as (
  select * from tabulky union all select * from omezeni union all select * from indexy
  union all select * from pohledy union all select * from funkce union all select * from rls
  union all select * from politiky union all select * from triggery union all select * from prava
)
select string_agg(ddl, E'\n\n' order by poradi, klic) as struktura from vse;
