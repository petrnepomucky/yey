# Napojení kalkulaček na katalog

- Přiřazení řádků kalkulaček k produktům je v projektu **Stavební materiál**, tabulka `public.kancelar_kalk`
  (kalk, radek = začátek názvu řádku, skupina = skupina/podskupina katalogu, slova, bez = vyloučená slova oddělená |, vychozi_kod).
- Aplikace volá `katalog_dotaz` a `katalog_podle_kodu_vse`. Bez licence vrací jen bezplatnou část katalogu.
- Licenční klíč je ve sloupci `online_kancelar.firmy.licence`. Aplikace ho pošle funkci `katalog-pristup`
  (projekt Stavební materiál) a dostane token na plný katalog (max. 7 dní, uloží se v prohlížeči).
- Cena/MJ se předvyplní jen tehdy, když jednotka produktu odpovídá jednotce výpočtu (pytel/kbelík/role = ks).
