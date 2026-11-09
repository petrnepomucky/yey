/* Kalkulačky YeY – modul převzatý beze změny z yey.cz (repo YeY-WEB, yey.html, <script id="yey-kalk">), 2026-11-08. */
/* =====================================================================
   YeY – kalkulačky spotřeby materiálu
   Společný modul pro online i offline verzi. Aplikace mu předá adaptér:
     katalogDostupny()          -> bool
     hledej(dotaz, pocet)       -> Promise<[{kod,nazev,mj,cena,hmotnost,naPalete,vBaleni,rozmer,foto,ean,tema,skupina}]>
     zasoby(kody)               -> Promise<{kod:{malesice:{zasoba,mj,cena,cislo}, liben:{…}}}>
     cenik()                    -> [{id,kod,nazev,mj,cena,typ}]     (kod = kód katalogu, cena = prodej bez DPH)
     cilDokladu()               -> text nebo null (kam se bude vkládat)
     doDokladu(radky, meta)     -> Promise   (radky: {typ,nazev,mj,mnozstvi,cena,nakup,prirazka,katKod,cenikId,sazba_dph,poznamka,tema,skupina,ean,foto})
     toast(text, chyba)
     pamet {cti(k,v), pis(k,v)}
     vychoziPrirazka            -> číslo
   ===================================================================== */
(function (global) {
'use strict';

/* ---------- pomocné ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cis = v => { if (typeof v === 'number') return Number.isFinite(v) ? v : null; const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const zaok = n => Math.round(n * 100) / 100;
const f3 = n => Number(n).toLocaleString('cs-CZ', { maximumFractionDigits: 3 });
const kc = n => (n == null || !Number.isFinite(Number(n))) ? '–' : Number(n).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Kč';
const kc0 = n => Math.round(Number(n) || 0).toLocaleString('cs-CZ') + ' Kč';
const vp = n => (n == null || !Number.isFinite(Number(n))) ? '' : String(zaok(Number(n))).replace('.', ',');
const bezDia = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const nahoru = x => Math.ceil(x - 1e-9);
const MJ = { ks: 'ks', kus: 'ks', kusy: 'ks', kg: 'kg', m2: 'm²', 'm²': 'm²', m3: 'm³', 'm³': 'm³', m: 'm', bm: 'm',
  l: 'l', ltr: 'l', litr: 'l', bal: 'bal', baleni: 'bal', pal: 'pal', par: 'pár', 'pár': 'pár', rol: 'rol', role: 'rol', t: 't', sada: 'sada', kpl: 'kpl' };
const mjN = m => { const k = bezDia(m).trim().replace(/\.$/, ''); return MJ[k] || k; };
const mjHezky = m => { const n = mjN(m); return n === 'm' ? 'bm' : (n || 'ks'); };

/* ---------- prodejny STAVIMEX Praha, a.s. ---------- */
const STAVIMEX = {
  firma: 'STAVIMEX Praha, a.s.', ico: '25050028', web: 'https://stavimex.cz',
  malesice: { nazev: 'Prodejna Malešice', adresa: 'Černokostelecká 2111/131, 100 00 Praha 10', pozn: 'vjezd z ulice Dřevčická',
    tel: '+420 777 324 248', email: 'malesice@stavimex.cz' },
  liben: { nazev: 'Prodejna Libeň', adresa: 'Voctářova 2367/12, 180 00 Praha 8', pozn: 'u Kauflandu pod Libeňským mostem',
    tel: '+420 608 324 247', email: 'liben@stavimex.cz' },
  cenyText: 'Ceny prodejen Malešice a Libeň jsou aktuální. Ostatní ceny v katalogu jsou průměrné ceny prodejen a e-shopů jiných prodejců.'
};
const telOdkaz = t => 'tel:' + String(t).replace(/\s/g, '');
/** Karta s prodejnami – hlavní kontakt Malešice. kompakt = jednořádkový pruh pro katalog. */
function stavimexHtml(kompakt) {
  const S2 = STAVIMEX, m = S2.malesice, l = S2.liben;
  if (kompakt) return `<div class="kk-stx kk-stx-kompakt">
    <div><b>${S2.firma}</b> · hlavní kontakt <b>${m.nazev}</b>, ${m.adresa} · <a href="${telOdkaz(m.tel)}">${m.tel}</a> · <a href="mailto:${m.email}">${m.email}</a></div>
    <div>${l.nazev}: ${l.adresa} · <a href="${telOdkaz(l.tel)}">${l.tel}</a> · <a href="mailto:${l.email}">${l.email}</a></div>
    <div class="kk-stx-ceny">${S2.cenyText}</div></div>`;
  const karta = (p, hlavni) => `<div class="kk-stx-karta${hlavni ? ' hlavni' : ''}">
    ${hlavni ? '<span class="kk-stx-stitek">Hlavní kontakt</span>' : ''}
    <b>${p.nazev}</b><span>${p.adresa}</span><small>${p.pozn}</small>
    <a class="kk-stx-tel" href="${telOdkaz(p.tel)}">📞 ${p.tel}</a><a href="mailto:${p.email}">✉ ${p.email}</a></div>`;
  return `<details class="kk-stx">
    <summary><span><b>Prodejny ${S2.firma}</b> – Malešice a Libeň</span><span class="kk-stx-souhrn">hlavní kontakt Malešice ${m.tel}</span></summary>
    <div class="kk-stx-telo">${karta(m, true)}${karta(l, false)}</div>
    <p class="kk-stx-ceny">${S2.cenyText} IČO ${S2.ico}.</p></details>`;
}

/* ---------- zásoby Stavimexu ---------- */
const PRODEJNY = { malesice: 'Malešice', liben: 'Libeň' };
const zasobaCislo = k => k ? (Number(k.zasoba) || 0) : 0;
function skladSkore(z) {
  if (!z) return 0;
  if (zasobaCislo(z.malesice) > 0) return 3;
  if (zasobaCislo(z.liben) > 0) return 2;
  return (z.malesice || z.liben) ? 1 : 0;
}
/** Seřadí seznam: skladem v Malešicích, pak v Libni, pak Stavimex bez zásoby, pak ostatní. Jinak drží pořadí. */
function seraditPodleSkladu(pole, zas, kodFn) {
  return pole.map((p, i) => ({ p, i, s: skladSkore(zas[kodFn(p)]) }))
    .sort((a, b) => b.s - a.s || a.i - b.i).map(x => x.p);
}
/** Filtry: malesice = skladem v Malešicích, obe = skladem M. nebo L., stavimex = cokoli, co Stavimex vede, vse = celý katalog. */
function projdeFiltrem(z, filtr) {
  if (filtr === 'stavimex') return !!(z && (z.malesice || z.liben));
  if (filtr === 'malesice') return zasobaCislo(z?.malesice) > 0;
  if (filtr === 'obe') return zasobaCislo(z?.malesice) > 0 || zasobaCislo(z?.liben) > 0;
  return true;
}
/** Dvě pilulky se zásobou. potreba (volitelně) = kolik je potřeba ve stejné MJ. */
function skladHtml(z, potreba, mjPotreby) {
  if (!z) return '<span class="kk-pill kk-pill-nic" title="Zásobu zboží teď nevidím – zavolej nebo napiš do prodejny">Ověřit stav na prodejně</span>';
  return ['malesice', 'liben'].map(p => {
    const k = z[p];
    if (!k) return `<span class="kk-pill kk-pill-nic">${PRODEJNY[p]} –</span>`;
    const q = zasobaCislo(k);
    const stejnaMj = !mjPotreby || mjN(k.mj) === mjN(mjPotreby);
    const malo = q > 0 && potreba > 0 && stejnaMj && q < potreba;
    const cls = q <= 0 ? 'kk-pill-ne' : (malo ? 'kk-pill-malo' : 'kk-pill-ok');
    return `<span class="kk-pill ${cls}" title="${q > 0 ? 'Skladem' : 'Není skladem'} v prodejně ${PRODEJNY[p]}">${q > 0 ? '●' : '○'} ${PRODEJNY[p]} ${f3(q)} ${esc(mjHezky(k.mj))}</span>`;
  }).join('');
}

/* ---------- údaje z názvu zboží ---------- */
function zNazvu(nazev, co) {
  const t = bezDia(nazev).replace(/²/g, '2').replace(/(\d),(\d)/g, '$1.$2');
  let m = null;
  if (co === 'kg') m = t.match(/(\d+(?:\.\d+)?)\s*kg\b/);
  else if (co === 'ks') m = t.match(/(\d+)\s*(?:ks|kusu|kus)\b/);
  else if (co === 'l') m = t.match(/(\d+(?:\.\d+)?)\s*(?:l|lt|ltr|litru|litr|litry)\b/);
  else if (co === 'm2') {
    m = t.match(/(\d+(?:\.\d+)?)\s*m2\b/) || t.match(/\bs\s*=\s*(\d+(?:\.\d+)?)\s*(?:mp|m2)\b/);
    if (!m) { const r = t.match(/\b(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*m\b/); if (r && +r[1] < 20 && +r[2] < 20) return +r[1] * +r[2]; }
  } else if (co === 'm') {
    m = t.match(/(\d+(?:\.\d+)?)\s*(?:bm|m)\b(?![23])/);
    if (!m) m = t.match(/(?:^|[^\d.])(\d{1,2}(?:\.\d+)?)\s*m(?=\s*[x×*]\s*\d)/);   // „3mx10mm“, „2,5m x 6mm“
    if (!m) { const mm = t.match(/\b(\d{4,5})\s*mm\b/); if (mm) return Number(mm[1]) / 1000; }
    if (!m) { const cm = t.match(/\b(\d{3})\s*cm\b/); if (cm) return Number(cm[1]) / 100; }   // „Omítník dřevěný 250cm“
  }
  const v = m ? Number(m[1]) : null;
  return v > 0 ? v : null;
}
/** Rozměr tvárnice / dlaždice v cm (seřazený od největšího). */
function rozmerCm(text) {
  const t = String(text || '').replace(/(\d),(\d)/g, '$1.$2');
  const m = t.match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)(?:\s*[x×*]\s*(\d+(?:\.\d+)?))?/i);
  if (!m) return null;
  let c = [m[1], m[2], m[3]].filter(Boolean).map(Number).filter(n => n > 0);
  if (c.length < 2) return null;
  if (Math.max(...c) > 200) c = c.map(x => x / 10);          // mm -> cm
  return c;
}

/** Z rozměrů tvárnice (cm) určí délku, výšku a tloušťku.
    Tloušťka = rozměr shodný se zadanou tloušťkou, jinak nejmenší; výška = zbylý rozměr nejbližší 25 cm. */
function rozmerTvarnice(c, tlNyni) {
  let zbyva = c.slice();
  if (zbyva.length < 3) { const s = zbyva.sort((a, b) => b - a); return { td: vp(s[0]), tv: vp(s[1]) }; }
  let iTl = tlNyni ? zbyva.findIndex(x => Math.abs(x - tlNyni) < 0.6) : -1;
  if (iTl < 0) iTl = zbyva.indexOf(Math.min(...zbyva));
  const tl = zbyva.splice(iTl, 1)[0];
  zbyva.sort((a, b) => Math.abs(a - 25) - Math.abs(b - 25));
  return { td: vp(zbyva[1]), tv: vp(zbyva[0]), tl: vp(tl) };
}
/** Přepočet z jednotky výpočtu na jednotku, ve které se zboží prodává. */
/** Objem jednoho kusu řeziva v m³ z názvu: „KVH 60x120x5000“, „hranol 100/100/4000“, „fošna 50x200 mm 4 m“. */
function objemKusu(nazev) {
  const t = bezDia(nazev).replace(/(\d),(\d)/g, '$1.$2');
  const r3 = t.match(/(\d+(?:\.\d+)?)\s*[x×*/]\s*(\d+(?:\.\d+)?)\s*[x×*/]\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)?/);
  if (r3) {
    let c = [+r3[1], +r3[2], +r3[3]];
    const j = r3[4] || (Math.max(...c) > 600 ? 'mm' : null);
    if (j === 'mm') c = c.map(x => x / 1000); else if (j === 'cm') c = c.map(x => x / 100);
    else if (j === 'm') c = [c[0] / 1000, c[1] / 1000, c[2]];                // „60x120x4 m“
    else return null;
    const v = c[0] * c[1] * c[2];
    return v > 0 && Math.max(...c) >= 0.5 && Math.max(...c) <= 15 ? v : null;
  }
  const r2 = t.match(/(\d{2,3})\s*[x×*/]\s*(\d{2,3})\s*mm/), d = zNazvu(nazev, 'm');
  if (r2 && d && d >= 0.5 && d <= 15) return (+r2[1] / 1000) * (+r2[2] / 1000) * d;
  return null;
}
/** Ruční převody zadané uživatelem: klíč zboží|jednotka výpočtu → kolik jednotek výpočtu je v 1 prodejní jednotce. */
const klicPrevodu = (m, z) => (m.kod || m.ean || m.nazev) + '|' + z;
let SCHV = {};   // schválené přepočty ze Supabase (nasazuje správce v dbadmin.html)
function schvPrevod(m, z) { const k = m.kod ? m.kod + '|' + z : null; const v = k && SCHV[k]; return v > 0 ? v : null; }
function uzivPrevod(m, z) { try { const v = (S.prevody || {})[klicPrevodu(m, z)]; return v > 0 ? v : null; } catch (e) { return null; } }
const POCITANE = ['ks', 'bal', 'rol', 'sada', 'pal', 'pár', 'kpl'];
function prepocet(q, mjZ, m) {
  const z = mjN(mjZ), na = mjN(m.mj);
  if (!z || !na || z === na || !(q > 0)) return null;
  const del = (d, popis) => ({ mnozstvi: nahoru(q / d), popis });
  const u = uzivPrevod(m, z);
  if (u) return { mnozstvi: POCITANE.includes(na) ? nahoru(q / u) : zaok(q / u), popis: `${f3(q)} ${mjHezky(z)} ÷ ${f3(u)} ${mjHezky(z)} v 1 ${mjHezky(na)} (tvůj přepočet)`, uziv: true };
  const sv = schvPrevod(m, z);
  if (sv) return { mnozstvi: POCITANE.includes(na) ? nahoru(q / sv) : zaok(q / sv), popis: `${f3(q)} ${mjHezky(z)} ÷ ${f3(sv)} ${mjHezky(z)} v 1 ${mjHezky(na)} (ověřený přepočet)`, overeno: true };
  // tuny → kusy / pytle podle hmotnosti zboží
  if (z === 't' && POCITANE.includes(na)) { const hm = m.hmotnost > 0 ? m.hmotnost : zNazvu(m.nazev, 'kg'); if (hm) return { mnozstvi: nahoru(q * 1000 / hm), popis: `${f3(q)} t = ${f3(zaok(q * 1000))} kg ÷ ${f3(hm)} kg` }; }
  if (z === 't' && na === 'kg') return { mnozstvi: zaok(q * 1000), popis: `${f3(q)} t = ${f3(zaok(q * 1000))} kg` };
  // m³ → kusy: řezivo podle rozměru v názvu, sypké a balené podle litrů
  if (z === 'm³' && POCITANE.includes(na)) {
    const v = objemKusu(m.nazev); if (v) return { mnozstvi: nahoru(q / v), popis: `${f3(q)} m³ ÷ ${f3(Math.round(v * 1e5) / 1e5)} m³ v kusu` };
    const l = zNazvu(m.nazev, 'l'); if (l) return { mnozstvi: nahoru(q * 1000 / l), popis: `${f3(q)} m³ = ${f3(zaok(q * 1000))} l ÷ ${f3(l)} l` };
    const hm = m.hmotnost > 0 ? m.hmotnost : zNazvu(m.nazev, 'kg');
    if (hm && /pisek|sterk|drt|kamen|kacirek|cement/.test(bezDia(m.nazev).toLowerCase())) return { mnozstvi: nahoru(q * 1600 / hm), popis: `${f3(q)} m³ × 1,6 t/m³ ÷ ${f3(hm)} kg` };
  }
  if (z === 'm³' && na === 'l') return { mnozstvi: zaok(q * 1000), popis: `${f3(q)} m³ = ${f3(zaok(q * 1000))} l` };
  if (z === 'l' && na === 'm³') return { mnozstvi: Math.ceil(q) / 1000, popis: `${f3(q)} l = ${f3(q / 1000)} m³` };
  if (z === 'm' && na === 'm³') { const r2 = bezDia(m.nazev).match(/(\d{2,3})\s*[x×*/]\s*(\d{2,3})/); if (r2) { const v = zaok(q * r2[1] * r2[2] / 1e6 * 1000) / 1000; return { mnozstvi: v, popis: `${f3(q)} bm × ${r2[1]}×${r2[2]} mm` }; } }
  if (m.velJed > 0 && m.mjKat && z === mjN(m.mjKat)) return del(m.velJed, `${f3(q)} ${mjHezky(z)} ÷ ${f3(m.velJed)} ${mjHezky(z)} ${m.velKde || ''}`.trim());
  if (na === 'bal' && m.vBaleni > 0) return del(m.vBaleni, `${f3(q)} ${mjHezky(z)} ÷ ${f3(m.vBaleni)} v balení`);
  if ((na === 'bal' || na === 'ks') && z === 'ks' && !(m.vBaleni > 1)) { const n = zNazvu(m.nazev, 'ks'); if (n > 1) return del(n, `${f3(q)} ks ÷ ${f3(n)} ks v balení`); }
  if (na === 'ks' || na === 'bal' || na === 'rol' || na === 'sada') {
    if (z === 'kg') { const hm = m.hmotnost > 0 ? m.hmotnost : zNazvu(m.nazev, 'kg'); if (hm) return del(hm, `${f3(q)} kg ÷ ${f3(hm)} kg`); }
    if (z === 'l') { const v = zNazvu(m.nazev, 'l'); if (v) return del(v, `${f3(q)} l ÷ ${f3(v)} l`); }
    if (z === 'm²') { let a = zNazvu(m.nazev, 'm2');
      if (!a && /dlazb|dlazdic|obklad|deska|plat/.test(bezDia(m.nazev).toLowerCase())) { const c = rozmerCm(m.nazev); if (c && c[0] >= 10 && c[0] <= 120 && c[1] >= 5) a = Math.round(c[0] * c[1]) / 1e4; }
      if (!a) { const r = bezDia(m.nazev).match(/(\d{3,4})\s*[x×*]\s*(\d{3,4})(?:\s*[x×*]\s*\d+(?:[.,]\d+)?)?\s*mm/); if (r && +r[1] >= 300 && +r[2] >= 300) a = zaok(+r[1] * +r[2] / 1e6 * 1000) / 1000; }
      if (a) return del(a, `${f3(q)} m² ÷ ${f3(a)} m²`); }
    if (z === 'm') { const d = zNazvu(m.nazev, 'm'); if (d) return del(d, `${f3(q)} bm ÷ ${f3(d)} m`); }
    if (z === 'ks' && m.vBaleni > 1) return del(m.vBaleni, `${f3(q)} ks ÷ ${f3(m.vBaleni)} ks v balení`);
  }
  if (na === 'kg' && z === 'ks' && m.hmotnost > 0) return { mnozstvi: zaok(q * m.hmotnost), popis: `${f3(q)} ks × ${f3(m.hmotnost)} kg` };
  if (na === 't' && z === 'm³') return { mnozstvi: zaok(q * 1.6), popis: `${f3(q)} m³ × 1,6 t/m³ (kamenivo)` };
  if (na === 't' && z === 'kg') return { mnozstvi: zaok(q / 1000), popis: `${f3(q)} kg = ${f3(q / 1000)} t` };
  return { mnozstvi: null, popis: `${mjHezky(z)} → ${mjHezky(na)}` };
}

/* =====================================================================
   DEFINICE KALKULAČEK
   rozmer: steny (délka × výška) | plocha (délka × šířka) | mistnost (délka × šířka × výška)
   pole: typ num (výchozí) | volba | ano ; profi = jen v režimu Podrobně ; ukaz(h) = kdy zobrazit
   spocitej(h) -> { radky:[{klic,nazev,mnozstvi,mj,zaklad,q}], prace:[{klic,nazev,mj,mnozstvi}] }
   q = co hledat v katalogu (kmeny slov bez diakritiky), null = materiál vybírá uživatel
   ===================================================================== */
const P = true;
const DVERE = [['0.8,1.97', 'Dveře 80'], ['0.9,1.97', 'Dveře 90'], ['1.2,1.5', 'Okno 120×150'], ['1,1', 'Vlastní']];

