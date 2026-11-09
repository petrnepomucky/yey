-- Režim tisku položek na dokladu: položkově / souhrnně / souhrnně + rozpis v příloze
alter table online_kancelar.doklady
  add column if not exists tisk_rezim text not null default 'polozky',
  add column if not exists souhrn_text text;
alter table online_kancelar.doklady drop constraint if exists doklady_tisk_rezim_check;
alter table online_kancelar.doklady add constraint doklady_tisk_rezim_check check (tisk_rezim in ('polozky','souhrn','souhrn_priloha'));
