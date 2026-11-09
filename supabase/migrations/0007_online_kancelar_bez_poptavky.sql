-- Fáze Poptávka zrušena: zakázky začínají ve fázi Nabídka
update online_kancelar.zakazky set faze = 'nabidka' where faze = 'poptavka';
alter table online_kancelar.zakazky alter column faze set default 'nabidka';