/** Řezivo: sčítá kusy a metry podle průřezu, vrací řádky v m³ (KVH) s rozpisem kusů. */
function DREVO(prorez) {
  const sk = [], f = 1 + (prorez || 0) / 100;
  const najdi = (klic, nazev, prurez) => { let x = sk.find(s => s.klic === klic && s.prurez === prurez); if (!x) { x = { klic, nazev, prurez, kusy: [], bm: 0, pozn: '' }; sk.push(x); } return x; };
  const roz = p => String(p).split('x').map(Number);
  return {
    pridej(klic, nazev, prurez, ks, delka) { if (!(ks > 0 && delka > 0)) return; const x = najdi(klic, nazev, prurez); x.kusy.push([ks, delka]); x.bm += ks * delka; },
    pridejBm(klic, nazev, prurez, bm, pozn) { if (!(bm > 0)) return; const x = najdi(klic, nazev, prurez); x.bm += bm; x.pozn = pozn; },
    povrch() { return sk.reduce((a, x) => { const [b, c] = roz(x.prurez); return a + 2 * (b + c) / 1000 * x.bm; }, 0); },
    radky() {
      const seznam = sk.length > 1 && new Set(sk.map(x => x.klic)).size < sk.length;
      return sk.map(x => {
        const [b, c] = roz(x.prurez), m3 = x.bm * b * c / 1e6 * f;
        const kusy = x.kusy.length ? x.kusy.map(([n, d]) => `${n} ks × ${f3(zaok(d))} m`).join(' + ') + ` = ${f3(zaok(x.bm))} bm` : `${f3(zaok(x.bm))} bm (${x.pozn})`;
        return { klic: seznam ? `${x.klic}-${x.prurez}` : x.klic, nazev: `${x.nazev} ${b}×${c} mm`, mnozstvi: Math.ceil(m3 * 1000 - 1e-6) / 1000, mj: 'm³', q: `kvh ${b}x${c}`,
          zaklad: `${kusy}, průřez ${b}×${c} mm${f > 1 ? `, prořez ${f3(zaok((f - 1) * 100))} %` : ''}` };
      });
    }
  };
}
/** Suché směsi: obvyklá tloušťka (mm) a spotřeba (kg/m² na 1 mm). */
const SMESI = {
  lepidlo: { kratce: 'Lepidlo na obklad', nazev: 'Lepidlo na obklady a dlažbu (flexibilní)', tl: 3, sp: 1.3, q: 'lepidlo flex', vyl: 'pu |pena|tmel|ml\\b', prace: 'Lepení obkladu / dlažby' },
  jadrova: { kratce: 'Jádrová omítka', nazev: 'Jádrová omítka vápenocementová', tl: 15, sp: 1.4, q: 'omitka jadrova', prace: 'Jádrová omítka' },
  stuk: { kratce: 'Štuková omítka', nazev: 'Štuková omítka', tl: 2, sp: 1.4, q: 'omitka stuk', vyl: 'lzic|hladit', prace: 'Štuková omítka' },
  sadrova: { kratce: 'Sádrová omítka', nazev: 'Sádrová omítka', tl: 10, sp: 0.9, q: 'sadrova omitka', prace: 'Sádrová omítka' },
  sterka: { kratce: 'Lepicí a stěrková hmota', nazev: 'Lepicí a stěrková hmota', tl: 4, sp: 1.4, q: 'lepici sterk', prace: 'Stěrkování s výztužnou tkaninou' },
  finalni: { kratce: 'Finální stěrka', nazev: 'Finální stěrka', tl: 1, sp: 1.1, q: 'sterk final', prace: 'Finální stěrkování' },
  hydro: { kratce: 'Hydroizolační stěrka', nazev: 'Hydroizolační stěrka', tl: 2, sp: 1.5, q: 'hydroizolacni sterk', pen: 'penetrac hydroizol', prace: 'Hydroizolační stěrka (2 vrstvy)' },
  nivelace: { kratce: 'Samonivelační stěrka', nazev: 'Samonivelační stěrka', tl: 5, sp: 1.6, q: 'samoniv', pen: 'penetrac podlah', prace: 'Nivelace podlahy' },
  poter: { kratce: 'Cementový potěr', nazev: 'Cementový potěr', tl: 50, sp: 2.0, q: 'poter cement', vyl: 'balkon', prace: 'Cementový potěr' }
};
const KALK = {
  zdivo: {
    nazev: 'Zdivo', ikona: '🧱', rozmer: 'steny', usek: 'Stěna', otvory: true,
    popis: 'Příčky i nosné zdi z tvárnic nebo cihel. Každou stěnu zadej zvlášť (nebo rovnou m²), odečti dveře a okna.',
    sablony: [
      { n: 'Ytong 10', h: { td: '60', tv: '25', tl: '10', malta: 'tenka', spara: '1' }, q: { tvarnice: 'ytong 100' } },
      { n: 'Ytong 15', h: { td: '60', tv: '25', tl: '15', malta: 'tenka', spara: '1' }, q: { tvarnice: 'ytong 150' } },
      { n: 'Ytong 20', h: { td: '60', tv: '25', tl: '20', malta: 'tenka', spara: '1' }, q: { tvarnice: 'ytong 200' } },
      { n: 'Ytong 25', h: { td: '60', tv: '25', tl: '25', malta: 'tenka', spara: '1' }, q: { tvarnice: 'ytong 250' } },
      { n: 'Ytong 30', h: { td: '60', tv: '25', tl: '30', malta: 'tenka', spara: '1' }, q: { tvarnice: 'ytong 300' } },
      { n: 'Porotherm 11,5', h: { td: '50', tv: '24,9', tl: '11,5', malta: 'tenka', spara: '1' }, q: { tvarnice: 'porotherm 11,5' } },
      { n: 'Porotherm 30', h: { td: '24,8', tv: '24,9', tl: '30', malta: 'tenka', spara: '1' }, q: { tvarnice: 'porotherm 30' } },
      { n: 'Porotherm 44', h: { td: '24,8', tv: '24,9', tl: '44', malta: 'tenka', spara: '1' }, q: { tvarnice: 'porotherm 44' } },
      { n: 'Příčkovka YTONG PLUS 7,5', h: { td: '60', tv: '25', tl: '7,5', malta: 'tenka', spara: '1' }, q: { tvarnice: 'ytong 75' } },
      { n: 'Cihla plná', h: { td: '29', tv: '6,5', tl: '14', malta: 'klasicka', spara: '12' }, q: { tvarnice: 'cihla plna' } }
    ],
    pole: [
      { id: 'td', popis: 'Tvárnice – délka', mj: 'cm', v: '60', tip: 'Delší rozměr pohledové strany.' },
      { id: 'tv', popis: 'Tvárnice – výška', mj: 'cm', v: '25', tip: 'Kratší rozměr pohledové strany.' },
      { id: 'tl', popis: 'Tloušťka zdi', mj: 'cm', v: '15', tip: 'Ovlivní spotřebu malty, ne počet kusů.' },
      { id: 'malta', popis: 'Pojivo', typ: 'volba', v: 'tenka', volby: [['tenka', 'Tenkovrstvá'], ['klasicka', 'Klasická'], ['pena', 'Pěna']],
        tip: 'Tenkovrstvá malta je na přesné tvárnice, klasická na spáru 10–12 mm.' },
      { id: 'spara', popis: 'Spára', mj: 'mm', v: '1', profi: P, tip: 'Tenkovrstvá malta 1–3 mm, klasická 10–12 mm (při klasické maltě a spáře pod 5 mm počítám 10 mm).' },
      { id: 'spTenka', popis: 'Spotřeba tenkovrstvé malty', mj: 'kg/m² na 10 cm', v: '2,5', profi: P, tip: 'Výrobci uvádějí cca 20–30 kg na m³ zdiva.', ukaz: h => h.malta === 'tenka' },
      { id: 'prorez', popis: 'Prořez', mj: '%', v: '5', profi: P, tip: 'Rezerva na řezání. Členitá stěna 8–10 %.' },
      { id: 'vyztuz', popis: 'Výztuž do spáry každou', mj: 'řadu', v: '0', profi: P, tip: '0 = bez výztuže. Obvykle každá 3. řada.' },
      { id: 'preklady', popis: 'Překlady nad otvory', typ: 'ano', v: '1', tip: 'Délka překladu = šířka otvoru + 2 × 25 cm uložení.' },
      { id: 'izolPod', popis: 'Hydroizolace pod první řadu', typ: 'ano', v: '0', tip: 'Asfaltový pás nebo izolace proti vlhkosti pod první řadou tvárnic (na soklu / základové desce). Počítá se podle délky stěn.' },
      { id: 'prvniRada', popis: 'První řada na klasickou maltu', typ: 'ano', v: '0', profi: P, ukaz: h => h.malta !== 'klasicka', tip: 'První řada se klade do cementové malty (vyrovnání nerovností). Přidá 1 řadu klasické malty do spáry 15 mm.' }
    ],
    jak: 'Plocha = součet stěn − otvory.\nKusů na m² = 1 ÷ ((délka + spára) × (výška + spára)), navýšeno o prořez.\nTenkovrstvá malta: zadaná spotřeba (výchozí 2,5 kg/m² na každých 10 cm tloušťky = cca 25 kg na m³ zdiva).\nKlasická malta: objem spár = tloušťka × (1 − podíl tvárnic v ploše), +15 % ztráty a zapadání do dutin, 1 900 kg/m³.\nZdicí pěna: 1 dóza na 10 m².\nVýztuž: počet řad ÷ zvolený krok × délka stěny.\nPřeklad: šířka otvoru + 0,5 m.\nHydroizolace pod první řadu: délka stěn + 10 % přesahy.\nObjem zdiva (m³) = plocha × tloušťka – uvedeno u tvárnic.',
    spocitej(h) {
      const A = h.plocha;
      if (!A || !h.td || !h.tv) return null;
      // klasická malta = spára 10–12 mm; při zadané tenké spáře (do 5 mm) počítám s 10 mm
      const sparaMm = h.malta === 'klasicka' && (h.spara || 0) < 5 ? 10 : (h.spara || 0);
      const sp = sparaMm / 10;
      const naM2 = 1 / (((h.td + sp) / 100) * ((h.tv + sp) / 100));
      const tl = h.tl || 15;
      const r = [{ klic: 'tvarnice', nazev: 'Tvárnice / cihly', mnozstvi: nahoru(A * naM2 * (1 + (h.prorez || 0) / 100)), mj: 'ks', q: null,
        zaklad: `${f3(zaok(A))} m² × ${f3(zaok(naM2))} ks/m², prořez ${f3(h.prorez || 0)} %, zdivo ${f3(zaok(A * tl / 100))} m³` }];
      if (h.malta === 'klasicka') {
        // objem spár z geometrie: podíl plochy, kterou nezabírají tvárnice (+15 % ztráty a zapadání do dutin)
        const podil = Math.min(0.45, Math.max(0.08, 1 - naM2 * (h.td / 100) * (h.tv / 100)));
        const m3 = A * (tl / 100) * podil * 1.15;
        r.push({ klic: 'malta', nazev: 'Zdicí malta', mnozstvi: nahoru(m3 * 1900), mj: 'kg', q: 'malta zdic', zaklad: `spáry ${f3(zaok(podil * 100))} % objemu zdiva +15 % ztráty, 1 900 kg/m³` });
      } else if (h.malta === 'pena') {
        r.push({ klic: 'pena', nazev: 'Zdicí pěna', mnozstvi: nahoru(A / 10), mj: 'ks', q: 'pena zdic', zaklad: '1 dóza na 10 m²' });
      } else {
        const s = h.spTenka || 2.5;
        r.push({ klic: 'malta', nazev: 'Tenkovrstvá malta', mnozstvi: nahoru(A * s * tl / 10), mj: 'kg', q: 'malta tenkovrstv', zaklad: `${f3(s)} kg/m² na 10 cm, zeď ${f3(tl)} cm` });
      }
      if (h.prvniRada && h.malta !== 'klasicka' && h.delka > 0) {
        const kg = h.delka * (tl / 100) * (0.015 + 0.005) * 1900 * 1.15;
        r.push({ klic: 'maltaPrvni', nazev: 'Cementová malta pod první řadu', mnozstvi: nahoru(kg), mj: 'kg', q: 'malta zdic', zaklad: `délka stěn ${f3(zaok(h.delka))} m × tloušťka ${f3(tl)} cm × 20 mm` });
      }
      if (h.izolPod && h.delka > 0) r.push({ klic: 'izolPod', nazev: 'Hydroizolace pod první řadu zdiva', mnozstvi: nahoru(h.delka * 1.1 * (tl + 10) / 100), mj: 'm²', q: 'pas asfaltovy oxidovany', vyloucit: 'sadrok|sdk|pask|lepidl|nater|penetr|samolep', zaklad: `délka stěn ${f3(zaok(h.delka))} m + 10 % přesahy × šířka pásu ${f3(tl + 10)} cm (zeď ${f3(tl)} cm + 2 × 5 cm)` });
      if (h.vyztuz > 0) {
        let bm = 0;
        h.useky.forEach(u => { if (u.d > 0 && u.v > 0) bm += Math.ceil(Math.floor(u.v * 100 / ((h.tv || 25) + sp)) / h.vyztuz) * u.d; });
        if (bm > 0) r.push({ klic: 'vyztuz', nazev: 'Výztuž do ložné spáry', mnozstvi: nahoru(bm * 1.05), mj: 'bm', q: 'murfor', zaklad: `každá ${f3(h.vyztuz)}. řada, +5 % přesahy` });
      }
      if (h.preklady && h.otvoryN) {
        // typ překladu podle tloušťky zdi: příčka do 10 cm → nenosný Ytong NEP, do 17,5 cm → plochý Porotherm KP 11,5/14,5,
        // silnější zeď → nosné Porotherm KP 7 vedle sebe (1 ks na každých cca 10 cm tloušťky)
        const tlz = Number(h.tl) || 15;
        const typP = tlz <= 10 ? { q: `preklad nenosny ytong nep ${tlz <= 7.5 ? 75 : 100}x249`, n: 'Překlad nenosný (pórobeton)', ks: 1, max: 1250 }
          : tlz <= 12.5 ? { q: 'preklad plochy porotherm kp 11,5', n: 'Překlad plochý KP 11,5', ks: 1 }
          : tlz <= 17.5 ? { q: 'preklad plochy porotherm kp 14,5', n: 'Překlad plochý KP 14,5', ks: 1 }
          : { q: 'preklad nosny porotherm kp 7', n: 'Překlad nosný KP 7', ks: Math.max(2, Math.round(tlz / 10)) };
        const poDelce = {};
        h.otvory.filter(o => o.s > 0 && o.n > 0).forEach(o => {
          let mm = Math.max(1000, Math.ceil((o.s + 0.5) * 4 - 1e-9) * 250);
          if (typP.max && mm < typP.max) mm = typP.max;
          poDelce[mm] = (poDelce[mm] || 0) + o.n;
        });
        Object.keys(poDelce).map(Number).sort((a, b) => a - b).forEach((mm, i) => {
          const n = poDelce[mm];
          // nenosný pórobetonový překlad se vyrábí jen 1,25 m – širší otvor v příčce kryje nosný KP 7
          const t = typP.max && mm > typP.max ? { q: 'preklad nosny porotherm kp 7', n: 'Překlad nosný KP 7', ks: 1 } : typP;
          r.push({ klic: i ? 'preklad_' + (i + 1) : 'preklad', nazev: `${t.n} – ${f3(mm / 1000)} m`, mnozstvi: n * t.ks, mj: 'ks',
            q: `${t.q}${t.max ? '' : ' ' + mm + 'mm'}`, vyloucit: 'sadrok|sdk|zaluz|rolet', zaklad: `${n} otvor${n > 1 ? 'ů' : ''}${t.ks > 1 ? ` × ${t.ks} ks vedle sebe (zeď ${f3(tlz)} cm)` : ''}, délka = šířka otvoru + 2 × 25 cm, zaokrouhleno na vyráběnou délku` });
        });
      }
      const pr = [{ klic: 'zdeni', nazev: 'Zdění', mj: 'm²', mnozstvi: zaok(A) }];
      if (h.preklady && h.otvoryN) pr.push({ klic: 'osazeniPrekladu', nazev: 'Osazení překladů', mj: 'ks', mnozstvi: h.otvoryN });
      return { radky: r, prace: pr };
    }
  },

  sdk: {
    nazev: 'Sádrokarton', ikona: '🔲', rozmer: 'steny', usek: 'Stěna', otvory: true,
    popisky: h => h.konstrukce === 'podhled' ? ['Šířka', 'Délka'] : ['Délka', 'Výška'],
    popis: 'Příčky, předstěny i podhledy. Materiál vybírám ze sortimentu suché výstavby Stavimexu – desky v m², profily v metrech podle výšky stěny, šrouby po baleních.',
    sablony: [
      { n: 'Příčka W111', h: { konstrukce: 'pricka', strany: 'obe', zaklop: 'jednoduchy', rozten: '625', profil: '75', deska: 'rb', tlDesky: '12,5', izolace: '1' } },
      { n: 'Příčka W112', h: { konstrukce: 'pricka', strany: 'obe', zaklop: 'dvojity', rozten: '625', profil: '75', deska: 'rb', tlDesky: '12,5', izolace: '1' } },
      { n: 'Koupelna / obklad', h: { konstrukce: 'pricka', strany: 'obe', zaklop: 'dvojity', rozten: '400', profil: '75', deska: 'rbi', tlDesky: '12,5', izolace: '1' } },
      { n: 'Protipožární EI 60', h: { konstrukce: 'pricka', strany: 'obe', zaklop: 'dvojity', rozten: '625', profil: '75', deska: 'rf', tlDesky: '12,5', izolace: '1' } },
      { n: 'Předstěna', h: { konstrukce: 'predstena', strany: 'jedna', zaklop: 'jednoduchy', rozten: '625', profil: '50', deska: 'rb', tlDesky: '12,5', izolace: '1' } },
      { n: 'Podhled', h: { konstrukce: 'podhled', strany: 'jedna', zaklop: 'jednoduchy', rozten: '500', deska: 'rb', tlDesky: '12,5', izolace: '0' } }
    ],
    pole: [
      { id: 'konstrukce', popis: 'Konstrukce', typ: 'volba', v: 'pricka', volby: [['pricka', 'Příčka'], ['predstena', 'Předstěna'], ['podhled', 'Podhled']] },
      { id: 'strany', popis: 'Opláštění', typ: 'volba', v: 'obe', volby: [['obe', 'Obě strany'], ['jedna', 'Jedna strana']], ukaz: h => h.konstrukce === 'pricka' },
      { id: 'zaklop', popis: 'Záklop', typ: 'volba', v: 'jednoduchy', volby: [['jednoduchy', '1 deska'], ['dvojity', '2 desky']], tip: 'Dvojitý záklop kvůli požáru, akustice a pevnějšímu kotvení.' },
      { id: 'deska', popis: 'Deska', typ: 'volba', v: 'rb', volby: [['rb', 'Standard'], ['rbi', 'Do vlhka'], ['rf', 'Protipožární'], ['rfi', 'Požár + vlhko'], ['ak', 'Akustická']] },
      { id: 'tlDesky', popis: 'Tloušťka desky', typ: 'volba', v: '12,5', volby: [['12,5', '12,5 mm'], ['15', '15 mm']] },
      { id: 'profil', popis: 'Profil CW/UW', typ: 'volba', v: '75', volby: [['50', '50'], ['75', '75'], ['100', '100']], ukaz: h => h.konstrukce !== 'podhled' },
      { id: 'rozten', popis: 'Osová vzdálenost', typ: 'volba', v: '625', volby: [['625', '625'], ['500', '500'], ['400', '400'], ['300', '300']], tip: 'Pod obklad 400 mm, podhled 500 mm.' },
      { id: 'dd', popis: 'Deska – šířka (bez vybraného zboží)', mj: 'm', v: '1,25', profi: P },
      { id: 'dv', popis: 'Deska – délka (bez vybraného zboží)', mj: 'm', v: '2', profi: P },
      { id: 'prorez', popis: 'Prořez desek', mj: '%', v: '10', profi: P },
      { id: 'kotveni', popis: 'Kotvení profilů každých', mj: 'm', v: '0,8', profi: P, ukaz: h => h.konstrukce !== 'podhled', tip: 'UW do podlahy a stropu, krajní CW do zdi. Max. 1 m, min. 3 kotvy na profil.' },
      { id: 'izolace', popis: 'Izolace do dutiny', typ: 'ano', v: '1' },
      { id: 'finalni', popis: 'Finální stěrka (Q3)', typ: 'ano', v: '1', tip: 'Celoplošné přestěrkování pohledové plochy pod malbu.' },
      { id: 'spFinal', popis: 'Spotřeba finální stěrky', mj: 'kg/m²', v: '0,6', profi: P, ukaz: h => !!h.finalni, tip: 'Tenká vrstva cca 1 mm ≈ 0,6 kg/m², silnější 1 kg/m².' },
      { id: 'rohy', popis: 'Vnější rohy a ukončení (lišty)', mj: 'ks', v: '0', ukaz: h => h.konstrukce !== 'podhled', tip: 'Počet vnějších rohů z SDK – dostanou rohovou lištu na celou výšku. Ostění dveří a oken se počítá samo.' },
      { id: 'vyztuzotvoru', popis: 'Vyztužit otvory UA', typ: 'ano', v: '1', ukaz: h => h.konstrukce !== 'podhled', tip: 'Kolem dveří UA profily na celou výšku s připojovacími úhelníky, aby konstrukce nepracovala.' }
    ],
    jak: 'Plocha = součet stěn − otvory.\nDesky: plocha × strany × záklop + prořez, zaokrouhleno na celé desky vybraného formátu (prodej v m²).\nCW: délka ÷ osová vzdálenost + 1 na každou stěnu; délku profilu volím nejkratší, která pokryje výšku stěny (prodej v m).\nUW: 2 × délka − dveře + nadpraží (šířka + 0,5 m), zaokrouhleno na celé kusy.\nUA: 2 stojky na otvor na celou výšku + 4 připojovací úhelníky.\nKotvy: obvod konstrukce ÷ rozteč kotvení.\nŠrouby: pohledová vrstva 25 ks/m² (u 2 desek delší TN 35), spodní 12 ks/m² TN 25; zaokrouhleno na balení.\nTmel 0,4 kg/m², páska 1,2 bm/m² pohledové plochy, finální stěrka (Q3) 0,6 kg/m² pohledové plochy, těsnění = obvod podle šířky profilu.\nRohová lišta: ostění otvorů (2 × výška + šířka, z každé strany) + vnější rohy × výška stěny.\nPodhled: CD = (šířka ÷ rozteč + 1) × délka, UD = obvod, přímý závěs každých 0,9 m, 1 stropní kotva na závěs, podélná spojka CD každé 4 m profilu.\nŠrouby u desek 15 mm: spodní vrstva TN 35, horní TN 45.',
    spocitej(h) {
      const A = h.plocha;
      if (!A) return null;
      const podhled = h.konstrukce === 'podhled';
      const stran = h.konstrukce === 'pricka' && h.strany === 'obe' ? 2 : 1;
      const vrstev = h.zaklop === 'dvojity' ? 2 : 1;
      const opl = A * stran * vrstev * (1 + (h.prorez || 0) / 100);
      const pohled = A * stran;
      const rozt = Number(h.rozten || 625) / 1000;
      const tl = String(h.tlDesky || '12,5');
      const deskaNazev = { rb: 'Sádrokartonová deska', rbi: 'Deska do vlhka (impregnovaná)', rf: 'Deska protipožární', rfi: 'Deska protipožární impregnovaná', ak: 'Deska akustická' }[h.deska] || 'Sádrokartonová deska';
      const plDesky = (h.dd || 1.25) * (h.dv || 2);
      const r = [{ klic: 'deska', nazev: `${deskaNazev} ${tl} mm`, mnozstvi: zaok(opl), mj: 'm²', jed: 'plocha',
        sv: `deska:${h.deska}:${tl}`, q: 'sadrokarton ' + (h.deska || ''),
        zaklad: `${f3(zaok(opl))} m² opláštění (${stran === 2 ? 'obě strany' : 'jedna strana'}, ${vrstev} ${vrstev === 2 ? 'vrstvy' : 'vrstva'}, prořez ${f3(h.prorez || 0)} %) ≈ ${nahoru(opl / plDesky)} desek` }];
      const vyska = h.vyskaMax || h.vyska || 0;
      const dMin = vyska > 0 ? Math.round(vyska * 100) / 100 : 2.6;
      if (!podhled) {
        const pr = h.profil;
        let cw = 0; h.useky.forEach(u => { if (u.d > 0) cw += Math.ceil(u.d / rozt) + 1; });
        if (h.m2 > 0 && h.vyska > 0) cw += Math.ceil(h.m2 / h.vyska / rozt) + 1;
        r.push({ klic: 'cw', nazev: `Profil CW ${pr}`, mnozstvi: cw, mj: 'ks', jed: 'kusy', delkaMin: dMin, sv: `cw:${pr}:${dMin}`, q: 'profil cw ' + pr,
          zaklad: `${cw} stojek, osová ${f3(rozt * 1000)} mm, výška ${vyska ? f3(dMin) + ' m' : 'nezadaná'}` });
        const nadprazi = h.otvory.reduce((s, o) => s + ((o.s || 0) + 0.5) * (o.n || 0), 0);
        const uw = Math.max(0, 2 * h.delka - h.sirkaDveri) + (h.vyztuzotvoru ? nadprazi : 0);
        r.push({ klic: 'uw', nazev: `Profil UW ${pr}`, mnozstvi: zaok(uw), mj: 'bm', jed: 'metry', sv: `uw:${pr}`, q: 'profil uw ' + pr,
          zaklad: 'podlaha a strop bez dveří' + (h.vyztuzotvoru && nadprazi ? ` + nadpraží ${f3(zaok(nadprazi))} m` : '') });
        if (h.vyztuzotvoru && h.otvoryN) {
          r.push({ klic: 'ua', nazev: `Profil UA ${pr}`, mnozstvi: 2 * h.otvoryN, mj: 'ks', jed: 'kusy', delkaMin: dMin, sv: `ua:${pr}:${dMin}`, q: 'profil ua ' + pr,
            zaklad: `${h.otvoryN}× otvor, 2 stojky na celou výšku ${f3(dMin)} m` });
          r.push({ klic: 'kotvy', nazev: `Úhelník připojovací UA ${pr}`, mnozstvi: h.otvoryN * 4, mj: 'ks', sv: `uaUhel:${pr}`, q: 'uhelnik ua ' + pr, zaklad: '4 ks na otvor (nahoře a dole)' });
        }
        const rozKot = h.kotveni > 0 ? h.kotveni : 0.8;
        r.push({ klic: 'hmozd', nazev: 'Hmoždinka natloukací 6 × 35/40', mnozstvi: nahoru(h.obvod / rozKot), mj: 'ks', sv: 'hmozd', q: 'hmozdinka natloukaci 6',
          zaklad: `obvod ${f3(zaok(h.obvod))} m ÷ ${f3(rozKot)} m` });
      } else {
        let cd = 0; h.useky.forEach(u => { if (u.d > 0 && u.v > 0) cd += (Math.ceil(u.d / rozt) + 1) * u.v; });
        if (h.m2 > 0) cd += h.m2 / rozt;
        r.push({ klic: 'cd', nazev: 'Profil CD 60/27', mnozstvi: zaok(cd * 1.05), mj: 'bm', jed: 'metry', sv: 'cd', q: 'profil cd', zaklad: `rozteč ${f3(rozt * 1000)} mm, +5 % na spoje` });
        r.push({ klic: 'ud', nazev: 'Profil UD 28/30', mnozstvi: zaok(h.obvod), mj: 'bm', jed: 'metry', sv: 'ud', q: 'profil ud', zaklad: 'obvod místnosti' });
        r.push({ klic: 'zaves', nazev: 'Závěs přímý 125', mnozstvi: nahoru(cd / 0.9), mj: 'ks', sv: 'zaves', q: 'zaves primy', zaklad: 'každých 0,9 m profilu CD' });
        r.push({ klic: 'hmozd', nazev: 'Stropní kotva DN6', mnozstvi: nahoru(cd / 0.9 + h.obvod / 0.8), mj: 'ks', sv: 'strop', q: 'stropni dn6', zaklad: '1 na závěs + UD po 0,8 m' });
        r.push({ klic: 'spojkaCD', nazev: 'Spojka CD profilu (podélná)', mnozstvi: nahoru(cd / 4), mj: 'ks', q: 'spojka cd', zaklad: 'profily se dodávají po 4 m' });
      }
      if (!podhled) {
        const roh = (h.obvodOtvoru || 0) * stran + (h.rohy || 0) * (h.vyskaMax || 2.6);
        if (roh > 0) r.push({ klic: 'rohovnik', nazev: 'Rohová lišta pro SDK', mnozstvi: nahoru(roh * 1.05), mj: 'bm', q: 'rohova lista sadrokart', zaklad: `ostění otvorů ${stran === 2 ? 'z obou stran ' : ''}+ vnější rohy, +5 %` });
      }
      if (vrstev === 2) {
        const sp1 = tl === '15' ? 35 : 25, sp2 = tl === '15' ? 45 : 35;
        r.push({ klic: 'srouby', nazev: `Šrouby TN ${sp1} – spodní vrstva`, mnozstvi: nahoru(pohled * 12), mj: 'ks', sv: 'sroub:' + sp1, q: 'sroub tn ' + sp1, zaklad: '12 ks/m²' });
        r.push({ klic: 'srouby2', nazev: `Šrouby TN ${sp2} – pohledová vrstva`, mnozstvi: nahoru(pohled * 25), mj: 'ks', sv: 'sroub:' + sp2, q: 'sroub tn ' + sp2, zaklad: '25 ks/m²' });
      } else {
        r.push({ klic: 'srouby', nazev: 'Šrouby TN 25', mnozstvi: nahoru(pohled * 25), mj: 'ks', sv: tl === '15' ? 'sroub:35' : 'sroub:25', q: 'sroub tn', zaklad: '25 ks/m²' });
      }
      r.push({ klic: 'tmel', nazev: 'Tmel na spáry', mnozstvi: nahoru(pohled * 0.4), mj: 'kg', sv: 'tmel', q: 'tmel sadrokart', zaklad: '0,4 kg/m² pohledové plochy' });
      r.push({ klic: 'paska', nazev: 'Výztužná páska do spár', mnozstvi: nahoru(pohled * 1.2), mj: 'bm', jed: 'metry', sv: 'paska', q: 'pask spar', zaklad: '1,2 bm/m² pohledové plochy' });
      if (h.finalni) r.push({ klic: 'sterka', nazev: 'Finální stěrka', mnozstvi: nahoru(pohled * (h.spFinal || 0.6)), mj: 'kg', q: 'sterk final', vyloucit: 'fasad|lepic|cement|podlah|samoniv',
        zaklad: `${f3(h.spFinal || 0.6)} kg/m² pohledové plochy (${f3(zaok(pohled))} m²)` });
      // „akusti“ najde Akustik i Akustic (Isover, Knauf Insulation…); desky a sádrokarton se nevybírají
      if (h.izolace) r.push({ klic: 'izolace', nazev: 'Akustická izolace do dutiny', mnozstvi: zaok(A * 1.03), mj: 'm²', q: 'akusti', vyloucit: 'desk|sadrokart|profil|tmel', tlMax: podhled ? null : Number(h.profil),
        zaklad: `plocha +3 %, tloušťka do profilu ${podhled ? 'podle podhledu' : h.profil + ' mm'}` });
      r.push({ klic: 'tesneni', nazev: 'Těsnění pod profily', mnozstvi: zaok(h.obvod), mj: 'bm', jed: 'metry', sv: 'tesneni:' + (podhled ? 30 : h.profil), q: 'tesneni penove', zaklad: 'obvod konstrukce' });
      return { radky: r, prace: [
        { klic: 'montaz', nazev: 'Montáž SDK konstrukce', mj: 'm²', mnozstvi: zaok(A) },
        { klic: 'tmeleni', nazev: 'Tmelení a broušení Q2', mj: 'm²', mnozstvi: zaok(pohled) }]
        .concat(h.izolace ? [{ klic: 'montazIzolace', nazev: 'Montáž izolace do dutiny', mj: 'm²', mnozstvi: zaok(A) }] : [])
        .concat(h.finalni ? [{ klic: 'sterkovani', nazev: 'Finální stěrkování Q3', mj: 'm²', mnozstvi: zaok(pohled) }] : []) };
    }
  },

  omitka: {
    nazev: 'Omítky', ikona: '🧽', rozmer: 'mistnost', usek: 'Místnost', otvory: true,
    popis: 'Vnitřní omítky – jádro, štuk nebo obojí. Zadej místnosti, stěny i strop spočítám sám.',
    sablony: [
      { n: 'Jádro + štuk', h: { typ: 'dvou', tlJadro: '10', tlStuk: '2', strop: '1' } },
      { n: 'Jen štuk', h: { typ: 'stuk', tlStuk: '3', strop: '1' } },
      { n: 'Sanace – silnější jádro', h: { typ: 'dvou', tlJadro: '20', tlStuk: '2', strop: '0' } },
      { n: 'Sádrová strojní', h: { typ: 'jadro', tlJadro: '10', strop: '1', spJadro: '1' }, q: { jadro: 'omitka sadrov' } }
    ],
    pole: [
      { id: 'strop', popis: 'Omítat i strop', typ: 'ano', v: '1' },
      { id: 'typ', popis: 'Skladba', typ: 'volba', v: 'dvou', volby: [['dvou', 'Jádro + štuk'], ['jadro', 'Jen jádro'], ['stuk', 'Jen štuk']] },
      { id: 'tlJadro', popis: 'Tloušťka jádra', mj: 'mm', v: '10', ukaz: h => h.typ !== 'stuk' },
      { id: 'tlStuk', popis: 'Tloušťka štuku', mj: 'mm', v: '2', ukaz: h => h.typ !== 'jadro' },
      { id: 'spJadro', popis: 'Spotřeba jádra', mj: 'kg/m² na mm', v: '1,4', profi: P, ukaz: h => h.typ !== 'stuk' },
      { id: 'spStuk', popis: 'Spotřeba štuku', mj: 'kg/m² na mm', v: '1,3', profi: P, ukaz: h => h.typ !== 'jadro' },
      { id: 'osteni', popis: 'Hloubka ostění oken a dveří', mj: 'cm', v: '15', tip: 'Ostění se omítá zvlášť – o šířku zdi mínus rám okna. 0 = nepočítat.' },
      { id: 'rohyOm', popis: 'Vnější rohy', mj: 'ks', v: '0', profi: P, tip: 'Počet vnějších rohů místností – dostanou rohovou lištu na celou výšku.' },
      { id: 'sit', popis: 'Pletivo / síťovina na spoje', typ: 'ano', v: '0', tip: 'Přes spoje dvou materiálů (zdivo × beton), rýhy a pod štuk. Počítá 10 % plochy.' },
      { id: 'omitniky', popis: 'Omítníky (vodicí lišty)', typ: 'ano', v: '1', ukaz: h => h.typ !== 'stuk' },
      { id: 'penetrace', popis: 'Penetrace / můstek', typ: 'ano', v: '1' },
      { id: 'postrik', popis: 'Cementový postřik (podhoz)', typ: 'ano', v: '1', ukaz: h => h.typ !== 'stuk', tip: 'Zlepší přilnavost jádra na hladkém nebo savém podkladu (beton, cihla). Počítá 5 kg/m².' }
    ],
    jak: 'Stěny = obvod místnosti × výška − otvory + ostění (obvod otvorů × hloubka), strop = délka × šířka.\nJádro = plocha × tloušťka × spotřeba na mm.\nŠtuk = plocha × tloušťka × spotřeba na mm.\nOmítníky: lišta každých 1,5 m délky stěny, na celou výšku.\nRohovníky: obvod otvorů (ostění) + vnější rohy × výška.\nPletivo: 10 % plochy.\nPenetrace 0,2 l/m².',
    spocitej(h) {
      const ost = (h.obvodOtvoru || 0) * (h.osteni || 0) / 100;
      const A = h.steny + ost + (h.strop ? h.podlaha : 0);
      if (!A) return null;
      const r = [];
      if (h.penetrace) r.push({ klic: 'penetrace', nazev: 'Penetrace', mnozstvi: zaok(A * 0.2), mj: 'l', q: 'penetrac', zaklad: '0,2 l/m²' });
      if (h.postrik && h.typ !== 'stuk') r.push({ klic: 'postrik', nazev: 'Cementový postřik (podhoz)', mnozstvi: nahoru(A * 5), mj: 'kg', q: 'podhoz', vyloucit: 'sanac', zaklad: `${f3(zaok(A))} m² × 5 kg` });
      if (h.typ !== 'stuk') r.push({ klic: 'jadro', nazev: 'Jádrová omítka', mnozstvi: nahoru(A * (h.tlJadro || 10) * (h.spJadro || 1.4)), mj: 'kg', q: 'omitka jadr',
        zaklad: `${f3(zaok(A))} m² × ${f3(h.tlJadro || 10)} mm × ${f3(h.spJadro || 1.4)} kg` });
      if (h.typ !== 'jadro') r.push({ klic: 'stuk', nazev: 'Štuková omítka', mnozstvi: nahoru(A * (h.tlStuk || 2) * (h.spStuk || 1.3)), mj: 'kg', q: 'stuk',
        zaklad: `${f3(zaok(A))} m² × ${f3(h.tlStuk || 2)} mm × ${f3(h.spStuk || 1.3)} kg` });
      if (h.omitniky && h.typ !== 'stuk') {
        let bm = 0; h.useky.forEach(u => { if (u.d > 0 && u.s > 0 && u.v > 0) bm += Math.ceil(2 * (u.d + u.s) / 1.5) * u.v; });
        if (bm) r.push({ klic: 'omitnik', nazev: 'Omítník', mnozstvi: nahoru(bm), mj: 'bm', q: 'omitnik', zaklad: 'každých 1,5 m stěny' });
      }
      const roh = (h.obvodOtvoru || 0) + (h.rohyOm || 0) * (h.vyskaMax || 2.6);
      if (roh) r.push({ klic: 'rohovnik', nazev: 'Rohový profil', mnozstvi: nahoru(roh), mj: 'bm', q: 'rohovnik', zaklad: 'ostění otvorů + vnější rohy' });
      if (h.sit) r.push({ klic: 'sit', nazev: 'Pletivo / síťovina', mnozstvi: nahoru(A * 0.1), mj: 'm²', q: 'sitovin', zaklad: '10 % plochy' });
      const prO = [{ klic: 'omitani', nazev: 'Omítání', mj: 'm²', mnozstvi: zaok(A) }];
      if (h.obvodOtvoru > 0) prO.push({ klic: 'osteni', nazev: 'Omítání ostění (příplatek)', mj: 'bm', mnozstvi: zaok(h.obvodOtvoru) });
      return { radky: r, prace: prO };
    }
  },

  malba: {
    nazev: 'Malba', ikona: '🎨', rozmer: 'mistnost', usek: 'Místnost', otvory: true,
    popis: 'Vnitřní malby včetně penetrace a zakrývání. Stačí rozměry místností.',
    sablony: [
      { n: 'Nová omítka', h: { natery: '2', vydatnost: '6', penetrace: '1', strop: '1' } },
      { n: 'Přemalování', h: { natery: '1', vydatnost: '7', penetrace: '0', strop: '1' } },
      { n: 'Sytá barva', h: { natery: '3', vydatnost: '6', penetrace: '1', strop: '0' } }
    ],
    pole: [
      { id: 'strop', popis: 'Malovat i strop', typ: 'ano', v: '1' },
      { id: 'natery', popis: 'Počet nátěrů', typ: 'volba', v: '2', volby: [['1', '1×'], ['2', '2×'], ['3', '3×']] },
      { id: 'vydatnost', popis: 'Vydatnost barvy', mj: 'm²/kg', v: '6', profi: P, tip: 'Na obalu, u malířských barev obvykle 5–7 m² z 1 kg v jedné vrstvě.' },
      { id: 'penetrace', popis: 'Penetrace', typ: 'ano', v: '1' },
      { id: 'zakryti', popis: 'Zakrývací fólie a páska', typ: 'ano', v: '1' },
      { id: 'osteni', popis: 'Hloubka ostění oken a dveří', mj: 'cm', v: '15', profi: P, tip: 'Ostění se maluje také. 0 = nepočítat.' },
      { id: 'opravy', popis: 'Vyspravení a vyhlazení podkladu', typ: 'ano', v: '0', tip: 'Přetmelení trhlin a děr, u starých stěn i celoplošný glet.' },
      { id: 'pomucky', popis: 'Váleček, štětec, tácek', typ: 'ano', v: '1' }
    ],
    jak: 'Plocha = stěny − otvory + ostění + strop.\nBarva (kg) = plocha × počet nátěrů ÷ vydatnost.\nPenetrace 0,1 l/m² (ředěná).\nFólie = podlaha + 10 %, páska = 2 × obvod.\nVyspravení: tmel 0,15 kg/m².',
    spocitej(h) {
      const A = h.steny + (h.obvodOtvoru || 0) * (h.osteni || 0) / 100 + (h.strop ? h.podlaha : 0);
      if (!A) return null;
      const n = h.natery || 2;
      const r = [{ klic: 'barva', nazev: 'Malířská barva', mnozstvi: nahoru(A * n / (h.vydatnost || 6)), mj: 'kg', q: 'malirsk barv',
        zaklad: `${f3(zaok(A))} m² × ${n} ÷ ${f3(h.vydatnost || 6)} m²/kg` }];
      if (h.penetrace) r.push({ klic: 'penetrace', nazev: 'Penetrace', mnozstvi: zaok(A * 0.1), mj: 'l', q: 'penetrac', zaklad: '0,1 l/m²' });
      if (h.zakryti) {
        r.push({ klic: 'folie', nazev: 'Zakrývací fólie', mnozstvi: nahoru((h.podlaha || A * 0.3) * 1.1), mj: 'm²', q: 'zakryvac foli', zaklad: 'podlaha + 10 %' });
        r.push({ klic: 'paska', nazev: 'Malířská páska', mnozstvi: nahoru((h.obvod || 0) * 2), mj: 'bm', q: 'malirsk pask', zaklad: 'u podlahy a stropu' });
      }
      if (h.opravy) r.push({ klic: 'tmel', nazev: 'Tmel / štuk na opravy', mnozstvi: nahoru(A * 0.15), mj: 'kg', q: 'tmel', zaklad: '0,15 kg/m²' });
      if (h.pomucky) r.push({ klic: 'pomucky', nazev: 'Malířské pomůcky (váleček, štětec, tácek)', mnozstvi: 1, mj: 'sada', q: 'valecek', zaklad: 'na jednu zakázku' });
      const prM = [{ klic: 'malovani', nazev: 'Malování', mj: 'm²', mnozstvi: zaok(A) }];
      if (h.zakryti) prM.push({ klic: 'priprava', nazev: 'Zakrytí a příprava', mj: 'm²', mnozstvi: zaok(h.podlaha || A * 0.3) });
      if (h.opravy) prM.push({ klic: 'opravyPrace', nazev: 'Vyspravení a vyhlazení', mj: 'm²', mnozstvi: zaok(A) });
      return { radky: r, prace: prM };
    }
  },

  plocha: {
    nazev: 'Dlažba a obklad', ikona: '🟫', rozmer: 'plocha', usek: 'Plocha', otvory: true,
    popisky: () => ['Délka', 'Šířka / výška'],
    otvoryNadpis: 'Odečíst (vana, vanička, okno)',
    otvoryVolby: [['1.7,0.75', 'Vana 170'], ['0.9,0.9', 'Vanička 90'], ['0.8,1.97', 'Dveře 80'], ['1,1', 'Vlastní']],
    popis: 'Dlažby, obklady i velkoformáty. Obklad stěny zadej jako délka × výška stěny.',
    sablony: [
      { n: '30 × 60', h: { kd: '60', ksi: '30', spara: '3', tloustka: '9', zub: '8', oboustranne: '0' } },
      { n: '60 × 60', h: { kd: '60', ksi: '60', spara: '3', tloustka: '10', zub: '10', oboustranne: '1' } },
      { n: '20 × 25 obklad', h: { kd: '25', ksi: '20', spara: '2', tloustka: '7', zub: '6', oboustranne: '0' } },
      { n: '120 × 60', h: { kd: '120', ksi: '60', spara: '2', tloustka: '10', zub: '12', oboustranne: '1', prorez: '12' } }
    ],
    pole: [
      { id: 'kd', popis: 'Dlaždice – délka', mj: 'cm', v: '60' },
      { id: 'ksi', popis: 'Dlaždice – šířka', mj: 'cm', v: '30' },
      { id: 'zub', popis: 'Zubová stěrka', typ: 'volba', v: '8', volby: [['6', '6 mm'], ['8', '8 mm'], ['10', '10 mm'], ['12', '12 mm']], tip: '6 mm obklad, 8 mm běžná dlažba, 10–12 mm velkoformát.' },
      { id: 'oboustranne', popis: 'Lepit oboustranně', typ: 'ano', v: '0', tip: 'U velkoformátů a venku. Spotřeba lepidla +30 %.' },
      { id: 'spara', popis: 'Šířka spáry', mj: 'mm', v: '3', profi: P },
      { id: 'tloustka', popis: 'Tloušťka dlaždice', mj: 'mm', v: '9', profi: P },
      { id: 'prorez', popis: 'Prořez', mj: '%', v: '10', profi: P, tip: '10 % rovně, 15 % diagonálně nebo členitě.' },
      { id: 'baleniM2', popis: 'm² v balení', mj: 'm²', v: '0', profi: P, tip: '0 = neznám. Jinak zaokrouhlím na celá balení.' },
      { id: 'penetrace', popis: 'Penetrace', typ: 'ano', v: '1' },
      { id: 'sokl', popis: 'Sokl po obvodu', typ: 'ano', v: '0' },
      { id: 'silikon', popis: 'Silikon v rozích a u vany', typ: 'ano', v: '1', tip: 'Pružná spára v koutech, u podlahy, vany a sprchy – pro mokré prostory nutnost.' },
      { id: 'listy', popis: 'Rohové a ukončovací lišty', mj: 'bm', v: '0', tip: 'Vnější rohy obkladu, ukončení nad obkladem, přechod dlažba/koberec.' },
      { id: 'flex', popis: 'Flexibilní lepidlo (C2 S1)', typ: 'ano', v: '0', tip: 'Velkoformát, podlahové topení, venkovní plochy, koupelny nad podkladem se sádrokartonem.' }
    ],
    jak: 'Plocha = součet ploch − odečty, dlažba navýšená o prořez.\nLepidlo = zub (mm) × 0,45 kg/m², oboustranně × 1,3.\nSpárovačka = (A + B) ÷ (A × B) × šířka spáry × tloušťka × 1,6 kg/m² (A, B v mm).\nKřížky = počet dlaždic + 10 %.\nPenetrace 0,15 l/m², sokl = obvod ploch.\nSilikon: 1 kartuše (310 ml) na 10 bm spáry.\nLišty: zadaná délka + 5 %.',
    spocitej(h) {
      const A = h.plocha;
      if (!A) return null;
      const sPr = A * (1 + (h.prorez || 0) / 100);
      const r = [];
      let ks = 0;
      if (h.kd && h.ksi) {
        const sp = (h.spara || 0) / 10;
        ks = nahoru(sPr / (((h.kd + sp) / 100) * ((h.ksi + sp) / 100)));
      }
      let m2 = zaok(sPr), zakl = `${f3(zaok(A))} m² + prořez ${f3(h.prorez || 0)} %` + (ks ? `, ≈ ${ks} ks dlaždic` : '');
      if (h.baleniM2 > 0) { const bal = nahoru(sPr / h.baleniM2); m2 = zaok(bal * h.baleniM2); zakl += `, ${bal} balení`; }
      r.push({ klic: 'material', nazev: 'Dlažba / obklad', mnozstvi: m2, mj: 'm²', q: null, zaklad: zakl });
      const lep = A * (h.zub || 8) * 0.45 * (h.oboustranne ? 1.3 : 1);
      r.push({ klic: 'lepidlo', nazev: h.flex ? 'Flexibilní lepidlo na obklady a dlažby' : 'Lepidlo na obklady a dlažby', mnozstvi: nahoru(lep), mj: 'kg', q: h.flex ? 'lepidlo flex' : 'lepidlo obklad',
        zaklad: `zub ${f3(h.zub || 8)} mm × 0,45 kg/m²${h.oboustranne ? ', oboustranně +30 %' : ''}` });
      if (h.kd && h.ksi && h.spara) {
        const a = h.kd * 10, b = h.ksi * 10;
        const naM2 = (a + b) / (a * b) * h.spara * (h.tloustka || 9) * 1.6;
        r.push({ klic: 'spara', nazev: 'Spárovací hmota', mnozstvi: Math.max(1, nahoru(A * naM2)), mj: 'kg', q: 'sparovac', zaklad: `${f3(zaok(naM2))} kg/m²` });
      }
      if (ks) r.push({ klic: 'krizky', nazev: 'Spárovací křížky', mnozstvi: nahoru(ks * 1.1), mj: 'ks', q: 'krizk', zaklad: 'kus na dlaždici + 10 %' });
      if (h.penetrace) r.push({ klic: 'penetrace', nazev: 'Penetrace', mnozstvi: zaok(A * 0.15), mj: 'l', q: 'penetrac', zaklad: '0,15 l/m²' });
      if (h.sokl && h.obvod) r.push({ klic: 'sokl', nazev: 'Sokl', mnozstvi: nahoru(h.obvod * 1.05), mj: 'bm', q: 'sokl', zaklad: 'obvod + 5 %' });
      if (h.silikon && h.obvod) r.push({ klic: 'silikon', nazev: 'Sanitární silikon (kartuše 310 ml)', mnozstvi: nahoru(h.obvod / 10), mj: 'ks', q: 'silikon sanit', zaklad: '1 kartuše na 10 bm spáry, obvod ploch' });
      if (h.listy > 0) r.push({ klic: 'listy', nazev: 'Rohová / ukončovací lišta', mnozstvi: nahoru(h.listy * 1.05), mj: 'bm', q: 'list obklad', zaklad: 'zadaná délka + 5 %' });
      const pr = [{ klic: 'pokladka', nazev: 'Pokládka dlažby / obkladu', mj: 'm²', mnozstvi: zaok(A) }, { klic: 'sparovani', nazev: 'Spárování', mj: 'm²', mnozstvi: zaok(A) }];
      if (h.sokl && h.obvod) pr.push({ klic: 'sokl', nazev: 'Pokládka soklu', mj: 'bm', mnozstvi: nahoru(h.obvod) });
      if (h.silikon && h.obvod) pr.push({ klic: 'silikonovani', nazev: 'Silikonování spár', mj: 'bm', mnozstvi: nahoru(h.obvod) });
      if (h.listy > 0) pr.push({ klic: 'montazListy', nazev: 'Montáž lišt', mj: 'bm', mnozstvi: nahoru(h.listy) });
      return { radky: r, prace: pr };
    }
  },

  hydro: {
    nazev: 'Hydroizolace', ikona: '💧', rozmer: 'plocha', usek: 'Koupelna', otvory: false,
    popis: 'Stěrková hydroizolace koupelen a sprch pod obklad – stěrka, pásky, manžety i rohy.',
    sablony: [
      { n: 'Koupelna s vanou', h: { vyskaSten: '0,3', sprcha: '0', vrstvy: '2', prostupy: '3' } },
      { n: 'Sprchový kout', h: { vyskaSten: '0,3', sprcha: '3,6', vrstvy: '2', prostupy: '2' } },
      { n: 'Bezbariérová sprcha', h: { vyskaSten: '0,3', sprcha: '5', vrstvy: '2', prostupy: '3' } }
    ],
    pole: [
      { id: 'vyskaSten', popis: 'Izolace na stěnách do výšky', mj: 'm', v: '0,3', tip: 'Vytažení na stěnu kolem celé místnosti.' },
      { id: 'sprcha', popis: 'Stěny sprchy navíc', mj: 'm²', v: '0', tip: 'Např. 2 stěny 0,9 m × 2 m = 3,6 m².' },
      { id: 'vrstvy', popis: 'Vrstvy stěrky', typ: 'volba', v: '2', volby: [['2', '2 vrstvy'], ['3', '3 vrstvy']] },
      { id: 'spotreba', popis: 'Spotřeba na vrstvu', mj: 'kg/m²', v: '1,5', profi: P, tip: 'Podle výrobce, obvykle 1,2–1,6 kg/m² na vrstvu (celkem 3–3,5 kg/m² při tloušťce 2 mm).' },
      { id: 'prostupy', popis: 'Prostupy (voda, odpad)', mj: 'ks', v: '3' },
      { id: 'rohy', popis: 'Vnitřní rohy', mj: 'ks', v: '4', profi: P },
      { id: 'rohyVn', popis: 'Vnější rohy', mj: 'ks', v: '0', profi: P, tip: 'Např. zazdívka, výstupek nebo hrana vany.' },
      { id: 'vpust', popis: 'Podlahové vpusti / žlaby', mj: 'ks', v: '0', tip: 'Každá vpust potřebuje manžetu nebo přírubu zalitou do hydroizolace.' }
    ],
    jak: 'Plocha = podlaha + obvod × výška na stěnách + stěny sprchy.\nStěrka = plocha × vrstvy × spotřeba.\nPenetrace 0,2 l/m².\nPáska = obvod + svislé rohy (ve sprše do výšky 2 m).\nManžety = prostupy + vpusti.\nVnější rohy: 1 ks na roh.',
    spocitej(h) {
      if (!h.podlaha && !h.m2) return null;
      const A = h.podlaha + h.m2 + (h.obvod || 0) * (h.vyskaSten || 0) + (h.sprcha || 0);
      const vr = h.vrstvy || 2;
      const svisle = (h.rohy || 0) * (h.sprcha > 0 ? 2 : (h.vyskaSten || 0));
      return { radky: [
        { klic: 'penetrace', nazev: 'Penetrace', mnozstvi: zaok(A * 0.2), mj: 'l', q: 'penetrac', zaklad: '0,2 l/m²' },
        { klic: 'sterka', nazev: 'Hydroizolační stěrka', mnozstvi: nahoru(A * vr * (h.spotreba || 1.5)), mj: 'kg', q: 'hydroizolac',
          zaklad: `${f3(zaok(A))} m² × ${vr} vrstvy × ${f3(h.spotreba || 1.5)} kg` },
        { klic: 'paska', nazev: 'Těsnicí páska', mnozstvi: nahoru(((h.obvod || 0) + svisle) * 1.1), mj: 'bm', q: 'tesnic pask', zaklad: 'obvod + svislé rohy, +10 %' },
        ...(h.prostupy + h.vpust > 0 ? [{ klic: 'manzety', nazev: 'Těsnicí manžeta', mnozstvi: (h.prostupy || 0) + (h.vpust || 0), mj: 'ks', q: 'manzet', zaklad: 'na každý prostup a vpust' }] : []),
        ...(h.rohy > 0 ? [{ klic: 'rohy', nazev: 'Těsnicí roh vnitřní', mnozstvi: h.rohy, mj: 'ks', q: 'tesnic roh', zaklad: 'vnitřní rohy' }] : []),
        ...(h.rohyVn > 0 ? [{ klic: 'rohyVn', nazev: 'Těsnicí roh vnější', mnozstvi: h.rohyVn, mj: 'ks', q: 'tesnic roh vnejs', zaklad: 'vnější rohy' }] : [])
      ], prace: [{ klic: 'hydro', nazev: 'Hydroizolace', mj: 'm²', mnozstvi: zaok(A) },
        { klic: 'paskaPrace', nazev: 'Lepení těsnicích pásek a manžet', mj: 'bm', mnozstvi: nahoru(((h.obvod || 0) + svisle)) }] };
    }
  },

  nivelace: {
    nazev: 'Nivelace', ikona: '〰️', rozmer: 'plocha', usek: 'Místnost', otvory: false,
    popis: 'Samonivelační stěrka pod dlažbu nebo vinyl včetně penetrace a okrajové pásky.',
    sablony: [
      { n: '3 mm pod vinyl', h: { tl: '3' } }, { n: '5 mm', h: { tl: '5' } }, { n: '10 mm vyrovnání', h: { tl: '10' } }
    ],
    pole: [
      { id: 'tl', popis: 'Průměrná tloušťka', mj: 'mm', v: '5' },
      { id: 'sp', popis: 'Spotřeba', mj: 'kg/m² na mm', v: '1,6', profi: P, tip: 'Samonivelační stěrky 1,5–1,8 kg/m² na mm.' },
      { id: 'rezerva', popis: 'Rezerva na nerovnosti a zbytky', mj: '%', v: '5', profi: P, tip: 'U hodně nerovného podkladu 10 %.' },
      { id: 'penetrace', popis: 'Penetrace', typ: 'ano', v: '1' },
      { id: 'paska', popis: 'Okrajová dilatační páska', typ: 'ano', v: '1' }
    ],
    jak: 'Stěrka = plocha × tloušťka × spotřeba na mm + rezerva.\nPenetrace 0,15 l/m², páska = obvod + 5 %.\nPod savé podklady (anhydrit, cementový potěr) penetrace před stěrkou, po zaschnutí vyzkoušej vlhkost.',
    spocitej(h) {
      const A = h.plocha; if (!A) return null;
      const r = [];
      if (h.penetrace) r.push({ klic: 'penetrace', nazev: 'Penetrace', mnozstvi: zaok(A * 0.15), mj: 'l', q: 'penetrac', zaklad: '0,15 l/m²' });
      r.push({ klic: 'sterka', nazev: 'Samonivelační stěrka', mnozstvi: nahoru(A * (h.tl || 5) * (h.sp || 1.6) * (1 + (h.rezerva || 0) / 100)), mj: 'kg', q: 'samonivel',
        zaklad: `${f3(zaok(A))} m² × ${f3(h.tl || 5)} mm × ${f3(h.sp || 1.6)} kg, rezerva ${f3(h.rezerva || 0)} %` });
      if (h.paska && h.obvod) r.push({ klic: 'paska', nazev: 'Okrajová páska', mnozstvi: nahoru(h.obvod * 1.05), mj: 'bm', q: 'dilatac pask', zaklad: 'obvod + 5 %' });
      return { radky: r, prace: [{ klic: 'nivelace', nazev: 'Nivelace podlahy', mj: 'm²', mnozstvi: zaok(A) }] };
    }
  },

  podlaha: {
    nazev: 'Plovoucí podlaha', ikona: '🪵', rozmer: 'plocha', usek: 'Místnost', otvory: false,
    popis: 'Laminát, vinyl click i dřevěné plovoucí podlahy – balení, podložka, fólie a lišty.',
    sablony: [
      { n: 'Laminát', h: { baleniM2: '2,22', prorez: '7', podlozka: '1', folie: '1' } },
      { n: 'Vinyl click', h: { baleniM2: '2,2', prorez: '5', podlozka: '0', folie: '0' } },
      { n: 'Vinyl lepený', h: { baleniM2: '0', prorez: '5', podlozka: '0', folie: '0', lepidlo: '1' } },
      { n: 'Diagonálně', h: { prorez: '12' } }
    ],
    pole: [
      { id: 'baleniM2', popis: 'm² v balení', mj: 'm²', v: '2,22', tip: 'Na krabici. 0 = neznám.' },
      { id: 'prorez', popis: 'Prořez', mj: '%', v: '7', tip: 'Rovně 5–7 %, diagonálně 10–15 %.' },
      { id: 'podlozka', popis: 'Podložka', typ: 'ano', v: '1' },
      { id: 'folie', popis: 'Parozábrana na beton', typ: 'ano', v: '1' },
      { id: 'sokl', popis: 'Soklové lišty', typ: 'ano', v: '1' },
      { id: 'dvere', popis: 'Dveře (přechodové lišty)', mj: 'ks', v: '1' },
      { id: 'lepidlo', popis: 'Lepidlo (lepený vinyl, parkety)', typ: 'ano', v: '0', tip: 'Pro lepené podlahy místo podložky. Spotřeba cca 0,35 kg/m².' }
    ],
    jak: 'Podlaha = plocha × (1 + prořez), zaokrouhleno na celá balení.\nPodložka plocha + 5 %, fólie plocha + 15 % na přesahy.\nLišty = (obvod − 0,9 m na dveře) + 5 %.\nLepidlo na vinyl: 0,35 kg/m².\nSokl: koncovky a rohy se přikoupí podle půdorysu.',
    spocitej(h) {
      const A = h.plocha; if (!A) return null;
      const sPr = A * (1 + (h.prorez || 0) / 100);
      let m2 = zaok(sPr), zakl = `${f3(zaok(A))} m² + prořez ${f3(h.prorez || 0)} %`;
      if (h.baleniM2 > 0) { const b = nahoru(sPr / h.baleniM2); m2 = zaok(b * h.baleniM2); zakl += ` = ${b} balení`; }
      const r = [{ klic: 'podlaha', nazev: 'Podlaha', mnozstvi: m2, mj: 'm²', q: null, zaklad: zakl }];
      if (h.podlozka) r.push({ klic: 'podlozka', nazev: 'Podložka pod podlahu', mnozstvi: nahoru(A * 1.05), mj: 'm²', q: 'mirelon', zaklad: 'plocha + 5 %' });
      if (h.folie) r.push({ klic: 'folie', nazev: 'PE fólie parozábrana', mnozstvi: nahoru(A * 1.15), mj: 'm²', q: 'folie pe', zaklad: 'plocha + 15 % přesahy' });
      if (h.lepidlo) r.push({ klic: 'lepidlo', nazev: 'Lepidlo na podlahy', mnozstvi: nahoru(A * 0.35), mj: 'kg', q: 'lepidlo vinyl', zaklad: '0,35 kg/m²' });
      const lista = Math.max(0, (h.obvod || 0) - 0.9 * (h.dvere || 0));
      if (h.sokl && lista) r.push({ klic: 'sokl', nazev: 'Soklová lišta', mnozstvi: nahoru(lista * 1.05), mj: 'bm', q: 'soklov list', zaklad: 'obvod bez dveří + 5 %' });
      if (h.dvere > 0) r.push({ klic: 'prechod', nazev: 'Přechodová lišta', mnozstvi: h.dvere, mj: 'ks', q: 'prechodov list', zaklad: '1 na dveře' });
      const pr = [{ klic: 'pokladka', nazev: 'Pokládka podlahy', mj: 'm²', mnozstvi: zaok(A) }];
      if (h.sokl && lista) pr.push({ klic: 'listy', nazev: 'Montáž lišt', mj: 'bm', mnozstvi: nahoru(lista) });
      return { radky: r, prace: pr };
    }
  },

  objem: {
    nazev: 'Beton a potěr', ikona: '🪣', rozmer: 'plocha', usek: 'Plocha', otvory: false,
    popis: 'Potěry, mazaniny, desky i základy. Pytle, míchání na místě i beton z betonárny.',
    sablony: [
      { n: 'Potěr 5 cm', h: { tloustka: '5', rezerva: '5', forma: 'pytle' }, q: { smes: 'poter' } },
      { n: 'Mazanina 10 cm', h: { tloustka: '10', rezerva: '5', forma: 'michany', kari: '1' } },
      { n: 'Základový pas 40 cm', h: { tloustka: '40', rezerva: '10', forma: 'betonarna', ocel: '70', bedneni: '1' } }
    ],
    pole: [
      { id: 'tloustka', popis: 'Tloušťka', mj: 'cm', v: '5' },
      { id: 'forma', popis: 'Z čeho', typ: 'volba', v: 'pytle', volby: [['pytle', 'Pytle'], ['michany', 'Míchat'], ['betonarna', 'Betonárna']] },
      { id: 'vydatnost', popis: 'Vydatnost pytle', mj: 'l', v: '12,5', profi: P, ukaz: h => h.forma === 'pytle', tip: 'Pytel 25 kg dá zhruba 12,5 l směsi.' },
      { id: 'rezerva', popis: 'Rezerva', mj: '%', v: '5', profi: P, tip: 'Nerovný podklad 10 %.' },
      { id: 'kari', popis: 'Kari síť', typ: 'ano', v: '0' },
      { id: 'dilatace', popis: 'Okrajová páska', typ: 'ano', v: '0' },
      { id: 'folie', popis: 'PE fólie pod desku / potěr', typ: 'ano', v: '0', tip: 'Separační vrstva proti odtoku vody z betonu. Plocha + 15 % přesahy.' },
      { id: 'ocel', popis: 'Betonářská ocel', mj: 'kg/m³', v: '0', profi: P, tip: '0 = bez. Pas obvykle 60–100 kg/m³, deska 80–120 kg/m³.' },
      { id: 'bedneni', popis: 'Bednění po obvodu', typ: 'ano', v: '0', ukaz: h => h.forma !== 'pytle', tip: 'Pro desky a pasy. Plocha = obvod × tloušťka.' }
    ],
    jak: 'Objem = plocha × tloušťka + rezerva.\nPytle = objem v litrech ÷ vydatnost pytle.\nMíchaný C20/25 na 1 m³: 320 kg cementu, 0,65 m³ písku, 0,65 m³ štěrku, 160 l vody.\nKari síť plocha + 10 % přesahy.\nBetonářská ocel: objem × zadané kg/m³ + 5 % zbytky.\nBednění: obvod × tloušťka.\nPísek a štěrk se v kamenivu přepočítají na tuny (1,6 t/m³).',
    spocitej(h) {
      const A = h.plocha; if (!A || !h.tloustka) return null;
      const V = A * h.tloustka / 100 * (1 + (h.rezerva || 0) / 100);
      const zakl = `${f3(zaok(A))} m² × ${f3(h.tloustka)} cm + ${f3(h.rezerva || 0)} % = ${f3(zaok(V * 1000) / 1000)} m³`;
      const r = [];
      if (h.forma === 'pytle') r.push({ klic: 'smes', nazev: 'Směs v pytlích', mnozstvi: nahoru(V * 1000 / (h.vydatnost || 12.5)), mj: 'ks', q: 'beton smes', zaklad: zakl + `, ${f3(h.vydatnost || 12.5)} l z pytle` });
      else if (h.forma === 'michany') {
        r.push({ klic: 'cement', nazev: 'Cement', mnozstvi: nahoru(V * 320), mj: 'kg', q: 'cement', zaklad: zakl + ', 320 kg/m³' });
        r.push({ klic: 'pisek', nazev: 'Písek', mnozstvi: zaok(V * 0.65), mj: 'm³', q: 'pisek', zaklad: '0,65 m³ na m³' });
        r.push({ klic: 'sterk', nazev: 'Štěrk', mnozstvi: zaok(V * 0.65), mj: 'm³', q: 'sterk', zaklad: '0,65 m³ na m³, voda ' + f3(nahoru(V * 160)) + ' l' });
      } else r.push({ klic: 'beton', nazev: 'Beton z betonárny', mnozstvi: Math.ceil(V * 4) / 4, mj: 'm³', q: null, zaklad: zakl + ', objednat po 0,25 m³' });
      if (h.kari) r.push({ klic: 'kari', nazev: 'Kari síť', mnozstvi: zaok(A * 1.1), mj: 'm²', q: 'kari sit', zaklad: 'plocha + 10 % přesahy' });
      if (h.dilatace && h.obvod) r.push({ klic: 'paska', nazev: 'Okrajová páska', mnozstvi: nahoru(h.obvod * 1.05), mj: 'bm', q: 'dilatac pask', zaklad: 'obvod' });
      if (h.folie) r.push({ klic: 'folie', nazev: 'PE fólie', mnozstvi: nahoru(A * 1.15), mj: 'm²', q: 'folie pe', zaklad: 'plocha + 15 % přesahy' });
      if (h.ocel > 0) r.push({ klic: 'ocel', nazev: 'Betonářská ocel', mnozstvi: nahoru(V * h.ocel * 1.05), mj: 'kg', q: 'betonarska ocel', zaklad: `${f3(zaok(V * 1000) / 1000)} m³ × ${f3(h.ocel)} kg/m³ + 5 %` });
      if (h.bedneni && h.obvod && h.forma !== 'pytle') r.push({ klic: 'bedneni', nazev: 'Bednění', mnozstvi: zaok(h.obvod * h.tloustka / 100), mj: 'm²', q: 'bedneni', zaklad: `obvod ${f3(zaok(h.obvod))} m × ${f3(h.tloustka)} cm` });
      const prB = [{ klic: 'betonaz', nazev: 'Betonáž / potěr', mj: 'm²', mnozstvi: zaok(A) },
        { klic: 'betonazM3', nazev: 'Betonáž (podle objemu)', mj: 'm³', mnozstvi: zaok(V * 100) / 100 }];
      if (h.bedneni && h.obvod && h.forma !== 'pytle') prB.push({ klic: 'bedneniPrace', nazev: 'Bednění a odbednění', mj: 'm²', mnozstvi: zaok(h.obvod * h.tloustka / 100) });
      if (h.ocel > 0) prB.push({ klic: 'vyztuzovani', nazev: 'Vázání výztuže', mj: 'kg', mnozstvi: nahoru(V * h.ocel) });
      return { radky: r, prace: prB };
    }
  },

  fasada: {
    nazev: 'Zateplení', ikona: '🏠', rozmer: 'steny', usek: 'Fasáda', otvory: true,
    popis: 'Kontaktní zateplení od lepidla po omítku, s hmoždinkami, rohovníky a lištami.',
    sablony: [
      { n: 'EPS 100 mm', h: { izolant: 'eps70', tl: '10' } },
      { n: 'EPS 160 mm', h: { izolant: 'eps70', tl: '16' } },
      { n: 'EPS 200 mm', h: { izolant: 'eps70', tl: '20', hmozdinky: '8' } },
      { n: 'Vata 160 mm', h: { izolant: 'vata', tl: '16', hmozdinky: '8' } }
    ],
    pole: [
      { id: 'izolant', popis: 'Izolant', typ: 'volba', v: 'eps70', volby: [['eps70', 'EPS 70 F (fasádní)'], ['eps100', 'EPS 100 F (pevnější)'], ['vata', 'Minerální vata TF']] },
      { id: 'tl', popis: 'Tloušťka izolantu', mj: 'cm', v: '16' },
      { id: 'hmozdinky', popis: 'Hmoždinek na m²', v: '6', profi: P, tip: '6 ks v ploše, 8 ks u nároží a vyšších budov.' },
      { id: 'omitka', popis: 'Spotřeba omítky', mj: 'kg/m²', v: '2,5', tip: 'Zrno 1,5 mm ≈ 2,5 kg/m², zrno 2 mm ≈ 3,2 kg/m².' },
      { id: 'narozi', popis: 'Nároží budovy', mj: 'ks', v: '4', profi: P },
      { id: 'lista', popis: 'Zakládací lišta', typ: 'ano', v: '1' }
    ],
    jak: 'Plocha = součet stěn − otvory.\nLepidlo na desky 5 kg/m², stěrka 5 kg/m², perlinka plocha + 10 %.\nPenetrace pod omítku 0,25 kg/m², omítka podle spotřeby.\nZakládací (soklový) profil v šířce izolantu, kusy po 2 m.\nRohovníky = obvod otvorů + nároží × výška.\nDélka hmoždinky = izolant + 6 cm.',
    spocitej(h) {
      const A = h.plocha; if (!A) return null;
      const rohy = (h.obvodOtvoru || 0) + (h.narozi || 0) * (h.vyskaMax || 0);
      const tl = h.tl || 16, mm = Math.round(tl * 10);
      const izq = { eps70: `eps 70 f ${mm}mm`, eps100: `eps 100 f ${mm}mm`, vata: `tf profi ${mm} mm` }[h.izolant] || `eps 70 f ${mm}mm`;
      const izn = { eps70: 'Polystyren EPS 70 F', eps100: 'Polystyren EPS 100 F', vata: 'Minerální vata TF' }[h.izolant] || 'Polystyren EPS 70 F';
      const dHm = [110, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300].find(x => x >= mm + 60) || 300;
      const r = [
        { klic: 'izolant', nazev: `${izn} ${f3(tl)} cm`, mnozstvi: zaok(A * 1.03), mj: 'm²', q: izq, zaklad: 'plocha + 3 % prořez' },
        { klic: 'lepidlo', nazev: 'Lepidlo na izolant', mnozstvi: nahoru(A * 5), mj: 'kg', q: 'lepic sterkov', zaklad: '5 kg/m²' },
        { klic: 'hmozdinky', nazev: 'Talířová hmoždinka', mnozstvi: nahoru(A * (h.hmozdinky || 6)), mj: 'ks', q: `talirov hmozd ${dHm} mm`, zaklad: `${f3(h.hmozdinky || 6)} ks/m², délka ${dHm} mm (izolant + aspoň 6 cm)` },
        { klic: 'sterka', nazev: 'Stěrková hmota', mnozstvi: nahoru(A * 5), mj: 'kg', q: 'lepic sterkov', zaklad: '5 kg/m²' },
        { klic: 'perlinka', nazev: 'Perlinka', mnozstvi: nahoru(A * 1.1), mj: 'm²', q: 'perlink', zaklad: 'plocha + 10 %' },
        { klic: 'penetrace', nazev: 'Penetrace pod omítku', mnozstvi: zaok(A * 0.25), mj: 'kg', q: 'penetrac omitk', zaklad: '0,25 kg/m²' },
        { klic: 'omitka', nazev: 'Fasádní omítka', mnozstvi: nahoru(A * (h.omitka || 2.5)), mj: 'kg', q: 'omitka silikon', zaklad: `${f3(h.omitka || 2.5)} kg/m²` }
      ];
      if (h.lista && h.delka) r.push({ klic: 'lista', nazev: `Zakládací (soklový) profil ${f3(tl)} cm`, mnozstvi: nahoru(Math.max(0, h.delka - h.sirkaDveri) * 1.05), mj: 'bm', q: `soklov profil al ${tl}cm`, zaklad: `délka fasády bez dveří + 5 %, šířka podle izolantu ${f3(tl)} cm` });
      if (rohy) r.push({ klic: 'rohovnik', nazev: 'Rohovník s perlinkou', mnozstvi: nahoru(rohy * 1.05), mj: 'bm', q: 'rohov tkanin', vyloucit: 'bez tkan|dilatac', zaklad: 'ostění + nároží + 5 %' });
      if (h.otvoryN) {
        const apu = h.otvory.reduce((s, o) => s + (2 * (o.v || 0) + (o.s || 0)) * (o.n || 0), 0);
        r.push({ klic: 'apu', nazev: 'Okenní APU lišta', mnozstvi: nahoru(apu), mj: 'bm', q: 'apu list', zaklad: 'napojení na okna' });
      }
      const prF = [{ klic: 'zatepleni', nazev: 'Zateplení fasády', mj: 'm²', mnozstvi: zaok(A) },
        { klic: 'leseni', nazev: 'Lešení (montáž, pronájem, demontáž)', mj: 'm²', mnozstvi: zaok(A + (h.plochaOtvoru || 0)) }];
      if (h.obvodOtvoru > 0) prF.push({ klic: 'osteniF', nazev: 'Zateplení ostění a parapetů', mj: 'bm', mnozstvi: zaok(h.obvodOtvoru) });
      return { radky: r, prace: prF };
    }
  },

  strecha: {
    nazev: 'Střecha', ikona: '🏚️', rozmer: 'plocha', usek: 'Půdorys', otvory: true,
    popisky: () => ['Délka (po hřebeni)', 'Šířka domu'],
    otvoryNadpis: 'Odečíst (střešní okna, komín)',
    otvoryVolby: [['0.78,1.18', 'Okno 78×118'], ['1.14,1.18', 'Okno 114×118'], ['0.6,0.6', 'Komín'], ['1,1', 'Vlastní']],
    popis: 'Šikmé střechy z tašek, plechu nebo šindele. Zadej půdorys domu, sklon a přesah – skutečnou plochu střechy dopočítám.',
    sablony: [
      { n: 'Betonová taška 35°', h: { krytina: 'taska', sklon: '35', kusuM2: '10', lat: '33' } },
      { n: 'Pálená taška 40°', h: { krytina: 'taska', sklon: '40', kusuM2: '13', lat: '32' } },
      { n: 'Plech 20°', h: { krytina: 'plech', sklon: '20', lat: '35' } },
      { n: 'Asfaltový šindel 30°', h: { krytina: 'sindel', sklon: '30' } }
    ],
    pole: [
      { id: 'krytina', popis: 'Krytina', typ: 'volba', v: 'taska', volby: [['taska', 'Tašky'], ['plech', 'Plech'], ['sindel', 'Šindel']] },
      { id: 'sklon', popis: 'Sklon střechy', mj: '°', v: '35', tip: 'Tašky obvykle od 22°, plech od 8–10°, šindel od 12°.' },
      { id: 'pres', popis: 'Přesah přes zeď', mj: 'cm', v: '40', tip: 'Okapový a štítový přesah, obvykle 30–60 cm.' },
      { id: 'kusuM2', popis: 'Tašek na m²', mj: 'ks', v: '10', ukaz: h => h.krytina === 'taska', tip: 'Podle výrobce: betonové cca 10, pálené drážkové 13–16.' },
      { id: 'lat', popis: 'Rozteč latí', mj: 'cm', v: '33', ukaz: h => h.krytina !== 'sindel', tip: 'Tašky podle krytiny (30–35 cm), plech 35–40 cm. Šindel jde na celoplošné bednění.' },
      { id: 'krokve', popis: 'Rozteč krokví', mj: 'cm', v: '90', profi: P, tip: 'Kontralatě vedou po každé krokvi.' },
      { id: 'folie', popis: 'Podstřešní fólie', typ: 'ano', v: '1' },
      { id: 'zlab', popis: 'Okapní žlaby a háky', typ: 'ano', v: '1' },
      { id: 'vyskaSvodu', popis: 'Výška svodu', mj: 'm', v: '6', profi: P, ukaz: h => h.zlab, tip: 'Od okapu k terénu. Svod se počítá na každých 10 m okapu, nejméně 2.' },
      { id: 'vetrPas', popis: 'Větrací pás hřebene', typ: 'ano', v: '1', ukaz: h => h.krytina !== 'sindel' },
      { id: 'hreben', popis: 'Délka hřebene a nároží', mj: 'm', v: '0', profi: P, tip: '0 = délka domu (sedlová střecha).' },
      { id: 'okap', popis: 'Délka okapu', mj: 'm', v: '0', profi: P, tip: '0 = 2 × délka domu (sedlová střecha).' },
      { id: 'prorez', popis: 'Prořez', mj: '%', v: '5', profi: P, tip: 'Valbová nebo členitá střecha 8–10 %.' }
    ],
    jak: 'Plocha střechy = (půdorys + obvod × přesah + 4 × přesah²) ÷ cos(sklon) − okna a komíny.\nTašky: plocha × kusů na m² + prořez; hřebenáč po 38 cm.\nPlech: plocha + 10 % na přesahy a ořezy; šindel: plocha + 10 %, na celoplošné bednění (+8 %).\nLatě: plocha ÷ rozteč + 5 %, kontralatě: plocha ÷ rozteč krokví + 5 %.\nPodstřešní fólie: plocha + 15 % přesahy.\nŽlab = délka okapu, hák každých 60 cm.',
    spocitej(h) {
      if (!h.podlaha) return null;
      const cos = Math.cos(Math.min(75, Math.max(0, h.sklon || 35)) * Math.PI / 180), pr = (h.pres || 0) / 100;
      const A = Math.max(0, (h.podlaha + h.obvod * pr + 4 * pr * pr) / cos - h.plochaOtvoru);
      const heb = h.hreben > 0 ? h.hreben : h.delka, okap = h.okap > 0 ? h.okap : 2 * h.delka;
      const z0 = `střecha ${f3(zaok(A))} m² (sklon ${f3(h.sklon)}°, přesah ${f3(h.pres)} cm)`;
      const r = [];
      if (h.krytina === 'taska') {
        r.push({ klic: 'krytina', nazev: 'Střešní tašky', mnozstvi: nahoru(A * (h.kusuM2 || 10) * (1 + (h.prorez || 0) / 100)), mj: 'ks', q: null, zaklad: `${z0}, ${f3(h.kusuM2 || 10)} ks/m², prořez ${f3(h.prorez || 0)} %` });
        if (heb > 0) r.push({ klic: 'hrebenac', nazev: 'Hřebenáč (taška hřebenová)', mnozstvi: nahoru(heb / 0.38), mj: 'ks', q: null, zaklad: `hřeben ${f3(zaok(heb))} m ÷ 0,38 m` });
      } else if (h.krytina === 'plech') {
        r.push({ klic: 'krytina', nazev: 'Plechová krytina', mnozstvi: nahoru(A * 1.1), mj: 'm²', q: null, zaklad: z0 + ', +10 % přesahy a ořez' });
        if (heb > 0) r.push({ klic: 'hrebenac', nazev: 'Hřebenáč plechový', mnozstvi: nahoru(heb * 1.05), mj: 'bm', q: null, zaklad: 'délka hřebene + 5 %' });
      } else {
        r.push({ klic: 'bedneni', nazev: 'Bednění (OSB / prkna)', mnozstvi: nahoru(A * 1.08), mj: 'm²', q: 'osb', zaklad: z0 + ', +8 %' });
        r.push({ klic: 'krytina', nazev: 'Asfaltový šindel', mnozstvi: nahoru(A * 1.1), mj: 'm²', q: 'sindel', zaklad: z0 + ', +10 % ořez' });
        if (heb > 0) r.push({ klic: 'hrebenac', nazev: 'Hřebenový šindel', mnozstvi: nahoru(heb * 1.05), mj: 'bm', q: 'hrebenac sindel', zaklad: 'délka hřebene + 5 %' });
      }
      if (h.folie) r.push({ klic: 'folie', nazev: 'Podstřešní (difuzní) fólie', mnozstvi: nahoru(A * 1.15), mj: 'm²', q: 'folie difuzni', zaklad: 'plocha + 15 % přesahy, role 75 m²' });
      if (h.krytina !== 'sindel') r.push({ klic: 'late', nazev: 'Střešní latě', mnozstvi: nahoru(A / ((h.lat || 33) / 100) * 1.05), mj: 'bm', q: 'lat susen', zaklad: `rozteč ${f3(h.lat || 33)} cm, +5 %` });
      r.push({ klic: 'kontralate', nazev: 'Kontralatě', mnozstvi: nahoru(A / ((h.krokve || 90) / 100) * 1.05), mj: 'bm', q: 'lat susen', zaklad: `rozteč krokví ${f3(h.krokve || 90)} cm, +5 %` });
      if (h.zlab && okap > 0) {
        r.push({ klic: 'zlab', nazev: 'Okapní žlab', mnozstvi: nahoru(okap * 1.05), mj: 'bm', q: 'zlab', zaklad: `okap ${f3(zaok(okap))} m + 5 %` });
        r.push({ klic: 'hak', nazev: 'Hák žlabu', mnozstvi: nahoru(okap / 0.6) + 1, mj: 'ks', q: 'hak zlab', zaklad: 'každých 60 cm' });
        const nSv = Math.max(2, Math.ceil(okap / 10)), vSv = h.vyskaSvodu > 0 ? h.vyskaSvodu : 6;
        r.push({ klic: 'kotlik', nazev: 'Kotlík žlabu', mnozstvi: nSv, mj: 'ks', q: 'kotlik', zaklad: `${nSv} svodů (1 na 10 m okapu)` });
        r.push({ klic: 'svod', nazev: 'Okapní svod', mnozstvi: nahoru(nSv * vSv * 1.05), mj: 'bm', q: 'roura svod', zaklad: `${nSv} svodů × ${f3(vSv)} m + 5 %` });
        r.push({ klic: 'objimky', nazev: 'Objímka svodu', mnozstvi: nSv * Math.ceil(vSv / 2), mj: 'ks', q: 'objimk svod', zaklad: `${nSv} svodů × 1 objímka na 2 m` });
      }
      if (h.vetrPas && h.krytina !== 'sindel' && heb > 0) r.push({ klic: 'vetrPas', nazev: 'Větrací pás hřebene', mnozstvi: nahoru(heb * 1.05), mj: 'bm', q: 'vetrac pas hreben', zaklad: 'délka hřebene + 5 %' });
      const pr2 = [{ klic: 'pokryvani', nazev: 'Pokrývání střechy', mj: 'm²', mnozstvi: zaok(A) }, { klic: 'latovani', nazev: h.krytina === 'sindel' ? 'Bednění střechy' : 'Latování a kontralatě', mj: 'm²', mnozstvi: zaok(A) }];
      if (h.folie) pr2.push({ klic: 'foliePrace', nazev: 'Položení podstřešní fólie', mj: 'm²', mnozstvi: zaok(A) });
      if (heb > 0) pr2.push({ klic: 'hrebenPrace', nazev: 'Hřeben a nároží', mj: 'bm', mnozstvi: zaok(heb) });
      if (h.zlab && okap > 0) pr2.push({ klic: 'zlabPrace', nazev: 'Montáž žlabů', mj: 'bm', mnozstvi: zaok(okap) });
      if (h.zlab && okap > 0) { const nSv = Math.max(2, Math.ceil(okap / 10)); pr2.push({ klic: 'svodPrace', nazev: 'Montáž svodů', mj: 'bm', mnozstvi: zaok(nSv * (h.vyskaSvodu > 0 ? h.vyskaSvodu : 6)) }); }
      return { radky: r, prace: pr2 };
    }
  },

  podkrovi: {
    nazev: 'Zateplení podkroví', ikona: '🌡️', rozmer: 'plocha', usek: 'Šikmina', otvory: true,
    popisky: () => ['Délka', 'Šířka (po krokvi)'],
    otvoryNadpis: 'Odečíst (střešní okno, komín)',
    otvoryVolby: [['0.78,1.18', 'Okno 78×118'], ['1.14,1.18', 'Okno 114×118'], ['0.6,0.6', 'Komín'], ['1,1', 'Vlastní']],
    popis: 'Izolace šikmé střechy zevnitř – vata mezi krokve, případně druhá vrstva pod krokve, parozábrana a lepicí pásky.',
    sablony: [
      { n: 'Vata 200 mm', h: { tl: '20', tl2: '0' } },
      { n: '160 + 60 křížem', h: { tl: '16', tl2: '6' } },
      { n: '240 + 60 křížem', h: { tl: '24', tl2: '6' } }
    ],
    pole: [
      { id: 'tl', popis: 'Izolace mezi krokve', mj: 'cm', v: '20', tip: 'Podle výšky krokví; pro nízkoenergetický dům 24 cm a víc.' },
      { id: 'tl2', popis: 'Druhá vrstva pod krokve', mj: 'cm', v: '0', tip: '0 = bez druhé vrstvy. Překrývá krokve a snižuje tepelné mosty.' },
      { id: 'parozabrana', popis: 'Parozábrana', typ: 'ano', v: '1' },
      { id: 'paska', popis: 'Lepicí a těsnicí pásky', typ: 'ano', v: '1' },
      { id: 'prorez', popis: 'Prořez', mj: '%', v: '5', profi: P, tip: 'Vata se do rozteče krokví řeže s přesahem; nerovné krokve 8–10 %.' }
    ],
    jak: 'Plocha = součet šikmin − okna a komíny.\nVata = plocha + prořez (druhá vrstva stejně).\nParozábrana = plocha + 15 % přesahy.\nPáska = 0,7 bm/m² na spoje + obvod na napojení.',
    spocitej(h) {
      const A = h.plocha; if (!A) return null;
      const pr = 1 + (h.prorez || 0) / 100;
      const r = [{ klic: 'vata', nazev: `Izolace mezi krokve ${f3(h.tl || 20)} cm`, mnozstvi: zaok(A * pr), mj: 'm²', q: 'vata', zaklad: `${f3(zaok(A))} m² + prořez ${f3(h.prorez || 0)} %` }];
      if (h.tl2 > 0) r.push({ klic: 'vata2', nazev: `Izolace pod krokve ${f3(h.tl2)} cm`, mnozstvi: zaok(A * pr), mj: 'm²', q: 'vata', zaklad: 'druhá vrstva přes krokve' });
      if (h.parozabrana) r.push({ klic: 'parozabrana', nazev: 'Parozábrana', mnozstvi: nahoru(A * 1.15), mj: 'm²', q: 'parozabran', zaklad: 'plocha + 15 % přesahy' });
      if (h.paska) r.push({ klic: 'paska', nazev: 'Lepicí páska na parozábranu', mnozstvi: nahoru(A * 0.7 + (h.obvod || 0)), mj: 'bm', q: 'pask parozabran', zaklad: '0,7 bm/m² + obvod' });
      return { radky: r, prace: [{ klic: 'izolace', nazev: 'Montáž izolace', mj: 'm²', mnozstvi: zaok(A) }].concat(h.parozabrana ? [{ klic: 'parozabranaPrace', nazev: 'Montáž parozábrany', mj: 'm²', mnozstvi: zaok(A) }] : []) };
    }
  },

  zamkova: {
    nazev: 'Zámková dlažba', ikona: '🛣️', rozmer: 'plocha', usek: 'Plocha', otvory: true,
    otvoryNadpis: 'Odečíst (šachta, sloup, záhon)',
    otvoryVolby: [['0.6,0.6', 'Šachta 60'], ['1,1', 'Vlastní']],
    popis: 'Chodníky, příjezdy a terasy – dlažba, podsyp, podkladní vrstva, obrubníky, geotextilie i výkop.',
    sablony: [
      { n: 'Chodník 6 cm', h: { tl: '6', lozeni: '4', podklad: '15' } },
      { n: 'Příjezd 8 cm', h: { tl: '8', lozeni: '4', podklad: '25' } },
      { n: 'Terasa 4 cm', h: { tl: '4', lozeni: '3', podklad: '10', obrubniky: '0' } }
    ],
    pole: [
      { id: 'tl', popis: 'Tloušťka dlažby', mj: 'cm', v: '6', tip: 'Pochozí 4–6 cm, pojízdná osobním autem 8 cm.' },
      { id: 'lozeni', popis: 'Lože (drť 4/8)', mj: 'cm', v: '4' },
      { id: 'podklad', popis: 'Podkladní vrstva (0/32)', mj: 'cm', v: '15', tip: 'Chodník 10–15 cm, příjezd 20–30 cm hutněné vrstvy.' },
      { id: 'geo', popis: 'Geotextilie', typ: 'ano', v: '1' },
      { id: 'obrubniky', popis: 'Obrubníky po obvodu', typ: 'ano', v: '1' },
      { id: 'sparovaci', popis: 'Písek do spár', typ: 'ano', v: '1' },
      { id: 'prorez', popis: 'Prořez', mj: '%', v: '5', profi: P, tip: 'Rovné plochy 3–5 %, oblouky a složitý tvar 8–12 %.' },
      { id: 'zhutneni', popis: 'Zhutnění podkladu', mj: '%', v: '10', profi: P, tip: 'Rezerva kameniva na slehnutí.' }
    ],
    jak: 'Dlažba = plocha + prořez.\nLože: plocha × tloušťka × 1,6 t/m³ + zhutnění.\nPodklad: plocha × tloušťka × 2,0 t/m³ + zhutnění.\nGeotextilie: plocha + 15 %.\nObrubník: obvod + 2 %, beton pod obrubník 30 l na bm.\nPísek do spár: 1,5 kg/m².\nVýkop = plocha × (dlažba + lože + podklad).',
    spocitej(h) {
      const A = h.plocha; if (!A) return null;
      const hu = 1 + (h.zhutneni || 0) / 100;
      const r = [{ klic: 'dlazba', nazev: 'Zámková dlažba', mnozstvi: zaok(A * (1 + (h.prorez || 0) / 100)), mj: 'm²', q: null, zaklad: `${f3(zaok(A))} m² + prořez ${f3(h.prorez || 0)} %` },
        { klic: 'lozeni', nazev: 'Drť 4/8 do lože', mnozstvi: zaok(A * (h.lozeni || 4) / 100 * 1.6 * hu), mj: 't', q: 'drt 4 8', zaklad: `${f3(h.lozeni || 4)} cm × 1,6 t/m³ + ${f3(h.zhutneni || 0)} %` },
        { klic: 'podklad', nazev: 'Štěrkodrť 0/32 – podklad', mnozstvi: zaok(A * (h.podklad || 15) / 100 * 2 * hu), mj: 't', q: 'sterkodrt 0 32', zaklad: `${f3(h.podklad || 15)} cm × 2,0 t/m³ + ${f3(h.zhutneni || 0)} %` }];
      if (h.geo) r.push({ klic: 'geo', nazev: 'Geotextilie', mnozstvi: nahoru(A * 1.15), mj: 'm²', q: 'geotextili', zaklad: 'plocha + 15 %' });
      if (h.obrubniky && h.obvod) {
        r.push({ klic: 'obrubnik', nazev: 'Obrubník', mnozstvi: nahoru(h.obvod * 1.02), mj: 'bm', q: 'obrubnik', zaklad: 'obvod + 2 %' });
        r.push({ klic: 'betonObr', nazev: 'Beton pod obrubníky (pytel)', mnozstvi: nahoru(h.obvod * 30 / 12.5), mj: 'ks', q: 'beton smes', zaklad: '30 l na bm, pytel 12,5 l' });
      }
      if (h.sparovaci) r.push({ klic: 'pisek', nazev: 'Písek do spár', mnozstvi: nahoru(A * 1.5), mj: 'kg', q: 'pisek spar', zaklad: '1,5 kg/m²' });
      const vykop = zaok(A * ((h.tl || 6) + (h.lozeni || 4) + (h.podklad || 15)) / 100);
      const pr = [{ klic: 'vykop', nazev: 'Výkop a odvoz zeminy', mj: 'm³', mnozstvi: vykop }, { klic: 'zhutneni', nazev: 'Úprava a zhutnění podkladu', mj: 'm²', mnozstvi: zaok(A) },
        { klic: 'pokladka', nazev: 'Pokládka zámkové dlažby', mj: 'm²', mnozstvi: zaok(A) }];
      if (h.obrubniky && h.obvod) pr.push({ klic: 'obrubnikPrace', nazev: 'Osazení obrubníků', mj: 'bm', mnozstvi: nahoru(h.obvod) });
      return { radky: r, prace: pr };
    }
  },

  skladba: {
    nazev: 'Skladba podlahy', ikona: '🧊', rozmer: 'plocha', usek: 'Místnost', otvory: false,
    popis: 'Plovoucí podlaha na zemině nebo stropu: hydroizolace, polystyren, fólie, okrajová páska, kari síť a cementový potěr.',
    sablony: [
      { n: 'EPS 50 + potěr 50', h: { tlEps: '5', tlPoter: '5', hydro: '0' } },
      { n: 'EPS 100 + potěr 60', h: { tlEps: '10', tlPoter: '6', hydro: '1' } },
      { n: 'Jen potěr 50', h: { tlEps: '0', tlPoter: '5', hydro: '0' } }
    ],
    pole: [
      { id: 'tlEps', popis: 'Polystyren EPS', mj: 'cm', v: '5', tip: '0 = bez tepelné izolace. Pod potěr na zemině běžně EPS 100 / 150.' },
      { id: 'tlPoter', popis: 'Tloušťka potěru', mj: 'cm', v: '5' },
      { id: 'hydro', popis: 'Hydroizolace proti zemní vlhkosti', typ: 'ano', v: '0', tip: 'Asfaltový pás nebo izolace na betonové desce nad terénem.' },
      { id: 'folie', popis: 'PE fólie nad izolantem', typ: 'ano', v: '1' },
      { id: 'okraj', popis: 'Okrajová dilatační páska', typ: 'ano', v: '1' },
      { id: 'kari', popis: 'Kari síť', typ: 'ano', v: '0' },
      { id: 'vydatnost', popis: 'Vydatnost pytle potěru', mj: 'l', v: '12,5', profi: P },
      { id: 'rezerva', popis: 'Rezerva potěru', mj: '%', v: '5', profi: P }
    ],
    jak: 'Hydroizolace a fólie: plocha + 15 % přesahy.\nPolystyren: plocha + 3 %.\nOkrajová páska: obvod + 5 %.\nPotěr: plocha × tloušťka + rezerva, pytel dá cca 12,5 l.\nKari: plocha + 10 %.',
    spocitej(h) {
      const A = h.plocha; if (!A) return null;
      const r = [];
      if (h.hydro) r.push({ klic: 'hydro', nazev: 'Hydroizolační pás', mnozstvi: nahoru(A * 1.15), mj: 'm²', q: 'hydroizolac pas', zaklad: 'plocha + 15 % přesahy' });
      if (h.tlEps > 0) r.push({ klic: 'eps', nazev: `Polystyren EPS ${f3(h.tlEps * 10)} mm`, mnozstvi: zaok(A * 1.03), mj: 'm²', q: 'eps podlah', zaklad: 'plocha + 3 %' });
      if (h.folie) r.push({ klic: 'folie', nazev: 'PE fólie', mnozstvi: nahoru(A * 1.15), mj: 'm²', q: 'folie pe', zaklad: 'plocha + 15 % přesahy' });
      if (h.okraj && h.obvod) r.push({ klic: 'okraj', nazev: 'Okrajová dilatační páska', mnozstvi: nahoru(h.obvod * 1.05), mj: 'bm', q: 'dilatac pask', zaklad: 'obvod + 5 %' });
      if (h.kari) r.push({ klic: 'kari', nazev: 'Kari síť', mnozstvi: zaok(A * 1.1), mj: 'm²', q: 'kari sit', zaklad: 'plocha + 10 %' });
      if (h.tlPoter > 0) r.push({ klic: 'poter', nazev: 'Cementový potěr (pytel)', mnozstvi: nahoru(A * h.tlPoter / 100 * 1000 * (1 + (h.rezerva || 0) / 100) / (h.vydatnost || 12.5)), mj: 'ks', q: 'poter',
        zaklad: `${f3(zaok(A))} m² × ${f3(h.tlPoter)} cm + ${f3(h.rezerva || 0)} %, ${f3(h.vydatnost || 12.5)} l z pytle` });
      const pr = [];
      if (h.hydro) pr.push({ klic: 'hydroPrace', nazev: 'Položení hydroizolace', mj: 'm²', mnozstvi: zaok(A) });
      if (h.tlEps > 0) pr.push({ klic: 'izolacePrace', nazev: 'Položení izolace a fólie', mj: 'm²', mnozstvi: zaok(A) });
      if (h.tlPoter > 0) pr.push({ klic: 'poterPrace', nazev: 'Potěr (příprava, litý / zpracování)', mj: 'm²', mnozstvi: zaok(A) });
      return { radky: r, prace: pr };
    }
  },

  elektro: {
    nazev: 'Elektroinstalace', ikona: '🔌', rozmer: 'plocha', usek: 'Byt / patro', otvory: false,
    popisky: () => ['Délka', 'Šířka'],
    popis: 'Rozvody v bytě nebo domku: kabely, krabice, přístroje, svorky a rýhování. Plocha slouží k odhadu délek kabelů; počty bodů zadej podle projektu.',
    sablony: [
      { n: 'Garsonka', h: { zas: '8', vyp: '4', sv: '5', sporak: '1', okruhy: '6' } },
      { n: 'Byt 3+kk', h: { zas: '22', vyp: '9', sv: '12', sporak: '1', okruhy: '10' } },
      { n: 'Rodinný dům', h: { zas: '45', vyp: '20', sv: '28', sporak: '1', okruhy: '18' } }
    ],
    pole: [
      { id: 'montaz', popis: 'Provedení', typ: 'volba', v: 'omitka', volby: [['omitka', 'Pod omítku'], ['listy', 'Na povrch v lištách']], tip: 'Pod omítku: krabice KU 68, přístroje s rámečkem a rýhy. V lištách: nástěnné zásuvky a vypínače, vkládací lišty, bez sekání.' },
      { id: 'zas', popis: 'Zásuvky 230 V', mj: 'ks', v: '10', tip: 'Jednoduché i dvojité počítej jako 1 bod.' },
      { id: 'vyp', popis: 'Vypínače a přepínače', mj: 'ks', v: '5' },
      { id: 'sv', popis: 'Světelné body', mj: 'ks', v: '6' },
      { id: 'sporak', popis: 'Silové vývody 400 V (sporák, trouba, ohřev)', mj: 'ks', v: '1' },
      { id: 'okruhy', popis: 'Okruhy – jističe v rozvaděči', mj: 'ks', v: '8' },
      { id: 'rysy', popis: 'Zasekávání rýh ve zdi', typ: 'ano', v: '1', ukaz: h => h.montaz !== 'listy', tip: 'Odečti, pokud vedeš kabely podlahou, podhledem nebo v SDK.' },
      { id: 'dlBod', popis: 'Průměrná délka kabelu na bod', mj: 'm', v: '0', profi: P, tip: '0 = odhad z plochy. Typicky 6–10 m včetně svislic.' },
      { id: 'rezerva', popis: 'Rezerva kabelů', mj: '%', v: '10', profi: P }
    ],
    jak: 'Délka na bod = 3 + 0,6 × √plocha (m), nebo zadaná hodnota.\nCYKY 3×2,5: zásuvky; CYKY 5×2,5: silové vývody 400 V; CYKY 3×1,5: světla + vypínače (+2,5 m svislice).\nKrabice KU 68: zásuvky + vypínače + světla; rozvodné krabice: okruhy.\nSvorky: 3 ks na bod. Přístroje: zásuvky + vypínače.\nPod omítku: rýhy 60 % délky kabelů.\nV lištách: lišta 18×13 na 70 % délky kabelů, 40×20 na hlavní trasy (15 %), přístroje nástěnné, krabice na povrch.',
    spocitej(h) {
      const body = (h.zas || 0) + (h.vyp || 0) + (h.sv || 0) + (h.sporak || 0);
      if (!body) return null;
      const A = h.plocha;
      const bod = h.dlBod > 0 ? h.dlBod : 3 + 0.6 * Math.sqrt(A || 40);
      const rez = 1 + (h.rezerva || 0) / 100;
      const cyky25 = (h.zas || 0) * bod * rez, cyky5 = (h.sporak || 0) * bod * rez, cyky15 = ((h.sv || 0) * bod + (h.vyp || 0) * 2.5) * rez;
      const z0 = `${f3(zaok(bod))} m na bod, rezerva ${f3(h.rezerva || 0)} %`;
      const r = [];
      if (cyky25) r.push({ klic: 'cyky25', nazev: 'Kabel CYKY 3×2,5', mnozstvi: nahoru(cyky25), mj: 'bm', q: 'cyky 3 2 5', zaklad: `${h.zas} zásuvek, ${z0}` });
      if (cyky5) r.push({ klic: 'cyky5', nazev: 'Kabel CYKY 5×2,5', mnozstvi: nahoru(cyky5), mj: 'bm', q: 'cyky 5 2 5', zaklad: `${h.sporak} silových vývodů, ${z0}` });
      if (cyky15) r.push({ klic: 'cyky15', nazev: 'Kabel CYKY 3×1,5', mnozstvi: nahoru(cyky15), mj: 'bm', q: 'cyky 3 1 5', zaklad: `${h.sv} světel a ${h.vyp} vypínačů, ${z0}` });
      const kr = (h.zas || 0) + (h.vyp || 0) + (h.sv || 0), listy = h.montaz === 'listy';
      if (!listy && kr) r.push({ klic: 'krabice', nazev: 'Krabice přístrojová KU 68', mnozstvi: kr + (h.sporak || 0), mj: 'ks', q: 'krabice ku 68', zaklad: 'zásuvky + vypínače + světla + silové vývody' });
      if (h.okruhy > 0 || (listy && h.sv > 0)) r.push({ klic: 'rozvodna', nazev: listy ? 'Krabice rozbočovací na povrch' : 'Krabice rozvodná', mnozstvi: nahoru((h.okruhy || 0) * 1.5 + (listy ? (h.sv || 0) * 0.5 : 0)), mj: 'ks', q: 'krabice acidur', zaklad: listy ? '1,5 ks na okruh + 1 na 2 světla' : '1,5 ks na okruh' });
      r.push({ klic: 'svorky', nazev: 'Svorky (Wago)', mnozstvi: body * 3, mj: 'ks', q: 'svork wago', zaklad: '3 ks na bod' });
      if (h.zas > 0) r.push(listy
        ? { klic: 'zasuvky', nazev: 'Zásuvka nástěnná 230 V', mnozstvi: h.zas, mj: 'ks', q: 'zasuvka nastenna emos', vyloucit: 'dvojnas|cyklone', zaklad: 'zadaný počet, na povrch' }
        : { klic: 'zasuvky', nazev: 'Zásuvka 230 V pod omítku (s rámečkem)', mnozstvi: h.zas, mj: 'ks', q: 'zasuvka french', vyloucit: 'usb|dvojnas|ant\\.', zaklad: 'zadaný počet, do krabice KU 68' });
      if (h.vyp > 0) r.push(listy
        ? { klic: 'vypinace', nazev: 'Vypínač nástěnný', mnozstvi: h.vyp, mj: 'ks', q: 'prepinac nastenny emos', vyloucit: 'cyklone', zaklad: 'zadaný počet, na povrch' }
        : { klic: 'vypinace', nazev: 'Vypínač pod omítku (s rámečkem)', mnozstvi: h.vyp, mj: 'ks', q: 'prepinac stridavy', vyloucit: 'dvojit|ant\\.', zaklad: 'zadaný počet; střídavý č. 6 funguje i jako č. 1' });
      if (h.okruhy > 0) r.push({ klic: 'chranic', nazev: 'Proudový chránič 30 mA', mnozstvi: Math.max(1, Math.ceil(h.okruhy / 6)), mj: 'ks', q: 'chranic proudov', zaklad: '1 na 6 okruhů' });
      if (h.okruhy > 0) r.push({ klic: 'jistice', nazev: 'Jistič', mnozstvi: h.okruhy, mj: 'ks', q: 'jistic', zaklad: '1 na okruh' });
      const km = cyky25 + cyky5 + cyky15;
      const pr = [{ klic: 'kabely', nazev: 'Tažení a ukládání kabelů', mj: 'bm', mnozstvi: nahoru(km) }, { klic: 'prstroje', nazev: 'Montáž přístrojů a krabic', mj: 'ks', mnozstvi: body + kr }];
      if (listy) {
        r.push({ klic: 'lista', nazev: 'Lišta vkládací 18×13 mm', mnozstvi: nahoru(km * 0.7), mj: 'bm', q: 'lista vkladaci 18 13', zaklad: '70 % délky kabelů (souběžné kabely v jedné liště)' });
        r.push({ klic: 'lista2', nazev: 'Lišta vkládací 40×20 mm (hlavní trasy)', mnozstvi: nahoru(km * 0.15), mj: 'bm', q: 'lista vkladaci 40 20', zaklad: '15 % délky kabelů' });
        pr.push({ klic: 'listyPrace', nazev: 'Montáž elektroinstalačních lišt', mj: 'bm', mnozstvi: nahoru(km * 0.85) });
      }
      if (h.rysy && !listy) { r.push({ klic: 'sadra', nazev: 'Sádra / malta na zapravení rýh', mnozstvi: nahoru(km * 0.6 * 1.5), mj: 'kg', q: 'sadra', zaklad: '60 % kabelů v rýze × 1,5 kg/bm' }); pr.push({ klic: 'rysy', nazev: 'Drážkování a zapravení rýh', mj: 'bm', mnozstvi: nahoru(km * 0.6) }); }
      if (h.okruhy > 0) pr.push({ klic: 'rozvadec', nazev: 'Osazení a zapojení rozvaděče', mj: 'okruh', mnozstvi: h.okruhy });
      return { radky: r, prace: pr };
    }
  },

  pergola: {
    nazev: 'Pergola a přístřešek', ikona: '⛱️', rozmer: 'plocha', usek: 'Půdorys', otvory: false,
    popisky: () => ['Délka', 'Hloubka'],
    popis: 'Dřevěná pergola nebo pultový přístřešek na sloupcích. Zadej půdorys – spočítám sloupky, nosníky, krokve, pásky, krytinu, kotvení i nátěr. Řezivo v m³ (KVH) i v kusech a metrech.',
    sablony: [
      { n: 'Pergola na terasu', h: { typ: 'pergola', sloup: '120x120', vaz: '120x160', krok: '60x160', rozK: '60', rozS: '3' } },
      { n: 'Přístřešek s plechem', h: { typ: 'pultova', sloup: '140x140', vaz: '140x200', krok: '80x160', rozK: '80', rozS: '3,5', krytina: 'plech', sklon: '5' } },
      { n: 'Terasa s polykarbonátem', h: { typ: 'pultova', sloup: '120x120', vaz: '120x160', krok: '60x160', rozK: '70', rozS: '3', krytina: 'polykarbonat', sklon: '5' } }
    ],
    pole: [
      { id: 'typ', popis: 'Provedení', typ: 'volba', v: 'pergola', volby: [['pergola', 'Pergola (otevřený rošt)'], ['pultova', 'Přístřešek se střechou']] },
      { id: 'vyska', popis: 'Výška sloupků', mj: 'm', v: '2,5', tip: 'Od patky po spodní hranu nosníku.' },
      { id: 'rozS', popis: 'Max. rozteč sloupků', mj: 'm', v: '3', tip: 'Nosník 120×160 obvykle do 3 m, 140×200 do 4 m. Sloupky stojí ve dvou řadách.' },
      { id: 'sloup', popis: 'Sloupky', typ: 'volba', v: '120x120', volby: [['100x100', '100×100'], ['120x120', '120×120'], ['140x140', '140×140']] },
      { id: 'vaz', popis: 'Nosníky na sloupcích', typ: 'volba', v: '120x160', volby: [['100x160', '100×160'], ['120x160', '120×160'], ['140x200', '140×200']] },
      { id: 'krok', popis: 'Krokve (příčné trámky)', typ: 'volba', v: '60x160', volby: [['60x120', '60×120'], ['60x160', '60×160'], ['80x160', '80×160'], ['60x200', '60×200']] },
      { id: 'rozK', popis: 'Rozteč krokví', mj: 'cm', v: '70', tip: 'Pergola 50–80 cm, pod plech nebo polykarbonát 60–90 cm.' },
      { id: 'pres', popis: 'Přesah nosníků a krokví', mj: 'cm', v: '30' },
      { id: 'sklon', popis: 'Sklon střechy', mj: '°', v: '5', ukaz: h => h.typ === 'pultova', tip: 'Plech a polykarbonát od 3–5°.' },
      { id: 'krytina', popis: 'Krytina', typ: 'volba', v: 'plech', ukaz: h => h.typ === 'pultova', volby: [['plech', 'Trapézový plech'], ['polykarbonat', 'Polykarbonát'], ['bedneni', 'Bednění + lepenka']] },
      { id: 'pasky', popis: 'Šikmé pásky (ztužení)', typ: 'ano', v: '1', tip: 'Dva pásky 80×80 mm, cca 0,8 m, na každý sloupek.' },
      { id: 'patky', popis: 'Betonové patky', typ: 'ano', v: '1', tip: 'Patka 30 × 30 × 80 cm pod každý sloupek, kotevní patka do betonu.' },
      { id: 'natr', popis: 'Nátěr dřeva (lazura)', typ: 'ano', v: '1', tip: '2 vrstvy, cca 0,1 l/m² na vrstvu.' },
      { id: 'prorez', popis: 'Prořez řeziva', mj: '%', v: '10', profi: P }
    ],
    jak: 'Sloupky: ve dvou řadách, v každé (délka ÷ max. rozteč) + 1.\nNosníky: 2 ks, délka + 2 × přesah.\nKrokve: (délka + 2 × přesah) ÷ rozteč + 1, délka = (hloubka + 2 × přesah) ÷ cos(sklon).\nŘezivo KVH v m³ = kusy × délka × průřez + prořez.\nPásky: 2 na sloupek po 0,8 m. Plech na latě 40×60 po 60 cm.\nKrytina = (délka + 2 přesahy) × (hloubka + 2 přesahy) ÷ cos(sklon) + ořez.\nÚhelníky: 1 na každé uložení krokve, 2 na sloupek, 8 vrutů na úhelník.\nPatka 30×30×80 cm = 0,072 m³ ≈ 150 kg betonové směsi.\nNátěr: povrch řeziva × 2 vrstvy × 0,1 l/m².',
    spocitej(h) {
      const U = h.useky.filter(u => u.d > 0 && u.s > 0);
      if (!U.length) return null;
      const D = DREVO(h.prorez || 0), p = (h.pres || 0) / 100;
      const pult = h.typ === 'pultova', cos = Math.cos((pult ? Math.min(45, Math.max(0, h.sklon || 0)) : 0) * Math.PI / 180);
      const rK = Math.max(0.3, (h.rozK || 70) / 100), rS = Math.max(1, h.rozS || 3), vys = h.vyska || 2.5;
      let sloupku = 0, krokvi = 0, pudorys = 0, krytina = 0;
      U.forEach(u => {
        const nRad = Math.ceil(u.d / rS - 1e-9) + 1, sl = 2 * nRad;
        const nK = Math.ceil((u.d + 2 * p) / rK - 1e-9) + 1, lK = (u.s + 2 * p) / cos;
        sloupku += sl; krokvi += nK; pudorys += u.d * u.s;
        D.pridej('sloupky', 'Sloupky', h.sloup, sl, vys);
        D.pridej('vaznice', 'Nosníky (vaznice)', h.vaz, 2, u.d + 2 * p);
        D.pridej('krokve', 'Krokve', h.krok, nK, lK);
        if (h.pasky) D.pridej('pasky', 'Pásky', '80x80', 2 * sl, 0.8);
        if (pult) {
          const A = (u.d + 2 * p) * (u.s + 2 * p) / cos; krytina += A;
          if (h.krytina === 'plech') D.pridej('late', 'Latě pod plech', '40x60', Math.ceil(lK / 0.6 - 1e-9) + 1, u.d + 2 * p);
        }
      });
      const r = D.radky();
      if (pult && krytina > 0) {
        const z = `střecha ${f3(zaok(krytina))} m²`;
        if (h.krytina === 'plech') r.push({ klic: 'krytina', nazev: 'Trapézový plech', mnozstvi: nahoru(krytina * 1.1), mj: 'm²', q: 'plech trapez', vyloucit: 'lat|list|sroub|tmel', zaklad: z + ' + 10 % přesahy' });
        else if (h.krytina === 'polykarbonat') {
          r.push({ klic: 'krytina', nazev: 'Polykarbonátové desky', mnozstvi: nahoru(krytina * 1.05), mj: 'm²', q: 'polykarbonat desk', vyloucit: 'profil|pask|sroub', zaklad: z + ' + 5 % ořez' });
          r.push({ klic: 'profil', nazev: 'Spojovací profil polykarbonátu', mnozstvi: krokvi, mj: 'ks', q: 'profil polykarbonat', zaklad: 'na každou krokev' });
        } else {
          r.push({ klic: 'bedneni', nazev: 'Bednění (OSB / prkna)', mnozstvi: nahoru(krytina * 1.08), mj: 'm²', q: 'osb', vyloucit: 'lak|tmel', zaklad: z + ' + 8 %' });
          r.push({ klic: 'lepenka', nazev: 'Asfaltová lepenka', mnozstvi: nahoru(krytina * 1.15), mj: 'm²', q: 'asfaltovy pas', vyloucit: 'tekut|penetr|lak', zaklad: z + ' + 15 % přesahy' });
        }
      }
      const uhel = 2 * krokvi + 2 * sloupku;
      r.push({ klic: 'uhelnik', nazev: 'Úhelníky tesařské', mnozstvi: uhel, mj: 'ks', q: 'uhelnik tesarsk', vyloucit: 'plast|beton', zaklad: `krokve ${krokvi} × 2 uložení + sloupky ${sloupku} × 2` });
      r.push({ klic: 'vruty', nazev: 'Vruty do tesařského kování', mnozstvi: uhel * 8, mj: 'ks', q: 'vrut tesarsk', zaklad: `${uhel} úhelníků × 8 vrutů` });
      if (h.patky) {
        r.push({ klic: 'kotva', nazev: 'Kotevní patky sloupků', mnozstvi: sloupku, mj: 'ks', q: 'kotevni patka', zaklad: `${sloupku} sloupků` });
        r.push({ klic: 'beton', nazev: 'Betonová směs do patek', mnozstvi: nahoru(sloupku * 0.072 * 2100), mj: 'kg', q: 'betonova smes', zaklad: `${sloupku} patek 30 × 30 × 80 cm × 0,072 m³ × 2 100 kg/m³` });
      }
      if (h.natr) r.push({ klic: 'lazura', nazev: 'Lazura na dřevo', mnozstvi: zaok(D.povrch() * 2 * 0.1), mj: 'l', q: 'lazura', zaklad: `povrch řeziva ${f3(zaok(D.povrch()))} m² × 2 vrstvy × 0,1 l/m²` });
      const pr = [{ klic: 'montaz', nazev: pult ? 'Montáž přístřešku' : 'Montáž pergoly', mj: 'm²', mnozstvi: zaok(pudorys) },
        { klic: 'sloupky', nazev: 'Osazení sloupků' + (h.patky ? ' a betonáž patek' : ''), mj: 'ks', mnozstvi: sloupku }];
      if (pult && krytina > 0) pr.push({ klic: 'krytinaPrace', nazev: 'Pokládka krytiny', mj: 'm²', mnozstvi: zaok(krytina) });
      if (h.natr) pr.push({ klic: 'natr', nazev: 'Nátěr dřeva (2 vrstvy)', mj: 'm²', mnozstvi: zaok(D.povrch()) });
      return { radky: r, prace: pr };
    },
    nakres(h, g) {
      const u = g.u, rS = Math.max(1, h.rozS || 3), rK = Math.max(0.3, (h.rozK || 70) / 100);
      const nRad = Math.ceil(u.d / rS - 1e-9) + 1, nK = Math.ceil(u.d / rK - 1e-9) + 1, sz = Math.max(5, Math.min(14, 0.14 * g.m));
      let t = '';
      for (let i = 0; i < nK; i++) { const x = g.x0 + Math.min(u.d, i * rK) * g.m; t += `<line x1="${x}" x2="${x}" y1="${g.y0}" y2="${g.y0 + g.vy}" class="kk-svg-krokev"/>`; }
      [g.y0 + sz / 2, g.y0 + g.vy - sz / 2].forEach(y => { t += `<line x1="${g.x0}" x2="${g.x0 + g.s}" y1="${y}" y2="${y}" class="kk-svg-tram"/>`;
        for (let i = 0; i < nRad; i++) { const x = g.x0 + (nRad > 1 ? i * g.s / (nRad - 1) : 0); t += `<rect x="${Math.min(g.x0 + g.s - sz, Math.max(g.x0, x - sz / 2))}" y="${y - sz / 2}" width="${sz}" height="${sz}" class="kk-svg-sloup"/>`; } });
      return t;
    }
  },

  krov: {
    nazev: 'Krov (dřevo střechy)', ikona: '🪚', rozmer: 'plocha', usek: 'Půdorys', otvory: false,
    popisky: () => ['Délka (po hřebeni)', 'Šířka domu'],
    popis: 'Řezivo na sedlový nebo pultový krov: krokve, pozednice, vaznice se sloupky a pásky, kleštiny, latě a kontralatě. Spočítám kusy, metry i m³ (KVH), kotvení a spojovací materiál. Krytinu spočítá kalkulačka Střecha.',
    sablony: [
      { n: 'Sedlová 35°', h: { tvar: 'sedlova', sklon: '35', krok: '80x160', vaznice: '1' } },
      { n: 'Sedlová 45°', h: { tvar: 'sedlova', sklon: '45', krok: '80x200', vaznice: '1' } },
      { n: 'Pultová 10°', h: { tvar: 'pultova', sklon: '10', krok: '80x200', vaznice: '0', klestiny: '0' } }
    ],
    pole: [
      { id: 'tvar', popis: 'Tvar střechy', typ: 'volba', v: 'sedlova', volby: [['sedlova', 'Sedlová'], ['pultova', 'Pultová']] },
      { id: 'sklon', popis: 'Sklon střechy', mj: '°', v: '35' },
      { id: 'presO', popis: 'Přesah u okapu', mj: 'cm', v: '50', tip: 'Vodorovně od líce zdi.' },
      { id: 'presS', popis: 'Přesah u štítu', mj: 'cm', v: '40' },
      { id: 'rozK', popis: 'Rozteč krokví', mj: 'cm', v: '90', tip: 'Obvykle 80–100 cm podle krytiny a zatížení.' },
      { id: 'krok', popis: 'Krokve', typ: 'volba', v: '80x160', volby: [['60x160', '60×160'], ['80x160', '80×160'], ['60x200', '60×200'], ['80x200', '80×200']] },
      { id: 'pozed', popis: 'Pozednice', typ: 'volba', v: '140x140', volby: [['120x120', '120×120'], ['140x140', '140×140'], ['140x160', '140×160']] },
      { id: 'vaznice', popis: 'Vaznice se sloupky a pásky', typ: 'ano', v: '1', tip: 'U rozpětí nad 4–5 m krokve podpírají vaznice (sedlová 2, pultová 1).' },
      { id: 'vaz', popis: 'Vaznice', typ: 'volba', v: '140x160', ukaz: h => h.vaznice, volby: [['120x160', '120×160'], ['140x160', '140×160'], ['140x200', '140×200']] },
      { id: 'rozSl', popis: 'Rozteč sloupků vaznice', mj: 'm', v: '3,5', ukaz: h => h.vaznice, profi: P },
      { id: 'vyskaSl', popis: 'Výška sloupků', mj: 'm', v: '1,8', ukaz: h => h.vaznice, profi: P },
      { id: 'klestiny', popis: 'Kleštiny', typ: 'ano', v: '1', ukaz: h => h.vaznice && h.tvar === 'sedlova', tip: 'Párové kleštiny 60×160 v místě každého sloupku.' },
      { id: 'late', popis: 'Latě a kontralatě', typ: 'ano', v: '1' },
      { id: 'rozL', popis: 'Rozteč latí', mj: 'cm', v: '33', ukaz: h => h.late, tip: 'Podle krytiny: tašky 30–35 cm, plech 35–40 cm.' },
      { id: 'impreg', popis: 'Impregnace krovu', typ: 'ano', v: '1', tip: 'Proti hmyzu a houbám, cca 0,15 l/m² povrchu.' },
      { id: 'prorez', popis: 'Prořez řeziva', mj: '%', v: '10', profi: P }
    ],
    jak: 'Krokve: (délka + 2 × přesah u štítu) ÷ rozteč + 1, u sedlové na obě strany.\nDélka krokve: sedlová (šířka ÷ 2 + přesah u okapu) ÷ cos(sklon), pultová (šířka + 2 přesahy) ÷ cos(sklon).\nPozednice 2 × délka domu, vaznice 1× (pultová) nebo 2× (sedlová) délka domu.\nSloupky vaznice: délka ÷ rozteč + 1, dva pásky 100×100 po 0,9 m na sloupek.\nKleštiny: pár 60×160 na každý sloupek, délka 0,7 × šířka domu.\nLatě: plocha ÷ rozteč + 5 %, kontralatě po každé krokvi, obojí 40×60.\nŘezivo KVH v m³ = kusy × délka × průřez + prořez.\nKotvení pozednice: závitová tyč M12 po 1 m. Hřebíky: 1 na křížení latě a krokve.',
    spocitej(h) {
      const U = h.useky.filter(u => u.d > 0 && u.s > 0);
      if (!U.length) return null;
      const D = DREVO(h.prorez || 0), sedl = h.tvar !== 'pultova';
      const cos = Math.cos(Math.min(70, Math.max(0, h.sklon || 0)) * Math.PI / 180);
      const po = (h.presO || 0) / 100, ps = (h.presS || 0) / 100, rK = Math.max(0.4, (h.rozK || 90) / 100);
      let krokvi = 0, bmKrok = 0, A = 0, pozedBm = 0, uloz = 0;
      U.forEach(u => {
        const nK = Math.ceil((u.d + 2 * ps) / rK - 1e-9) + 1, strany = sedl ? 2 : 1;
        const lK = sedl ? (u.s / 2 + po) / cos : (u.s + 2 * po) / cos;
        D.pridej('krokve', 'Krokve', h.krok, nK * strany, lK);
        krokvi += nK * strany; bmKrok += nK * strany * lK;
        A += (u.d + 2 * ps) * (u.s + 2 * po) / cos;
        D.pridej('pozednice', 'Pozednice', h.pozed, 2, u.d); pozedBm += 2 * u.d;
        uloz += nK * strany;
        if (h.vaznice) {
          const nV = sedl ? 2 : 1, nSl = Math.ceil(u.d / Math.max(1.5, h.rozSl || 3.5) - 1e-9) + 1;
          D.pridej('vaznice', 'Vaznice', h.vaz, nV, u.d);
          D.pridej('sloupky', 'Sloupky vaznice', '140x140', nV * nSl, h.vyskaSl || 1.8);
          D.pridej('pasky', 'Pásky', '100x100', nV * nSl * 2, 0.9);
          uloz += nK * strany;
          if (sedl && h.klestiny) D.pridej('klestiny', 'Kleštiny', '60x160', nSl * 2, 0.7 * u.s);
        }
      });
      if (h.late) {
        const rL = Math.max(0.15, (h.rozL || 33) / 100), late = A / rL * 1.05;
        D.pridejBm('late', 'Střešní latě', '40x60', late, `plocha ${f3(zaok(A))} m² ÷ ${f3(rL)} m + 5 %`);
        D.pridejBm('kontralate', 'Kontralatě', '40x60', bmKrok, `po každé krokvi: ${krokvi} × délka krokve`);
      }
      const r = D.radky();
      r.push({ klic: 'kotveni', nazev: 'Kotvení pozednice – závitová tyč M12', mnozstvi: nahoru(pozedBm / 1) + 2, mj: 'ks', q: 'zavitova tyc m12', zaklad: `pozednice ${f3(zaok(pozedBm))} m, kotva po 1 m` });
      r.push({ klic: 'vruty', nazev: 'Tesařské vruty (uložení krokví)', mnozstvi: uloz * 2, mj: 'ks', q: 'vrut tesarsk', zaklad: `${uloz} uložení krokví × 2 vruty` });
      if (h.late) {
        const krizeni = (A / Math.max(0.15, (h.rozL || 33) / 100)) / rK;
        r.push({ klic: 'hrebiky', nazev: 'Hřebíky na latě', mnozstvi: Math.max(1, Math.ceil(krizeni * 0.006 * 1.1 * 10) / 10), mj: 'kg', q: 'hrebik', zaklad: `${nahoru(krizeni)} křížení latě a krokve × 6 g + 10 %` });
      }
      if (h.impreg) r.push({ klic: 'impreg', nazev: 'Impregnace dřeva', mnozstvi: zaok(D.povrch() * 0.15), mj: 'l', q: 'impregnac drev', zaklad: `povrch řeziva ${f3(zaok(D.povrch()))} m² × 0,15 l/m²` });
      const pr = [{ klic: 'krov', nazev: 'Tesařské práce – krov', mj: 'm²', mnozstvi: zaok(A) }];
      if (h.late) pr.push({ klic: 'latovani', nazev: 'Laťování a kontralatě', mj: 'm²', mnozstvi: zaok(A) });
      if (h.impreg) pr.push({ klic: 'impregPrace', nazev: 'Impregnace krovu', mj: 'm²', mnozstvi: zaok(D.povrch()) });
      return { radky: r, prace: pr };
    }
  },

  smesi: {
    nazev: 'Suché směsi na plochy', ikona: '⚖️', rozmer: 'plocha', usek: 'Plocha', otvory: true,
    otvoryNadpis: 'Odečíst (okna, dveře…)',
    popisky: () => ['Délka', 'Šířka / výška'],
    popis: 'Spotřeba suché směsi na libovolnou plochu: lepidla, omítky, štuky, stěrky, nivelace, potěry. Vyber druh a tloušťku vrstvy – spočítám kilogramy a pytle.',
    sablony: Object.entries(SMESI).map(([k, d]) => ({ n: d.kratce, h: { druh: k, tl: '', sp: '' } })),
    pole: [
      { id: 'druh', popis: 'Druh směsi', typ: 'volba', v: 'lepidlo', volby: Object.entries(SMESI).map(([k, d]) => [k, d.kratce]) },
      { id: 'tl', popis: 'Tloušťka vrstvy', mj: 'mm', v: '', tip: 'Prázdné = obvyklá tloušťka pro zvolený druh (viz Jak počítám).' },
      { id: 'sp', popis: 'Spotřeba', mj: 'kg/m² na 1 mm', v: '', tip: 'Prázdné = obvyklá spotřeba druhu. Přesnou hodnotu najdeš v technickém listu výrobce.' },
      { id: 'pytel', popis: 'Balení', mj: 'kg', v: '25', tip: 'Jen pro informaci o počtu pytlů – u vybraného zboží se přepočítá podle jeho balení.' },
      { id: 'ztraty', popis: 'Ztráty', mj: '%', v: '5', profi: P },
      { id: 'penetrace', popis: 'Penetrace podkladu', typ: 'ano', v: '1', tip: 'Cca 0,15 l/m².' }
    ],
    get jak() { return 'Spotřeba = plocha × tloušťka (mm) × spotřeba na 1 mm + ztráty; pytle = kg ÷ balení.\nObvyklé hodnoty:\n' + Object.values(SMESI).map(d => `${d.nazev}: ${f3(d.tl)} mm, ${f3(d.sp)} kg/m² na 1 mm`).join('\n') + '\nPenetrace 0,15 l/m².'; },
    spocitej(h) {
      const A = h.plocha;
      if (!(A > 0)) return null;
      const d = SMESI[h.druh] || SMESI.lepidlo;
      const tl = h.tl > 0 ? h.tl : d.tl, sp = h.sp > 0 ? h.sp : d.sp, z = h.ztraty || 0, pytel = h.pytel > 0 ? h.pytel : 25;
      const kg = A * tl * sp * (1 + z / 100);
      const r = [{ klic: 'smes', nazev: d.nazev, mnozstvi: nahoru(kg), mj: 'kg', q: d.q, vyloucit: d.vyl,
        zaklad: `${f3(zaok(A))} m² × ${f3(tl)} mm × ${f3(sp)} kg/m² na 1 mm + ${f3(z)} % = ${f3(nahoru(kg))} kg ≈ ${nahoru(kg / pytel)} × ${f3(pytel)} kg` }];
      if (h.penetrace) r.push({ klic: 'penetrace', nazev: 'Penetrace podkladu', mnozstvi: zaok(A * 0.15 * 1.05), mj: 'l', q: d.pen || 'penetrac', vyloucit: 'fungicid|barv', zaklad: `${f3(zaok(A))} m² × 0,15 l/m² + 5 %` });
      return { radky: r, prace: [{ klic: 'smesPrace', nazev: d.prace, mj: 'm²', mnozstvi: zaok(A) }] };
    }
  },

  bourani: {
    nazev: 'Bourání a suť', ikona: '🔨', rozmer: 'steny', usek: 'Stěna', otvory: true,
    popis: 'Bourání příček a zdí – objem a hmotnost sutě, počet kontejnerů a práce s odvozem.',
    sablony: [
      { n: 'Cihelná příčka 10', h: { tl: '10', mat: 'cihla' } },
      { n: 'Cihelná zeď 30', h: { tl: '30', mat: 'cihla' } },
      { n: 'Pórobeton 15', h: { tl: '15', mat: 'porobeton' } },
      { n: 'Beton 20', h: { tl: '20', mat: 'beton' } },
      { n: 'Příčka SDK', h: { tl: '10', mat: 'sdk' } }
    ],
    pole: [
      { id: 'tl', popis: 'Tloušťka zdi', mj: 'cm', v: '15' },
      { id: 'mat', popis: 'Materiál', typ: 'volba', v: 'cihla', volby: [['cihla', 'Cihly'], ['porobeton', 'Pórobeton'], ['beton', 'Beton'], ['sdk', 'Sádrokarton']] },
      { id: 'kontejner', popis: 'Velikost kontejneru', typ: 'volba', v: '5', volby: [['3', '3 m³'], ['5', '5 m³'], ['7', '7 m³']] },
      { id: 'omitka', popis: 'Včetně omítky', typ: 'ano', v: '1', tip: 'U cihel a pórobetonu přidá ~ 3 cm omítky.', ukaz: h => h.mat === 'cihla' || h.mat === 'porobeton' },
      { id: 'pytle', popis: 'Pytle na suť (vynášení)', typ: 'ano', v: '0', tip: 'Pro ruční vynášení z patra, 25 l pytel.' }
    ],
    jak: 'Objem zdi = plocha × tloušťka (+ 3 cm omítky u cihel a pórobetonu).\nHmotnost: cihla 1 600, pórobeton 600, beton 2 400, SDK 700 kg/m³.\nObjem sutě po rozbourání = objem × kypření (1,5–2,0).\nKontejnery: podle objemu (využití 90 %) i nosnosti 1 t/m³ – platí přísnější.',
    spocitej(h) {
      const A = h.plocha; if (!A) return null;
      const M = { cihla: [1600, 1.5], porobeton: [600, 1.5], beton: [2400, 1.6], sdk: [700, 2.0] }[h.mat] || [1600, 1.5];
      const tl = (h.tl || 15) + (h.omitka && (h.mat === 'cihla' || h.mat === 'porobeton') ? 3 : 0);
      const V = A * tl / 100, t = V * M[0] / 1000, sut = V * M[1];
      const k = Number(h.kontejner || 5);
      const poObjemu = nahoru(sut / (k * 0.9)), poHmot = nahoru(t / k);
      const r = [{ klic: 'kontejner', nazev: `Kontejner na suť ${k} m³`, mnozstvi: Math.max(1, poObjemu, poHmot), mj: 'ks', q: null,
        zaklad: `zeď ${f3(zaok(V))} m³ → suť ${f3(zaok(sut))} m³, ${f3(zaok(t))} t (objem ${poObjemu} ks, hmotnost ${poHmot} ks)` }];
      if (h.pytle) r.push({ klic: 'pytle', nazev: 'Pytel na suť', mnozstvi: nahoru(sut / 0.025), mj: 'ks', q: 'pytel sut', zaklad: `${f3(zaok(sut))} m³ ÷ 25 l` });
      return { radky: r, prace: [{ klic: 'bourani', nazev: 'Bourání', mj: 'm²', mnozstvi: zaok(A) }, { klic: 'bouraniM3', nazev: 'Bourání (podle objemu)', mj: 'm³', mnozstvi: zaok(V) },
        { klic: 'vynaseni', nazev: 'Vynášení a nakládka sutě', mj: 'm³', mnozstvi: zaok(sut) }, { klic: 'odvoz', nazev: 'Odvoz a likvidace sutě', mj: 't', mnozstvi: zaok(t) }] };
    }
  }
};
/* =====================================================================
   SORTIMENT STAVIMEX – SUCHÁ VÝSTAVBA (vestavěný ceník)
   Kalkulačka SDK vybírá ze seznamu podle pravidel a množství počítá
   v jednotce, ve které se zboží prodává (m², m, balení).
   ===================================================================== */
