-- Kategorie položek (jako yey.cz), banka a SWIFT dodavatele, číslo objednávky, tisk po kategoriích
alter table online_kancelar.polozky add column if not exists kat text;
alter table online_kancelar.firmy add column if not exists banka text, add column if not exists swift text;
alter table online_kancelar.doklady add column if not exists objednavka text;
alter table online_kancelar.doklady drop constraint if exists doklady_tisk_rezim_check;
alter table online_kancelar.doklady add constraint doklady_tisk_rezim_check check (tisk_rezim in ('polozky','kategorie','souhrn','souhrn_priloha'));
