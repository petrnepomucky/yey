-- Moje kancelář: struktura převzatá z projektu „Kancelář řemeslníků online“ (vgpnrlgisqcdkrzhhfsy, public),
-- přenesená do schématu online_kancelar v projektu „YeY - Online Office“ (hkzhjoveiqadezmvksdz). 2026-11-08.

create table online_kancelar.cenik (
  id uuid default gen_random_uuid() not null,
  firma_id uuid not null,
  nazev text not null,
  mj text default 'm²'::text,
  cena numeric(14,2) default 0 not null,
  dph numeric(5,2) default 21 not null,
  kategorie text
);

create table online_kancelar.clenove (
  firma_id uuid not null,
  user_id uuid not null,
  role text default 'majitel'::text not null
);

create table online_kancelar.denik (
  id uuid default gen_random_uuid() not null,
  firma_id uuid not null,
  zakazka_id uuid not null,
  text text not null,
  created_at timestamp with time zone default now() not null
);

create table online_kancelar.doklady (
  id uuid default gen_random_uuid() not null,
  firma_id uuid not null,
  zakazka_id uuid,
  kontakt_id uuid,
  zdroj_id uuid,
  typ text not null,
  cislo text not null,
  stav text default 'koncept'::text not null,
  datum date default CURRENT_DATE not null,
  splatnost date,
  duzp date,
  vs text,
  predmet text,
  poznamka text,
  forma_uhrady text default 'převodem'::text,
  zaplaceno_dne date,
  celkem_bez numeric(14,2) default 0 not null,
  celkem_dph numeric(14,2) default 0 not null,
  created_at timestamp with time zone default now() not null
);

create table online_kancelar.firmy (
  id uuid default gen_random_uuid() not null,
  nazev text default 'Moje firma'::text not null,
  ico text,
  dic text,
  platce_dph boolean default false not null,
  ulice text,
  mesto text,
  psc text,
  email text,
  telefon text,
  web text,
  ucet text,
  iban text,
  splatnost_dni integer default 14 not null,
  zapis text,
  created_at timestamp with time zone default now() not null
);

create table online_kancelar.kontakty (
  id uuid default gen_random_uuid() not null,
  firma_id uuid not null,
  typ text default 'klient'::text not null,
  nazev text not null,
  osoba text,
  ico text,
  dic text,
  ulice text,
  mesto text,
  psc text,
  email text,
  telefon text,
  poznamka text,
  created_at timestamp with time zone default now() not null
);

create table online_kancelar.polozky (
  id uuid default gen_random_uuid() not null,
  doklad_id uuid not null,
  firma_id uuid not null,
  poradi integer default 0 not null,
  nazev text default ''::text not null,
  mnozstvi numeric(14,3) default 1 not null,
  mj text default 'ks'::text,
  cena numeric(14,2) default 0 not null,
  dph numeric(5,2) default 21 not null
);