/* yey.html: vestavěný ceník Stavimexu se nepoužívá – kandidáti se hledají v katalogu. */
const SV_POD = [];
const SV_ZN = [];
const SV_DATA = [];

const SV_MJ = { M: 'm', M2: 'm²', KS: 'ks', BAL: 'bal' };
/** Rozebere název zboží na údaje pro pravidla (typ a šířka profilu, délka, formát desky, balení, kg…). */
function parsujSV(p) {
  const n = p.n = bezDia(p.nazev), nc = n.replace(/(\d),(\d)/g, '$1.$2');
  p.sv = true;
  const pr = n.startsWith('profil') && n.match(/\b(?:r-)?(cw|uw|ua|cd|ud)\s*(\d+)/);
  if (pr) { p.typ = pr[1]; p.sirka = Number(pr[2]); }
  const del = [...nc.matchAll(/(\d+(?:\.\d+)?)\s*m(?![a-z0-9²])/g)].pop();
  if (del) p.delka = Number(del[1]);
  const dz = nc.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d{3,4})\s*[x×]\s*(\d{3,4})/);
  if (dz) { p.tl = Number(dz[1]); p.plocha = Math.round(Number(dz[2]) * Number(dz[3]) / 1e4) / 100; p.rozmer = `${dz[2]}×${dz[3]} mm`; }
  const bal = n.match(/\[(\d+)\s*ks\]/); if (bal) p.vBaleni = Number(bal[1]);
  const kg = nc.match(/(\d+(?:\.\d+)?)\s*kg/); if (kg) p.hmotnost = Number(kg[1]);
  const mm = nc.match(/(\d{2})\s*mm/); if (mm) p.sirkaMm = Number(mm[1]);
  const sl = nc.match(/[x×]\s*(\d{2})(?:\s*mm)?\b/) || nc.match(/\b(?:tn|tb)\s*(\d{2})\b/); if (sl) p.delkaSroubu = Number(sl[1]);
  return p;
}
const SV = SV_DATA.map(([kod, nazev, mj, pc, sk, pi, zi, ean]) => parsujSV({ kod, nazev,
  mj: SV_MJ[mj] || String(mj || 'ks').toLowerCase(), cena: pc, skladem: sk, ean,
  tema: 'Suchá výstavba', skupina: SV_POD[pi] || '', podskupina: SV_POD[pi] || '', znacka: SV_ZN[zi] || '' }));
