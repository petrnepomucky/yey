# Kancelář řemeslníků online

Webová aplikace (React + Vite + Supabase) pro evidenci dokladů, kontaktů a zakázek řemeslníků.
Ovládání z klávesnice, dole lišta funkčních kláves F1–F10 jako v MS-DOS aplikacích.

## Spuštění

    cp .env.example .env   # doplňte VITE_SUPABASE_PUBLISHABLE_KEY (Supabase → Project Settings → API)
    npm install
    npm run dev

Databázové schéma (migrace) je nasazené v Supabase projektu `vgpnrlgisqcdkrzhhfsy`.
