-- Smlouva o dílo jako nový typ dokladu, údaje smlouvy (jsonb), vlastní šablona firmy, výchozí číselná řada SOD{RRRR}{NNN}
alter table online_kancelar.doklady drop constraint if exists doklady_typ_check;
alter table online_kancelar.doklady add constraint doklady_typ_check check (typ in ('nabidka','faktura','zalohova','protokol','smlouva'));
alter table online_kancelar.doklady add column if not exists udaje jsonb;
alter table online_kancelar.firmy add column if not exists sod_sablona text;
-- dalsi_cislo(): přidána výchozí řada 'smlouva' → 'SOD{RRRR}{NNN}' (celá funkce viz databáze)