/** Režim „katalog“ (A.svZKatalogu): kandidáti pro pravidla se hledají v katalogu a ukládají sem. */
const SV_DOTAZ = { deska: a => 'deska sadrokart', cw: a => 'profil cw ' + a[0], uw: a => 'profil uw ' + a[0], ua: a => 'profil ua ' + a[0],
  cd: () => 'profil cd', ud: () => 'profil ud', uaUhel: a => 'uhelnik ua ' + a[0], hmozd: () => 'hmozdinka natlouk', strop: () => 'stropni',
  zaves: () => 'zaves prim', sroub: a => ['sroub tn ' + a[0], 'vrut tn ' + a[0], 'rychlosroub ' + a[0]], tmel: () => 'tmel', paska: () => ['pask', 'mrizka samolep'], tesneni: () => 'tesn' };
const SV_KAT = {};                 // sv klíč → kandidáti z katalogu
const SV_KAT_BEZI = {};
async function nactiSVzKatalogu(sv) {
  if (!A.svZKatalogu || !sv || SV_KAT[sv]) return SV_KAT[sv] || [];
  if (SV_KAT_BEZI[sv]) return SV_KAT_BEZI[sv];
  const [k, ...a] = String(sv).split(':');
  const f = SV_PRAVIDLA[k], d = SV_DOTAZ[k];
  if (!f || !d) return (SV_KAT[sv] = []);
  const dotazy = [].concat(d(a));
  SV_KAT_BEZI[sv] = (async () => {
    const vid = new Set(), vsech = [];
    for (const q of dotazy) {
      let nal = [];
      try { nal = await A.hledej(q, 80, { nazev: 'Suchá výstavba', slova: ['sucha vystav', 'sadrokart', 'sdk'] }, 'vse') || []; } catch (e) { nal = []; }
      nal.forEach(x => { if (x && x.kod && !vid.has(x.kod)) { vid.add(x.kod); vsech.push(x); } });
    }
    // desky: celá podskupina daného typu (protipožární, impregnované…) – fulltext jich vrací jen část
    if (k === 'deska' && SV_DESKY[a[0]]) {
      try {
        const nal = await A.hledej('', 120, { nazev: SV_DESKY[a[0]], slova: [], tema: 'Suchá výstavba', skupina: SV_DESKY[a[0]] }, 'vse') || [];
        nal.forEach(x => { if (x && x.kod && !vid.has(x.kod)) { vid.add(x.kod); vsech.push(x); } });
      } catch (e) {}
    }
    if (A.schvalene && A.podleKodu) {
      try {
        const sch = await A.schvalene(S.druh), kody = Object.values(sch).flat().map(x => x.kod).filter(k => !vid.has(k));
        (await A.podleKodu(kody)).forEach(x => { if (x && x.kod && !vid.has(x.kod)) { vid.add(x.kod); vsech.push(x); } });
      } catch (e) {}
    }
    const out = vsech.map(x => parsujSV({ kod: x.kod, nazev: x.nazev, mj: SV_MJ[String(x.mj || '').toUpperCase()] || mjN(x.mj) || 'ks',
      cena: x.cena, skladem: 1, ean: x.ean || '', foto: x.foto || '', tema: x.tema || '', skupina: x.podskupina || x.skupina || '',
      podskupina: x.podskupina || '', znacka: x.znacka || '' })).filter(p => f(p, a));
    SV_KAT[sv] = out; delete SV_KAT_BEZI[sv];
    return out;
  })();
  return SV_KAT_BEZI[sv];
}
const SV_DESKY = { rb: 'Standardní desky', rbi: 'Impregnované desky', rf: 'Protipožární desky', rfi: 'Protipožární impregnované desky', ak: 'Akustické desky' };
/** Pravidla výběru pro jednotlivé řádky (klíč = první část r.sv). */
const SV_PRAVIDLA = {
  deska: (p, a) => p.plocha > 0 && p.skupina === SV_DESKY[a[0]] && Math.abs(p.tl - Number(String(a[1]).replace(',', '.'))) < 0.3 && /deska/.test(p.n),
  cw: (p, a) => p.typ === 'cw' && p.sirka === Number(a[0]) && p.delka > 0,
  uw: (p, a) => p.typ === 'uw' && p.sirka === Number(a[0]) && p.delka > 0,
  ua: (p, a) => p.typ === 'ua' && p.sirka === Number(a[0]) && p.delka > 0,
  cd: p => p.typ === 'cd' && p.delka > 0,
  ud: p => p.typ === 'ud' && p.delka > 0,
  uaUhel: (p, a) => /uhelnik/.test(p.n) && (p.n.match(/\bua\s*(\d+)/) || [])[1] === String(a[0]),
  hmozd: p => /hmozdinka natloukac/.test(p.n) && /\b6\s*[x×]\s*(35|40)\b/.test(p.n),
  strop: p => /(trn|hreb) stropn/.test(p.n) && /dn\s?6/.test(p.n),
  zaves: p => /zaves prim/.test(p.n) && /125/.test(p.n) && !/akust/.test(p.n) && (p.mj === 'ks' || p.vBaleni > 0),
  sroub: (p, a) => /(sroub|vrut)/.test(p.n) && (/\btn\b/.test(p.n) || /\btb 221\b/.test(p.n)) && p.delkaSroubu === Number(a[0])
    && !/(vrtac|vrtn|antikoro|xtn|umn|habito|aquapanel|diamant|brio|black|\blb\b|\bln\b|\bfn\b|\bsn\b|tex|tun)/.test(p.n) && (p.vBaleni > 0 || p.mj === 'ks'),
  tmel: p => p.skupina === 'Tmely' && /tmel/.test(p.n) && p.hmotnost >= 4
    && !/(finish|finaln|lepic|aquapanel|jet|trennwand|kitt|rifix|\bf plus|glet|imprag)/.test(p.n),
  paska: p => /(pask|mrizk|bandaz)/.test(p.n) && p.delka > 0
    && (p.skupina === 'Pásky a mřížky' || p.tema === 'Suchá výstavba' || /(sadrokart|sdk|spar|vyztuz|skeln)/.test(p.n))
    && !/(rohov|strait|krep|maskov|tesnic|aquapanel|habito|kotvic|zaplat|teflon|izolacni|elektr|kobercov|oboustr|vyznac|alu|hlinik|kaucuk)/.test(p.n),
  tesneni: (p, a) => /(tesneni|pask[a-z]* tesnic)/.test(p.n) && p.delka > 0 && p.sirkaMm >= Number(a[0]) - 12 && p.sirkaMm <= Number(a[0]) + 2
};
function svKandidati(sv) {
  if (!sv) return [];
  if (A && A.svZKatalogu) return SV_KAT[sv] || [];
  const [k, ...a] = String(sv).split(':');
  const f = SV_PRAVIDLA[k];
  return f ? SV.filter(p => f(p, a)) : [];
}
/** Množství ve prodejní jednotce zboží ze sortimentu podle typu řádku. */
function prodejSV(r, m) {
  const q = r.mnozstvi;
  if (!(q > 0)) return null;
  const mj = mjN(m.mj);
  if (r.jed === 'plocha' && m.plocha > 0) {
    const ks = nahoru(q / m.plocha);
    const popis = `${ks} ${ks === 1 ? 'deska' : ks < 5 ? 'desky' : 'desek'} ${m.rozmer || ''} po ${f3(m.plocha)} m²`.replace('  ', ' ');
    return mj === 'm²' ? { mnozstvi: zaok(ks * m.plocha), mj: m.mj, popis } : { mnozstvi: ks, mj: m.mj, popis };
  }
  if (r.jed === 'kusy' && m.delka > 0) {
    // kratší profil se nastavuje s přesahem 0,5 m
    const nast = r.delkaMin > m.delka + 0.001 ? Math.ceil((r.delkaMin - 0.5) / Math.max(0.1, m.delka - 0.5)) : 1;
    const ks = q * nast;
    const popis = `${ks} ks × ${f3(m.delka)} m` + (nast > 1 ? ` (${nast} kusy na stojku s přesahem 0,5 m, stěna ${f3(r.delkaMin)} m)` : '');
    return mj === 'm' ? { mnozstvi: zaok(ks * m.delka), mj: m.mj, popis, nastavovani: nast > 1 ? nast : 0 } : { mnozstvi: ks, mj: m.mj, popis, nastavovani: nast > 1 ? nast : 0 };
  }
  if (r.jed === 'metry' && m.delka > 0 && mjN(r.mj) === 'm') {
    const ks = nahoru(q / m.delka);
    const popis = `${f3(q)} bm → ${ks} ks × ${f3(m.delka)} m`;
    return mj === 'm' ? { mnozstvi: zaok(ks * m.delka), mj: m.mj, popis } : { mnozstvi: ks, mj: m.mj, popis };
  }
  return null;
}
/** Množství, které se kupuje: { mnozstvi, mj, popis } | { nejde } | null (stejná jednotka). */
function mnozstviPro(r, m) {
  if (!m) return null;
  if (r.jed && m.sv) { const x = prodejSV(r, m); if (x) return x; }
  const pr = prepocet(r.mnozstvi, r.mj, m);
  if (pr && pr.mnozstvi != null) return { mnozstvi: pr.mnozstvi, mj: m.mj, popis: pr.popis };
  if (pr) return { nejde: true };
  return null;
}
/** Zboží ze sortimentu suché výstavby v prodejní jednotce: desky na kusy (Stavimex prodává SDK desky na ks),
    profily a pásky na kusy / role podle délky. Cena za kus = cena za m² × plocha desky, resp. za bm × délka. */
