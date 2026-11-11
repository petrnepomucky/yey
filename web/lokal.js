/* =====================================================================
   YeY – místní režim (bez registrace): data zůstávají v prohlížeči.

   1) Místní databáze: napodobuje tu část rozhraní supabase-js, kterou aplikace používá
      (from → select / insert / update / delete / upsert, eq, in, order, limit, single; rpc),
      a dělá i to, co v cloudu dělá databáze: výchozí hodnoty sloupců, přepočet součtů dokladu,
      číselné řady (dalsi_cislo) a úklid navázaných řádků při mazání.
      Ukládá se do localStorage a zároveň do IndexedDB (bez limitu velikosti – logo, podpis).
   2) Převod dat ze starší verze YeY (yey.html: klíč yey_odhad_data_v1 / IndexedDB yey-odhad-store).
      Stará data se jen čtou, nikdy se nemažou ani nepřepisují.
   3) Záloha do souboru a obnova ze zálohy (nový i starý formát).
   ===================================================================== */
(function (global) {
'use strict';

const KLIC = 'yey_kancelar_v2';                       // localStorage – jiný klíč než starší verze (yey_odhad_data_v1)
const IDB_NAZEV = 'yey-kancelar', IDB_SKLAD = 'kv';
const STARY_KLIC = 'yey_odhad_data_v1', STARA_IDB = 'yey-odhad-store';
const TABULKY = ['firmy', 'kontakty', 'zakazky', 'doklady', 'polozky', 'cenik', 'denik'];

let D = null;                 // { verze, _ulozeno, tab: { firmy: [...], ... }, meta: {} }
let pamet = null;             // úložiště (v prohlížeči localStorage; v testech náhrada)
let naZmenu = null;           // zavolá se, když data změnila jiná karta prohlížeče
let naChybu = null;           // zavolá se, když se data nepodařilo uložit

const ted = () => new Date().toISOString();
const dnes = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const uuid = () => (global.crypto && crypto.randomUUID) ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
const kopie = o => o == null ? o : JSON.parse(JSON.stringify(o));
const cislo = v => { const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : 0; };
/** Zaokrouhlení na haléře stejně jako numeric v Postgresu (od nuly). */
const r2 = v => { const s = v < 0 ? -1 : 1; return s * Math.round((Math.abs(v) + 1e-9) * 100) / 100; };

function prazdna() { const tab = {}; TABULKY.forEach(t => { tab[t] = []; }); return { verze: 2, _ulozeno: '', tab, meta: {} }; }
function srovnej(d) {
  const z = prazdna(); if (!d || typeof d !== 'object') return z;
  z._ulozeno = String(d._ulozeno || ''); z.meta = (d.meta && typeof d.meta === 'object') ? d.meta : {};
  TABULKY.forEach(t => { if (d.tab && Array.isArray(d.tab[t])) z.tab[t] = d.tab[t].filter(r => r && typeof r === 'object'); });
  return z;
}

/* ---------- IndexedDB ---------- */
function idbOtevri(nazev) {
  return new Promise((res, rej) => {
    if (!global.indexedDB) return rej(new Error('IndexedDB není k dispozici'));
    const r = indexedDB.open(nazev, 1);
    // Sklad se zakládá stejně jako ve starší verzi (kv), aby otevření neexistující databáze nic nerozbilo.
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(IDB_SKLAD)) r.result.createObjectStore(IDB_SKLAD); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbCti(nazev, klic) {
  const db = await idbOtevri(nazev);
  try { return await new Promise((res, rej) => { const q = db.transaction(IDB_SKLAD, 'readonly').objectStore(IDB_SKLAD).get(klic); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
  finally { db.close(); }
}
async function idbPis(nazev, klic, v) {
  const db = await idbOtevri(nazev);
  try { await new Promise((res, rej) => { const t = db.transaction(IDB_SKLAD, 'readwrite'); t.objectStore(IDB_SKLAD).put(v, klic); t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); }
  finally { db.close(); }
}

/* ---------- ukládání ---------- */
let casovac = null, ceka = false;
function uloz() { D._ulozeno = ted(); ceka = true; clearTimeout(casovac); casovac = setTimeout(zapis, 120); }
function zapis() {
  if (!ceka || !D) return; ceka = false; clearTimeout(casovac);
  let t = ''; try { t = JSON.stringify(D); } catch (e) { return; }
  let okLS = true;
  try { pamet.setItem(KLIC, t); } catch (e) { okLS = false; try { pamet.removeItem(KLIC); } catch (_) { } }
  if (global.indexedDB) idbPis(IDB_NAZEV, 'data', t).catch(() => { if (!okLS && naChybu) naChybu(); });
  else if (!okLS && naChybu) naChybu();
}

async function init(opt) {
  opt = opt || {};
  pamet = opt.pamet || global.localStorage; naZmenu = opt.naZmenu || null; naChybu = opt.naChybu || null;
  let a = null, b = null;
  try { const t = pamet.getItem(KLIC); a = t ? JSON.parse(t) : null; } catch (e) { a = null; }
  if (global.indexedDB && !opt.bezIdb) { try { const t = await idbCti(IDB_NAZEV, 'data'); b = typeof t === 'string' ? JSON.parse(t) : null; } catch (e) { b = null; } }
  const d = !a ? b : !b ? a : (String(b._ulozeno || '') > String(a._ulozeno || '') ? b : a);
  D = srovnej(d);
  if (global.addEventListener && !init.hotovo) {
    init.hotovo = true;
    global.addEventListener('pagehide', zapis);
    if (global.document) document.addEventListener('visibilitychange', () => { if (document.hidden) zapis(); });
    global.addEventListener('storage', e => {
      if (e.key !== KLIC || !e.newValue || ceka || !D) return;
      try { const n = JSON.parse(e.newValue); if (String(n._ulozeno || '') > String(D._ulozeno || '')) { D = srovnej(n); if (naZmenu) naZmenu(); } } catch (_) { }
    });
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (_) { }   // ať prohlížeč data sám nesmaže
  }
}

/* ---------- firma (v místním režimu právě jedna) ---------- */
function firma() {
  let f = D.tab.firmy[0];
  if (!f) { f = vychozi('firmy', {}); D.tab.firmy.push(f); uloz(); }
  return f;
}

/* ---------- výchozí hodnoty sloupců (stejné jako v databázi) ---------- */
const VYCHOZI = {
  firmy: () => ({ nazev: 'Moje firma', ico: null, dic: null, platce_dph: false, ulice: null, mesto: null, psc: null, email: null, telefon: null, web: null, ucet: null, iban: null,
    splatnost_dni: 14, zapis: null, created_at: ted(), licence: null, logo: null, logo_text: null, podpis: null, hlidat_ceny: true, cisla: {}, banka: null, swift: null, sod_sablona: null }),
  kontakty: () => ({ typ: 'klient', osoba: null, ico: null, dic: null, ulice: null, mesto: null, psc: null, email: null, telefon: null, poznamka: null, created_at: ted() }),
  zakazky: () => ({ kontakt_id: null, adresa: null, faze: 'nabidka', termin: null, postup: 0, poznamka: null, created_at: ted(), updated_at: ted() }),
  doklady: () => ({ zakazka_id: null, kontakt_id: null, zdroj_id: null, stav: 'koncept', datum: dnes(), splatnost: null, duzp: null, vs: null, predmet: null, poznamka: null,
    forma_uhrady: 'převodem', zaplaceno_dne: null, celkem_bez: 0, celkem_dph: 0, created_at: ted(), pdp: false, tisk_rezim: 'polozky', souhrn_text: null, objednavka: null, udaje: null }),
  polozky: () => ({ poradi: 0, nazev: '', mnozstvi: 1, mj: 'ks', cena: 0, dph: 21, kat: null }),
  cenik: () => ({ mj: 'm²', cena: 0, dph: 21, kategorie: null }),
  denik: () => ({ created_at: ted() })
};
function vychozi(t, r) { const o = Object.assign({ id: uuid() }, VYCHOZI[t](), r); if (!o.id) o.id = uuid(); return o; }

/* ---------- to, co v cloudu dělají triggery ---------- */
function prepocet(dokladId) {
  const d = D.tab.doklady.find(x => x.id === dokladId); if (!d) return;
  const pol = D.tab.polozky.filter(p => p.doklad_id === dokladId);
  d.celkem_bez = r2(pol.reduce((s, p) => s + r2(cislo(p.mnozstvi) * cislo(p.cena)), 0));
  d.celkem_dph = d.pdp ? 0 : r2(pol.reduce((s, p) => s + r2(cislo(p.mnozstvi) * cislo(p.cena) * cislo(p.dph) / 100), 0));
}
function poZmene(t, radky, zmena) {
  if (t === 'polozky') new Set(radky.map(r => r.doklad_id)).forEach(prepocet);
  if (t === 'doklady' && zmena && 'pdp' in zmena) radky.forEach(r => prepocet(r.id));
  if (t === 'zakazky' && zmena) radky.forEach(r => { r.updated_at = ted(); });
}
function poSmazani(t, radky) {
  const ids = new Set(radky.map(r => r.id)), T = D.tab;
  if (t === 'polozky') new Set(radky.map(r => r.doklad_id)).forEach(prepocet);
  if (t === 'doklady') { T.polozky = T.polozky.filter(p => !ids.has(p.doklad_id)); T.doklady.forEach(d => { if (ids.has(d.zdroj_id)) d.zdroj_id = null; }); }
  if (t === 'zakazky') { T.denik = T.denik.filter(x => !ids.has(x.zakazka_id)); T.doklady.forEach(d => { if (ids.has(d.zakazka_id)) d.zakazka_id = null; }); }
  if (t === 'kontakty') { T.doklady.forEach(d => { if (ids.has(d.kontakt_id)) d.kontakt_id = null; }); T.zakazky.forEach(z => { if (ids.has(z.kontakt_id)) z.kontakt_id = null; }); }
}

/* ---------- číselné řady – stejná logika jako funkce dalsi_cislo v databázi ---------- */
const RADA_VYCHOZI = { nabidka: 'N{RRRR}{NNN}', faktura: 'F{RRRR}{NNN}', zalohova: 'Z{RRRR}{NNN}', smlouva: 'SOD{RRRR}{NNN}', dobropis: 'D{RRRR}{NNN}' };
function dalsiCislo(typ) {
  const F = firma(), d = new Date(), rok = d.getFullYear();
  const cfg = (F.cisla && F.cisla[typ]) || {};
  const fmt = cfg.fmt || RADA_VYCHOZI[typ] || 'P{RRRR}{NNN}';
  const datumDo = s => s.replace(/\{RRRR\}/g, String(rok)).replace(/\{RR\}/g, String(rok).slice(2)).replace(/\{MM\}/g, String(d.getMonth() + 1).padStart(2, '0'));
  let n = (cfg.dalsi == null || cfg.dalsi === '') ? null : parseInt(cfg.dalsi, 10); if (!isFinite(n)) n = null;
  if (n != null && /\{RR/.test(fmt) && Number(cfg.rok == null ? rok : cfg.rok) !== rok) n = 1;
  if (n == null) {
    const pre = datumDo(fmt).replace(/\{N+\}[\s\S]*$/, '');
    let max = 0;
    D.tab.doklady.forEach(x => { if (x.typ !== typ || !String(x.cislo || '').startsWith(pre)) return; const c = parseInt(String(x.cislo).slice(pre.length).replace(/\D/g, ''), 10); if (isFinite(c) && c > max) max = c; });
    n = max + 1;
  }
  const mist = Math.max(((fmt.match(/\{(N+)\}/) || [])[1] || '').length, 1);
  let kand;
  for (;;) {
    kand = datumDo(fmt).replace(/\{N+\}/, '__N__').split('__N__').join(String(n).padStart(mist, '0'));
    if (!D.tab.doklady.some(x => x.cislo === kand)) break;
    n++;
  }
  F.cisla = Object.assign({}, F.cisla); F.cisla[typ] = Object.assign({}, F.cisla[typ], { fmt, dalsi: n + 1, rok });
  uloz();
  return kand;
}

/* ---------- dotaz (stejné řetězení jako supabase-js) ---------- */
function Dotaz(t) { this.t = t; this.op = 'select'; this.f = []; this.vrat = true; this.jeden = false; this.raz = []; this.lim = null; }
Dotaz.prototype = {
  select() { this.vrat = true; return this; },
  insert(r) { this.op = 'insert'; this.radky = r; this.vrat = false; return this; },
  upsert(r) { this.op = 'upsert'; this.radky = r; this.vrat = false; return this; },
  update(z) { this.op = 'update'; this.zmena = z; this.vrat = false; return this; },
  delete() { this.op = 'delete'; this.vrat = false; return this; },
  eq(c, v) { this.f.push(r => r[c] === v); return this; },
  neq(c, v) { this.f.push(r => r[c] !== v); return this; },
  in(c, a) { const s = new Set(a || []); this.f.push(r => s.has(r[c])); return this; },
  order(c, o) { this.raz.push([c, !o || o.ascending !== false]); return this; },
  limit(n) { this.lim = n; return this; },
  single() { this.jeden = true; return this; },
  then(a, b) { return Promise.resolve().then(() => this.proved()).then(a, b); },
  proved() {
    try {
      const T = D.tab[this.t];
      if (!T) return { data: null, error: { message: 'Neznámá tabulka ' + this.t } };
      const sedi = r => this.f.every(fn => fn(r));
      let vys = [];
      if (this.op === 'select') {
        vys = T.filter(sedi);
        this.raz.slice().reverse().forEach(([c, vzest]) => {
          vys = vys.map((r, i) => [r, i]).sort((x, y) => {
            const a = x[0][c], b = y[0][c]; let v;
            if (a == null && b == null) v = 0; else if (a == null) v = 1; else if (b == null) v = -1;
            else if (typeof a === 'number' && typeof b === 'number') v = a - b;
            else v = String(a).localeCompare(String(b), 'cs');
            return (vzest ? v : -v) || x[1] - y[1];
          }).map(x => x[0]);
        });
        if (this.lim != null) vys = vys.slice(0, this.lim);
      } else if (this.op === 'insert') {
        vys = [].concat(this.radky || []).map(r => vychozi(this.t, kopie(r)));
        const dup = vys.find(r => T.some(x => x.id === r.id));
        if (dup) return { data: null, error: { message: 'Záznam s tímto označením už existuje.', code: '23505' } };
        T.push(...vys); poZmene(this.t, vys, null); uloz();
      } else if (this.op === 'upsert') {
        [].concat(this.radky || []).forEach(r0 => {
          const r = kopie(r0), ex = r.id ? T.find(x => x.id === r.id) : null;
          if (ex) { Object.assign(ex, r); vys.push(ex); } else { const n = vychozi(this.t, r); T.push(n); vys.push(n); }
        });
        poZmene(this.t, vys, this.t === 'doklady' ? { pdp: true } : null); uloz();
      } else if (this.op === 'update') {
        vys = T.filter(sedi); const z = kopie(this.zmena || {});
        vys.forEach(r => Object.assign(r, z)); poZmene(this.t, vys, z); uloz();
      } else if (this.op === 'delete') {
        vys = T.filter(sedi); const pryc = new Set(vys);
        D.tab[this.t] = T.filter(r => !pryc.has(r)); poSmazani(this.t, vys); uloz();
      }
      let data = this.vrat ? vys.map(kopie) : null;
      if (this.jeden) {
        if (!data || data.length !== 1) return { data: null, error: { message: 'Záznam nenalezen.', code: 'PGRST116' } };
        data = data[0];
      }
      return { data, error: null };
    } catch (e) { return { data: null, error: { message: (e && e.message) || 'Chyba místní databáze' } }; }
  }
};

/** Náhrada klienta Supabase pro místní režim. Funkce na serveru (načtení zboží z odkazu) se dál volají přes cloudového klienta. */
function klient(cloud) {
  return {
    lokal: true,
    from: t => new Dotaz(t),
    rpc(fn, a) {
      const proved = () => {
        try {
          if (fn === 'dalsi_cislo') return { data: dalsiCislo(a && a.p_typ), error: null };
          if (fn === 'zalozit_firmu') { const f = firma(); if (a && a.p_nazev) f.nazev = a.p_nazev; if (a && a.p_ico) f.ico = a.p_ico; uloz(); return { data: f.id, error: null }; }
          return { data: null, error: { message: 'Funkce ' + fn + ' není v místním režimu k dispozici.' } };
        } catch (e) { return { data: null, error: { message: e.message } }; }
      };
      return { then: (x, y) => Promise.resolve().then(proved).then(x, y) };
    },
    functions: (cloud && cloud.functions) || { invoke: async () => ({ data: null, error: { message: 'Bez připojení.' } }) }
  };
}

/* ---------- přehled o datech ---------- */
function pocty() { const T = D.tab, typ = t => T.doklady.filter(d => d.typ === t).length;
  return { kontakty: T.kontakty.length, zakazky: T.zakazky.length, doklady: T.doklady.length, faktury: typ('faktura') + typ('zalohova') + typ('dobropis'), nabidky: typ('nabidka'), protokoly: typ('protokol'), smlouvy: typ('smlouva'), cenik: T.cenik.length }; }
function maData() { const T = D.tab; return !!(T.kontakty.length || T.doklady.length || T.zakazky.length || T.cenik.length); }

/* ---------- záloha do souboru ---------- */
function zaloha() { const f = D.tab.firmy[0] || {}; return { yeyKancelar: 2, exportovano: ted(), firma: f.nazev || '', ico: f.ico || '', data: kopie(D.tab) }; }
const jeZaloha = o => !!(o && o.yeyKancelar && o.data && typeof o.data === 'object');
const jeStara = o => !!(o && typeof o === 'object' && !o.yeyKancelar && (o.dodavatel || Array.isArray(o.faktury) || Array.isArray(o.kontakty) || Array.isArray(o.nabidky)));
/** Obnova ze zálohy nového formátu. nahradit = true přepíše současná data, jinak se přidá jen to, co tu ještě není. */
function obnov(o, nahradit) {
  if (!jeZaloha(o)) throw new Error('Soubor není záloha YeY.');
  const n = srovnej({ tab: o.data }).tab, pridano = {};
  if (nahradit) {
    const meta = D.meta; D = prazdna(); D.meta = meta; TABULKY.forEach(t => { D.tab[t] = n[t]; pridano[t] = n[t].length; });
    if (D.tab.firmy.length > 1) D.tab.firmy = [D.tab.firmy[0]];
    const fid = firma().id; TABULKY.forEach(t => { if (t !== 'firmy') D.tab[t].forEach(r => { r.firma_id = fid; }); });
  } else {
    const f = firma(), fid = f.id, nf = n.firmy[0];
    if (nf) Object.keys(nf).forEach(k => { if (k !== 'id' && k !== 'created_at' && jePrazdne(f, k) && nf[k] != null && nf[k] !== '') f[k] = nf[k]; });
    TABULKY.forEach(t => { if (t === 'firmy') return; pridano[t] = 0;
      n[t].forEach(r => { if (!r.id || D.tab[t].some(x => x.id === r.id)) return; r.firma_id = fid; D.tab[t].push(r); pridano[t]++; }); });
  }
  D.tab.doklady.forEach(d => prepocet(d.id));
  uloz(); zapis();
  return pridano;
}
function jePrazdne(f, k) { const v = f[k]; if (k === 'nazev') return !v || v === 'Moje firma'; if (k === 'cisla') return !v || !Object.keys(v).length; if (k === 'splatnost_dni') return false; return v == null || v === '' || v === false; }

/* =====================================================================
   PŘEVOD ZE STARŠÍ VERZE YeY (yey.html)
   ===================================================================== */
/** Data starší verze uložená v tomto prohlížeči (novější z localStorage a IndexedDB). Jen čtení. */
async function staraNacti() {
  let a = null, b = null;
  try { const t = (pamet || global.localStorage).getItem(STARY_KLIC); a = t ? JSON.parse(t) : null; } catch (e) { a = null; }
  // IndexedDB starší verze se otevírá jen tehdy, když v prohlížeči po starší verzi něco zbylo (nezakládat ji zbytečně)
  if (global.indexedDB && (a || await staraIdbExistuje())) { try { const t = await idbCti(STARA_IDB, 'dbJson'); b = typeof t === 'string' ? JSON.parse(t) : null; } catch (e) { b = null; } }
  const d = !a ? b : !b ? a : (String(b._ulozeno || '') > String(a._ulozeno || '') ? b : a);
  return jeStara(d) ? d : null;
}
async function staraIdbExistuje() { try { if (!indexedDB.databases) return false; return (await indexedDB.databases()).some(x => x.name === STARA_IDB); } catch (e) { return false; } }
function staraMaData(o) { return !!(o && ((o.kontakty || []).length || (o.cenik || []).length || (o.faktury || []).length || (o.nabidky || []).length || (o.protokoly || []).length
  || (o.dodavatel && (o.dodavatel.nazev || o.dodavatel.ico)) || (o.nastaveni && o.nastaveni.licence))); }

const KAT_POPIS = { material: 'Materiál', prace: 'Práce', doprava: 'Doprava', rezie: 'Režie', ostatni: 'Ostatní', montaz: 'Montáž', demontaz: 'Demontáž' };
const STAV_NAB = { 'Rozpracováno': 'koncept', 'Odesláno': 'odeslano', 'Přijato': 'prijato', 'Odmítnuto': 'odmitnuto' };
const txt = v => { const s = String(v == null ? '' : v).trim(); return s || null; };
const datumIso = v => /^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : null;

/** Převede data starší verze do místní databáze. Přidává jen to, co tu teď není (podle původního označení záznamu),
    takže opakovaný převod nic nezdvojí a nepřepíše, co už bylo v nové verzi upraveno. Vrací počty přidaných záznamů. */
function staraPreved(o) {
  if (!jeStara(o)) throw new Error('Soubor není datový soubor YeY.');
  const M = D.meta.stare = D.meta.stare || {};
  const id = (druh, stare) => { const k = druh + ':' + stare; return M[k] || (M[k] = uuid()); };
  const T = D.tab, F = firma(), fid = F.id, dod = o.dodavatel || {}, nast = o.nastaveni || {};
  const faktury = o.faktury || [], kategorie = {}; (nast.kategorie || []).forEach(k => { if (k && k.key) kategorie[k.key] = k.label; });
  const pridano = { kontakty: 0, faktury: 0, nabidky: 0, protokoly: 0, cenik: 0 };

  /* firma – doplní se jen prázdná pole */
  const platce = faktury.length ? faktury.some(f => f.rezim !== 'neplatce') : !!txt(dod.dic);
  const fNova = { nazev: txt(dod.nazev), ico: txt(dod.ico), dic: txt(dod.dic), ulice: txt(dod.ulice), mesto: txt(dod.mesto), psc: txt(dod.psc), telefon: txt(dod.tel), email: txt(dod.email),
    banka: txt(dod.banka), ucet: txt(dod.ucet), iban: txt(dod.iban), swift: txt(dod.swift), zapis: txt(dod.rejstrik), logo_text: txt(dod.claim), logo: txt(dod.logo), podpis: txt(dod.podpis),
    licence: txt(nast.licence), platce_dph: platce || null };
  Object.keys(fNova).forEach(k => { if (fNova[k] != null && jePrazdne(F, k)) F[k] = fNova[k]; });
  if (!D.meta.prevedeno) {
    // nastavení se přebírá jen při prvním převodu, později by přepsalo to, co si uživatel v nové verzi změnil
    if (nast.splatnost != null && nast.splatnost !== '') F.splatnost_dni = nast.splatnost === 'mesic' ? 30 : (parseInt(nast.splatnost, 10) || 14); else F.splatnost_dni = 30;
    if (nast.hlidatCeny != null) F.hlidat_ceny = !!nast.hlidatCeny;
    const rok = new Date().getFullYear(), fm = o.formaty || {}, cr = o.cislaRady || {}, cisla = Object.assign({}, F.cisla);
    ['faktura', 'zalohova', 'dobropis', 'nabidka', 'protokol'].forEach(t => {
      let fmt = txt(fm[t]); if (!fmt && (t === 'zalohova' || t === 'dobropis') && txt(fm.faktura)) fmt = (t === 'zalohova' ? 'Z9' : 'D8') + fm.faktura;
      if (!fmt) return; const n = parseInt(cr[t], 10);
      cisla[t] = Object.assign({}, cisla[t], { fmt }, n > 0 ? { dalsi: n, rok } : {});
    });
    cisla.protokol = Object.assign({}, cisla.protokol, { dle_faktury: nast.prCisloFa == null ? true : !!nast.prCisloFa, prefix: nast.prPrefix == null ? 'P' : String(nast.prPrefix) });
    F.cisla = cisla;
  }

  /* kontakty */
  (o.kontakty || []).forEach(k => {
    if (!k || !k.id) return; const nid = id('k', k.id); if (T.kontakty.some(x => x.id === nid)) return;
    const pozn = [txt(k.pozn), k.typ ? 'Typ odběratele: ' + k.typ : null, Number(k.index) ? 'Cenový index: ' + String(k.index).replace('.', ',') : null].filter(Boolean).join('\n');
    T.kontakty.push(vychozi('kontakty', { id: nid, firma_id: fid, typ: 'klient', nazev: txt(k.nazev) || 'Bez názvu', osoba: txt(k.osoba), ico: txt(k.ico), dic: txt(k.dic),
      ulice: txt(k.ulice), mesto: txt(k.mesto), psc: txt(k.psc), email: txt(k.email), telefon: txt(k.tel), poznamka: pozn || null }));
    pridano.kontakty++;
  });
  const kontakt = stare => stare && M['k:' + stare] && T.kontakty.some(x => x.id === M['k:' + stare]) ? M['k:' + stare] : null;

  /* ceník prací */
  (o.cenik || []).forEach(c => {
    if (!c || !c.id || !txt(c.nazev)) return; const nid = id('c', c.id); if (T.cenik.some(x => x.id === nid)) return;
    T.cenik.push(vychozi('cenik', { id: nid, firma_id: fid, nazev: txt(c.nazev), mj: txt(c.mj) || 'ks', cena: r2(cislo(c.cena)), dph: 21, kategorie: kategorie[c.kategorie] || KAT_POPIS[c.kategorie] || txt(c.kategorie) }));
    pridano.cenik++;
  });

  /* doklady */
  const vznik = (datum, i) => (datumIso(datum) || dnes()) + 'T12:' + String(Math.floor(i / 60) % 60).padStart(2, '0') + ':' + String(i % 60).padStart(2, '0') + '.000Z';
  const polozky = (dokladId, pol, dph, sCenou) => (pol || []).forEach((p, i) => {
    if (!p) return; const sleva = cislo(p.sleva), c0 = sCenou ? cislo(p.cena) : 0, c = sleva ? r2(c0 * (1 - sleva / 100)) : r2(c0);
    T.polozky.push(vychozi('polozky', { doklad_id: dokladId, firma_id: fid, poradi: i, nazev: (txt(p.nazev) || '') + (sleva && sCenou ? ' (po slevě ' + String(sleva).replace('.', ',') + ' %)' : ''),
      mnozstvi: Math.round(cislo(p.mnozstvi) * 1000) / 1000, mj: txt(p.mj) || 'ks', cena: c, dph: dph(p), kat: txt(p.kat) }));
  });
  const novyDoklad = (druh, stare, o1) => { const nid = id(druh, stare); if (T.doklady.some(x => x.id === nid)) return null; const d = vychozi('doklady', Object.assign({ id: nid, firma_id: fid }, o1)); T.doklady.push(d); return d; };

  (o.nabidky || []).forEach((n, i) => {
    if (!n || !n.id) return;
    const d = novyDoklad('n', n.id, { typ: 'nabidka', cislo: txt(n.cislo) || ('N-' + (i + 1)), kontakt_id: kontakt(n.kontaktId), stav: STAV_NAB[n.stav] || 'koncept', datum: datumIso(n.datum) || dnes(),
      splatnost: datumIso(n.platnostDo), predmet: txt(n.predmet), poznamka: txt(n.pozn), created_at: vznik(n.datum, i) });
    if (!d) return; polozky(d.id, n.polozky, () => platce ? 21 : 0, true); pridano.nabidky++;
  });
  faktury.forEach((f, i) => {
    if (!f || !f.id) return;
    const typ = f.typ === 'zalohova' ? 'zalohova' : f.typ === 'dobropis' ? 'dobropis' : 'faktura', zapl = f.stav === 'Zaplacená';
    const d = novyDoklad('f', f.id, { typ, cislo: txt(f.cislo) || ('F-' + (i + 1)), kontakt_id: kontakt(f.kontaktId), stav: zapl ? 'zaplaceno' : 'odeslano',
      datum: datumIso(f.datumVystaveni) || dnes(), duzp: datumIso(f.duzp), splatnost: datumIso(f.splatnost), vs: txt(f.vs) || String(f.cislo || '').replace(/\D/g, '') || null, objednavka: txt(f.objednavka),
      forma_uhrady: (txt(f.formaUhrady) || 'převodem').toLowerCase(), zaplaceno_dne: zapl ? (datumIso(f.datumUhrady) || datumIso(f.datumVystaveni)) : null, predmet: txt(f.akce), poznamka: txt(f.pozn),
      pdp: f.rezim === 'pdp', udaje: typ === 'dobropis' ? { duvod: txt(f.duvod) || '' } : null, created_at: vznik(f.datumVystaveni, i) });
    if (!d) return;
    polozky(d.id, f.polozky, p => f.rezim === 'neplatce' ? 0 : (p.sazba == null || p.sazba === '' ? 21 : cislo(p.sazba)), true); pridano.faktury++;
  });
  (o.protokoly || []).forEach((p, i) => {
    if (!p || !p.id) return;
    const pozn = [p.misto ? 'Místo předání: ' + p.misto : null, p.stavDila === 'vyhrady' ? 'Dílo předáno s výhradami.' : null, txt(p.vady), txt(p.predano) ? 'Předáno: ' + p.predano : null, txt(p.pozn)].filter(Boolean).join('\n');
    const d = novyDoklad('p', p.id, { typ: 'protokol', cislo: txt(p.cislo) || ('P-' + (i + 1)), kontakt_id: kontakt(p.kontaktId), stav: 'koncept', datum: datumIso(p.datumPredani) || dnes(),
      predmet: txt(p.predmet), objednavka: txt(p.objednavka), poznamka: pozn || null, created_at: vznik(p.datumPredani, i) });
    if (!d) return; polozky(d.id, p.polozky, () => 0, false); pridano.protokoly++;
  });
  /* vazby mezi doklady (faktura z nabídky, dobropis k faktuře, protokol k faktuře) – až když existují obě strany */
  const dok = (druh, stare) => { const n = stare && M[druh + ':' + stare]; return n && T.doklady.some(x => x.id === n) ? n : null; };
  const vazba = (druh, stare, cil) => { const n = M[druh + ':' + stare], d = n && T.doklady.find(x => x.id === n); if (d && !d.zdroj_id && cil && cil !== d.id) d.zdroj_id = cil; };
  faktury.forEach(f => { if (f && f.id) vazba('f', f.id, f.typ === 'dobropis' ? dok('f', f.puvodni && f.puvodni.id) : dok('n', f.zNabidky)); });
  (o.protokoly || []).forEach(p => { if (p && p.id) vazba('p', p.id, dok('f', p.zFaktury) || dok('n', p.zNabidky)); });

  T.doklady.forEach(d => prepocet(d.id));
  D.meta.prevedeno = D.meta.prevedeno || ted();
  D.meta.stareCas = String(o._ulozeno || '');          // podle toho se pozná, že starší verze má od převodu novější data
  uloz(); zapis();
  return pridano;
}

global.YeyLokal = {
  init, klient, firma, pocty, maData, zaloha, obnov, jeZaloha, jeStara, uloz: () => { uloz(); zapis(); },
  meta: () => D.meta, zapisMeta(k, v) { D.meta[k] = v; uloz(); },
  stara: { nacti: staraNacti, maData: staraMaData, preved: staraPreved },
  _test: { dalsiCislo, prepocet, r2, data: () => D }
};
})(typeof window !== 'undefined' ? window : globalThis);
