// Moje kancelář – načtení názvu a ceny zboží z odkazu na produkt v e-shopu (Hornbach, Bauhaus, OBI, …).
// Volá ji přihlášený uživatel z editoru dokladu (okno „Z katalogu“ → „Přidat ručně“). Načte jen jednu stránku,
// kterou uživatel sám vložil; výsledek se nikam neukládá.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });

const OVERIT_UZIVATELE = true;

const MJ: Record<string, string> = { MTK: "m²", MTR: "m", MTQ: "m³", KGM: "kg", LTR: "l", C62: "ks", H87: "ks", PCE: "ks", PR: "pár", SET: "sada", TNE: "t", RO: "role", BG: "bal", PK: "bal" };

function dekoduj(s: string) {
  return s.replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).trim();
}
function cislo(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  let s = String(v).replace(/\s| /g, "").replace(/kč|czk|,-$/gi, "");
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(",", ".");
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}
function meta(html: string, klic: string): string | null {
  const re1 = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${klic}["'][^>]*content=["']([^"']*)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name|itemprop)=["']${klic}["']`, "i");
  const m = re1.exec(html) || re2.exec(html);
  return m ? dekoduj(m[1]) : null;
}
function produkty(x: any, out: any[] = []): any[] {
  if (!x || typeof x !== "object") return out;
  if (Array.isArray(x)) { x.forEach((y) => produkty(y, out)); return out; }
  const t = x["@type"]; const typy = Array.isArray(t) ? t : [t];
  if (typy.some((y: string) => /^(Product|ProductGroup|IndividualProduct)$/i.test(String(y)))) out.push(x);
  if (x["@graph"]) produkty(x["@graph"], out);
  if (x.mainEntity) produkty(x.mainEntity, out);
  return out;
}
function nabidka(p: any) {
  let o = p.offers; if (Array.isArray(o)) o = o[0];
  if (!o && Array.isArray(p.hasVariant) && p.hasVariant[0]) { const v = p.hasVariant[0].offers; o = Array.isArray(v) ? v[0] : v; }
  if (!o) return {};
  const ps = Array.isArray(o.priceSpecification) ? o.priceSpecification[0] : o.priceSpecification;
  const cena = cislo(o.price ?? o.lowPrice ?? ps?.price);
  const mena = o.priceCurrency || ps?.priceCurrency || null;
  const jed = ps?.unitCode || ps?.referenceQuantity?.unitCode || o.unitCode || null;
  return { cena, mena, mj: jed ? (MJ[String(jed).toUpperCase()] || null) : null };
}
function rozeber(html: string, url: URL) {
  const vysl: Record<string, unknown> = { obchod: url.hostname.replace(/^www\./, ""), odkaz: url.toString() };
  const ld = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of ld) {
    let j: unknown; try { j = JSON.parse(m[1].trim()); } catch { continue; }
    const p = produkty(j)[0]; if (!p) continue;
    const n = nabidka(p);
    vysl.nazev = p.name ? dekoduj(String(p.name)) : undefined;
    vysl.cena = n.cena; vysl.mena = n.mena; vysl.mj = n.mj;
    vysl.ean = p.gtin13 || p.gtin || p.gtin14 || p.gtin8 || undefined;
    vysl.kod = p.sku || p.mpn || p.productID || undefined;
    vysl.znacka = typeof p.brand === "string" ? p.brand : p.brand?.name;
    const img = Array.isArray(p.image) ? p.image[0] : p.image; vysl.foto = typeof img === "string" ? img : img?.url;
    if (vysl.nazev && vysl.cena != null) break;
  }
  vysl.nazev ||= meta(html, "og:title") || (/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") ?? null) ||
    (/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? null);
  if (typeof vysl.nazev === "string") vysl.nazev = dekoduj(vysl.nazev).replace(/\s*[|–-]\s*(HORNBACH|BAUHAUS|OBI)[^|]*$/i, "").trim();
  if (vysl.cena == null) {
    vysl.cena = cislo(meta(html, "product:price:amount") || meta(html, "og:price:amount") || meta(html, "price") ||
      (/itemprop=["']price["'][^>]*content=["']([\d.,\s]+)["']/i.exec(html)?.[1] ?? null));
    vysl.mena ||= meta(html, "product:price:currency") || meta(html, "og:price:currency") || meta(html, "priceCurrency");
  }
  vysl.foto ||= meta(html, "og:image");
  return vysl;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, chyba: "Jen POST." }, 405);
  if (OVERIT_UZIVATELE) {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data, error } = token ? await sb.auth.getUser(token) : { data: { user: null }, error: true };
    if (error || !data?.user) return json({ ok: false, chyba: "Přihlaste se prosím." }, 401);
  }
  let url: URL;
  try { const b = await req.json(); url = new URL(String(b.url || "").trim()); } catch { return json({ ok: false, chyba: "Neplatný odkaz." }, 400); }
  if (!/^https?:$/.test(url.protocol) || url.port || url.username || /^(localhost|.*\.local|.*\.internal)$/i.test(url.hostname) ||
      /^[\d.]+$/.test(url.hostname) || url.hostname.includes(":") || !url.hostname.includes("."))
    return json({ ok: false, chyba: "Odkaz musí vést na veřejný e-shop (https://…)." }, 400);
  try {
    const r = await fetch(url, {
      redirect: "follow", signal: AbortSignal.timeout(12000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml", "Accept-Language": "cs-CZ,cs;q=0.9",
      },
    });
    if (!r.ok) return json({ ok: false, chyba: `Obchod stránku nevydal (HTTP ${r.status}).`, stav: r.status });
    const html = (await r.text()).slice(0, 3_000_000);
    const titulek = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] || "";
    if (/client challenge|just a moment|attention required|captcha|access denied|are you a robot/i.test(titulek))
      return json({ ok: false, blokovano: true, chyba: "Tento obchod nedovoluje automatické načtení stránky – název jsem vzal z odkazu, cenu prosím doplňte ručně." });
    const v = rozeber(html, new URL(r.url || url.toString()));
    if (!v.nazev && v.cena == null) return json({ ok: false, chyba: "Na stránce jsem nenašel název ani cenu zboží." });
    return json({ ok: true, ...v });
  } catch (e) {
    return json({ ok: false, chyba: "Stránku se nepodařilo načíst: " + (e instanceof Error ? e.message : String(e)) });
  }
});
