# Moje kancelář – YeY

Nová online verze YeY – Kancelář pro řemeslníky. Nahradí původní YeY (repo `YeY-WEB`, yey.cz), včetně převodu firem a licencí.

## Struktura

| Složka | Obsah |
|---|---|
| `web/` | Aplikace. Jediná složka, kterou zveřejňuje Cloudflare (kancelar.yey.cz). Statické soubory, bez build kroku. |
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