function zSortimentu(p) {
  const m = zSortimentuSurove(p), mj = mjN(m.mj);
  if (mj === 'm²' && m.plocha > 0)
    return { ...m, mj: 'ks', mjKat: 'm²', velJed: m.plocha, velKde: 'v desce', nakup: m.nakup != null ? zaok(Number(m.nakup) * m.plocha) : null };
  if (mj === 'm' && m.delka > 0 && m.delka <= 100)
    return { ...m, mj: 'ks', mjKat: 'm', velJed: m.delka, velKde: 'v kusu', nakup: m.nakup != null ? zaok(Number(m.nakup) * m.delka) : null };
  return m;
}
function zSortimentuSurove(p) {
  return { src: 'katalog', sv: true, kod: p.kod, nazev: p.nazev, mj: p.mj, nakup: p.cena, ean: p.ean || '', foto: p.foto || '',
    tema: p.tema, skupina: p.skupina, podskupina: p.podskupina, znacka: p.znacka, rozmer: p.rozmer || '',
    delka: p.delka || null, plocha: p.plocha || null, vBaleni: p.vBaleni || null, hmotnost: p.hmotnost || null, skladem: p.skladem };
}
/** Pořadí: dost skladem v Malešicích → skladem v Malešicích → v Libni → skladová položka ceníku → cena za celou potřebu. */
function hodnotSV(p, r) {
  const m = zSortimentu(p), x = mnozstviPro(r, m);
  const q = x && x.mnozstvi != null ? x.mnozstvi : (mjN(r.mj) === mjN(m.mj) ? r.mnozstvi : null);
  const c = cenaMaterialu(m).cena;
  const z = R.zas[p.kod];
  let s = skladSkore(z);
  if (s === 3 && q != null && z.malesice && mjN(z.malesice.mj) === mjN(p.mj) && zasobaCislo(z.malesice) >= q) s = 4;
  return { p, m, q, s, list: p.skladem === 1 ? 2 : p.skladem === 0 ? 1 : 0, nast: x && x.nastavovani ? x.nastavovani : 0,
    n: q == null || !(c > 0) ? Infinity : q * c };
}
function seraditSV(kand, r) {
  return kand.map(p => hodnotSV(p, r)).sort((a, b) => (b.q != null) - (a.q != null) || b.s - a.s || a.nast - b.nast || b.list - a.list || a.n - b.n || a.p.nazev.localeCompare(b.p.nazev));
}
async function vyberSV(r, filtr) {
  if (A.svZKatalogu) await nactiSVzKatalogu(r.sv);
  const kand = svKandidati(r.sv);
  if (!kand.length) return null;
  await nactiZasoby(kand.map(p => p.kod));
  const znameZasoby = kand.some(p => R.zas[p.kod]);
  const ok = znameZasoby ? kand.filter(p => projdeFiltrem(R.zas[p.kod], efFiltr(filtr))) : kand;
  let pool = ok.length ? ok : kand;
  const sFotkou = pool.filter(p => p.foto); if (sFotkou.length) pool = sFotkou;
  const sch = A.schvalene ? ((await A.schvalene(S.druh))[r.klic] || []) : [];
  if (sch.length) { const kody = new Set(sch.map(x => x.kod)); const jenSch = pool.filter(p => kody.has(p.kod)); if (jenSch.length) pool = jenSch; }
  const serazeno = seraditSV(pool, r);
  const vych = new Set(sch.filter(x => x.vychozi).map(x => x.kod));
  const iV = serazeno.findIndex(x => vych.has(x.p.kod) && x.nast === serazeno[0].nast);
  const m = serazeno[iV > 0 ? iV : 0].m;
  if (znameZasoby && !ok.length) m.mimoSklad = true;
  return m;
}

/* ---------- sortiment: z jakého oboru katalogu se materiál vybírá ----------
   Klíčová slova (bez diakritiky, začátky slov) se hledají v tématu, skupině a podskupině zboží.
   _ = výchozí pro celou kalkulačku, jinak podle klíče řádku. */
const SORT = {
  zdivo: { _: ['Zdivo', ['zdiv', 'porobeton', 'cihl', 'tvarnic', 'keramick']],
    malta: ['Malty a suché směsi', ['malt', 'smes', 'zdic']],
    pena: ['Zdicí pěny a lepidla', ['pen', 'lepidl', 'zdic']],
    vyztuz: ['Výztuž zdiva', ['vyztuz', 'zdiv', 'armatur']],
    preklad: ['Překlady', ['preklad', 'zdiv']],
    preklad_2: ['Překlady', ['preklad', 'zdiv']],
    preklad_3: ['Překlady', ['preklad', 'zdiv']],
    preklad_4: ['Překlady', ['preklad', 'zdiv']],
    preklad_5: ['Překlady', ['preklad', 'zdiv']],
    preklad_6: ['Překlady', ['preklad', 'zdiv']],
    preklad_7: ['Překlady', ['preklad', 'zdiv']],
    preklad_8: ['Překlady', ['preklad', 'zdiv']],
    izolPod: ['Hydroizolace', ['asfalt', 'hydroizol']],
    maltaPrvni: ['Malty a suché směsi', ['malt', 'smes', 'zdic']] },
  sdk: { _: ['Suchá výstavba', ['sucha vystav', 'sadrokart', 'sdk']],
    izolace: ['Izolace', ['izolac', 'mineral', 'vata', 'tepeln', 'zvuk']],
    rohovnik: ['Suchá výstavba', ['sucha vystav', 'sadrokart', 'sdk', 'profil', 'list']],
    spojkaCD: ['Suchá výstavba', ['sucha vystav', 'sadrokart', 'sdk', 'profil']] },
  omitka: { _: ['Omítky a suché směsi', ['omitk', 'stuk', 'smes', 'malt']],
    penetrace: ['Penetrace', ['penetrac', 'nater', 'stavebni chem']],
    omitnik: ['Omítníky a profily', ['omitnik', 'omitk', 'profil', 'list']],
    rohovnik: ['Omítníky a profily', ['rohov', 'omitk', 'profil', 'list']],
    sit: ['Pletiva a sítě', ['pletiv', 'sitovin', 'perlink', 'omitk']] },
  malba: { _: ['Barvy a malířské potřeby', ['barv', 'nater', 'malir']],
    tmel: ['Tmely a štuky', ['tmel', 'stuk', 'glet', 'sterk', 'smes']] },
  plocha: { _: ['Obklady, dlažby a lepidla', ['obklad', 'dlazb', 'lepidl', 'sparov', 'keramik']],
    penetrace: ['Penetrace', ['penetrac', 'stavebni chem', 'obklad']],
    sokl: ['Obklady a dlažby', ['obklad', 'dlazb', 'sokl', 'keramik']],
    silikon: ['Silikony a tmely', ['silikon', 'tmel', 'stavebni chem']],
    listy: ['Obkladové lišty', ['list', 'profil', 'obklad']] },
  hydro: { _: ['Hydroizolace', ['hydroizol', 'izolac', 'koupeln']],
    penetrace: ['Penetrace', ['penetrac', 'hydroizol', 'stavebni chem']],
    rohyVn: ['Hydroizolace', ['hydroizol', 'izolac', 'koupeln']] },
  nivelace: { _: ['Podlahové směsi', ['samoniv', 'nivel', 'podlah', 'sterk', 'smes']],
    penetrace: ['Penetrace', ['penetrac', 'podlah', 'stavebni chem']],
    paska: ['Podlahy a izolace', ['podlah', 'dilatac', 'izolac']] },
  podlaha: { _: ['Podlahy', ['podlah', 'lamin', 'vinyl']],
    lepidlo: ['Lepidla na podlahy', ['lepidl', 'podlah', 'vinyl', 'stavebni chem']],
    folie: ['Fólie a izolace', ['foli', 'izolac', 'podlah']] },
  objem: { _: ['Beton a suché směsi', ['beton', 'cement', 'smes', 'malt']],
    pisek: ['Kamenivo', ['kameniv', 'pisek', 'sterk', 'sypk']],
    sterk: ['Kamenivo', ['kameniv', 'pisek', 'sterk', 'sypk']],
    kari: ['Výztuž a kari sítě', ['kari', 'vyztuz', 'armatur', 'ocel']],
    ocel: ['Výztuž a kari sítě', ['vyztuz', 'armatur', 'ocel', 'betonarsk']],
    bedneni: ['Bednění', ['bednen', 'bedn', 'desk']],
    folie: ['Fólie a izolace', ['foli', 'izolac']],
    paska: ['Podlahy a izolace', ['podlah', 'dilatac', 'izolac']] },
  strecha: { _: ['Střechy a krytiny', ['strech', 'krytin', 'tasek', 'tasky', 'plech']],
    late: ['Řezivo', ['rezivo', 'late', 'drev', 'hranol']],
    kontralate: ['Řezivo', ['rezivo', 'late', 'drev', 'hranol']],
    folie: ['Fólie a izolace', ['foli', 'izolac', 'strech']],
    bedneni: ['Desky a bednění', ['osb', 'desk', 'bedn', 'drev']],
    zlab: ['Okapy a žlaby', ['zlab', 'okap', 'klempir']],
    hak: ['Okapy a žlaby', ['zlab', 'okap', 'klempir']] },
  podkrovi: { _: ['Izolace', ['izolac', 'mineral', 'vata', 'tepeln']],
    parozabrana: ['Fólie a izolace', ['foli', 'parozabr', 'izolac']],
    paska: ['Fólie a izolace', ['pask', 'foli', 'izolac']] },
  zamkova: { _: ['Zámková dlažba a zahrada', ['zamkov', 'dlazb', 'betonov', 'zahrad']],
    dlazba: ['Dlažby venkovní', ['dlazby venkovni', 'dlazby zamkov', 'dlazby plosn', 'dlazby zatravnov']],
    lozeni: ['Kamenivo', ['kameniv', 'drt', 'sterk', 'sypk']],
    podklad: ['Kamenivo', ['kameniv', 'drt', 'sterk', 'sypk']],
    geo: ['Geotextilie', ['geotextili', 'foli', 'izolac']],
    obrubnik: ['Obrubníky', ['obrubnik', 'zamkov', 'betonov']],
    betonObr: ['Beton a suché směsi', ['beton', 'smes', 'malt']],
    pisek: ['Kamenivo', ['pisek', 'kameniv', 'zamkov', 'sypk']] },
  skladba: { _: ['Podlahové izolace a směsi', ['podlah', 'izolac', 'poter', 'polystyren', 'eps']],
    hydro: ['Hydroizolace', ['hydroizol', 'izolac', 'asfalt']],
    folie: ['Fólie a izolace', ['foli', 'izolac']],
    okraj: ['Podlahy a izolace', ['podlah', 'dilatac', 'izolac']],
    kari: ['Výztuž a kari sítě', ['kari', 'vyztuz', 'armatur', 'ocel']],
    poter: ['Beton a suché směsi', ['poter', 'beton', 'cement', 'smes']] },
  elektro: { _: ['Elektroinstalace', ['elektro', 'kabel', 'vodic', 'instalac']],
    krabice: ['Elektroinstalační krabice', ['krabic', 'elektro', 'instalac']],
    rozvodna: ['Elektroinstalační krabice', ['krabic', 'elektro', 'instalac']],
    sadra: ['Sádry a omítky', ['sadr', 'omitk', 'smes', 'malt']] },
  bourani: { _: ['Odpad a suť', ['sut', 'odpad', 'kontejner', 'pytl']] },
  pergola: { _: ['Celý katalog', []] },
  krov: { _: ['Celý katalog', []] },
  smesi: { _: ['Suché směsi', ['smes', 'omitk', 'lepidl', 'stuk', 'malt', 'poter', 'nivel', 'sterk', 'hydroizol']],
    penetrace: ['Penetrace', ['penetrac', 'stavebni chem', 'nater']] },
  fasada: { _: ['Zateplení a fasády', ['zatepl', 'fasad', 'etics', 'kzs', 'polystyren', 'izolac', 'omitk']] }
};
/** Řádek bez hledaného výrazu se vybírá automaticky jen s vlastním sortimentem (kód nebo Správa databáze). */
function vlastniSort(klic, druh = S.druh) {
  const o = (global.YEY_KH || {})[druh + '/' + klic];
  return !!((SORT[druh] || {})[klic] || (o && (o.sort_slova || o.skupina || o.tema)));
}
/** Sortiment řádku: {nazev, slova, tema, skupina} – tema/skupina, pokud si ji uživatel vybral. */
function sortRadku(klic, druh = S.druh) {
  const d = SORT[druh] || {};
  let zakl = d[klic] || d._ || ['Celý katalog', []];
  // výchozí hodnoty z tabulky yey_kalk_hledani (Správa databáze) mají přednost před kódem
  const KH = global.YEY_KH || {}, o = KH[druh + '/' + klic], o_ = KH[druh + '/_'];
  const slovaZ = t => String(t).split(',').map(x => bezDia(x.trim())).filter(Boolean);
  if (o && o.sort_slova) zakl = [o.sort_nazev || zakl[0], slovaZ(o.sort_slova)];
  else if (!d[klic] && o_ && o_.sort_slova) zakl = [o_.sort_nazev || zakl[0], slovaZ(o_.sort_slova)];
  const st = S.d[druh], vyb = st && st.sortVyber && st.sortVyber[klic];
  return { nazev: zakl[0], slova: zakl[1], tema: vyb?.tema || o?.tema || null, skupina: vyb?.skupina || o?.skupina || null };
}
function textSortimentu(p) { return bezDia([p.tema, p.skupina, p.podskupina].filter(Boolean).join(' | ')); }
/** Patří zboží do sortimentu? Vybraná skupina má přednost před klíčovými slovy. */
function vSortimentu(p, sort) {
  if (!sort) return true;
  if (sort.skupina) return bezDia(p.skupina) === bezDia(sort.skupina) || bezDia(p.podskupina) === bezDia(sort.skupina);
  if (!sort.slova.length) return true;
  const t = textSortimentu(p);
  return !!t && sort.slova.some(s => t.includes(s));
}
/** Názvy témat katalogu, která odpovídají sortimentu (pro dotaz na server). */
function temataSortimentu(vsechna, sort) {
  if (!sort) return [];
  if (sort.tema) return [sort.tema];
  return (vsechna || []).filter(n => sort.slova.some(s => bezDia(n).includes(s)));
}
const cestaSortimentu = p => [...new Set([p.tema, p.skupina, p.podskupina].filter(Boolean))].join(' › ');

const PORADI = ['zdivo', 'sdk', 'omitka', 'smesi', 'malba', 'plocha', 'hydro', 'nivelace', 'podlaha', 'objem', 'fasada', 'skladba', 'strecha', 'krov', 'pergola', 'podkrovi', 'zamkova', 'elektro', 'bourani'];
/** Řádek, jehož materiál určuje rozměr (tvárnice, dlaždice). */
const HLAVNI_S_ROZMEREM = { zdivo: { klic: 'tvarnice', pole: ['td', 'tv', 'tl'] }, plocha: { klic: 'material', pole: ['kd', 'ksi'] } };

/* =====================================================================
   STAV
   ===================================================================== */
let A = null, root = null;
const KLIC = 'kk-stav-v1';
const DOPRAVA0 = { zpusob: 'ne', km: '', sazba: '', pausal: '', nosnost: '1,2', jizdy: '', kg: '' };
const S = { doprava: { ...DOPRAVA0 }, druh: 'zdivo', rezim: 'laik', tipy: false, jak: false, filtr: 'malesice', prirazka: 15, d: {}, cenyPrace: {} };
const R = { radky: [], prace: [], h: null, zas: {}, zasBez: {}, nenalezeno: {}, vybiram: false, znovu: false, dlg: null, hledaniSeq: 0, vysledky: [] };
let ulozCas, vyberCas;

function stav() {
  if (!S.d[S.druh]) {
    const k = KALK[S.druh];
    const u = k.rozmer === 'mistnost' ? { d: '', s: '', v: '2,6' } : k.rozmer === 'steny' ? { d: '', v: '' } : { d: '', s: '' };
    S.d[S.druh] = { useky: [u], otvory: [], pole: {}, mat: {}, rucne: {}, vyp: {}, pracePouzit: {}, dotazy: {}, sortVyber: {}, sablona: null };
  }
  const st = S.d[S.druh];
  if (!st.sortVyber) st.sortVyber = {};
  return st;
}
function nacti() {
  try { const t = A.pamet.cti(KLIC, ''); if (t) { const x = JSON.parse(t); Object.assign(S, x); } } catch (e) {}
  if (!KALK[S.druh]) S.druh = 'zdivo';
  S.doprava = Object.assign({}, DOPRAVA0, S.doprava);
  if (!['malesice', 'obe', 'stavimex', 'vse'].includes(S.filtr)) S.filtr = 'malesice';
  if (A.jenStavimex && S.filtr === 'vse') S.filtr = 'stavimex';
  if (!Number.isFinite(Number(S.prirazka))) S.prirazka = A.vychoziPrirazka ?? 15;
}
function uloz() { clearTimeout(ulozCas); ulozCas = setTimeout(() => { try { A.pamet.pis(KLIC, JSON.stringify(S)); } catch (e) {} }, 400); }

/* ---------- hodnoty zadání ---------- */
function hodnotyPole() {
  const k = KALK[S.druh], st = stav(), h = {};
  k.pole.forEach(f => {
    const raw = st.pole[f.id] !== undefined ? st.pole[f.id] : f.v;
    if (f.typ === 'volba') h[f.id] = String(raw);
    else if (f.typ === 'ano') h[f.id] = String(raw) === '1';
    else h[f.id] = cis(raw) ?? 0;
  });
  return h;
}
function geometrie(h) {
  const k = KALK[S.druh], st = stav();
  const useky = st.useky.map(u => ({ d: cis(u.d) || 0, v: cis(u.v) || 0, s: cis(u.s) || 0, m2: cis(u.m2) || 0, jeM2: u.m2 !== undefined }));
  const otv = (k.otvory ? st.otvory : []).map(o => ({ s: cis(o.s) || 0, v: cis(o.v) || 0, n: Math.max(0, Math.round(cis(o.n) || 0)) }));
  let hruba = 0, delka = 0, podlaha = 0, steny = 0, obvod = 0, m2 = 0, vyskaMax = 0;
  useky.forEach(u => {
    if (u.jeM2) { m2 += u.m2; return; }
    if (k.rozmer === 'steny') { hruba += u.d * u.v; delka += u.d; obvod += (u.d > 0 && u.v > 0) ? 2 * (u.d + u.v) : 0; vyskaMax = Math.max(vyskaMax, u.v); }
    else if (k.rozmer === 'plocha') { podlaha += u.d * u.s; delka += u.d; obvod += (u.d > 0 && u.s > 0) ? 2 * (u.d + u.s) : 0; }
    else { podlaha += u.d * u.s; obvod += (u.d > 0 && u.s > 0) ? 2 * (u.d + u.s) : 0; steny += (u.d > 0 && u.s > 0) ? 2 * (u.d + u.s) * u.v : 0; vyskaMax = Math.max(vyskaMax, u.v); }
  });
  const plochaOtvoru = otv.reduce((s, o) => s + o.s * o.v * o.n, 0);
  Object.assign(h, {
    useky: useky.filter(u => !u.jeM2), m2, otvory: otv,
    otvoryN: otv.reduce((s, o) => s + o.n, 0), plochaOtvoru,
    obvodOtvoru: otv.reduce((s, o) => s + 2 * (o.s + o.v) * o.n, 0),
    sirkaDveri: otv.filter(o => o.v >= 1.8).reduce((s, o) => s + o.s * o.n, 0),
    delka, obvod, vyskaMax, podlaha
  });
  if (k.rozmer === 'steny') {
    h.plocha = Math.max(0, hruba + m2 - plochaOtvoru);
    h.vyska = delka > 0 ? hruba / delka : (vyskaMax || 0);
  } else if (k.rozmer === 'plocha') {
    h.plocha = Math.max(0, podlaha + m2 - plochaOtvoru);
  } else {
    h.steny = Math.max(0, steny + m2 - plochaOtvoru);
    h.plocha = h.steny;
  }
  return h;
}
function hodnoty() { return geometrie(hodnotyPole()); }

/* =====================================================================
   MATERIÁL, CENY, ZÁSOBY
   ===================================================================== */
async function nactiZasoby(kody) {
  kody = [...new Set((kody || []).filter(k => k && !(k in R.zas) && !R.zasBez[k]))];
  if (!kody.length || !A.zasoby) return false;
  try {
    const z = await A.zasoby(kody) || {};
    kody.forEach(k => { if (z[k]) R.zas[k] = z[k]; else R.zasBez[k] = 1; });
    return true;
  } catch (e) { return false; }
}
/** Hledá zboží; se sortimentem dá napřed zboží z oboru, v něm skladem v Malešicích, pak v Libni. */
/** Filtr, který se opravdu použije: offline verze (jen Stavimex) nikdy nepustí celý katalog;
    bez dat o zásobách se nefiltruje vůbec. */
function efFiltr(f) {
  if (A && A.stxDostupne && !A.stxDostupne()) return 'vse';
  if (A && A.jenStavimex && (f === 'vse' || !f)) return 'stavimex';
  return f || 'stavimex';
}
const textFiltru = f => ({ malesice: 'skladem v Malešicích', obe: 'skladem v Malešicích nebo Libni', stavimex: 've Stavimexu', vse: 'v katalogu' }[f] || '');
async function hledejSeSkladem(q, pocet, sort, filtr) {
  const nal = await A.hledej(q, pocet, sort || null, efFiltr(filtr ?? S.filtr)) || [];
  const vid = new Set(), uniq = nal.filter(p => p && p.kod && !vid.has(p.kod) && vid.add(p.kod));
  await nactiZasoby(uniq.map(x => x.kod));
  const serazeno = seraditPodleSkladu(uniq, R.zas, x => x.kod);
  if (!sort) return serazeno;
  return serazeno.map((p, i) => ({ p, i, v: vSortimentu(p, sort) ? 1 : 0 })).sort((a, b) => b.v - a.v || a.i - b.i).map(x => x.p);
}
function zCeniku(c) {
  return { src: 'cenik', cenikId: c.id, kod: c.kod || null, nazev: c.nazev, mj: c.mj || 'ks', cenaCenik: Number(c.cena) || 0 };
}
/** Prodejní jednotka zboží, které katalog vede v m² nebo bm (desky, izolace, profily, lišty):
    kus podle rozměru / délky v názvu, nebo balení podle katalogu (MJ v balení). */
