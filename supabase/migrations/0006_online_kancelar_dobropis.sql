-- Dobropis (opravný daňový doklad) jako typ dokladu, výchozí řada D{RRRR}{NNN} v dalsi_cislo()
alter table online_kancelar.doklady drop constraint if exists doklady_typ_check;
alter table online_kancelar.doklady add constraint doklady_typ_check check (typ in ('nabidka','faktura','zalohova','protokol','smlouva','dobropis'));