create table online_kancelar.zakazky (
  id uuid default gen_random_uuid() not null,
  firma_id uuid not null,
  kontakt_id uuid,
  nazev text not null,
  adresa text,
  faze text default 'poptavka'::text not null,
  termin date,
  postup integer default 0 not null,
  poznamka text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

alter table online_kancelar.cenik add constraint cenik_pkey PRIMARY KEY (id);

alter table online_kancelar.clenove add constraint clenove_pkey PRIMARY KEY (firma_id, user_id);

alter table online_kancelar.denik add constraint denik_pkey PRIMARY KEY (id);

alter table online_kancelar.doklady add constraint doklady_pkey PRIMARY KEY (id);

alter table online_kancelar.firmy add constraint firmy_pkey PRIMARY KEY (id);

alter table online_kancelar.kontakty add constraint kontakty_pkey PRIMARY KEY (id);

alter table online_kancelar.polozky add constraint polozky_pkey PRIMARY KEY (id);

alter table online_kancelar.zakazky add constraint zakazky_pkey PRIMARY KEY (id);

alter table online_kancelar.clenove add constraint clenove_role_check CHECK ((role = ANY (ARRAY['majitel'::text, 'clen'::text])));

alter table online_kancelar.doklady add constraint doklady_stav_check CHECK ((stav = ANY (ARRAY['koncept'::text, 'odeslano'::text, 'prijato'::text, 'odmitnuto'::text, 'zaplaceno'::text, 'storno'::text, 'podepsano'::text])));

alter table online_kancelar.doklady add constraint doklady_typ_check CHECK ((typ = ANY (ARRAY['nabidka'::text, 'faktura'::text, 'zalohova'::text, 'protokol'::text])));

alter table online_kancelar.kontakty add constraint kontakty_typ_check CHECK ((typ = ANY (ARRAY['klient'::text, 'dodavatel'::text, 'jiny'::text])));

alter table online_kancelar.zakazky add constraint zakazky_faze_check CHECK ((faze = ANY (ARRAY['poptavka'::text, 'nabidka'::text, 'realizace'::text, 'fakturace'::text, 'hotovo'::text, 'zruseno'::text])));

alter table online_kancelar.zakazky add constraint zakazky_postup_check CHECK (((postup >= 0) AND (postup <= 100)));

alter table online_kancelar.cenik add constraint cenik_firma_id_fkey FOREIGN KEY (firma_id) REFERENCES online_kancelar.firmy(id) ON DELETE CASCADE;

alter table online_kancelar.clenove add constraint clenove_firma_id_fkey FOREIGN KEY (firma_id) REFERENCES online_kancelar.firmy(id) ON DELETE CASCADE;

alter table online_kancelar.clenove add constraint clenove_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table online_kancelar.denik add constraint denik_firma_id_fkey FOREIGN KEY (firma_id) REFERENCES online_kancelar.firmy(id) ON DELETE CASCADE;

alter table online_kancelar.denik add constraint denik_zakazka_id_fkey FOREIGN KEY (zakazka_id) REFERENCES online_kancelar.zakazky(id) ON DELETE CASCADE;

alter table online_kancelar.doklady add constraint doklady_firma_id_fkey FOREIGN KEY (firma_id) REFERENCES online_kancelar.firmy(id) ON DELETE CASCADE;

alter table online_kancelar.doklady add constraint doklady_kontakt_id_fkey FOREIGN KEY (kontakt_id) REFERENCES online_kancelar.kontakty(id) ON DELETE SET NULL;

alter table online_kancelar.doklady add constraint doklady_zakazka_id_fkey FOREIGN KEY (zakazka_id) REFERENCES online_kancelar.zakazky(id) ON DELETE SET NULL;

alter table online_kancelar.doklady add constraint doklady_zdroj_id_fkey FOREIGN KEY (zdroj_id) REFERENCES online_kancelar.doklady(id) ON DELETE SET NULL;

alter table online_kancelar.kontakty add constraint kontakty_firma_id_fkey FOREIGN KEY (firma_id) REFERENCES online_kancelar.firmy(id) ON DELETE CASCADE;

alter table online_kancelar.polozky add constraint polozky_doklad_id_fkey FOREIGN KEY (doklad_id) REFERENCES online_kancelar.doklady(id) ON DELETE CASCADE;

alter table online_kancelar.polozky add constraint polozky_firma_id_fkey FOREIGN KEY (firma_id) REFERENCES online_kancelar.firmy(id) ON DELETE CASCADE;

alter table online_kancelar.zakazky add constraint zakazky_firma_id_fkey FOREIGN KEY (firma_id) REFERENCES online_kancelar.firmy(id) ON DELETE CASCADE;

alter table online_kancelar.zakazky add constraint zakazky_kontakt_id_fkey FOREIGN KEY (kontakt_id) REFERENCES online_kancelar.kontakty(id) ON DELETE SET NULL;

CREATE INDEX cenik_firma_id_idx ON online_kancelar.cenik USING btree (firma_id);

CREATE INDEX clenove_user_id_idx ON online_kancelar.clenove USING btree (user_id);

CREATE INDEX denik_firma_id_idx ON online_kancelar.denik USING btree (firma_id);

CREATE INDEX denik_zakazka_id_idx ON online_kancelar.denik USING btree (zakazka_id);

CREATE INDEX doklady_firma_id_idx ON online_kancelar.doklady USING btree (firma_id);

CREATE INDEX doklady_kontakt_id_idx ON online_kancelar.doklady USING btree (kontakt_id);

CREATE INDEX doklady_zakazka_id_idx ON online_kancelar.doklady USING btree (zakazka_id);

CREATE INDEX doklady_zdroj_id_idx ON online_kancelar.doklady USING btree (zdroj_id);

CREATE INDEX kontakty_firma_id_idx ON online_kancelar.kontakty USING btree (firma_id);

CREATE INDEX polozky_doklad_id_idx ON online_kancelar.polozky USING btree (doklad_id);

CREATE INDEX polozky_firma_id_idx ON online_kancelar.polozky USING btree (firma_id);

CREATE INDEX zakazky_firma_id_idx ON online_kancelar.zakazky USING btree (firma_id);

CREATE INDEX zakazky_kontakt_id_idx ON online_kancelar.zakazky USING btree (kontakt_id);

CREATE OR REPLACE FUNCTION online_kancelar.dalsi_cislo(p_firma uuid, p_typ text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare pre text := case p_typ when 'nabidka' then 'N' when 'faktura' then 'F' when 'zalohova' then 'Z' else 'P' end
  || to_char(current_date,'YYYY'); n int;
begin
  select coalesce(max(nullif(regexp_replace(substr(cislo, length(pre)+1),'\D','','g'),'')::int),0)+1 into n
  from online_kancelar.doklady where firma_id = p_firma and typ = p_typ and cislo like pre||'%';
  return pre || lpad(n::text,3,'0'); end $function$
;

CREATE OR REPLACE FUNCTION online_kancelar.moje_firmy()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select firma_id from online_kancelar.clenove where user_id = (select auth.uid()) $function$
;

CREATE OR REPLACE FUNCTION online_kancelar.prepocet_dokladu()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d uuid := coalesce(new.doklad_id, old.doklad_id); begin
  update online_kancelar.doklady set
    celkem_bez = coalesce((select sum(round(mnozstvi*cena,2)) from online_kancelar.polozky where doklad_id = d),0),
    celkem_dph = coalesce((select sum(round(mnozstvi*cena*dph/100,2)) from online_kancelar.polozky where doklad_id = d),0)
  where id = d; return null; end $function$
;

CREATE OR REPLACE FUNCTION online_kancelar.touch_updated()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$ begin new.updated_at = now(); return new; end $function$
;

CREATE OR REPLACE FUNCTION online_kancelar.zalozit_firmu(p_nazev text, p_ico text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f uuid; begin
  if auth.uid() is null then raise exception 'Nepřihlášen'; end if;
  select firma_id into f from online_kancelar.clenove where user_id = auth.uid() limit 1;
  if f is not null then return f; end if;
  insert into online_kancelar.firmy(nazev, ico) values (coalesce(nullif(p_nazev,''),'Moje firma'), p_ico) returning id into f;
  insert into online_kancelar.clenove(firma_id, user_id, role) values (f, auth.uid(), 'majitel');
  return f; end $function$
;

alter table online_kancelar.cenik enable row level security;

alter table online_kancelar.clenove enable row level security;

alter table online_kancelar.denik enable row level security;

alter table online_kancelar.doklady enable row level security;

alter table online_kancelar.firmy enable row level security;

alter table online_kancelar.kontakty enable row level security;

alter table online_kancelar.polozky enable row level security;

alter table online_kancelar.zakazky enable row level security;

create policy cenik_firma on online_kancelar.cenik as PERMISSIVE for ALL to authenticated using ((firma_id IN ( SELECT online_kancelar.moje_firmy() AS moje_firmy))) with check ((firma_id IN ( SELECT online_kancelar.moje_firmy() AS moje_firmy)));

create policy clen_sel on online_kancelar.clenove as PERMISSIVE for SELECT to authenticated using ((user_id = ( SELECT auth.uid() AS uid)));

create policy denik_firma on online_kancelar.denik as PERMISSIVE for ALL to authenticated using ((firma_id IN ( SELECT online_kancelar.moje_firmy() AS moje_firmy))) with check ((firma_id IN ( SELECT online_kancelar.moje_firmy() AS moje_firmy)));

create policy doklady_firma on online_kancelar.doklady as PERMISSIVE for ALL to authenticated using ((firma_id IN ( SELECT online_kancelar.moje_firmy() AS moje_firmy))) with check ((firma_id IN ( SELECT online_kancelar.moje_firmy() AS moje_firmy)));

create policy firmy_sel on online_kancelar.firmy as PERMISSIVE for SELECT to authenticated using ((id IN ( SELECT online_kancelar.moje_firmy() AS moje_firmy)));

create policy firmy_upd on online_kancelar.firmy as PERMISSIVE for UPDATE to authenticated using ((id IN ( SELECT online_kancelar.moje_firmy() AS moje_firmy)));

create policy kontakty_firma on online_kancelar.kontakty as PERMISSIVE for ALL to authenticated using ((firma_id IN ( SELECT online_kancelar.moje_firmy() AS moje_firmy))) with check ((firma_id IN ( SELECT online_kancelar.moje_firmy() AS moje_firmy)));

create policy polozky_firma on online_kancelar.polozky as PERMISSIVE for ALL to authenticated using ((firma_id IN ( SELECT online_kancelar.moje_firmy() AS moje_firmy))) with check ((firma_id IN ( SELECT online_kancelar.moje_firmy() AS moje_firmy)));

create policy zakazky_firma on online_kancelar.zakazky as PERMISSIVE for ALL to authenticated using ((firma_id IN ( SELECT online_kancelar.moje_firmy() AS moje_firmy))) with check ((firma_id IN ( SELECT online_kancelar.moje_firmy() AS moje_firmy)));

CREATE TRIGGER polozky_prepocet AFTER INSERT OR DELETE OR UPDATE ON online_kancelar.polozky FOR EACH ROW EXECUTE FUNCTION online_kancelar.prepocet_dokladu();

CREATE TRIGGER zakazky_touch BEFORE UPDATE ON online_kancelar.zakazky FOR EACH ROW EXECUTE FUNCTION online_kancelar.touch_updated();






-- Práva na funkce (v původním projektu mohl dalsi_cislo spouštět i anon – zde jen přihlášení).
revoke all on function online_kancelar.dalsi_cislo(uuid, text) from public, anon;
revoke all on function online_kancelar.moje_firmy() from public, anon;
revoke all on function online_kancelar.prepocet_dokladu() from public, anon, authenticated;
revoke all on function online_kancelar.touch_updated() from public, anon, authenticated;
revoke all on function online_kancelar.zalozit_firmu(text, text) from public, anon;
grant execute on function online_kancelar.dalsi_cislo(uuid, text) to authenticated;
grant execute on function online_kancelar.moje_firmy() to authenticated;
grant execute on function online_kancelar.zalozit_firmu(text, text) to authenticated;

-- Práva na tabulky (řádky hlídá RLS).
grant select, insert, update, delete on all tables in schema online_kancelar to authenticated;
grant all on all tables in schema online_kancelar to service_role;