function prodejniJednotka(m) {
  const z = mjN(m.mj);
  if (z !== 'm²' && z !== 'm') return null;
  const t = bezDia(m.nazev).replace(/²/g, '2').replace(/(\d),(\d)/g, '$1.$2');
  const bal = Number(m.vBaleni) > 0 ? Number(m.vBaleni) : null;
  if (z === 'm²') {
    const br = t.match(/\[\s*(\d+(?:\.\d+)?)\s*m2\s*\]/);
    if (br && +br[1] > 0) return { mj: 'ks', vel: +br[1], z, kde: 'v kusu' };
    if (bal && bal >= 0.3 && bal <= 60) return { mj: 'bal', vel: bal, z, kde: 'v balení' };
    const d = t.match(/(\d{3,4}(?:\.\d+)?)\s*[x×*]\s*(\d{3,4}(?:\.\d+)?)\s*(?:[x×*]\s*\d+(?:\.\d+)?\s*)?mm/);
    if (d && +d[1] >= 300 && +d[2] >= 300) { const a = zaok(+d[1] * +d[2] / 1e6 * 1000) / 1000; if (a > 0) return { mj: 'ks', vel: a, z, kde: 'v kusu' }; }
    return null;
  }
  const l = zNazvu(m.nazev, 'm');
  if (l > 0 && l <= 6.5) return { mj: 'ks', vel: l, z, kde: 'v kusu' };
  if (bal && bal > 6.5 && bal <= 30) return { mj: 'bal', vel: bal, z, kde: 'v balení' };
  return null;
}
/** Převede zboží z m² / bm na prodejní jednotku (cena a hmotnost za kus / balení). */
function naProdejniMj(m) {
  const pj = prodejniJednotka(m);
  if (!pj) return m;
  return { ...m, mj: pj.mj, mjKat: pj.z, velJed: pj.vel, velKde: pj.kde,
    nakup: m.nakup != null ? zaok(Number(m.nakup) * pj.vel) : null,
    hmotnost: m.hmotnost > 0 ? Math.round(m.hmotnost * pj.vel * 1000) / 1000 : null, vBaleni: null };
}
function zKatalogu(p) {
  return naProdejniMj(zKataloguSurove(p));
}
function zKataloguSurove(p) {
  return { src: 'katalog', kod: p.kod, nazev: p.nazev, mj: (p.mj || 'ks'), nakup: p.cena != null ? Number(p.cena) : null,
    hmotnost: p.hmotnost || null, naPalete: p.naPalete || null, vBaleni: p.vBaleni || null, foto: p.foto || '', ean: p.ean || '',
    tema: p.tema || '', skupina: p.skupina || '', podskupina: p.podskupina || '', rozmer: p.rozmer || '' };
}
/** Prodejní cena materiálu bez DPH a odkud je. */
function cenaMaterialu(m) {
  if (!m) return { cena: 0, popis: '' };
  if (m.src === 'cenik') {
    const c = A.cenik().find(x => x.id === m.cenikId);
    return { cena: c ? Number(c.cena) || 0 : (m.cenaCenik || 0), popis: 'z tvého ceníku' };
  }
  const vc = m.kod && A.cenik().find(x => x.kod === m.kod);
  if (vc) return { cena: Number(vc.cena) || 0, popis: 'z tvého ceníku', cenikId: vc.id };
  // pořadí: aktuální cena prodejny Malešice → Libeň → ceník Stavimexu (suchá výstavba) → průměrná cena trhu z katalogu
  const z = R.zas[m.kod];
  const cenaProdejny = k => k && k.cena != null && Number(k.cena) > 0 && (!k.mj || mjN(k.mj) === mjN(m.mj)) ? Number(k.cena) : null;
  let nakup = null, zdroj = '';
  if (cenaProdejny(z?.malesice) != null) { nakup = cenaProdejny(z.malesice); zdroj = 'aktuální cena Stavimex Malešice'; }
  else if (cenaProdejny(z?.liben) != null) { nakup = cenaProdejny(z.liben); zdroj = 'aktuální cena Stavimex Libeň'; }
  else if (m.nakup != null) { nakup = Number(m.nakup); zdroj = A.cenaPopis || (m.sv ? 'ceník Stavimex' : 'průměrná cena trhu'); }
  if (nakup == null) return { cena: 0, popis: 'bez ceny – doplň', nakup: null };
  const p = Number(S.prirazka) || 0;
  return { cena: zaok(nakup * (1 + p / 100)), popis: `${zdroj} ${kc(nakup)}${p ? ` + ${f3(p)} %` : ''}`, nakup, aktualni: /aktuální|ceník/.test(zdroj) };
}
/** Vybere nejlepší zboží pro potřebné množství: podle skladu (Malešice, Libeň) a pak nejnižší cena za celou potřebu. */
function vyberNejlepsi(nal, r, filtr) {
  const kandidati = nal.filter(p => projdeFiltrem(R.zas[p.kod], efFiltr(filtr)));
  if (!kandidati.length) return null;
  const naklad = p => {
    const m = zKatalogu(p);
    const c = cenaMaterialu(m).cena;
    if (!(c > 0)) return Infinity;
    const x = mnozstviPro(r, m);
    const q = x ? x.mnozstvi : (mjN(r.mj) === mjN(m.mj) ? r.mnozstvi : null);
    return q == null ? 1e12 + c : q * c;
  };
  // přednost má zboží, u kterého znám přepočet na prodejní jednotku, pak sklad, pak zboží s fotkou, nakonec nejnižší cena
  return kandidati.map(p => { const n = naklad(p); return { p, s: skladSkore(R.zas[p.kod]), n, pr: n < 1e12 ? 1 : 0, f: p.foto ? 1 : 0 }; })
    .sort((a, b) => b.pr - a.pr || b.s - a.s || b.f - a.f || a.n - b.n)[0].p;
}

/* ---------- řádky výsledku ---------- */
function sestavRadky() {
  const st = stav();
  return R.radky.map(r0 => {
    const r = { ...r0 };
    r.q = (st.dotazy[r.klic] && !/^fasad (eps|vata) /.test(st.dotazy[r.klic])) ? st.dotazy[r.klic] : r.q;
    r.vyp = !!st.vyp[r.klic];
    r.m = st.mat[r.klic] || null;
    r.mnProdej = r.mnozstvi; r.mjProdej = r.mj; r.prevod = null; r.prevodNejde = false;
    if (r.m) {
      const x = mnozstviPro(r, r.m);
      if (x && x.mnozstvi != null) { r.mnProdej = x.mnozstvi; r.mjProdej = x.mj; r.prevod = x.popis; r.nastavovani = !!x.nastavovani; }
      else if (x && x.nejde) { r.prevodNejde = true; r.mjProdej = r.mj; }
    }
    const ru = st.rucne[r.klic];
    if (ru && mjN(ru.mj) === mjN(r.mjProdej)) { r.mnProdej = cis(ru.q) ?? r.mnProdej; r.rucne = true; }
    const c = cenaMaterialu(r.m);
    r.cena = r.m ? c.cena : 0; r.cenaPopis = c.popis; r.nakup = c.nakup; r.cenikId = r.m?.cenikId || c.cenikId || null;
    r.celkem = r.m && !r.vyp ? zaok(r.mnProdej * r.cena) : 0;
    r.z = r.m?.kod ? R.zas[r.m.kod] : null;
    return r;
  });
}
/** Hmotnost řádku v kg (null = neznámá). Beton z betonárny veze míchačka – do nákladu se nepočítá. */
function hmotnostRadku(r) {
  if (r.klic === 'beton') return 0;
  const m = r.m, mn = Number(r.mnProdej) || 0, mj = mjN(r.mjProdej);
  if (!(mn > 0)) return 0;
  if (m.hmotnost > 0 && ['ks', 'bal', 'rol', 'sada', 'pal'].includes(mj)) return m.hmotnost * mn;
  if (mj === 'kg') return mn;
  if (mj === 't') return mn * 1000;
  if (mj === 'l') return mn * 1.2;
  if (mj === 'm³') return mn * 1600;
  return null;
}
/** Doprava materiálu: náklad podle zvolených položek, počet jízd podle nosnosti vozidla, cena za km nebo paušálem. */
function sestavDopravu(radky) {
  radky = radky || sestavRadky();
  const D = S.doprava;
  let kg = 0, bez = 0;
  radky.forEach(r => { if (r.vyp || !r.m) return; const x = hmotnostRadku(r); if (x == null) bez++; else kg += x; });
  const rucne = cis(D.kg) > 0;
  if (rucne) kg = cis(D.kg);
  const nos = (cis(D.nosnost) || 0) * 1000;
  const jizdy = Math.max(1, Math.round(cis(D.jizdy) || (kg > 0 && nos > 0 ? nahoru(kg / nos) : 1)));
  const km = cis(D.km) || 0, sazba = cis(D.sazba) || 0, pausal = cis(D.pausal) || 0;
  const out = { zpusob: D.zpusob, kg, bez, rucne, jizdy, mnozstvi: 0, mj: '', cena: 0, celkem: 0, nazev: 'Doprava materiálu' };
  if (D.zpusob === 'km') {
    out.mnozstvi = zaok(jizdy * km * 2); out.mj = 'km'; out.cena = sazba; out.celkem = zaok(out.mnozstvi * sazba);
    out.nazev = `Doprava materiálu (${jizdy}× ${f3(km)} km tam a zpět)`;
  } else if (D.zpusob === 'pausal') {
    out.mnozstvi = jizdy; out.mj = 'jízda'; out.cena = pausal; out.celkem = zaok(jizdy * pausal);
    out.nazev = `Doprava materiálu (${jizdy} ${jizdy === 1 ? 'jízda' : jizdy < 5 ? 'jízdy' : 'jízd'})`;
  }
  return out;
}
function vykresliDopravu() {
  const el = $k('doprava'); if (!el) return;
  const D = S.doprava, z = D.zpusob;
  const seg = [['ne', 'Bez dopravy'], ['km', 'Podle km'], ['pausal', 'Paušál za jízdu']].map(([v, t]) =>
    `<button type="button" data-dzp="${v}" aria-pressed="${z === v}">${t}</button>`).join('');
  const pole = (id, popis, mj, ph) => `<div class="kk-pole"><label class="kk-pole-popis" for="kk-d-${id}">${popis}</label>
    <span class="kk-mj-obal"><input id="kk-d-${id}" class="kk-in" data-dop="${id}" inputmode="decimal" value="${esc(D[id])}"${ph ? ` placeholder="${ph}"` : ''}>${mj ? `<i>${mj}</i>` : ''}</span></div>`;
  el.innerHTML = `<div class="kk-seg kk-seg-volba" role="group" aria-label="Způsob dopravy">${seg}</div>` +
    (z === 'ne' ? '' : `<div class="kk-mrizka kk-dop-pole">${pole('km', 'Vzdálenost k zákazníkovi', 'km', 'jedním směrem')}${z === 'km' ? pole('sazba', 'Sazba za km', 'Kč/km') : pole('pausal', 'Cena jedné jízdy', 'Kč')}${pole('nosnost', 'Nosnost vozidla', 't')}${pole('jizdy', 'Počet jízd', '', 'auto')}${pole('kg', 'Hmotnost nákladu ručně', 'kg', 'auto')}</div>`) +
    '<p class="kk-pozn" data-kk="dop-souhrn"></p>';
  obnovDopravuSouhrn();
}
function obnovDopravuSouhrn(radky) {
  if (!root) return;
  const e = root.querySelector('[data-kk="dop-souhrn"]'); if (!e) return;
  const d = sestavDopravu(radky);
  let t = d.kg > 0 ? `Náklad cca ${f3(Math.round(d.kg))} kg` : 'Hmotnost nákladu zatím neznám';
  if (d.bez && !d.rucne) t += ` (u ${d.bez} ${d.bez === 1 ? 'položky' : 'položek'} hmotnost chybí – zadej ji ručně)`;
  if (d.zpusob !== 'ne') t += ` · ${d.jizdy} ${d.jizdy === 1 ? 'jízda' : d.jizdy < 5 ? 'jízdy' : 'jízd'}` + (d.celkem > 0 ? ` · doprava ${kc0(d.celkem)}` : ' · doplň vzdálenost a cenu');
  e.textContent = t;
}

function sestavPraci() {
  return R.prace.map(p => {
    const kl = S.druh + ':' + p.klic;
    const cena = cis(S.cenyPrace[kl]);
    const st = stav();
    const pouzit = st.pracePouzit[p.klic] !== undefined ? st.pracePouzit[p.klic] : cena > 0;
    return { ...p, kl, cena, pouzit, celkem: pouzit && cena > 0 ? zaok(cena * p.mnozstvi) : 0 };
  });
}

/* =====================================================================
   VYKRESLENÍ
   ===================================================================== */
const $k = s => root.querySelector(`[data-kk="${s}"]`);

function kostra() {
  root.innerHTML = `<div class="kk">
  <nav class="kk-druhy" data-kk="druhy" aria-label="Kalkulačky"></nav>
  <section class="kk-karta">
    <div class="kk-hlava">
      <h2 data-kk="titulek"></h2>
      <div class="kk-hlava-akce">
        <div class="kk-seg" data-kk="rezim" role="group" aria-label="Režim zadání">
          <button type="button" data-rezim="laik">Jednoduše</button><button type="button" data-rezim="profi">Podrobně</button>
        </div>
        <button type="button" class="kk-btn kk-tichy kk-maly" data-akce="tipy">Nápověda</button>
        <button type="button" class="kk-btn kk-tichy kk-maly" data-akce="jak">Jak počítám</button>
        <button type="button" class="kk-btn kk-tichy kk-maly" data-akce="novy" title="Vymazat rozměry, parametry i vybraný materiál této kalkulačky">↺ Nový výpočet</button>
      </div>
    </div>
    <p class="kk-popis" data-kk="popis"></p>
    <div class="kk-sablony" data-kk="sablony"></div>
    <div class="kk-jak" data-kk="jak" hidden></div>
    <div class="kk-blok">
      <div class="kk-blok-hlava"><span data-kk="useky-nadpis">Rozměry</span><span class="kk-souhrn-plochy" data-kk="plocha"></span></div>
      <div data-kk="useky"></div>
      <div class="kk-radek-akci" data-kk="useky-akce"></div>
    </div>
    <div class="kk-blok" data-kk="otvory-blok"></div>
    <div class="kk-blok">
      <div class="kk-blok-hlava">Parametry</div>
      <div class="kk-mrizka" data-kk="pole"></div>
    </div>
    <div class="kk-schema" data-kk="schema"></div>
  </section>
  <section class="kk-karta kk-vysl">
    <div class="kk-hlava">
      <h2>Materiál</h2>
      <div class="kk-hlava-akce">
        <div class="kk-seg kk-seg-sklad" data-kk="filtr" role="group" aria-label="Zboží ze Stavimexu">
          <button type="button" data-filtr="malesice" title="Vybírat jen zboží skladem v Malešicích">Skladem Malešice</button><button type="button" data-filtr="obe" title="Skladem v Malešicích nebo v Libni">+ Libeň</button><button type="button" data-filtr="stavimex" title="Všechno zboží, které Stavimex vede, i bez zásoby">Stavimex</button>${A.jenStavimex ? '' : '<button type="button" data-filtr="vse" title="Celý katalog 130 tis. položek – průměrné ceny trhu">Celý katalog</button>'}
        </div>
        <label class="kk-prirazka">Přirážka <input class="kk-in kk-in-maly" data-kk="prirazka" inputmode="decimal"> %</label>
        <button type="button" class="kk-btn kk-tichy kk-maly" data-akce="predvyber" title="Znovu vybrat materiál podle zásob a ceny">↻ Vybrat znovu</button>
      </div>
    </div>
    <p class="kk-pozn" data-kk="mat-info"></p>
    <div data-kk="stx"></div>
    <div class="kk-radky" data-kk="radky"></div>
    <div class="kk-h3">Práce <small>cenu za jednotku si pamatuju</small></div>
    <div class="kk-prace" data-kk="prace"></div>
    <div class="kk-h3">Doprava <small>dovoz materiálu na stavbu</small></div>
    <div class="kk-doprava" data-kk="doprava"></div>
    <p class="kk-pozn">Kalkulačky jsou orientační pomůcka – výsledek vždy ověřte podle projektu a pokynů výrobce. <a href="obchodni-podminky.html#vypocty" target="_blank" rel="noopener">Více v podmínkách</a></p>
  </section>
  <div class="kk-lista" data-kk="lista"></div>
  <dialog class="kk-dlg" data-kk="dlg" aria-labelledby="kk-dlg-t">
    <div class="kk-dlg-hlava"><h3 id="kk-dlg-t" data-kk="dlg-titulek">Vybrat materiál</h3><button type="button" class="kk-dlg-x" data-akce="zavrit" aria-label="Zavřít">×</button></div>
    <div class="kk-dlg-telo">
      <div class="kk-omezeni" data-kk="dlg-omezeni" hidden>ℹ️ Bez registrace je v katalogu jen cca 4 000 položek. <b>S licencí uvidíte celý katalog 130 000 položek.</b> <a href="https://yey.cz/?tarif=start#koupit" target="_blank" rel="noopener">Koupit licenci</a></div>
      <input class="kk-in kk-hledat" data-kk="dlg-hledat" type="search" placeholder="Hledat – název, kód, EAN" autocomplete="off">
      <div class="kk-hledat-tip">Tip: slovo s mínusem z výsledků vyřadíš, např. <b>lepidlo -flex</b>.</div>
      <div class="kk-dlg-sort" data-kk="dlg-sort"></div>
      <div class="kk-dlg-filtry">
        <div class="kk-seg" data-kk="dlg-zdroj"><button type="button" data-zdroj="sv">Suchá výstavba</button><button type="button" data-zdroj="katalog">Katalog</button><button type="button" data-zdroj="cenik">Můj ceník</button></div>
        <div class="kk-seg kk-seg-sklad" data-kk="dlg-filtr"><button type="button" data-dfiltr="malesice">Skladem Malešice</button><button type="button" data-dfiltr="obe">+ Libeň</button><button type="button" data-dfiltr="stavimex">Stavimex</button>${A.jenStavimex ? '' : '<button type="button" data-dfiltr="vse">Celý katalog</button>'}</div>
      </div>
      <div class="kk-dlg-seznam" data-kk="dlg-seznam"></div>
    </div>
    <div class="kk-dlg-pata"><button type="button" class="kk-btn kk-tichy" data-akce="bez-materialu">Bez materiálu</button><button type="button" class="kk-btn kk-tichy" data-akce="zavrit">Zavřít</button></div>
  </dialog>
</div>`;
}

function vykresliDruhy() {
  $k('druhy').innerHTML = PORADI.map(k => `<button type="button" class="kk-druh${k === S.druh ? ' aktivni' : ''}" data-druh="${k}" aria-pressed="${k === S.druh}">
    <span class="kk-druh-ik" aria-hidden="true">${KALK[k].ikona}</span><span>${esc(KALK[k].nazev)}</span></button>`).join('');
  const akt = $k('druhy').querySelector('.aktivni');
  if (akt && akt.scrollIntoView) try { akt.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) {}
}

