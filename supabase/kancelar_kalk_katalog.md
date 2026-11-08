# Kalkulačky a katalog

- Kalkulačky jsou modul `web/kalk.js`, převzatý **beze změny** z yey.cz (repo YeY-WEB, `yey.html`, `<script id="yey-kalk">`).
  Při úpravě kalkulaček na yey.cz stačí modul znovu zkopírovat sem – Moje kancelář mu jen předává adaptér (`kalkAdapter` v `web/index.html`).
- Katalog, hledané výrazy (`yey_kalk_hledani`), schválené produkty (`yey_kalk_vyber`) a přepočty jednotek (`prevody_schvalene`, `prevod_navrh`)
  jsou v projektu **Stavební materiál** – stejné jako pro yey.cz, takže Správa databáze (dbadmin) ladí obě aplikace najednou.
- Licenční klíč je ve sloupci `online_kancelar.firmy.licence`; aplikace ho pošle funkci `katalog-pristup` a dostane token na plný katalog.
  Bez licence kalkulačky počítají množství a cenu bere z vlastního ceníku (stejně jako yey.cz bez licence).
- Tabulka `kancelar_kalk` (dřívější vlastní přiřazení) se už nepoužívá.
