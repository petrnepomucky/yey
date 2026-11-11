/* =====================================================================
   YeY – účetnictví: kontrolní hlášení DPH (DPHKH1) z vydaných faktur a kalendář jmenin.
   Čisté funkce bez vazby na obrazovku – vykreslení je v index.html (POHLEDY.ucetnictvi).

   Kontrolní hlášení: struktura XML podle dphkh1_epo2.xsd (verzePis 03.01), stejná jako v původním
   modulu Daně a účetnictví (ucetnictvi.html). Aplikace eviduje jen vydané doklady, takže plní
   oddíly A.1, A.4 a A.5; přijatá plnění (oddíl B) se doplní v EPO po načtení souboru.
   ===================================================================== */
(function (global) {
'use strict';

const LIMIT_KH = 10000;
const r2 = v => { const s = v < 0 ? -1 : 1; return s * Math.round((Math.abs(v) + 1e-9) * 100) / 100; };
const cis = v => { const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : 0; };
const dicCislo = d => String(d || '').replace(/\s/g, '').toUpperCase().replace(/^CZ/, '');
const dicCz = d => /^(CZ)?\d{8,10}$/.test(String(d || '').replace(/\s/g, '').toUpperCase());
const czDatum = iso => { const [y, m, d] = String(iso || '').slice(0, 10).split('-'); return y && m && d ? d + '.' + m + '.' + y : ''; };
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const kz = n => r2(n).toFixed(2);

/* Kódy předmětu plnění pro přenesenou daňovou povinnost v tuzemsku (číselník z pokynů k DPHKH1). */
const PDP_KODY = [['4', '4 – stavební a montážní práce'], ['4a', '4a – stavební a montážní práce, poskytnutí pracovníků'], ['1', '1 – zlato'], ['3', '3 – dodání nemovité věci'],
  ['5', '5 – zboží uvedené v příloze č. 5 (odpad, šrot)'], ['12', '12 – obiloviny a technické plodiny'], ['13', '13 – kovy'], ['14', '14 – mobilní telefony'],
  ['15', '15 – integrované obvody'], ['16', '16 – přenosná zařízení pro zpracování dat'], ['17', '17 – videoherní konzole']];

/* ---------- období ---------- */
/** o = '1'…'12' (měsíc) nebo 'Q1'…'Q4' (čtvrtletí) → první a poslední den období */
function rozsah(rok, o) {
  const q = String(o)[0] === 'Q', m0 = q ? (parseInt(String(o).slice(1), 10) - 1) * 3 : parseInt(o, 10) - 1, n = q ? 3 : 1;
  return { od: iso(new Date(rok, m0, 1)), do: iso(new Date(rok, m0 + n, 0)) };
}
/** Termín podání: 25. den po skončení období; připadne-li na víkend, nejbližší pondělí. */
function termin(rok, o) {
  const q = String(o)[0] === 'Q', m0 = q ? parseInt(String(o).slice(1), 10) * 3 : parseInt(o, 10);
  const d = new Date(rok, m0, 25); while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return iso(d);
}
/** Naposledy skončené období k danému dni. */
function minuleObdobi(ctvrtletne, kdy) {
  const d = kdy || new Date(); let rok = d.getFullYear();
  if (ctvrtletne) { let q = Math.floor(d.getMonth() / 3); if (q === 0) { q = 4; rok--; } return { rok, o: 'Q' + q }; }
  let m = d.getMonth(); if (m === 0) { m = 12; rok--; } return { rok, o: String(m) };
}
const MESICE = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
const nazevObdobi = (rok, o) => (String(o)[0] === 'Q' ? String(o).slice(1) + '. čtvrtletí' : MESICE[parseInt(o, 10) - 1]) + ' ' + rok;

/* ---------- výpočet ---------- */
/** Rozpad položek dokladu po sazbách (stejné zaokrouhlení po řádcích jako u součtů dokladu). */
function poSazbach(polozky, pdp) {
  const o = { z1: 0, d1: 0, z2: 0, d2: 0, z0: 0 };
  (polozky || []).forEach(p => {
    const z = r2(cis(p.mnozstvi) * cis(p.cena)), s = cis(p.dph), k = s === 21 ? 1 : s === 12 ? 2 : 0;
    if (k) { o['z' + k] += z; if (!pdp) o['d' + k] += r2(z * s / 100); } else o.z0 += z;
  });
  Object.keys(o).forEach(k => { o[k] = r2(o[k]); });
  return o;
}
/**
 * vstup: { firma, nast, rok, o, doklady, polozky: {dokladId: [...]}, kontakty }
 * Vrací { A1, A4, A5, C, ch (kontroly: [['err'|'warn', text]]), pocet, zaklad, dan }.
 */
function spocitej(v) {
  const { od, do: dd } = rozsah(v.rok, v.o), F = v.firma || {}, n = v.nast || {}, ch = [];
  const kon = id => (v.kontakty || []).find(k => k.id === id) || {};
  const A1 = [], A4 = [], A5 = { z1: 0, d1: 0, z2: 0, d2: 0 };
  const vsechny = v.doklady || [], maDobropis = id => vsechny.some(x => x.typ === 'dobropis' && x.zdroj_id === id && x.stav !== 'storno');
  const vObdobi = d => { const x = String(d.duzp || d.datum || '').slice(0, 10); return x >= od && x <= dd; };
  // Stornovaná faktura bez dobropisu se nepočítá (nikdy neplatila); s dobropisem jdou do hlášení oba doklady.
  const vyd = vsechny.filter(d => (d.typ === 'faktura' || d.typ === 'dobropis') && vObdobi(d) && (d.stav !== 'storno' || (d.typ === 'faktura' && maDobropis(d.id))))
    .sort((a, b) => String(a.duzp || a.datum).localeCompare(String(b.duzp || b.datum)) || String(a.cislo).localeCompare(String(b.cislo)));
  let zaklad = 0, dan = 0;
  vyd.forEach(d => {
    const k = kon(d.kontakt_id), dic = dicCislo(k.dic), p = poSazbach((v.polozky || {})[d.id], d.pdp);
    const zCelkem = r2(p.z1 + p.z2 + p.z0);
    if (!d.duzp) ch.push(['warn', 'Doklad ' + d.cislo + ' nemá vyplněné DUZP – použilo se datum vystavení.']);
    if (d.pdp) {
      if (!dicCz(k.dic)) ch.push(['err', 'Doklad ' + d.cislo + ' v přenesené daňové povinnosti: odběratel „' + (k.nazev || '?') + '“ nemá české DIČ – přenesení lze uplatnit jen mezi plátci.']);
      A1.push({ id: d.id, c_evid_dd: d.cislo, dic_odb: dic, duzp: String(d.duzp || d.datum).slice(0, 10), kod_pred_pl: (d.udaje && d.udaje.pdp_kod) || '4', zakl_dane1: zCelkem, odb: k.nazev || '' });
      zaklad += zCelkem;
    } else {
      if (p.z0) ch.push(['warn', 'Doklad ' + d.cislo + ' má položky s 0 % DPH – do hlášení nejdou (ověřte, zda jde o osvobozené plnění).']);
      const puv = d.typ === 'dobropis' ? vsechny.find(x => x.id === d.zdroj_id) : null;
      const celk = x => Math.abs(cis(x.celkem_bez) + cis(x.celkem_dph));
      const velikost = puv ? celk(puv) : Math.abs(p.z1 + p.d1 + p.z2 + p.d2);
      if (k.dic && !dicCz(k.dic)) ch.push(['warn', 'Doklad ' + d.cislo + ': DIČ odběratele „' + k.dic + '“ není české – plnění je zahrnuto souhrnně v A.5. Dodání do jiného státu EU se vykazuje jinak.']);
      if (dicCz(k.dic) && velikost > LIMIT_KH) A4.push({ id: d.id, c_evid_dd: d.cislo, dic_odb: dic, dppd: String(d.duzp || d.datum).slice(0, 10), z1: p.z1, d1: p.d1, z2: p.z2, d2: p.d2, odb: k.nazev || '' });
      else ['z1', 'd1', 'z2', 'd2'].forEach(x => { A5[x] += p[x]; });
      zaklad += p.z1 + p.z2; dan += p.d1 + p.d2;
    }
  });
  Object.keys(A5).forEach(k => { A5[k] = r2(A5[k]); });
  const C = { obrat23: r2(A4.reduce((a, x) => a + x.z1, 0) + A5.z1), obrat5: r2(A4.reduce((a, x) => a + x.z2, 0) + A5.z2), pln_rez_pren: r2(A1.reduce((a, x) => a + x.zakl_dane1, 0)),
    rez_pren23: 0, rez_pren5: 0, pln23: 0, pln5: 0 };
  /* kontroly hlavičky */
  const hl = [];
  if (!F.dic) hl.push(['err', 'V Moje firma chybí DIČ.']);
  else if (!/^\d{8,10}$/.test(dicCislo(F.dic))) hl.push(['err', 'DIČ firmy „' + F.dic + '“ nemá tvar CZ + 8–10 číslic.']);
  if (!/^\d{3}$/.test(n.ufo || '')) hl.push(['err', 'Doplňte kód finančního úřadu (3 číslice) v Údajích pro podání.']);
  if (!/^\d{4}$/.test(n.pracufo || '')) hl.push(['err', 'Doplňte kód územního pracoviště (4 číslice) v Údajích pro podání.']);
  if ((n.typ || 'F') === 'F' && !String(n.prijmeni || '').trim()) hl.push(['err', 'U fyzické osoby doplňte jméno a příjmení v Údajích pro podání.']);
  if (String(v.o)[0] === 'Q' && n.typ === 'P') hl.push(['err', 'Právnická osoba podává kontrolní hlášení vždy měsíčně – vyberte měsíc.']);
  const dup = {}; A1.forEach(x => { const k = x.c_evid_dd + '|' + x.kod_pred_pl; if (dup[k]) ch.push(['err', 'A.1: doklad ' + x.c_evid_dd + ' je uveden dvakrát se stejným kódem.']); dup[k] = 1; });
  if (vsechny.some(d => d.typ === 'zalohova' && vObdobi(d) && d.stav === 'zaplaceno')) ch.push(['warn', 'V období je zaplacená zálohová faktura. Zálohová faktura není daňový doklad – k přijaté platbě se vystavuje daňový doklad a ten do hlášení patří.']);
  return { A1, A4, A5, C, ch: hl.concat(ch), pocet: vyd.length, zaklad: r2(zaklad), dan: r2(dan), od, do: dd };
}

/* ---------- XML pro EPO ---------- */
const xa = o => Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => k + '="' + String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') + '"').join(' ');
function adresa(F) {
  const m = String(F.ulice || '').trim().match(/^(.*?)\s*(\d+)(?:\/(\w+))?$/);
  return { ulice: m ? m[1] : (F.ulice || ''), c_pop: m ? m[2] : '', c_orient: m && m[3] ? m[3] : '', naz_obce: F.mesto || '', psc: String(F.psc || '').replace(/\s/g, ''), stat: 'ČESKÁ REPUBLIKA' };
}
/** forma: 'B' řádné, 'O' opravné, 'N' následné */
function xml(v, vysl, forma, kdy) {
  const F = v.firma || {}, n = v.nast || {}, dnes = czDatum(iso(kdy || new Date())), fo = (n.typ || 'F') === 'F', L = [];
  const D = Object.assign({ dokument: 'KH1', k_uladis: 'DPH', khdph_forma: forma || 'B', rok: v.rok }, String(v.o)[0] === 'Q' ? { ctvrt: String(v.o).slice(1) } : { mesic: String(v.o) }, { d_poddp: dnes });
  if (forma === 'N') D.d_zjist = dnes;
  L.push('<VetaD ' + xa(D) + '/>');
  L.push('<VetaP ' + xa(Object.assign({ dic: dicCislo(F.dic), typ_ds: fo ? 'F' : 'P', c_ufo: n.ufo, c_pracufo: n.pracufo },
    fo ? { jmeno: n.jmeno, prijmeni: n.prijmeni, titul: n.titul } : { zkrobchjm: F.nazev, opr_jmeno: n.oprJmeno, opr_prijmeni: n.oprPrijmeni, opr_postaveni: n.oprPost },
    adresa(F), { c_telef: n.tel || F.telefon || '', email: n.email || F.email || '' })) + '/>');
  let i = 0; vysl.A1.forEach(x => L.push('<VetaA1 ' + xa({ c_radku: ++i, dic_odb: x.dic_odb, c_evid_dd: x.c_evid_dd, duzp: czDatum(x.duzp), zakl_dane1: kz(x.zakl_dane1), kod_pred_pl: x.kod_pred_pl }) + '/>'));
  i = 0; vysl.A4.forEach(x => L.push('<VetaA4 ' + xa({ c_radku: ++i, dic_odb: x.dic_odb, c_evid_dd: x.c_evid_dd, dppd: czDatum(x.dppd), zakl_dane1: kz(x.z1), dan1: kz(x.d1), zakl_dane2: kz(x.z2), dan2: kz(x.d2), kod_rezim_pl: '0', zdph_44: 'N' }) + '/>'));
  if (vysl.A5.z1 || vysl.A5.z2) L.push('<VetaA5 ' + xa({ zakl_dane1: kz(vysl.A5.z1), dan1: kz(vysl.A5.d1), zakl_dane2: kz(vysl.A5.z2), dan2: kz(vysl.A5.d2) }) + '/>');
  L.push('<VetaC ' + xa(Object.fromEntries(Object.entries(vysl.C).map(([k, x]) => [k, kz(x)]))) + '/>');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<Pisemnost nazevSW="YeY Kancelar" verzeSW="2.0">\n<DPHKH1 verzePis="03.01">\n' + L.join('\n') + '\n</DPHKH1>\n</Pisemnost>\n';
}
const soubor = (F, rok, o) => 'DPHKH1_' + dicCislo(F.dic) + '_' + rok + '-' + (String(o)[0] === 'Q' ? o : String(o).padStart(2, '0')) + '.xml';

/* =====================================================================
   JMENINY – český občanský kalendář. Položka začínající „!“ je den bez jména (státní svátek),
   „Jméno|Svátek“ je jméno i státní svátek ve stejný den.
   ===================================================================== */
const JMENINY = [
  '!Nový rok,Karina,Radmila,Diana,Dalimil,!Tři králové,Vilma,Čestmír,Vladan,Břetislav,Bohdana,Pravoslav,Edita,Radovan,Alice,Ctirad,Drahoslav,Vladislav,Doubravka,Ilona,Běla,Slavomír,Zdeněk,Milena,Miloš,Zora,Ingrid,Otýlie,Zdislava,Robin,Marika',
  'Hynek,Nela,Blažej,Jarmila,Dobromila,Vanda,Veronika,Milada,Apolena,Mojmír,Božena,Slavěna,Věnceslav,Valentýn,Jiřina,Ljuba,Miloslava,Gizela,Patrik,Oldřich,Lenka,Petr,Svatopluk,Matěj,Liliana,Dorota,Alexandr,Lumír,Horymír',
  'Bedřich,Anežka,Kamil,Stela,Kazimír,Miroslav,Tomáš,Gabriela,Františka,Viktorie,Anděla,Řehoř,Růžena,Rút a Matylda,Ida,Elena a Herbert,Vlastimil,Eduard,Josef,Světlana,Radek,Leona,Ivona,Gabriel,Marián,Emanuel,Dita,Soňa,Taťána,Arnošt,Kvido',
  'Hugo,Erika,Richard,Ivana,Miroslava,Vendula,Heřman a Hermína,Ema,Dušan,Darja,Izabela,Julius,Aleš,Vincenc,Anastázie,Irena,Rudolf,Valérie,Rostislav,Marcela,Alexandra,Evženie,Vojtěch,Jiří,Marek,Oto,Jaroslav,Vlastislav,Robert,Blahoslav',
  '!Svátek práce,Zikmund,Alexej,Květoslav,Klaudie,Radoslav,Stanislav,!Den vítězství,Ctibor,Blažena,Svatava,Pankrác,Servác,Bonifác,Žofie,Přemysl,Aneta,Nataša,Ivo,Zbyšek,Monika,Emil,Vladimír,Jana,Viola,Filip,Valdemar,Vilém,Maxmilián,Ferdinand,Kamila',
  'Laura,Jarmil,Tamara,Dalibor,Dobroslav,Norbert,Iveta a Slavoj,Medard,Stanislava,Gita,Bruno,Antonie,Antonín,Roland,Vít,Zbyněk,Adolf,Milan,Leoš,Květa,Alois,Pavla,Zdeňka,Jan,Ivan,Adriana,Ladislav,Lubomír,Petr a Pavel,Šárka',
  'Jaroslava,Patricie,Radomír,Prokop,!Den slovanských věrozvěstů Cyrila a Metoděje,!Den upálení mistra Jana Husa,Bohuslava,Nora,Drahoslava,Libuše a Amálie,Olga,Bořek,Markéta,Karolína,Jindřich,Luboš,Martina,Drahomíra,Čeněk,Ilja,Vítězslav,Magdaléna,Libor,Kristýna,Jakub,Anna,Věroslav,Viktor,Marta,Bořivoj,Ignác',
  'Oskar,Gustav,Miluše,Dominik,Kristián,Oldřiška,Lada,Soběslav,Roman,Vavřinec,Zuzana,Klára,Alena,Alan,Hana,Jáchym,Petra,Helena,Ludvík,Bernard,Johana,Bohuslav,Sandra,Bartoloměj,Radim,Luděk,Otakar,Augustýn,Evelína,Vladěna,Pavlína',
  'Linda a Samuel,Adéla,Bronislav,Jindřiška,Boris,Boleslav,Regína,Mariana,Daniela,Irma,Denisa,Marie,Lubor,Radka,Jolana,Ludmila,Naděžda,Kryštof,Zita,Oleg,Matouš,Darina,Berta,Jaromír,Zlata,Andrea,Jonáš,Václav|Den české státnosti,Michal,Jeroným',
  'Igor,Olívie a Oliver,Bohumil,František,Eliška,Hanuš,Justýna,Věra,Štefan a Sára,Marina,Andrej,Marcel,Renáta,Agáta,Tereza,Havel,Hedvika,Lukáš,Michaela,Vendelín,Brigita,Sabina,Teodor,Nina,Beáta,Erik,Šarlota a Zoe,!Den vzniku samostatného československého státu,Silvie,Tadeáš,Štěpánka',
  'Felix,Tobiáš,Hubert,Karel,Miriam,Liběna,Saskie,Bohumír,Bohdan,Evžen,Martin,Benedikt,Tibor,Sáva,Leopold,Otmar,Mahulena|Den boje za svobodu a demokracii,Romana,Alžběta,Nikola,Albert,Cecílie,Klement,Emílie,Kateřina,Artur,Xenie,René,Zina,Ondřej',
  'Iva,Blanka,Svatoslav,Barbora,Jitka,Mikuláš,Ambrož a Benjamín,Květoslava,Vratislav,Julie,Dana,Simona,Lucie,Lýdie,Radana,Albína,Daniel,Miloslav,Ester,Dagmar,Natálie,Šimon,Vlasta,Adam a Eva|Štědrý den,!1. svátek vánoční,Štěpán|2. svátek vánoční,Žaneta,Bohumila,Judita,David,Silvestr'
].map(m => m.split(','));
/** { jmeno: 'Martin' | '', svatek: 'Štědrý den' | '' } pro daný den */
function jmeniny(d) {
  d = d || new Date(); const t = (JMENINY[d.getMonth()] || [])[d.getDate() - 1] || '';
  if (t[0] === '!') return { jmeno: '', svatek: t.slice(1) };
  const [jmeno, svatek] = t.split('|'); return { jmeno: jmeno || '', svatek: svatek || '' };
}

global.YeyUcto = { PDP_KODY, LIMIT_KH, rozsah, termin, minuleObdobi, nazevObdobi, MESICE, spocitej, xml, soubor, jmeniny, czDatum, dicCz, _test: { JMENINY, poSazbach } };
})(typeof window !== 'undefined' ? window : globalThis);