function vykresliZadani() {
  const k = KALK[S.druh], st = stav();
  $k('titulek').textContent = k.nazev;
  $k('popis').textContent = k.popis;
  root.querySelectorAll('[data-rezim]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.rezim === S.rezim)));
  root.querySelector('[data-akce="tipy"]').textContent = S.tipy ? 'Skrýt nápovědu' : 'Nápověda';
  const jak = $k('jak'); jak.hidden = !S.jak; jak.textContent = k.jak;
  const hlavni = HLAVNI_S_ROZMEREM[S.druh];
  $k('sablony').innerHTML = (k.sablony || []).map((s, i) =>
    `<button type="button" class="kk-chip${st.sablona === i ? ' aktivni' : ''}" data-sablona="${i}">${esc(s.n)}</button>`).join('')
    + (hlavni ? `<button type="button" class="kk-chip kk-chip-kat" data-akce="rozmer-z-katalogu">📐 Rozměr podle zboží</button>` : '');
  vykresliUseky(); vykresliOtvory(); vykresliPole();
}

function popiskyUseku() {
  const k = KALK[S.druh];
  if (k.popisky) return k.popisky(hodnotyPole());
  return k.rozmer === 'steny' ? ['Délka', 'Výška'] : k.rozmer === 'plocha' ? ['Délka', 'Šířka'] : ['Délka', 'Šířka', 'Výška'];
}
function vykresliUseky() {
  const k = KALK[S.druh], st = stav(), pop = popiskyUseku();
  const klice = k.rozmer === 'steny' ? ['d', 'v'] : k.rozmer === 'plocha' ? ['d', 's'] : ['d', 's', 'v'];
  $k('useky-nadpis').textContent = k.rozmer === 'mistnost' ? 'Místnosti' : k.rozmer === 'steny' ? 'Stěny' : 'Plochy';
  $k('useky').innerHTML = st.useky.map((u, i) => {
    const nazev = `${k.usek} ${i + 1}`;
    const smaz = st.useky.length > 1 ? `<button type="button" class="kk-x" data-usek-smazat="${i}" aria-label="Odebrat ${esc(nazev)}">×</button>` : '<span></span>';
    if (u.m2 !== undefined) return `<div class="kk-usek kk-usek-m2"><span class="kk-usek-n">${esc(nazev)}</span>
      <label class="kk-mini"><span>Plocha</span><span class="kk-mj-obal"><input class="kk-in" data-u="${i}:m2" inputmode="decimal" value="${esc(u.m2)}" placeholder="0"><i>m²</i></span></label>${smaz}</div>`;
    return `<div class="kk-usek kk-usek-${klice.length}"><span class="kk-usek-n">${esc(nazev)}</span>
      ${klice.map((kl, j) => `${j ? '<span class="kk-krat" aria-hidden="true">×</span>' : ''}<label class="kk-mini"><span>${esc(pop[j])}</span><span class="kk-mj-obal"><input class="kk-in" data-u="${i}:${kl}" inputmode="decimal" value="${esc(u[kl] ?? '')}" placeholder="0"><i>m</i></span></label>`).join('')}
      ${smaz}</div>`;
  }).join('');
  const dalsi = k.rozmer === 'mistnost' ? '+ Další místnost' : k.rozmer === 'steny' ? '+ Další stěna' : '+ Další plocha';
  $k('useky-akce').innerHTML = `<button type="button" class="kk-btn kk-tichy kk-maly" data-akce="usek">${dalsi}</button>
    <button type="button" class="kk-btn kk-tichy kk-maly" data-akce="usek-m2">+ Zadat rovnou m²</button>`;
}
function vykresliOtvory() {
  const k = KALK[S.druh], st = stav(), el = $k('otvory-blok');
  if (!k.otvory) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const volby = k.otvoryVolby || DVERE;
  el.innerHTML = `<div class="kk-blok-hlava">${esc(k.otvoryNadpis || 'Odečíst dveře a okna')}</div>
    ${st.otvory.map((o, i) => `<div class="kk-otvor">
      <label class="kk-mini"><span>Šířka</span><span class="kk-mj-obal"><input class="kk-in" data-o="${i}:s" inputmode="decimal" value="${esc(o.s)}"><i>m</i></span></label>
      <span class="kk-krat">×</span>
      <label class="kk-mini"><span>Výška</span><span class="kk-mj-obal"><input class="kk-in" data-o="${i}:v" inputmode="decimal" value="${esc(o.v)}"><i>m</i></span></label>
      <label class="kk-mini kk-mini-n"><span>Kusů</span><span class="kk-krok"><button type="button" data-o-krok="${i}:-1" aria-label="Méně">−</button><input class="kk-in" data-o="${i}:n" inputmode="numeric" value="${esc(o.n)}"><button type="button" data-o-krok="${i}:1" aria-label="Více">+</button></span></label>
      <button type="button" class="kk-x" data-otvor-smazat="${i}" aria-label="Odebrat">×</button></div>`).join('')}
    <div class="kk-radek-akci">${volby.map(([v, t]) => `<button type="button" class="kk-chip" data-otvor-pridat="${v}">+ ${esc(t)}</button>`).join('')}</div>`;
}
function vykresliPole() {
  const k = KALK[S.druh], st = stav(), h = hodnotyPole();
  $k('pole').innerHTML = k.pole.filter(f => (!f.profi || S.rezim === 'profi') && (!f.ukaz || f.ukaz(h))).map(f => {
    const raw = st.pole[f.id] !== undefined ? st.pole[f.id] : f.v;
    const tip = f.tip ? `<p class="kk-tip"${S.tipy ? '' : ' hidden'}>${esc(f.tip)}</p>` : '';
    if (f.typ === 'ano') return `<div class="kk-pole kk-pole-ano"><label class="kk-prepinac"><input type="checkbox" data-pole="${f.id}"${String(raw) === '1' ? ' checked' : ''}><span class="kk-prep-kolej" aria-hidden="true"></span><span>${esc(f.popis)}</span></label>${tip}</div>`;
    if (f.typ === 'volba') return `<div class="kk-pole kk-pole-siroke"><span class="kk-pole-popis">${esc(f.popis)}</span><div class="kk-seg kk-seg-volba" role="group" aria-label="${esc(f.popis)}">${f.volby.map(([v, t]) =>
      `<button type="button" data-volba="${f.id}:${v}" aria-pressed="${String(raw) === v}">${esc(t)}</button>`).join('')}</div>${tip}</div>`;
    return `<div class="kk-pole"><label class="kk-pole-popis" for="kk-f-${f.id}">${esc(f.popis)}</label>
      <span class="kk-mj-obal"><input id="kk-f-${f.id}" class="kk-in" data-pole="${f.id}" inputmode="decimal" value="${esc(raw)}">${f.mj ? `<i>${esc(f.mj)}</i>` : ''}</span>${tip}</div>`;
  }).join('');
}

/* ---------- nákres ---------- */
function svgStena(h) {
  const d = h.delka, v = h.vyska;
  if (!d || !v) return '';
  // proporcionálně: jedno měřítko pro šířku i výšku
  const W = 600, o = 44, maxS = W - 2 * o, maxV = 240, m = Math.min(maxS / d, maxV / v);
  const s = d * m, vy = v * m, x0 = (W - s) / 2;
  const kusy = []; h.otvory.forEach(op => { if (op.s > 0 && op.v > 0) for (let i = 0; i < op.n; i++) kusy.push(op); });
  let vejde = kusy.length, sum = kusy.reduce((a, op) => a + op.s * m, 0);
  while (vejde > 0 && sum + 8 * (vejde + 1) > s) { vejde--; sum -= kusy[vejde].s * m; }
  const mezera = vejde ? (s - sum) / (vejde + 1) : 0;
  let x = x0 + mezera, otv = '';
  for (let i = 0; i < vejde; i++) {
    const op = kusy[i], ow = op.s * m, vys = Math.min(op.v, v);
    // dveře (výška od 1,8 m) stojí na podlaze, okna mají parapet (obvykle 0,9 m, pod stropem nejméně 0,2 m)
    const parapet = op.v >= 1.8 ? 0 : Math.max(0, Math.min(0.9, v - vys - 0.2));
    const oh = vys * m, y = o + vy - (parapet + vys) * m;
    otv += `<rect x="${x}" y="${y}" width="${ow}" height="${oh}" class="kk-svg-otvor"/>`;
    if (parapet > 0) otv += `<line x1="${x - 3}" x2="${x + ow + 3}" y1="${y + oh}" y2="${y + oh}" class="kk-svg-parapet"/>`;
    x += ow + mezera;
  }
  const zbyva = kusy.length - vejde;
  return `<svg viewBox="0 0 ${W} ${vy + 2 * o}" role="img" aria-label="Náhled stěn">
    <rect x="${x0}" y="${o}" width="${s}" height="${vy}" class="kk-svg-plocha"/>${otv}
    <text x="${x0 + s / 2}" y="${o + vy + 28}" class="kk-svg-t">${f3(zaok(d))} m${h.useky.length > 1 ? ' celkem' : ''}</text>
    <text x="${x0 - 14}" y="${o + vy / 2}" class="kk-svg-t" transform="rotate(-90 ${x0 - 14} ${o + vy / 2})">${f3(zaok(v))} m</text>
    ${zbyva > 0 ? `<text x="${x0 + s}" y="${o - 12}" class="kk-svg-t kk-svg-slaby" text-anchor="end">+ ${zbyva} ${zbyva === 1 ? 'otvor se nevešel' : 'otvory se nevešly'}</text>` : ''}</svg>`;
}
function svgPudorys(h, dlazba) {
  const u = h.useky.find(x => x.d > 0 && x.s > 0);
  if (!u) return '';
  const W = 600, o = 44, maxS = W - 2 * o, maxV = 240, m = Math.min(maxS / u.d, maxV / u.s);
  const s = u.d * m, vy = u.s * m, x0 = (W - s) / 2;
  let tiles = '';
  if (dlazba && h.kd && h.ksi) {
    const kd = h.kd / 100 * m, ks = h.ksi / 100 * m;
    if (kd > 3 && ks > 3 && (s / kd) * (vy / ks) < 700)
      for (let y = 0; y < vy - 1; y += ks) for (let x = 0; x < s - 1; x += kd)
        tiles += `<rect x="${x0 + x}" y="${o + y}" width="${Math.min(kd, s - x) - 1}" height="${Math.min(ks, vy - y) - 1}" class="kk-svg-dlazdice"/>`;
  }
  const k = KALK[S.druh];
  const navic = k.nakres ? k.nakres(h, { x0, y0: o, s, vy, m, u }) : '';
  return `<svg viewBox="0 0 ${W} ${vy + 2 * o}" role="img" aria-label="Půdorys">
    <rect x="${x0}" y="${o}" width="${s}" height="${vy}" class="kk-svg-plocha"/>${tiles}${navic}
    <rect x="${x0}" y="${o}" width="${s}" height="${vy}" class="kk-svg-obrys"/>
    <text x="${x0 + s / 2}" y="${o + vy + 28}" class="kk-svg-t">${f3(u.d)} m</text>
    <text x="${x0 - 14}" y="${o + vy / 2}" class="kk-svg-t" transform="rotate(-90 ${x0 - 14} ${o + vy / 2})">${f3(u.s)} m</text>
    ${u.v && !navic ? `<text x="${x0 + s / 2}" y="${o + vy / 2 + 5}" class="kk-svg-t kk-svg-slaby">výška ${f3(u.v)} m</text>` : ''}
    ${h.useky.length > 1 ? `<text x="${x0 + s}" y="${o - 12}" class="kk-svg-t kk-svg-slaby" text-anchor="end">+ ${h.useky.length - 1} další</text>` : ''}</svg>`;
}
function vykresliSchema(h) {
  const k = KALK[S.druh];
  const svg = k.rozmer === 'steny' ? svgStena(h) : svgPudorys(h, S.druh === 'plocha');
  $k('schema').innerHTML = svg;
  $k('schema').hidden = !svg;
  let t = '';
  if (k.rozmer === 'mistnost') t = h.steny ? `stěny ${f3(zaok(h.steny))} m², podlaha ${f3(zaok(h.podlaha))} m²` : '';
  else t = h.plocha ? `${f3(zaok(h.plocha))} m²${h.plochaOtvoru ? ` (−${f3(zaok(h.plochaOtvoru))} m² otvory)` : ''}` : '';
  $k('plocha').textContent = t;
}

/* ---------- výsledek ---------- */
function vykresliRadky() {
  const el = $k('radky');
  const radky = sestavRadky();
  $k('prirazka').value = vp(S.prirazka);
  root.querySelectorAll('[data-filtr]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filtr === S.filtr)));
  const info = $k('mat-info');
  if (!radky.length) {
    el.innerHTML = '<div class="kk-prazdno">Zadej rozměry a spočítám materiál.</div>';
    info.textContent = '';
    return radky;
  }
  if (A.bezStavimexu) {
    info.innerHTML = !A.katalogDostupny() ? (A.katalogZamceny && A.katalogZamceny() ? 'Spočítám množství materiálu. Cenu doplníš z vlastního ceníku (tlačítko Vybrat) nebo ručně v nabídce.<div class="kk-omezeni">🔒 <b>S licencí vyberu ke každé položce konkrétní zboží s cenou a fotkou</b> z katalogu 130 000 položek. <a href="https://yey.cz/?tarif=start#koupit" target="_blank" rel="noopener">Koupit licenci</a></div>' : 'Katalog materiálů není připojený – materiál vybereš z ceníku, nebo vložíš jen množství.')
      : R.vybiram ? '<span class="kk-spinner" aria-hidden="true"></span> Vybírám zboží z katalogu…'
      : 'Materiál vybírám z katalogu podle ceny. Ceny jsou orientační, bez DPH – jen pro hrubý odhad.' + (A.katalogOmezeny && A.katalogOmezeny() ? '<div class="kk-omezeni">ℹ️ Bez registrace vybírám jen z cca 4 000 položek. <b>S licencí je k dispozici celý katalog 130 000 položek.</b> <a href="https://yey.cz/?tarif=start#koupit" target="_blank" rel="noopener">Koupit licenci</a></div>' : '');
  } else info.innerHTML = !A.katalogDostupny() ? (A.katalogZamceny && A.katalogZamceny() ? 'Spočítám množství materiálu. Cenu doplníš z vlastního ceníku (tlačítko Vybrat) nebo ručně v nabídce.<div class="kk-omezeni">🔒 <b>S licencí vyberu ke každé položce konkrétní zboží s cenou a fotkou</b> z katalogu 130 000 položek. <a href="https://yey.cz/?tarif=start#koupit" target="_blank" rel="noopener">Koupit licenci</a></div>' : 'Katalog materiálů není připojený – materiál vybereš z ceníku, nebo vložíš jen množství.')
    : R.vybiram ? '<span class="kk-spinner" aria-hidden="true"></span> Vybírám zboží ze Stavimexu podle zásob a ceny…'
    : { malesice: 'Vybírám zboží skladem v prodejně Stavimex Malešice.',
        obe: 'Vybírám zboží skladem v Malešicích, případně v Libni.',
        stavimex: 'Vybírám ze zboží, které Stavimex vede – skladem má přednost.',
        vse: 'Vybírám z celého katalogu, zboží Stavimexu skladem má přednost.' }[efFiltr(S.filtr)] + ' Ceny jsou bez DPH.';
  el.innerHTML = radky.map(r => {
    const m = r.m;
    const foto = m && m.foto ? `<img src="${esc(m.foto)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
    const sklad = m && m.kod && !A.bezStavimexu ? `<div class="kk-r-sklad">${skladHtml(r.z, r.mnProdej, r.mjProdej)}${varovaniSkladu(r)}</div>` : '';
    const cena = m ? `<div class="kk-r-cena">${r.cena ? kc(r.cena) + ' / ' + esc(mjHezky(r.mjProdej)) : '<b class="kk-cervena">bez ceny</b>'} <span>· ${esc(r.cenaPopis)}</span></div>` : '';
    const nenalezeno = !m && r.q && R.nenalezeno[S.druh + '|' + r.q + '|' + S.filtr];
    return `<div class="kk-r${r.vyp ? ' vyp' : ''}${m ? '' : ' bez'}" data-radek="${r.klic}">
      <label class="kk-r-zap" title="${r.vyp ? 'Zahrnout' : 'Vynechat'}"><input type="checkbox" data-zap="${r.klic}"${r.vyp ? '' : ' checked'} aria-label="Zahrnout ${esc(r.nazev)}"></label>
      <div class="kk-r-foto">${foto || `<span aria-hidden="true">${KALK[S.druh].ikona}</span>`}</div>
      <div class="kk-r-telo">
        <div class="kk-r-nazev">${esc(m ? m.nazev : r.nazev)}</div>
        <div class="kk-r-co">${m ? esc(r.nazev) + ' · ' : ''}${esc(r.zaklad)}${r.prevod ? ' · ' + esc(r.prevod) : ''}${!m ? baleniOrientacne(r) : ''}</div>
        ${m && m.src === 'katalog' && cestaSortimentu(m) ? `<div class="kk-r-obor">${esc(cestaSortimentu(m))}</div>` : ''}
        ${m && m.mimoSklad ? '<div class="kk-r-var">Nic z vhodného sortimentu teď není skladem – vybral jsem nejlepší dostupné, ověř dodání.</div>' : ''}
        ${r.nastavovani ? '<div class="kk-r-var kk-r-var-info">Stěna je vyšší než nejdelší profil – počítám s nastavováním.</div>' : ''}
        ${m && m.mimo ? `<div class="kk-r-var">V sortimentu „${esc(sortRadku(r.klic).nazev)}“ jsem nic nenašel, zboží je z jiného oboru – zkontroluj ho.</div>` : ''}
        ${r.prevodNejde ? `<div class="kk-r-var"><b>Chybí přepočet:</b> spočteno ${f3(r.mnozstvi)} ${esc(mjHezky(r.mj))}, zboží se prodává na ${esc(mjHezky(m.mj))}. Bez přepočtu nejde vložit do nabídky. <button type="button" class="kk-btn kk-metr kk-maly" data-prevod="${r.klic}">⇄ Zadat přepočet</button> nebo <button type="button" class="kk-odkaz" data-mat="${r.klic}">vyber jiné zboží</button></div>` : ''}
        ${m && !r.prevodNejde && r.prevod && mjN(r.mj) !== mjN(r.mjProdej) ? `<div class="kk-r-var kk-r-var-info">Přepočet ${esc(mjHezky(r.mj))} → ${esc(mjHezky(r.mjProdej))} nesedí? <button type="button" class="kk-odkaz" data-prevod="${r.klic}">⇄ Upravit přepočet</button></div>` : ''}
        ${nenalezeno ? `<div class="kk-r-var">${efFiltr(S.filtr) === 'vse' ? 'V katalogu' : efFiltr(S.filtr) === 'stavimex' ? 'Ve zboží Stavimexu' : 'Skladem ve Stavimexu'} jsem nic vhodného nenašel – vyber ručně${efFiltr(S.filtr) === 'malesice' || efFiltr(S.filtr) === 'obe' ? ' nebo přepni na „Stavimex“' : ''}.</div>` : ''}
        ${!m && r.sv && !svKandidati(r.sv).length && (!A.svZKatalogu || SV_KAT[r.sv]) ? '<div class="kk-r-var kk-r-var-info">V sortimentu suché výstavby jsem nic vhodného nenašel – vyber z katalogu.</div>' : ''}
        ${!m && !r.q ? '<div class="kk-r-var kk-r-var-info">Tady záleží na výrobci a rozměru – vyber zboží.</div>' : ''}
        ${cena}${sklad}
      </div>
      <div class="kk-r-mn">
        <span class="kk-mj-obal"><input class="kk-in kk-in-mn" data-mn="${r.klic}" inputmode="decimal" value="${esc(vp(r.mnProdej))}" aria-label="Množství ${esc(r.nazev)}"><i>${esc(mjHezky(r.mjProdej))}</i></span>
        ${r.rucne ? `<button type="button" class="kk-odkaz" data-reset="${r.klic}" title="Vrátit vypočtené množství">↺ spočteno ${esc(vp(mnozstviPro(r, m)?.mnozstvi ?? r.mnozstvi))}</button>` : ''}
        <span class="kk-r-celkem" data-celkem="${r.klic}">${r.celkem ? kc0(r.celkem) : ''}</span>
      </div>
      <div class="kk-r-akce">
        <button type="button" class="kk-btn ${m ? 'kk-tichy' : 'kk-metr'} kk-maly" data-mat="${r.klic}">${m ? 'Změnit' : 'Vybrat'}</button>
        ${m && m.naPalete && mjN(m.mj) === mjN(r.mjProdej) ? `<button type="button" class="kk-btn kk-tichy kk-maly" data-paleta="${r.klic}" title="Zaokrouhlit na celé palety (${f3(m.naPalete)} ${esc(mjHezky(m.mj))})">📦 palety</button>` : ''}
      </div>
    </div>`;
  }).join('');
  return radky;
}
/** Bez konkrétního zboží: orientačně v běžném balení (pytle 25 kg). */
function baleniOrientacne(r) {
  if (mjN(r.mj) !== 'kg' || !(r.mnozstvi >= 20) || /≈|pytl|balen/.test(r.zaklad || '')) return '';
  const n = Math.ceil(r.mnozstvi / 25);
  return ` · ≈ ${n} ${n === 1 ? 'pytel' : n < 5 ? 'pytle' : 'pytlů'} po 25 kg`;
}
function varovaniSkladu(r) {
  if (!r.z || r.vyp) return '';
  const q = r.mnProdej, mz = r.z.malesice, lb = r.z.liben;
  const vMal = zasobaCislo(mz), vLib = zasobaCislo(lb);
  if (mz && mjN(mz.mj) === mjN(r.mjProdej) && vMal >= q) return '';
  if (vMal <= 0 && vLib <= 0) return '<div class="kk-r-var">Ve Stavimexu teď není skladem – ověř dodací lhůtu.</div>';
  if (mz && mjN(mz.mj) === mjN(r.mjProdej) && vMal > 0 && vMal < q)
    return `<div class="kk-r-var">V Malešicích jen ${f3(vMal)} ${esc(mjHezky(mz.mj))}${vLib > 0 ? `, zbytek je v Libni (${f3(vLib)})` : ''}.</div>`;
  if (vMal <= 0 && vLib > 0) return '<div class="kk-r-var kk-r-var-info">Skladem jen v Libni.</div>';
  return '';
}
function vykresliPraci() {
  const el = $k('prace');
  const prace = sestavPraci();
  if (!prace.length) { el.innerHTML = ''; return prace; }
  el.innerHTML = prace.map(p => `<div class="kk-p">
    <label class="kk-r-zap"><input type="checkbox" data-pz="${p.klic}"${p.pouzit ? ' checked' : ''} aria-label="Zahrnout ${esc(p.nazev)}"></label>
    <div class="kk-p-nazev">${esc(p.nazev)} <span>${f3(p.mnozstvi)} ${esc(p.mj)}</span></div>
    <span class="kk-mj-obal kk-p-cena"><input class="kk-in" data-cp="${p.klic}" inputmode="decimal" value="${esc(vp(p.cena))}" placeholder="cena"><i>Kč/${esc(p.mj)}</i></span>
    <span class="kk-r-celkem" data-pcelkem="${p.klic}">${p.celkem ? kc0(p.celkem) : ''}</span>
  </div>`).join('');
  return prace;
}
function vykresliListu() {
  const radky = sestavRadky(), prace = sestavPraci();
  const mat = radky.reduce((s, r) => s + r.celkem, 0);
  const pr = prace.reduce((s, p) => s + p.celkem, 0);
  let bezCeny = 0;
  radky.forEach(r => { if (r.vyp || !r.m) return; if (!r.cena) bezCeny++; });
  const dop = sestavDopravu(radky), hm = dop.kg;
  const cil = A.cilDokladu ? A.cilDokladu() : null;
  const pocet = radky.filter(r => !r.vyp).length + prace.filter(p => p.pouzit && p.cena > 0).length + (dop.celkem > 0 ? 1 : 0);
  $k('lista').innerHTML = !radky.length ? '' : `<div class="kk-lista-in">
    <div class="kk-lista-souhrn">
      <div><small>Materiál</small><b>${kc0(mat)}</b></div>
      ${pr ? `<div><small>Práce</small><b>${kc0(pr)}</b></div>` : ''}
      ${dop.celkem ? `<div><small>Doprava</small><b>${kc0(dop.celkem)}</b></div>` : ''}
      <div class="kk-lista-celkem"><small>Celkem bez DPH</small><b>${kc0(mat + pr + dop.celkem)}</b></div>
      ${hm ? `<div class="kk-lista-hm"><small>Hmotnost</small><b>${f3(Math.round(hm))} kg</b></div>` : ''}
    </div>
    <div class="kk-lista-akce">
      <button type="button" class="kk-btn kk-tichy" data-akce="sdilet" title="Seznam materiálu do SMS, WhatsAppu nebo e-mailu">Sdílet</button>
      <button type="button" class="kk-btn kk-metr" data-akce="do-dokladu"${pocet ? '' : ' disabled'}>${typeof zamceno === 'function' && zamceno('kalk_do_nabidky') ? '🔒 ' : ''}${cil ? 'Vložit do ' + esc(cil) : 'Vytvořit nabídku'} (${pocet})</button>
    </div>
    ${bezCeny ? `<div class="kk-lista-pozn">${bezCeny} ${bezCeny === 1 ? 'položka nemá' : 'položky nemají'} cenu – doplň ji v nabídce.</div>` : ''}
  </div>`;
  obnovDopravuSouhrn(radky);
}
function obnovSouctyBezPrekresleni() {
  sestavRadky().forEach(r => { const e = root.querySelector(`[data-celkem="${r.klic}"]`); if (e) e.textContent = r.celkem ? kc0(r.celkem) : ''; });
  sestavPraci().forEach(p => { const e = root.querySelector(`[data-pcelkem="${p.klic}"]`); if (e) e.textContent = p.celkem ? kc0(p.celkem) : ''; });
  vykresliListu();
}

/* ---------- hlavní přepočet ---------- */
function prepocitej() {
  const k = KALK[S.druh], h = hodnoty();
  R.h = h;
  vykresliSchema(h);
  const v = k.spocitej(h);
  R.radky = (v ? v.radky : []).map(r => {
    const o = (global.YEY_KH || {})[S.druh + '/' + r.klic];
    if (!o || (!o.dotaz && !o.vyloucit)) return r;
    const x = { ...r };
    if (o.dotaz) x.q = o.dotaz;
    if (o.vyloucit) x.vyloucit = bezDia(o.vyloucit);
    return x;
  });
  R.prace = v ? (v.prace || []) : [];
  vykresliRadky(); vykresliPraci(); vykresliDopravu(); vykresliListu();
  uloz();
  // chybějící zásoby u vybraného materiálu
  const st = stav();
  const kody = Object.values(st.mat).map(m => m && m.kod).filter(k2 => k2 && !(k2 in R.zas) && !R.zasBez[k2]);
  if (kody.length) nactiZasoby(kody).then(ok => { if (ok) { vykresliRadky(); vykresliListu(); } });
  naplanujPredvyber();
}
function naplanujPredvyber() {
  clearTimeout(vyberCas);
  if (!A.katalogDostupny() || !R.radky.length) return;
  vyberCas = setTimeout(() => predvyber(false), 500);
}

/** Hodí se schválený produkt k aktuálnímu řádku? Musí obsahovat slova hledaného dotazu (typ směsi, malty,
    rozměr hranolu…) a sedět tloušťkou, pokud ji řádek uvádí (vata 20 cm, EPS 100 mm). Jinak se hledá v katalogu. */
function sediKRadku(p, r) {
  const n = bezDia(p.nazev || '').replace(/(\d),(\d)/g, '$1.$2');
  const slova = bezDia(r.q || '').split(/\s+/).filter(w => w.length >= 2 && w[0] !== '-');
  if (slova.some(w => !n.includes(w))) return false;
  const q = bezDia(r.q || '');
  if (['tenkovrstv', 'zimn', 'sanac'].some(w => n.includes(w) && !q.includes(w))) return false;   // tenkovrstvá malta ≠ klasická zdicí
  const rn = bezDia(r.nazev || '').replace(/(\d),(\d)/g, '$1.$2');
  const cm = rn.match(/(\d+(?:\.\d+)?)\s*cm\b/), mm = rn.match(/(\d{2,3})\s*mm\b/);
  const tl = cm ? Math.round(+cm[1] * 10) : mm ? +mm[1] : null;
  if (tl) { const t = n.match(/(\d{2,3})\s*mm\b/); if (t && +t[1] !== tl) return false; }
  return true;
}
/** Automatický výběr zboží k řádkům bez materiálu. */
async function predvyber(znovu) {
  if (!A.katalogDostupny()) return;
  if (R.vybiram) { R.znovu = true; return; }
  const st = stav(), druh = S.druh;
  const radky = sestavRadky();
  const podpis = r => { if (r.sv) return 'sv|' + r.sv; const s = sortRadku(r.klic); return (s.skupina || '') + '|' + (s.tema || ''); };
  const cekaji = radky.filter(r => !r.vyp && (r.q || vlastniSort(r.klic, druh)) && (
    !r.m || (r.m.auto && (znovu || (r.m.src === 'cenik' && !r.q) || r.m.dotaz !== r.q || r.m.filtr !== S.filtr || (r.m.sortPodpis || '') !== podpis(r)))));
  const hledat = cekaji.filter(r => znovu || !R.nenalezeno[druh + '|' + r.klic + '|' + r.q + '|' + S.filtr]);
  if (!hledat.length) return;
  R.vybiram = true; vykresliRadky();
  let n = 0;
  for (const r of hledat) {
    const slova = bezDia(r.q || '').split(/\s+/).filter(Boolean);
    let m = null;
    // nejdřív vlastní ceník – drží se tvoje ceny
    const sort = sortRadku(r.klic);
    const zc = !r.sv && slova.length ? A.cenik().find(c => slova.every(w => bezDia(c.nazev).includes(w))) : null;   // bez hledaného výrazu se z ceníku nevybírá (prázdný výraz by sedl na cokoli)
    if (r.sv && A.svZKatalogu) await nactiSVzKatalogu(r.sv);
    let schM = null;
    if (!r.sv && A.schvalene && A.podleKodu) {
      try {
        const sch = ((await A.schvalene(druh))[r.klic] || []).slice().sort((a, b) => (b.vychozi - a.vychozi) || (a.poradi - b.poradi));
        if (sch.length) { const rows = await A.podleKodu(sch.map(x => x.kod)); const p = sch.map(x => rows.find(y => y.kod === x.kod)).find(y => y && sediKRadku(y, r));
          if (p) schM = zKatalogu(p); }
      } catch (e) { schM = null; }
    }
    if (schM) m = schM;
    else if (r.sv && svKandidati(r.sv).length) {
      try { m = await vyberSV(r, S.filtr); } catch (e) { m = null; }
    } else if (zc) m = zCeniku(zc);
    else {
      try {
        let nal = await hledejSeSkladem(r.q, 40, sort, S.filtr);
        if (r.vyloucit) { const re = new RegExp(r.vyloucit); nal = nal.filter(p => !re.test(bezDia(p.nazev))); }
        // automaticky jen zboží s fotkou – bez fotky si ho uživatel může vybrat ručně
        nal = nal.filter(p => p.foto);
        let zOboru = nal.filter(p => vSortimentu(p, sort) && !/^Sádrokartonové desky$/.test(p.skupina || ''));
        if (r.tlMax) {   // izolace se musí vejít do profilu – přednost tloušťce nejblíž šířce profilu
          const tl = p => { const m = bezDia(p.nazev).match(/(\d{2,3})\s*mm/); return m ? Number(m[1]) : null; };
          const vejde = zOboru.filter(p => tl(p) != null && tl(p) <= r.tlMax);
          if (vejde.length) { const nej = Math.max(...vejde.map(tl)); zOboru = vejde.filter(p => tl(p) === nej); }
        }
        // jen ze sortimentu; mimo něj až když v katalogu obor vůbec nenajdu
        let nej = vyberNejlepsi(zOboru, r, S.filtr);
        if (!nej && !zOboru.length && !sort.skupina) {
          // zboží bez kategorie (Nezařazeno) má přednost před zbožím zařazeným do úplně jiného oboru
          const bezKat = nal.filter(p => !p.skupina || /nezarazen/.test(bezDia((p.tema || '') + ' ' + (p.skupina || ''))));
          nej = vyberNejlepsi(bezKat, r, S.filtr) || vyberNejlepsi(nal, r, S.filtr);
          if (nej) nej = { ...nej, _mimo: true };
        }
        if (nej) { m = zKatalogu(nej); if (nej._mimo) m.mimo = true; }
      } catch (e) { break; }
    }
    if (S.druh !== druh) break;
    if (!m) { R.nenalezeno[druh + '|' + r.klic + '|' + r.q + '|' + S.filtr] = 1; if (st.mat[r.klic]?.auto) delete st.mat[r.klic]; continue; }
    m.auto = true; m.dotaz = r.q; m.filtr = S.filtr; m.sortPodpis = podpis(r);
    st.mat[r.klic] = m; delete st.rucne[r.klic]; n++;
  }
  R.vybiram = false;
  if (S.druh === druh) prepocitej();
  if (R.znovu) { R.znovu = false; predvyber(false); }
  return n;
}

/* =====================================================================
   VÝBĚR ZBOŽÍ (dialog)
   ===================================================================== */
function otevriVyber(cil) {
  const d = $k('dlg');
  const r = R.radky.find(x => x.klic === cil.klic);
  const maSV = !!(r && r.sv && svKandidati(r.sv).length);
  R.dlg = { ...cil, zdroj: maSV ? 'sv' : A.katalogDostupny() ? 'katalog' : 'cenik', filtr: S.filtr, jenSort: true, jenVhodne: true, skupiny: [] };
  $k('dlg-titulek').textContent = cil.rozmer ? 'Vybrat zboží a převzít rozměr' : ('Vybrat: ' + (r ? r.nazev : 'materiál'));
  const st = stav();
  // řádky s dotazem otevřou předvyplněné hledání, ostatní rovnou celý sortiment
  const q = cil.rozmer || maSV ? '' : (st.dotazy[cil.klic] || r?.q || '');
  $k('dlg-hledat').value = q;
  $k('dlg-omezeni').hidden = !(A.katalogOmezeny && A.katalogOmezeny());
  vykresliDlgFiltry();
  hledejVDialogu();
  if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  setTimeout(() => { try { $k('dlg-hledat').focus(); $k('dlg-hledat').select(); } catch (e) {} }, 30);
}
function zavriVyber() { const d = $k('dlg'); if (d.close) d.close(); else d.removeAttribute('open'); R.dlg = null; }
function vykresliDlgFiltry() {
  root.querySelectorAll('[data-zdroj]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.zdroj === R.dlg.zdroj)));
  root.querySelectorAll('[data-dfiltr]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.dfiltr === R.dlg.filtr)));
  $k('dlg-filtr').hidden = R.dlg.zdroj === 'cenik' || !!A.bezStavimexu;
  const r = R.radky.find(x => x.klic === R.dlg.klic);
  root.querySelector('[data-zdroj="sv"]').hidden = !(r && r.sv);
  root.querySelector('[data-akce="bez-materialu"]').hidden = !!R.dlg.rozmer;
  vykresliDlgSort();
}
/** Pruh se sortimentem: obor řádku, celý katalog a skupiny oboru k upřesnění. */
function vykresliDlgSort() {
  const el = $k('dlg-sort');
  if (R.dlg && R.dlg.zdroj === 'sv') {
    el.hidden = false;
    $k('dlg-hledat').placeholder = R.dlg.jenVhodne ? 'Hledat ve vhodném zboží' : 'Hledat v celé suché výstavbě – název, kód, EAN';
    el.innerHTML = `<span class="kk-dlg-sort-t">${A.bezStavimexu ? 'Výběr' : 'Stavimex'}</span>
      <button type="button" class="kk-chip kk-chip-sort${R.dlg.jenVhodne ? ' aktivni' : ''}" data-dsv="1">🎯 Vhodné pro tento řádek</button>
      ${A.svZKatalogu ? '' : `<button type="button" class="kk-chip${R.dlg.jenVhodne ? '' : ' aktivni'}" data-dsv="0">Celá suchá výstavba (${SV.length})</button>`}`;
    return;
  }
  if (!R.dlg || R.dlg.zdroj !== 'katalog') { el.hidden = true; return; }
  el.hidden = false;
  const sort = sortRadku(R.dlg.klic), jen = R.dlg.jenSort;
  const skup = R.dlg.skupiny || [];
  $k('dlg-hledat').placeholder = jen ? `Hledat v sortimentu ${sort.skupina || sort.nazev}` : 'Hledat v celém katalogu – název, kód, EAN';
  el.innerHTML = `<span class="kk-dlg-sort-t">Sortiment</span>
    <button type="button" class="kk-chip kk-chip-sort${jen && !sort.skupina ? ' aktivni' : ''}" data-dsort="obor">🎯 ${esc(sort.nazev)}</button>
    ${skup.map(s => `<button type="button" class="kk-chip${jen && sort.skupina && bezDia(sort.skupina) === bezDia(s.skupina) ? ' aktivni' : ''}" data-dskup="${esc(s.skupina)}" data-dtema="${esc(s.tema || '')}" title="${esc(s.tema || '')}">${esc(s.skupina)} <small>${s.n}</small></button>`).join('')}
    ${sort.skupina && !skup.some(s => bezDia(s.skupina) === bezDia(sort.skupina)) ? `<button type="button" class="kk-chip aktivni" data-dskup="${esc(sort.skupina)}" data-dtema="${esc(sort.tema || '')}">${esc(sort.skupina)}</button>` : ''}
    <button type="button" class="kk-chip${jen ? '' : ' aktivni'}" data-dsort="vse">Celý katalog</button>
    ${sort.skupina ? '<span class="kk-dlg-sort-pozn">Tuhle skupinu si pamatuju i pro automatický výběr.</span>' : ''}`;
}
let dlgCas;
/** Slova s mínusem („lepidlo -flex“) se z výsledků vyřadí. */
function rozdelDotaz(q) {
  const w = String(q || '').trim().split(/\s+/).filter(Boolean);
  return { plus: w.filter(x => x[0] !== '-').join(' '), minus: w.filter(x => x[0] === '-' && x.length > 2).map(x => bezDia(x.slice(1))) };
}
const bezVyloucenych = (nazev, minus) => !minus.length || !minus.some(m => bezDia(nazev || '').includes(m));
function hledejVDialogu() {
  clearTimeout(dlgCas);
  const seq = ++R.hledaniSeq, el = $k('dlg-seznam'), qCele = $k('dlg-hledat').value.trim();
  const { plus: q, minus } = rozdelDotaz(qCele);
  if (R.dlg.zdroj === 'cenik') {
    const w = bezDia(q).split(/\s+/).filter(Boolean);
    const pol = A.cenik().filter(c => w.every(x => bezDia(c.nazev).includes(x)) && bezVyloucenych(c.nazev, minus)).slice(0, 60);
    R.vysledky = pol.map(c => ({ cenik: c }));
    el.innerHTML = pol.length ? pol.map((c, i) => radekVyberu({ nazev: c.nazev, mj: c.mj, cena: c.cena, kod: c.kod }, i, 'z ceníku')).join('')
      : '<div class="kk-prazdno">V ceníku nic takového není.</div>';
    return;
  }
  if (R.dlg.zdroj === 'sv') return hledejSV(seq, el, q, minus);
  if (!A.katalogDostupny()) { el.innerHTML = '<div class="kk-prazdno">Katalog není připojený.</div>'; return; }
  const sort = R.dlg.jenSort ? sortRadku(R.dlg.klic) : null;
  if (q.length < 2 && !sort) { el.innerHTML = '<div class="kk-prazdno">Napiš aspoň 2 znaky – název, značku, kód nebo EAN.</div>'; return; }
  el.innerHTML = `<div class="kk-prazdno"><span class="kk-spinner"></span> ${q.length < 2 ? 'Načítám sortiment ' + esc(sort.nazev) : 'Hledám'} a zjišťuji zásoby…</div>`;
  dlgCas = setTimeout(async () => {
    let nal = [];
    try { nal = await hledejSeSkladem(q.length < 2 ? '' : qCele, 80, sort, R.dlg.filtr); nal = nal.filter(p => bezVyloucenych(p.nazev, minus)); } catch (e) { if (seq === R.hledaniSeq) el.innerHTML = '<div class="kk-prazdno">Hledání se nepovedlo.</div>'; return; }
    if (seq !== R.hledaniSeq || !R.dlg) return;
    let mimo = 0;
    if (sort) {
      // skupiny z oboru jako čipy k upřesnění (bez vybrané skupiny, ať jdou přepínat)
      const obor = nal.filter(p => vSortimentu(p, { ...sort, skupina: null }));
      const pocty = {};
      obor.forEach(p => { if (!p.skupina) return; const k = bezDia(p.skupina); (pocty[k] = pocty[k] || { skupina: p.skupina, tema: p.tema, n: 0 }).n++; });
      R.dlg.skupiny = Object.values(pocty).sort((a, b) => b.n - a.n).slice(0, 10);
      const pred = nal.length;
      nal = nal.filter(p => vSortimentu(p, sort));
      mimo = pred - nal.length;
      vykresliDlgSort();
    }
    const vse = nal.length;
    nal = nal.filter(p => projdeFiltrem(R.zas[p.kod], efFiltr(R.dlg.filtr)));
    R.vysledky = nal.map(p => ({ katalog: p }));
    const nicTu = sort
      ? `V sortimentu „${esc(sort.skupina || sort.nazev)}“ nic${q.length >= 2 ? ' pro „' + esc(q) + '“' : ''}${vse ? ' skladem' : ''}.`
        + (vse ? ` <button type="button" class="kk-odkaz" data-dfiltr="stavimex">Zobrazit i bez zásoby</button>` : '')
        + (mimo || q.length >= 2 ? ` <button type="button" class="kk-odkaz" data-dsort="vse">Hledat v celém katalogu</button>` : '')
      : (vse ? `Nalezeno ${vse} položek, ale žádná není ${textFiltru(efFiltr(R.dlg.filtr))}. <button type="button" class="kk-odkaz" data-dfiltr="${efFiltr(R.dlg.filtr) === 'stavimex' && !A.jenStavimex ? 'vse' : 'stavimex'}">Zobrazit víc</button>`
        : efFiltr(R.dlg.filtr) === 'vse' ? 'Nic nenalezeno. Zkus kratší slovo.' : 'Nic nenalezeno – ověřit stav na prodejně. Případně zkus kratší slovo nebo jiný název.');
    el.innerHTML = nal.length ? nal.map((p, i) => radekVyberu(p, i)).join('') : `<div class="kk-prazdno">${nicTu}</div>`;
  }, 280);
}
/** Výběr ze sortimentu suché výstavby v dialogu. */
function hledejSV(seq, el, q, minus = []) {
  const r = R.radky.find(x => x.klic === R.dlg.klic);
  const w = bezDia(q).split(/\s+/).filter(Boolean);
  const vhodne = new Set(svKandidati(r?.sv).map(p => p.kod));
  const zdrojSV = A.svZKatalogu ? [...new Map(Object.values(SV_KAT).flat().map(p => [p.kod, p])).values()] : SV;
  let pole = (R.dlg.jenVhodne && vhodne.size ? zdrojSV.filter(p => vhodne.has(p.kod)) : zdrojSV)
    .filter(p => w.every(x => p.n.includes(x) || p.kod.includes(x) || String(p.ean).includes(x)) && !minus.some(m => p.n.includes(m)));
  if (!R.dlg.jenVhodne && !w.length) { el.innerHTML = '<div class="kk-prazdno">Napiš, co hledáš – např. „profil cw 75“, „tmel“, „rohová lišta“.</div>'; return; }
  el.innerHTML = '<div class="kk-prazdno"><span class="kk-spinner"></span> Zjišťuji zásoby ve Stavimexu…</div>';
  clearTimeout(dlgCas);
  dlgCas = setTimeout(async () => {
    pole = pole.slice(0, 120);
    await nactiZasoby(pole.map(p => p.kod));
    if (seq !== R.hledaniSeq || !R.dlg) return;
    const vse = pole.length;
    const znameZasoby = pole.some(p => R.zas[p.kod]);
    if (znameZasoby) pole = pole.filter(p => projdeFiltrem(R.zas[p.kod], efFiltr(R.dlg.filtr)));
    const ser = r ? seraditSV(pole, r).map(x => x.p) : pole;
    const vh = ser.filter(p => vhodne.has(p.kod)), ost = ser.filter(p => !vhodne.has(p.kod));
    const serazeno = vh.concat(ost);
    R.vysledky = serazeno.map(p => ({ katalog: p, sv: true }));
    el.innerHTML = serazeno.length ? serazeno.map((p, i) => radekVyberu(p, i, null, i === 0 && vhodne.has(p.kod) ? 'Doporučuji' : '')).join('')
      : `<div class="kk-prazdno">${vse ? `Nic z toho teď není skladem${R.dlg.filtr === 'malesice' ? ' v Malešicích' : ''}. <button type="button" class="kk-odkaz" data-dfiltr="stavimex">Zobrazit i bez zásoby</button>` : 'Nic nenalezeno.'}</div>`;
  }, 120);
}
function radekVyberu(p, i, zdrojText, stitek) {
  const r = R.dlg && R.radky.find(x => x.klic === R.dlg.klic);
  const m = p.cenik ? null : p.sv ? zSortimentu(p) : zKatalogu(p);
  let potreba = '';
  if (r && m) {
    const x = mnozstviPro(r, m);
    const q = x && x.mnozstvi != null ? x.mnozstvi : (mjN(r.mj) === mjN(m.mj) ? r.mnozstvi : null);
    const c = cenaMaterialu(m).cena;
    if (q != null) potreba = `<span class="kk-v-potreba">potřeba ${f3(q)} ${esc(mjHezky(m.mj))}${c ? ' = ' + kc0(q * c) : ''}${x && x.popis ? ` <small>(${esc(x.popis)})</small>` : ''}</span>`;
  }
  const z = p.kod ? R.zas[p.kod] : null;
  return `<button type="button" class="kk-v" data-vyber="${i}">
    <span class="kk-r-foto">${p.foto ? `<img src="${esc(p.foto)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</span>
    <span class="kk-v-telo">${stitek ? `<span class="kk-v-doporuc">${esc(stitek)}</span>` : ''}<b>${esc(p.nazev)}</b>
      <span class="kk-v-meta">${esc([p.kod ? 'kód ' + p.kod : '', p.znacka, p.rozmer, p.sv ? (p.skladem === 1 ? 'skladová položka' : p.skladem === 2 ? 'na objednávku' : '') : '', zdrojText].filter(Boolean).join(' · '))}</span>
      ${!zdrojText && cestaSortimentu(p) ? `<span class="kk-v-obor">${esc(cestaSortimentu(p))}</span>` : ''}
      ${p.kod && !zdrojText && !A.bezStavimexu ? `<span class="kk-v-sklad">${skladHtml(z)}</span>` : ''}</span>
    <span class="kk-v-cena"><b>${p.cena != null ? kc(p.cena) : '–'}</b><small>/ ${esc(mjHezky(p.mj))} bez DPH</small>${potreba}</span>
  </button>`;
}
async function vybrano(i) {
  const v = R.vysledky[i]; if (!v || !R.dlg) return;
  const cil = R.dlg, st = stav();
  const m = v.cenik ? zCeniku(v.cenik) : v.sv ? zSortimentu(v.katalog) : zKatalogu(v.katalog);
  zavriVyber();
  if (v.katalog && !v.sv && !vSortimentu(v.katalog, { ...sortRadku(cil.klic), skupina: null })) m.mimoRucne = true;
  if (cil.rozmer) {
    const hl = HLAVNI_S_ROZMEREM[S.druh];
    const c = rozmerCm(v.katalog?.rozmer) || rozmerCm(m.nazev);
    if (c) {
      const s = c.slice().sort((a, b) => b - a);
      if (S.druh === 'zdivo') Object.assign(st.pole, rozmerTvarnice(c, cis(st.pole.tl)));
      else { st.pole.kd = vp(s[0]); st.pole.ksi = vp(s[1]); }
      A.toast('Rozměr převzat: ' + c.map(f3).join(' × ') + ' cm. Zkontroluj ho v parametrech.');
    } else A.toast('Zboží nemá uvedený rozměr – doplň ho ručně.', true);
    st.mat[hl.klic] = m; delete st.rucne[hl.klic]; st.sablona = null;
    vykresliZadani();
  } else {
    st.mat[cil.klic] = m; delete st.rucne[cil.klic]; delete st.vyp[cil.klic];
  }
  if (m.kod) await nactiZasoby([m.kod]);
  prepocitej();
}

/* ---------- sdílení a vložení ---------- */
function textSeznamu() {
  const k = KALK[S.druh], h = R.h, radky = sestavRadky().filter(r => !r.vyp), prace = sestavPraci().filter(p => p.pouzit && p.cena > 0);
  const L = [`${k.nazev}: ${k.rozmer === 'mistnost' ? `stěny ${f3(zaok(h.steny))} m², podlaha ${f3(zaok(h.podlaha))} m²` : f3(zaok(h.plocha)) + ' m²'}`, ''];
  radky.forEach(r => {
    let t = `• ${r.m ? r.m.nazev : r.nazev} – ${f3(r.mnProdej)} ${mjHezky(r.mjProdej)}`;
    if (r.m?.kod) t += ` (kód ${r.m.kod})`;
    if (r.z) { const a = zasobaCislo(r.z.malesice), b = zasobaCislo(r.z.liben); t += ` – skladem Malešice ${f3(a)}, Libeň ${f3(b)}`; }
    L.push(t);
  });
  if (prace.length) { L.push('', 'Práce:'); prace.forEach(p => L.push(`• ${p.nazev} – ${f3(p.mnozstvi)} ${p.mj} × ${kc(p.cena)}`)); }
  const dop = sestavDopravu(sestavRadky());
  if (dop.celkem > 0) L.push('', `Doprava: ${dop.nazev.replace('Doprava materiálu ', '')} – ${kc0(dop.celkem)}`);
  else if (dop.kg > 0) L.push('', `Náklad cca ${f3(Math.round(dop.kg))} kg`);
  const sum = radky.reduce((s, r) => s + r.celkem, 0) + prace.reduce((s, p) => s + p.celkem, 0) + dop.celkem;
  if (sum) L.push('', 'Orientačně celkem bez DPH: ' + kc0(sum));
  return L.join('\n');
}
async function sdilet() {
  const t = textSeznamu();
  if (navigator.share) { try { await navigator.share({ title: 'Materiál – ' + KALK[S.druh].nazev, text: t }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(t); A.toast('Seznam je ve schránce – vlož ho do zprávy.'); }
  catch (e) { A.toast('Kopírování se nepovedlo.', true); }
}
async function doDokladu(btn) {
  if (licBrana('kalk_do_nabidky')) return;
  const chybi = sestavRadky().filter(r => !r.vyp && r.m && r.prevodNejde && !r.rucne);
  if (chybi.length) { A.toast(`${chybi.length === 1 ? 'U 1 položky chybí' : `U ${chybi.length} položek chybí`} přepočet na prodejní jednotku – doplň ho.`, true); oknoPrevodu(chybi[0].klic); return; }
  const k = KALK[S.druh];
  const radky = sestavRadky().filter(r => !r.vyp && r.mnProdej > 0);
  const prace = sestavPraci().filter(p => p.pouzit && p.cena > 0);
  const vystup = radky.map(r => ({
    typ: 'material', nazev: r.m ? r.m.nazev : r.nazev, mj: mjHezky(r.mjProdej), mnozstvi: r.mnProdej,
    cena: r.cena, nakup: r.nakup ?? null, prirazka: r.m && r.m.src === 'katalog' && !r.cenikId ? Number(S.prirazka) || 0 : null,
    katKod: r.m?.kod || null, cenikId: r.cenikId, sazba_dph: 21,
    tema: r.m?.tema || '', skupina: r.m?.skupina || '', ean: r.m?.ean || '', foto: r.m?.foto || '',
    mnozstviPozor: !!r.prevodNejde,
    poznamka: `${k.nazev}: ${r.zaklad}${r.prevod ? ', ' + r.prevod : ''}`
  })).concat(prace.map(p => ({ typ: 'prace', nazev: p.nazev, mj: p.mj, mnozstvi: p.mnozstvi, cena: p.cena, sazba_dph: 21, poznamka: k.nazev })));
  const dop = sestavDopravu(sestavRadky());
  if (dop.celkem > 0) vystup.push({ typ: 'prace', nazev: dop.nazev, mj: dop.mj, mnozstvi: dop.mnozstvi, cena: dop.cena, sazba_dph: 21, poznamka: k.nazev + ': doprava' });
  if (!vystup.length) return A.toast('Není co vložit.', true);
  if (btn) btn.disabled = true;
  try { await A.doDokladu(vystup, { kalkulacka: k.nazev, plocha: R.h?.plocha }); }
  finally { if (btn) btn.disabled = false; }
}

/* =====================================================================
   UDÁLOSTI
   ===================================================================== */
/** Vyskakovací okno: uživatel zadá, kolik jednotek výpočtu je v 1 prodejní jednotce zboží. Platí pro to zboží ve všech kalkulačkách. */
function oknoPrevodu(klic) {
  const r = sestavRadky().find(x => x.klic === klic); if (!r || !r.m) return;
  const m = r.m, z = mjN(r.mj), na = mjN(m.mj), k = klicPrevodu(m, z);
  const vpp = n => n > 0 ? String(Math.round(n * 1e6) / 1e6).replace('.', ',') : '';
  const ted = uzivPrevod(m, z), auto = (() => { const s0 = S.prevody; S.prevody = {}; const x = prepocet(r.mnozstvi, r.mj, m); S.prevody = s0; return x && x.mnozstvi > 0 ? r.mnozstvi / x.mnozstvi : null; })();
  const hm = m.hmotnost > 0 ? m.hmotnost : zNazvu(m.nazev, 'kg');
  const tipy = [];
  if (hm && z === 'kg') tipy.push([hm, `${f3(hm)} kg (hmotnost zboží)`]);
  if (hm && z === 't') tipy.push([hm / 1000, `${f3(hm)} kg = ${f3(hm / 1000)} t`]);
  const l = zNazvu(m.nazev, 'l'); if (l && z === 'l') tipy.push([l, `${f3(l)} l z názvu`]); if (l && z === 'm³') tipy.push([l / 1000, `${f3(l)} l = ${f3(l / 1000)} m³`]);
  const ov = objemKusu(m.nazev); if (ov && z === 'm³') tipy.push([Math.round(ov * 1e5) / 1e5, `rozměr z názvu = ${f3(Math.round(ov * 1e5) / 1e5)} m³`]);
  const a = zNazvu(m.nazev, 'm2'); if (a && z === 'm²') tipy.push([a, `${f3(a)} m² z názvu`]);
  const d = zNazvu(m.nazev, 'm'); if (d && z === 'm') tipy.push([d, `${f3(d)} m z názvu`]);
  if (m.vBaleni > 1 && z === 'ks') tipy.push([m.vBaleni, `${f3(m.vBaleni)} ks v balení`]);
  let o = document.getElementById('kkPrevodOkno');
  if (!o) { o = document.createElement('div'); o.id = 'kkPrevodOkno'; o.className = 'backdrop'; o.style.zIndex = '1002'; document.body.appendChild(o); }
  o.innerHTML = `<div class="modal" style="max-width:440px" role="dialog" aria-label="Přepočet jednotek">
    <div class="modal-head"><h3>⇄ Přepočet jednotek</h3><button class="x" type="button" data-pz="x">×</button></div>
    <div class="modal-body">
      <p style="margin:0 0 6px"><b>${esc(m.nazev)}</b></p>
      <p class="muted small" style="margin:0 0 12px">Kalkulačka spočítala <b>${f3(r.mnozstvi)} ${esc(mjHezky(z))}</b>, zboží se prodává na <b>${esc(mjHezky(na))}</b>. Zadejte, kolik ${esc(mjHezky(z))} je v 1 ${esc(mjHezky(na))}.</p>
      <label class="small" for="kkPrevodVal">1 ${esc(mjHezky(na))} =</label>
      <div style="display:flex;gap:8px;align-items:center;margin-top:4px"><input id="kkPrevodVal" inputmode="decimal" value="${esc(vpp(ted || auto || (tipy[0] && tipy[0][0]) || 0))}" style="flex:1;padding:8px;border:1px solid var(--line);border-radius:8px;font-size:16px"><b>${esc(mjHezky(z))}</b></div>
      ${tipy.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">${tipy.map(([v, t]) => `<button type="button" class="btn sm" data-pt="${v}">${esc(t)}</button>`).join('')}</div>` : ''}
      <div id="kkPrevodVysl" class="small" style="margin-top:10px;font-weight:600"></div>
      <p class="muted small" style="margin:10px 0 0">Přepočet si zapamatuji pro toto zboží ve všech kalkulačkách. Zároveň ho pošlu jako návrh – po ověření ho uvidí všichni.</p>
    </div>
    <div class="modal-foot">${ted ? '<button class="btn" type="button" data-pz="smaz">Zrušit můj přepočet</button>' : ''}<button class="btn" type="button" data-pz="x">Zavřít</button><button class="btn gold" type="button" data-pz="ok">Použít</button></div></div>`;
  const inp = o.querySelector('#kkPrevodVal'), vys = o.querySelector('#kkPrevodVysl');
  const ukaz = () => { const f = cis(inp.value); vys.textContent = f > 0 ? `= ${f3(POCITANE.includes(na) ? nahoru(r.mnozstvi / f) : zaok(r.mnozstvi / f))} ${mjHezky(na)}` : ''; };
  inp.oninput = ukaz; ukaz();
  o.onclick = e => {
    const b = e.target.closest('[data-pz],[data-pt]');
    if (e.target === o || (b && b.dataset.pz === 'x')) { o.classList.remove('show'); return; }
    if (!b) return;
    if (b.dataset.pt) { inp.value = vpp(+b.dataset.pt); ukaz(); return; }
    S.prevody = S.prevody || {};
    if (b.dataset.pz === 'smaz') delete S.prevody[k];
    if (b.dataset.pz === 'ok') {
      const f = cis(inp.value); if (!(f > 0)) { inp.focus(); return; } S.prevody[k] = f;
      if (m.kod && A.prevodNavrh) A.prevodNavrh({ zbozi: m.kod, nazev: m.nazev, mjVypoctu: z, mjProdej: na, faktor: f });
    }
    delete stav().rucne[klic]; o.classList.remove('show'); prepocitej(); uloz();
  };
  o.classList.add('show'); setTimeout(() => inp.select(), 30);
}

function pripojUdalosti() {
  root.addEventListener('click', e => {
    const t = e.target.closest('button, [data-vyber]');
    if (!t || !root.contains(t)) return;
    const d = t.dataset;
    if (d.druh) { S.druh = d.druh; vykresliDruhy(); vykresliZadani(); prepocitej(); return; }
    if (d.rezim) { S.rezim = d.rezim; vykresliZadani(); uloz(); return; }
    if (d.sablona !== undefined) return pouzijSablonu(Number(d.sablona));
    if (d.volba) { const [id, v] = d.volba.split(':'); stav().pole[id] = v; vykresliPole(); vykresliUseky(); prepocitej(); return; }
    if (d.usekSmazat !== undefined) { stav().useky.splice(Number(d.usekSmazat), 1); vykresliUseky(); prepocitej(); return; }
    if (d.otvorPridat) { const [s, v] = d.otvorPridat.split(','); stav().otvory.push({ s: vp(+s), v: vp(+v), n: '1' }); vykresliOtvory(); prepocitej(); return; }
    if (d.otvorSmazat !== undefined) { stav().otvory.splice(Number(d.otvorSmazat), 1); vykresliOtvory(); prepocitej(); return; }
    if (d.oKrok) { const [i, s] = d.oKrok.split(':').map(Number); const o = stav().otvory[i]; o.n = String(Math.max(0, (cis(o.n) || 0) + s)); vykresliOtvory(); prepocitej(); return; }
    if (d.dzp) { S.doprava.zpusob = d.dzp; vykresliDopravu(); vykresliListu(); uloz(); return; }
    if (d.filtr) { S.filtr = d.filtr; prepocitej(); predvyber(false); return; }
    if (d.mat) return otevriVyber({ klic: d.mat });
    if (d.reset) { delete stav().rucne[d.reset]; prepocitej(); return; }
    if (d.prevod) return oknoPrevodu(d.prevod);
    if (d.paleta) {
      const r = sestavRadky().find(x => x.klic === d.paleta); if (!r) return;
      const pal = nahoru(r.mnProdej / r.m.naPalete);
      stav().rucne[r.klic] = { q: vp(pal * r.m.naPalete), mj: r.mjProdej };
      A.toast(`Zaokrouhleno na ${pal} ${pal === 1 ? 'celou paletu' : pal < 5 ? 'celé palety' : 'celých palet'}.`);
      prepocitej(); return;
    }
    if (d.zdroj) { R.dlg.zdroj = d.zdroj; vykresliDlgFiltry(); hledejVDialogu(); return; }
    if (d.dfiltr) { R.dlg.filtr = d.dfiltr; vykresliDlgFiltry(); hledejVDialogu(); return; }
    if (d.dsv !== undefined) { R.dlg.jenVhodne = d.dsv === '1'; vykresliDlgSort(); hledejVDialogu(); return; }
    if (d.dsort) {
      const st = stav();
      if (d.dsort === 'obor') { R.dlg.jenSort = true; delete st.sortVyber[R.dlg.klic]; }
      else R.dlg.jenSort = false;
      vykresliDlgSort(); hledejVDialogu(); uloz(); return;
    }
    if (d.dskup !== undefined) {
      const st = stav(), akt = st.sortVyber[R.dlg.klic];
      if (akt && bezDia(akt.skupina) === bezDia(d.dskup) && R.dlg.jenSort) delete st.sortVyber[R.dlg.klic];
      else st.sortVyber[R.dlg.klic] = { skupina: d.dskup, tema: d.dtema || null };
      R.dlg.jenSort = true;
      vykresliDlgSort(); hledejVDialogu(); uloz(); return;
    }
    if (d.vyber !== undefined) return vybrano(Number(d.vyber));
    switch (d.akce) {
      case 'tipy': S.tipy = !S.tipy; vykresliZadani(); uloz(); break;
      case 'jak': S.jak = !S.jak; vykresliZadani(); uloz(); break;
      case 'usek': { const k = KALK[S.druh]; const posl = stav().useky.filter(u => u.m2 === undefined).slice(-1)[0] || {};
        stav().useky.push(k.rozmer === 'mistnost' ? { d: '', s: '', v: posl.v || '2,6' } : k.rozmer === 'steny' ? { d: '', v: posl.v || '' } : { d: '', s: '' });
        vykresliUseky(); fokusPosledni(); break; }
      case 'usek-m2': stav().useky.push({ m2: '' }); vykresliUseky(); fokusPosledni(); break;
      case 'rozmer-z-katalogu': otevriVyber({ klic: HLAVNI_S_ROZMEREM[S.druh].klic, rozmer: true }); break;
      case 'predvyber': Object.keys(R.nenalezeno).forEach(k => delete R.nenalezeno[k]); predvyber(true); break;
      case 'zavrit': zavriVyber(); break;
      case 'bez-materialu': if (R.dlg) { const st = stav(); delete st.mat[R.dlg.klic]; delete st.rucne[R.dlg.klic]; R.nenalezeno[S.druh + '|' + (R.radky.find(x => x.klic === R.dlg.klic)?.q) + '|' + S.filtr] = 1; } zavriVyber(); prepocitej(); break;
      case 'novy': {
        const k = KALK[S.druh], st = S.d[S.druh];
        const neco = st && (st.useky.some(u => Object.keys(u).some(x => x !== 'v' && String(u[x] || '').trim())) || st.otvory.length || Object.keys(st.pole).length || Object.keys(st.rucne).length);
        if (neco && !confirm('Začít nový výpočet?\nRozměry, parametry i ručně vybraný materiál této kalkulačky se vymažou.')) break;
        delete S.d[S.druh]; Object.keys(R.nenalezeno).forEach(x => delete R.nenalezeno[x]);
        vykresliZadani(); prepocitej(); uloz();
        if (A.toast) A.toast('Nový výpočet – kalkulačka je prázdná.');
        break; }
      case 'sdilet': sdilet(); break;
      case 'do-dokladu': doDokladu(t); break;
    }
  });
  root.addEventListener('input', e => {
    const t = e.target, d = t.dataset, st = stav();
    if (d.u) { const [i, k] = d.u.split(':'); st.useky[+i][k] = t.value; prepocitej(); return; }
    if (d.o) { const [i, k] = d.o.split(':'); st.otvory[+i][k] = t.value; prepocitej(); return; }
    if (d.dop) { S.doprava[d.dop] = t.value; vykresliListu(); uloz(); return; }
    if (d.pole && t.type !== 'checkbox') { st.pole[d.pole] = t.value; st.sablona = null; oznacSablony(); prepocitej(); return; }
    if (d.mn) { const r = sestavRadky().find(x => x.klic === d.mn); st.rucne[d.mn] = { q: t.value, mj: r ? r.mjProdej : '' }; obnovSouctyBezPrekresleni(); uloz(); return; }
    if (d.cp) { S.cenyPrace[S.druh + ':' + d.cp] = t.value; if (cis(t.value) > 0 && st.pracePouzit[d.cp] === undefined) { const c = root.querySelector(`[data-pz="${d.cp}"]`); if (c) c.checked = true; } obnovSouctyBezPrekresleni(); uloz(); return; }
    if (t === $k('prirazka')) {
      S.prirazka = cis(t.value) ?? 0; uloz();
      clearTimeout(R.prirCas); R.prirCas = setTimeout(() => { vykresliRadky(); vykresliListu(); }, 350);   // pole přirážky se nepřekresluje, fokus zůstane
      return;
    }
    if (t === $k('dlg-hledat')) hledejVDialogu();
  });
  root.addEventListener('change', e => {
    const t = e.target, d = t.dataset, st = stav();
    if (d.pole && t.type === 'checkbox') { st.pole[d.pole] = t.checked ? '1' : '0'; st.sablona = null; vykresliPole(); prepocitej(); return; }
    if (d.zap) { if (t.checked) delete st.vyp[d.zap]; else st.vyp[d.zap] = true; prepocitej(); return; }
    if (d.pz) { st.pracePouzit[d.pz] = t.checked; obnovSouctyBezPrekresleni(); uloz(); return; }
  });
  $k('dlg').addEventListener('click', e => { if (e.target === $k('dlg')) zavriVyber(); });
  $k('dlg').addEventListener('close', () => { R.dlg = null; });
  $k('dlg-hledat').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (R.vysledky.length === 1) vybrano(0); } });
}
function fokusPosledni() { const r = root.querySelectorAll('[data-kk="useky"] .kk-usek'); const i = r.length ? r[r.length - 1].querySelector('input') : null; if (i) setTimeout(() => i.focus(), 20); }
function oznacSablony() { root.querySelectorAll('[data-sablona]').forEach(b => b.classList.toggle('aktivni', Number(b.dataset.sablona) === stav().sablona)); }
function pouzijSablonu(i) {
  const k = KALK[S.druh], s = k.sablony[i], st = stav();
  Object.assign(st.pole, s.h);
  st.sablona = i;
  const hl = HLAVNI_S_ROZMEREM[S.druh];
  if (s.q) Object.entries(s.q).forEach(([kl, q]) => { st.dotazy[kl] = q; if (st.mat[kl]?.auto || (hl && hl.klic === kl)) delete st.mat[kl]; });
  else if (hl && st.mat[hl.klic]?.auto) delete st.mat[hl.klic];
  vykresliZadani(); prepocitej();
}

/* =====================================================================
   STYLY
   ===================================================================== */
const CSS = `
.kk-hledat-tip{font-size:12px;color:#6b7280;margin:4px 2px 6px}
.kk-omezeni{margin:6px 0 8px;padding:8px 10px;border-radius:8px;background:#fff8e1;border:1px solid #f2d27a;color:#5a4500;font-size:13px;line-height:1.4}
.kk-omezeni a{color:inherit;font-weight:700}
.kk,.kk-pill,.kk-dlg,.kk-stx{--kk-ink:var(--inkoust,#1D272F);--kk-ocel:var(--ocel,#5D6B76);--kk-linka:#D8DCD6;--kk-pole:#BFC5BF;--kk-metr:var(--metr,#F2B705);--kk-ok:var(--sklad,#2B7A4B);--kk-pozor:var(--pozor,#B3261E);--kk-pod:#EEF0EC;--kk-karta:#fff}
.kk{color:var(--kk-ink);font-size:16px;line-height:1.45}
.kk *{box-sizing:border-box}
.kk h2,.kk h3,.kk-druh,.kk-lista-souhrn b,.kk-in-mn{font-family:'Barlow Condensed','Barlow',system-ui,sans-serif}
.kk h2{font-size:1.45rem;margin:0;line-height:1.15;font-weight:700}
.kk label{display:block;margin:0;font-weight:500;font-size:.88rem}
.kk [hidden]{display:none!important}
.kk button{font:inherit;color:inherit}
.kk-druhy{display:flex;gap:.5rem;overflow-x:auto;padding:.1rem .1rem .6rem;margin-bottom:.6rem;scrollbar-width:thin;scroll-snap-type:x proximity}
.kk-druh{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:.15rem;min-width:88px;padding:.55rem .6rem;border:1px solid var(--kk-linka);border-radius:10px;background:var(--kk-karta);cursor:pointer;font-weight:600;font-size:1rem;scroll-snap-align:start;line-height:1.1;text-align:center}
.kk-druh:hover{background:#F8F9F6}
.kk-druh-ik{font-size:1.5rem;line-height:1}
.kk-druh.aktivni{background:var(--kk-ink);color:#fff;border-color:var(--kk-ink);box-shadow:inset 0 -4px 0 var(--kk-metr)}
.kk-karta{background:var(--kk-karta);border:1px solid var(--kk-linka);border-radius:10px;padding:1rem;margin-bottom:1rem}
.kk-hlava{display:flex;gap:.6rem;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:.4rem}
.kk-hlava-akce{display:flex;gap:.45rem;align-items:center;flex-wrap:wrap}
.kk-popis{color:var(--kk-ocel);margin:.1rem 0 .8rem;font-size:.95rem}
.kk-pozn{color:var(--kk-ocel);margin:.2rem 0 .7rem;font-size:.88rem}
.kk-sablony{display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.9rem}
.kk-blok{border-top:1px solid var(--kk-linka);padding-top:.8rem;margin-top:.8rem}
.kk-blok-hlava{display:flex;justify-content:space-between;gap:.5rem;flex-wrap:wrap;font-weight:700;font-size:.95rem;margin-bottom:.55rem}
.kk-souhrn-plochy{font-weight:600;color:var(--kk-ok)}
.kk-btn{border:0;border-radius:8px;padding:.6rem 1rem;font-weight:600;cursor:pointer;background:var(--kk-ink);color:#fff;display:inline-flex;align-items:center;justify-content:center;gap:.35rem;line-height:1.2;min-height:44px;text-decoration:none}
.kk-btn:hover{background:#2E3B45}
.kk-btn:disabled{opacity:.5;cursor:default}
.kk .kk-btn.kk-tichy{background:transparent;color:var(--kk-ink);border:1px solid var(--kk-linka)}
.kk .kk-btn.kk-tichy:hover{background:#EBEDE8}
.kk .kk-btn.kk-metr{background:var(--kk-metr);color:var(--kk-ink)}
.kk .kk-btn.kk-metr:hover{background:#E0A800}
.kk-maly{padding:.4rem .75rem;font-size:.9rem;min-height:38px}
.kk-chip{border:1px solid var(--kk-linka);background:#fff;border-radius:999px;padding:.45rem .9rem;font-weight:600;font-size:.92rem;cursor:pointer;min-height:40px}
.kk-chip:hover{background:#EBEDE8}
.kk-chip.aktivni{background:var(--kk-metr);border-color:var(--kk-metr)}
.kk-chip-kat{border-style:dashed}
.kk-seg{display:inline-flex;border:1px solid var(--kk-linka);border-radius:8px;overflow:hidden;background:#fff;max-width:100%}
.kk-seg button{border:0;background:none;padding:.45rem .75rem;font-weight:600;font-size:.9rem;cursor:pointer;min-height:40px;border-left:1px solid var(--kk-linka);white-space:nowrap}
.kk-seg button:first-child{border-left:0}
.kk-seg button[aria-pressed="true"]{background:var(--kk-ink);color:#fff}
.kk-seg-sklad button[aria-pressed="true"]{background:var(--kk-ok)}
.kk-seg-volba{display:flex;width:100%}
.kk-seg-volba button{flex:1}
.kk-in{width:100%;padding:.55rem .65rem;border:1px solid var(--kk-pole);border-radius:8px;background:#fff;font:inherit;font-size:1.05rem;min-height:44px;color:var(--kk-ink)}
.kk-in:focus{outline:none;border-color:var(--kk-ink);box-shadow:0 0 0 3px rgba(29,39,47,.15)}
.kk-in-maly{width:4.2rem;min-height:36px;padding:.3rem .45rem;font-size:.95rem;text-align:right;display:inline-block}
.kk-mj-obal{position:relative;display:block}
.kk-mj-obal .kk-in{padding-right:3.2rem}
.kk-mj-obal i{position:absolute;right:.6rem;top:50%;transform:translateY(-50%);font-style:normal;color:var(--kk-ocel);font-size:.8rem;pointer-events:none;max-width:3rem;text-align:right;line-height:1.05}
.kk-mrizka{display:grid;gap:.8rem;grid-template-columns:repeat(auto-fill,minmax(170px,1fr))}
/* Širší okno: vlevo zadání (rozměry, parametry), vpravo materiál a výsledek */
@media (min-width:1240px){
  .kk{display:grid;grid-template-columns:minmax(360px,5fr) minmax(0,7fr);gap:0 1.1rem;align-items:start}
  .kk-druhy,.kk-lista{grid-column:1/-1}
  .kk-karta{min-width:0}
}
.kk-pole-siroke{grid-column:span 2}
.kk-pole-popis{display:block;font-weight:500;font-size:.88rem;margin-bottom:.25rem}
.kk-pole-ano{display:flex;flex-direction:column;justify-content:flex-end}
.kk-tip{font-size:.82rem;color:var(--kk-ocel);margin:.25rem 0 0}
.kk .kk-prepinac{display:flex;align-items:center;gap:.6rem;cursor:pointer;min-height:44px;font-size:.95rem}
.kk-prepinac input{position:absolute;opacity:0;width:1px;height:1px}
.kk-prep-kolej{flex:0 0 auto;width:46px;height:26px;border-radius:999px;background:#C9CEC7;position:relative;transition:background .15s}
.kk-prep-kolej::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:left .15s}
.kk-prepinac input:checked + .kk-prep-kolej{background:var(--kk-ok)}
.kk-prepinac input:checked + .kk-prep-kolej::after{left:23px}
.kk-prepinac input:focus-visible + .kk-prep-kolej{outline:3px solid var(--kk-ink);outline-offset:2px}
.kk-usek,.kk-otvor{display:grid;gap:.4rem;align-items:end;margin-bottom:.55rem}
.kk-usek-2{grid-template-columns:5.2rem 1fr auto 1fr 40px}
.kk-usek-3{grid-template-columns:5.2rem 1fr auto 1fr auto 1fr 40px}
.kk-usek-m2{grid-template-columns:5.2rem 1fr 40px}
.kk-otvor{grid-template-columns:1fr auto 1fr 8.5rem 40px}
.kk-usek-n{font-weight:600;font-size:.88rem;padding-bottom:.7rem;color:var(--kk-ocel)}
.kk-krat{padding-bottom:.7rem;color:var(--kk-ocel)}
.kk .kk-mini>span:first-child{display:block;font-size:.78rem;color:var(--kk-ocel);margin-bottom:.15rem}
.kk-x{width:40px;height:44px;border:1px solid var(--kk-linka);border-radius:8px;background:#fff;cursor:pointer;font-size:1.3rem;line-height:1}
.kk-x:hover{background:#FBEDEC;color:var(--kk-pozor)}
.kk-krok{display:flex}
.kk-krok button{width:36px;min-height:44px;border:1px solid var(--kk-pole);background:#F8F9F6;cursor:pointer;font-size:1.2rem}
.kk-krok button:first-child{border-radius:8px 0 0 8px;border-right:0}
.kk-krok button:last-child{border-radius:0 8px 8px 0;border-left:0}
.kk-krok .kk-in{border-radius:0;text-align:center;padding:.5rem .2rem}
.kk-radek-akci{display:flex;gap:.45rem;flex-wrap:wrap;margin-top:.2rem}
.kk-schema{margin-top:.9rem;background:#fff;border:1px solid var(--kk-linka);border-radius:8px;padding:.3rem}
.kk-schema svg{width:100%;height:auto;display:block;max-height:230px}
.kk-svg-plocha{fill:#F0F1EE;stroke:var(--kk-ink);stroke-width:2}
.kk-svg-obrys{fill:none;stroke:var(--kk-ink);stroke-width:2}
.kk-svg-otvor{fill:#fff;stroke:var(--kk-ink);stroke-width:1.5}
.kk-svg-parapet{stroke:var(--kk-ink);stroke-width:3}
.kk-svg-sloup{fill:var(--kk-ink)}
.kk-svg-tram{stroke:#8A6A3A;stroke-width:3}
.kk-svg-krokev{stroke:#B98B4E;stroke-width:2}
.kk-svg-dlazdice{fill:#fff;stroke:#C9CEC7}
.kk-svg-t{font:600 18px 'Barlow',system-ui,sans-serif;fill:var(--kk-ink);text-anchor:middle}
.kk-svg-slaby{fill:var(--kk-ocel);font-weight:500}
.kk-jak{background:var(--kk-pod);border-radius:8px;padding:.8rem 1rem;font-size:.9rem;line-height:1.6;white-space:pre-line;margin-bottom:.8rem}
.kk-prirazka{display:inline-flex!important;align-items:center;gap:.35rem;font-size:.9rem!important;font-weight:600!important}
.kk-stx{border:1px solid var(--kk-linka);border-radius:10px;margin:0 0 .8rem;background:#fff}
.kk-stx summary{cursor:pointer;padding:.65rem .9rem;display:flex;justify-content:space-between;gap:.6rem;flex-wrap:wrap;align-items:center;list-style:none;font-size:.92rem;min-height:44px}
.kk-stx summary::-webkit-details-marker{display:none}
.kk-stx summary::after{content:"▾";color:var(--kk-ocel);margin-left:auto}
.kk-stx[open] summary::after{content:"▴"}
.kk-stx-souhrn{color:var(--kk-ocel);font-size:.88rem}
.kk-stx a{color:var(--kk-ink);font-weight:600}
.kk-stx-telo{display:grid;grid-template-columns:1fr 1fr;gap:.6rem;padding:0 .9rem .6rem}
.kk-stx-karta{display:flex;flex-direction:column;gap:.15rem;border:1px solid var(--kk-linka);border-radius:8px;padding:.7rem .8rem;font-size:.9rem;position:relative}
.kk-stx-karta.hlavni{border:2px solid var(--kk-ok)}
.kk-stx-karta small{color:var(--kk-ocel)}
.kk-stx-karta a{min-height:32px;display:inline-flex;align-items:center}
.kk-stx-tel{font-size:1.05rem}
.kk-stx-stitek{align-self:flex-start;background:var(--kk-ok);color:#fff;font-size:.7rem;font-weight:700;padding:.05rem .45rem;border-radius:4px;text-transform:uppercase;letter-spacing:.3px;margin-bottom:.15rem}
.kk-stx-ceny{margin:0;padding:0 .9rem .75rem;font-size:.84rem;color:var(--kk-ocel)}
.kk-stx-kompakt{padding:.6rem .8rem;font-size:.86rem;line-height:1.5;display:flex;flex-direction:column;gap:.15rem}
.kk-stx-kompakt .kk-stx-ceny{padding:0}
@media (max-width:720px){.kk-stx-telo{grid-template-columns:1fr}}
.kk-radky{border:1px solid var(--kk-linka);border-radius:10px;overflow:hidden}
.kk-r{display:grid;grid-template-columns:28px 56px 1fr 150px 112px;gap:.7rem;padding:.75rem .8rem;border-top:1px solid var(--kk-linka);align-items:center;background:#fff}
.kk-r:first-child{border-top:0}
.kk-r.bez{background:#FFFCF2}
.kk-r.vyp{opacity:.5;background:#F8F9F6}
.kk-r.vyp .kk-r-telo,.kk-r.vyp .kk-r-mn{text-decoration:line-through}
.kk-r-zap{display:flex!important;align-items:center;justify-content:center;min-height:44px;cursor:pointer}
.kk-r-zap input{width:1.25rem;height:1.25rem;accent-color:var(--kk-ok)}
.kk-r-foto{width:56px;height:56px;border-radius:6px;background:var(--kk-pod);display:grid;place-items:center;overflow:hidden;font-size:1.5rem}
.kk-r-foto img{width:100%;height:100%;object-fit:contain;background:#fff}
.kk-r-nazev{font-weight:600;line-height:1.25}
.kk-r-co{font-size:.82rem;color:var(--kk-ocel);margin-top:.1rem}
.kk-r-cena{font-size:.88rem;margin-top:.2rem}
.kk-r-cena span{color:var(--kk-ocel)}
.kk-cervena{color:var(--kk-pozor)}
.kk-r-sklad{display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.3rem;align-items:center}
.kk-r-var{font-size:.84rem;color:#8A4B00;font-weight:600;margin-top:.25rem;flex-basis:100%}
.kk-r-var-info{color:var(--kk-ocel);font-weight:500}
.kk-pill{font-size:.78rem;font-weight:600;padding:.12rem .5rem;border-radius:999px;white-space:nowrap;background:var(--kk-pod);color:var(--kk-ocel)}
.kk-pill-ok{background:#E3F1E8;color:var(--kk-ok)}
.kk-pill-malo{background:#FDF0C4;color:#6B5300}
.kk-pill-ne{background:#F3F4F2;color:#8A949B}
.kk-pill-nic{background:transparent;color:#8A949B;padding-left:0}
.kk-r-mn{display:flex;flex-direction:column;align-items:stretch;gap:.2rem;text-align:right}
.kk-in-mn{font-size:1.3rem;font-weight:700;text-align:right}
.kk-r-celkem{font-size:.88rem;color:var(--kk-ocel);font-weight:600;min-height:1.2em}
.kk-r-akce{display:flex;flex-direction:column;gap:.3rem}
.kk-odkaz{background:none;border:0;padding:0;color:var(--kk-ocel);text-decoration:underline;cursor:pointer;font-size:.8rem}
.kk-prazdno{padding:1.6rem 1rem;text-align:center;color:var(--kk-ocel)}
.kk-h3{font-weight:700;margin:1.1rem 0 .5rem;font-size:1.05rem}
.kk-h3 small{font-weight:500;color:var(--kk-ocel);font-size:.82rem;margin-left:.4rem}
.kk-p{display:grid;grid-template-columns:28px 1fr 170px 110px;gap:.6rem;align-items:center;padding:.4rem 0;border-top:1px solid var(--kk-linka)}
.kk-p:first-child{border-top:0}
.kk-p-nazev{font-weight:600}
.kk-doprava{padding-bottom:.4rem}
.kk-doprava .kk-seg{margin-bottom:.7rem}
.kk-dop-pole{margin-bottom:.4rem}
.kk-p-nazev span{font-weight:500;color:var(--kk-ocel);margin-left:.35rem;white-space:nowrap}
.kk-p .kk-r-celkem{text-align:right}
.kk-lista{position:sticky;bottom:0;z-index:15;margin:0 -.2rem}
.kk-lista-in{background:var(--kk-ink);color:#fff;border-radius:10px 10px 0 0;padding:.7rem 1rem calc(.7rem + env(safe-area-inset-bottom));display:flex;gap:.6rem 1.2rem;align-items:center;justify-content:space-between;flex-wrap:wrap;box-shadow:0 -6px 20px rgba(0,0,0,.15)}
.kk-lista-souhrn{display:flex;gap:1.2rem;flex-wrap:wrap}
.kk-lista-souhrn small{display:block;font-size:.72rem;opacity:.75;text-transform:uppercase;letter-spacing:.4px}
.kk-lista-souhrn b{font-size:1.3rem}
.kk-lista-celkem b{color:var(--kk-metr);font-size:1.55rem}
.kk-lista-akce{display:flex;gap:.5rem;flex-wrap:wrap}
.kk-lista .kk-btn.kk-tichy{color:#fff;border-color:#55636E}
.kk-lista .kk-btn.kk-tichy:hover{background:#2E3B45}
.kk-lista-pozn{flex-basis:100%;font-size:.82rem;opacity:.8}
.kk-dlg{border:0;border-radius:12px;padding:0;width:min(720px,calc(100% - 1rem));max-height:calc(100vh - 1.5rem);max-height:calc(100dvh - 1.5rem);color:var(--kk-ink,#1D272F);display:none;flex-direction:column}
.kk-dlg[open]{display:flex}
.kk-dlg::backdrop{background:rgba(29,39,47,.55)}
.kk-dlg-hlava{background:var(--kk-metr);padding:.9rem 1rem;display:flex;align-items:center;gap:.6rem}
.kk-dlg-hlava h3{margin:0;font-size:1.3rem;flex:1;font-family:'Barlow Condensed','Barlow',sans-serif}
.kk-dlg-x{background:none;border:0;font-size:1.8rem;line-height:1;cursor:pointer;width:44px;height:44px}
.kk-dlg-telo{padding:.9rem 1rem;overflow:auto;flex:1;min-height:0}
.kk-hledat{font-size:1.1rem;border:2px solid var(--kk-ink)}
.kk-dlg-filtry{display:flex;gap:.5rem;flex-wrap:wrap;margin:.6rem 0 .7rem}
.kk-dlg-sort{display:flex;gap:.4rem;flex-wrap:nowrap;overflow-x:auto;align-items:center;margin-top:.6rem;padding-bottom:.2rem;scrollbar-width:thin}
.kk-dlg-sort .kk-chip{flex:0 0 auto;min-height:36px;padding:.3rem .75rem;font-size:.88rem;white-space:nowrap}
.kk-dlg-sort .kk-chip small{opacity:.6;font-weight:500;margin-left:.15rem}
.kk-chip-sort.aktivni{background:var(--kk-ink);color:#fff;border-color:var(--kk-ink)}
.kk-dlg-sort-t{font-size:.8rem;font-weight:700;color:var(--kk-ocel);text-transform:uppercase;letter-spacing:.4px;flex:0 0 auto}
.kk-dlg-sort-pozn{font-size:.8rem;color:var(--kk-ok);flex:0 0 auto;white-space:nowrap}
.kk-v-doporuc{align-self:flex-start;background:var(--kk-metr);color:var(--kk-ink);font-size:.72rem;font-weight:700;padding:.05rem .45rem;border-radius:4px;text-transform:uppercase;letter-spacing:.3px}
.kk-v-potreba small{font-weight:500;color:var(--kk-ocel)}
.kk-v-potreba{white-space:normal}
.kk-v-obor,.kk-r-obor{font-size:.78rem;color:var(--kk-ok);font-weight:600}
.kk-r-obor{margin-top:.1rem}
.kk-dlg-seznam{border:1px solid var(--kk-linka);border-radius:10px;overflow:hidden}
.kk-v{display:grid;grid-template-columns:56px 1fr auto;gap:.7rem;width:100%;text-align:left;border:0;border-top:1px solid var(--kk-linka);background:#fff;padding:.65rem .8rem;cursor:pointer;align-items:center}
.kk-v:first-child{border-top:0}
.kk-v:hover,.kk-v:focus-visible{background:#F8F9F6}
.kk-v-telo{display:flex;flex-direction:column;gap:.15rem;min-width:0}
.kk-v-meta{font-size:.8rem;color:var(--kk-ocel)}
.kk-v-sklad{display:flex;gap:.3rem;flex-wrap:wrap}
.kk-v-cena{text-align:right;display:flex;flex-direction:column;white-space:nowrap}
.kk-v-cena small{color:var(--kk-ocel);font-size:.75rem}
.kk-v-potreba{font-size:.78rem;color:var(--kk-ok);font-weight:600;margin-top:.15rem}
.kk-dlg-pata{display:flex;gap:.5rem;justify-content:flex-end;padding:.7rem 1rem;border-top:1px solid var(--kk-linka);background:#F8F9F6}
.kk-spinner{display:inline-block;width:.9em;height:.9em;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:kk-toc .8s linear infinite;vertical-align:-.1em}
@keyframes kk-toc{to{transform:rotate(360deg)}}
@media (max-width:720px){
  .kk-r{grid-template-columns:28px 48px 1fr;gap:.35rem .6rem;padding:.7rem .6rem}
  .kk-r-foto{width:48px;height:48px}
  .kk-r-mn{grid-column:2/4;flex-direction:row;align-items:center;justify-content:flex-start;text-align:left;gap:.6rem;flex-wrap:wrap}
  .kk-r-mn .kk-mj-obal{width:9.5rem}
  .kk-r-akce{grid-column:2/4;flex-direction:row}
  .kk-r-akce .kk-btn{flex:1}
  .kk-p{grid-template-columns:28px 1fr 130px}
  .kk-p .kk-r-celkem{grid-column:2/4}
  .kk-pole-siroke{grid-column:1/-1}
  .kk-mrizka{grid-template-columns:1fr 1fr}
  .kk-usek-2{grid-template-columns:1fr auto 1fr 40px}
  .kk-usek-3{grid-template-columns:1fr auto 1fr auto 1fr 40px}
  .kk-usek-m2{grid-template-columns:1fr 40px}
  .kk-usek-n{grid-column:1/-1;padding:0}
  .kk-otvor{grid-template-columns:1fr auto 1fr 40px}
  .kk-otvor .kk-mini-n{grid-column:1/4}
  .kk-hlava-akce{width:100%;gap:.35rem}
  .kk-hlava-akce .kk-maly{flex:1 1 auto;padding:.4rem .4rem;font-size:.8rem;white-space:nowrap;min-width:0}
  .kk-hlava-akce .kk-seg{flex:1 1 100%}
  .kk-hlava-akce .kk-seg>button{flex:1}
  .kk-seg-sklad{flex:1 1 auto}
  .kk-seg-sklad button{flex:1;padding:.45rem .5rem}
  .kk-lista{margin:0 -1rem}
  .kk-lista-in{border-radius:0;padding:.5rem .8rem calc(.5rem + env(safe-area-inset-bottom));gap:.4rem .8rem}
  .kk-lista-souhrn{gap:.9rem}
  .kk-lista-souhrn b{font-size:1.1rem}
  .kk-lista-celkem b{font-size:1.3rem}
  .kk-lista-akce .kk-btn{min-height:42px;padding:.45rem .6rem}
  .kk-svg-t{font-size:24px}
  .kk-lista-hm{display:none}
  .kk-lista-akce{width:100%}
  .kk-lista-akce .kk-btn{flex:1}
  .kk-lista-akce .kk-metr{flex:2}
  .kk-v{grid-template-columns:48px 1fr;}
  .kk-v .kk-r-foto{width:48px;height:48px}
  .kk-v-cena{grid-column:2;text-align:left;flex-direction:row;gap:.4rem;align-items:baseline;flex-wrap:wrap}
  .kk-dlg{width:100%;max-width:100%;max-height:100%;height:100%;height:100dvh;border-radius:0;margin:0}
}
@media (max-width:420px){
  .kk-usek-3{grid-template-columns:1fr 1fr 1fr 40px}
  .kk-usek-3 .kk-krat{display:none}
}
@media print{.kk-lista,.kk-dlg{display:none!important}}
@media (prefers-reduced-motion:reduce){.kk *{transition:none!important;animation:none!important}}
`;

/* =====================================================================
   VEŘEJNÉ ROZHRANÍ
   ===================================================================== */
function init(adapter, el) {
  A = adapter; root = el;
  if (!document.getElementById('kk-css')) { const s = document.createElement('style'); s.id = 'kk-css'; s.textContent = CSS; document.head.appendChild(s); }
  nacti();
  kostra();
  pripojUdalosti();
  $k('stx').innerHTML = A.bezStavimexu ? '' : stavimexHtml(false);
  if (A.bezStavimexu) { $k('filtr').hidden = true; $k('dlg-filtr').hidden = true; root.querySelector('[data-akce="predvyber"]').title = 'Znovu vybrat materiál podle ceny'; }
  vykresliDruhy(); vykresliZadani(); prepocitej();
  if (A.prevodyNacti) A.prevodyNacti().then(list => {
    SCHV = {}; (list || []).forEach(x => { const f = Number(x.faktor); if (x.zbozi && f > 0) SCHV[x.zbozi + '|' + mjN(x.mj_vypoctu)] = f; });
    if (Object.keys(SCHV).length) prepocitej();
  }).catch(() => {});
}
/** Volá aplikace při zobrazení záložky – obnoví ceny z ceníku a text tlačítka. */
function ukazano() {
  if (!root) return;
  vykresliDruhy();
  vykresliRadky(); vykresliPraci(); vykresliListu();
  naplanujPredvyber();
}

global.YeyKalk = {
  init, ukazano, STAVIMEX, stavimexHtml, prekresli: () => { try { vykresliListu(); } catch (e) { /* kalkulačka ještě není otevřená */ } },
  katalogZmena: () => { try { if (!A.katalogDostupny()) { const st = S.d[S.druh]; if (st) Object.keys(st.mat || {}).forEach(k => { if (st.mat[k] && st.mat[k].auto && st.mat[k].src === 'katalog') delete st.mat[k]; }); } vykresliRadky(); naplanujPredvyber(); } catch (e) { /* */ } },
  sklad: { skore: skladSkore, seradit: seraditPodleSkladu, html: skladHtml, filtr: projdeFiltrem, PRODEJNY },
  sortiment: { temata: temataSortimentu, obsahuje: vSortimentu, bezDia },
  _test: { prepocet, objemKusu, KALK, SORT, sortRadku, SV, svKandidati, prodejSV, mnozstviPro, seraditSV, prepocet, rozmerCm, zNazvu, S, R, hodnoty, sestavRadky, sestavPraci, textSeznamu, predvyber, vyberNejlepsi }
};
})(typeof window !== 'undefined' ? window : globalThis);

