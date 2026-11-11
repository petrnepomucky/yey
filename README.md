# YeY – Kancelář pro řemeslníky

Jedna aplikace pro všechny: nahrazuje původní YeY (repo `YeY-WEB`, soubor `yey.html`) i dřívější „Moje kancelář“.

## Rozsah

| | Co obsahuje |
|---|---|
| **Zdarma, bez registrace** | Faktury (i dobropis), předávací protokol k faktuře, kontakty, údaje firmy. Data jsou v prohlížeči (`web/lokal.js`), záloha do souboru. |
| **Licence (Kancelář)** | Zakázky, nabídky, smlouvy o dílo, zálohové faktury, dílčí protokoly, kalkulačky, ceník prací, Excel, vlastní číselné řady. |
| **Doplněk Materiál** | Katalog materiálu a zboží z hobbymarketů. Licence bez seznamu `moduly` (všechny dosud vydané) mají doplňky v ceně. |

Co je zdarma a co s licencí, určuje jediná tabulka `ROZSAH` v `web/index.html`. Licenční klíč má stejný formát i podpis jako v původní YeY, dříve vydané licence platí.

## Dva režimy uložení

- **Bez účtu**: data v prohlížeči (localStorage + IndexedDB, klíč `yey_kancelar_v2`). `lokal.js` napodobuje rozhraní supabase-js, takže zbytek aplikace je stejný.
- **S účtem**: data v Supabase (schéma `online_kancelar`).

## Převod z původní YeY

Běží-li aplikace na stejné doméně jako původní `yey.html` (yey.cz/app/), při prvním spuštění sama převezme data z klíče `yey_odhad_data_v1` (firma, kontakty, ceník, nabídky, faktury, protokoly, číselné řady, licence). Původní data jen čte, nikdy je nemění. Zálohu (JSON) z původní verze jde také načíst přes „Obnovit ze zálohy“.

## Kde běží

- **kancelar.yey.cz** – z tohoto repa (Cloudflare, složka `web/`).
- **yey.cz/app/** – kopie složky `web/` v repu `YeY-WEB` (složka `app/`). Měnit jen tady a pak zkopírovat: `cp -r web/. ../yey-web/app/`.

## Struktura

| Složka | Obsah |
|---|---|
| `web/` | Aplikace (jeden soubor `index.html`, převzatý z repa `live`). Jediná složka, kterou zveřejňuje Cloudflare (kancelar.yey.cz). Bez build kroku. |
| `supabase/migrations/` | SQL migrace schématu `online_kancelar`. |
| `archiv/` | Dřívější obsah repa (React prototyp z 4. 11. 2026). Nezveřejňuje se. |

## Databáze


- Supabase projekt **YeY - Online Office** (`hkzhjoveiqadezmvksdz`), schéma **`online_kancelar`**.
- Tabulky původního YeY v `public` zůstávají beze změny, dokud neproběhne převod.
- Přihlašovací účty (Supabase Auth) jsou společné, uživatelé původního YeY se přihlásí stejným e-mailem a heslem.
- Katalog materiálu je v projektu **Stavební materiál** (`fvrpuddkarujfttoaavb`), vazba přes kód položky.
- Schéma je potřeba povolit v Supabase → Project Settings → Data API → **Exposed schemas** (přidat `online_kancelar`).

## Nasazení (Cloudflare Workers, statické soubory)

- Repo: `petrnepomucky/yey`, větev `main`, projekt v Cloudflare se jmenuje **yey**
- Konfigurace je v `wrangler.jsonc` (zveřejňuje složku `web/`), Build command prázdný, Deploy command `npx wrangler deploy`
- Vlastní doména: **kancelar.yey.cz**
- Supabase → Authentication → URL Configuration: přidat `https://kancelar.yey.cz` do Redirect URLs.
