/* YeY – přepínač jazyka rozhraní (cs / uk / en). Převzato z původní verze YeY (yey.html), slovníky lang/<kód>.js jsou společné.
   Text aplikace je česky; ostatní jazyky se doplňují za běhu ze slovníku lang/<kód>.js.
   Překládá se jen to, co slovník zná – ostatní zůstává česky. Doklady (.doc, náhled .nahled) zůstávají vždy česky.
   Slovníky: lang/<kód>.js (kalkulačky a texty společné s původní verzí) + lang/<kód>-app.js (texty této aplikace). */
(function () {
  'use strict';
  var LS = 'yey_lang', LANGS = ['cs', 'uk', 'en'];
  var NUM = /\d+(?:[  ]\d{3})*(?:,\d+)?/g;
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  var SKIP = 'script,style,textarea,code,pre,[translate="no"],[contenteditable="true"],.doc,.papir,.nahled,#printArea,#jazyk';
  var NOFRAG = 'td,th,option,.kk-r-nazev,.kk-p-nazev';
  var D = {}, cache = {}, FR = {}, cur = 'cs';

  function stored() { try { return localStorage.getItem(LS); } catch (e) { return null; } }
  function detect() {
    var n = String((navigator.languages && navigator.languages[0]) || navigator.language || 'cs').toLowerCase().slice(0, 2);
    return LANGS.indexOf(n) > 0 ? n : 'cs';
  }
  var s = stored();
  cur = LANGS.indexOf(s) >= 0 ? s : detect();
  var api = window.YeyI18n = {
    lang: cur,
    reg: function (l, d) { D[l] = Object.assign(D[l] || {}, d); cache[l] = {}; delete FR[l]; },   // více slovníků se slučuje (lang/xx.js + lang/xx-dane.js)
    t: function (x) { return cur === 'cs' ? x : trStr(x); },
    set: function (l) {
      if (LANGS.indexOf(l) < 0) return;
      try { localStorage.setItem(LS, l); } catch (e) {}
      try { if (typeof dirty !== 'undefined' && dirty && typeof saveNow === 'function') saveNow(); } catch (e) {}
      setTimeout(function () { location.reload(); }, 150);
    }
  };
  document.documentElement.lang = cur;
  if (cur === 'cs') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindSelect); else bindSelect();
    return;
  }
  document.write('<script src="lang/' + cur + '.js"><\/script><script src="lang/' + cur + '-app.js"><\/script>');

  /* ---------- překlad řetězce ---------- */
  function fmtNum(n) {
    if (cur !== 'en') return n;
    var m = n.match(/^(\d+(?:[  ]\d{3})*)(?:,(\d+))?$/);
    return m ? m[1].replace(/[  ]/g, ',') + (m[2] ? '.' + m[2] : '') : n;
  }
  function fill(t, nums) { var i = 0; return t.replace(/#/g, function () { var n = nums[i++]; return n == null ? '#' : fmtNum(n); }); }
  var RULES = {
    uk: [['Шукати в асортименті ', 'Завантажую асортимент {X} і перевіряю наявність…', 'В асортименті «{X}» нічого для «{Q}».']],
    ru: [['Искать в ассортименте ', 'Загружаю ассортимент {X} и проверяю наличие…', 'В ассортименте «{X}» ничего для «{Q}».']],
    en: [['Search the range ', 'Loading the range {X} and checking stock…', 'In the range “{X}” nothing for “{Q}”.']]
  };
  function rule(core, d) {
    var r = RULES[cur], m;
    if (!r) return null;
    if ((m = core.match(/^Hledat v sortimentu (.+)$/))) return r[0][0] + (d[m[1]] || m[1]);
    if ((m = core.match(/^Načítám sortiment (.+) a zjišťuji zásoby…$/))) return r[0][1].replace('{X}', d[m[1]] || m[1]);
    if ((m = core.match(/^V sortimentu [„"](.+?)[“"] nic pro [„"](.*?)[“"]\.?$/))) return r[0][2].replace('{X}', d[m[1]] || m[1]).replace('{Q}', m[2]);
    return null;
  }
  function frag(core, d) {
    if (core.length > 800) return null;
    var list = FR[cur];
    if (!list) {
      list = FR[cur] = Object.keys(d).filter(function (k) { return k.length >= 8 && k.indexOf('#') < 0; }).sort(function (a, b) { return b.length - a.length; });
    }
    var out = core, hit = false, i, k, p, a, b;
    for (i = 0; i < list.length; i++) {
      k = list[i]; p = out.indexOf(k);
      while (p >= 0) {
        a = out.charAt(p - 1); b = out.charAt(p + k.length);
        if (!/[A-Za-zÀ-žА-яІіЇїЄє]/.test(a) && !/[A-Za-zÀ-žА-яІіЇїЄє]/.test(b)) { out = out.slice(0, p) + d[k] + out.slice(p + k.length); hit = true; p = out.indexOf(k, p + d[k].length); }
        else p = out.indexOf(k, p + 1);
      }
    }
    return hit ? out : null;
  }
  function find(core, d, allowFrag) {
    var ck = (allowFrag ? 'f|' : 'n|') + core, c = cache[cur];
    if (ck in c) return c[ck];
    var r = null, nums;
    if (Object.prototype.hasOwnProperty.call(d, core)) r = d[core];
    else {
      nums = core.match(NUM);
      if (nums) {
        var k = core.replace(NUM, '#');
        if (Object.prototype.hasOwnProperty.call(d, k)) r = fill(d[k], nums);
        else {
          k = k.replace(/# (jízdy|jízd)\b/, '# jízda');           // „2 jízdy“ → šablona s „jízda“
          if (Object.prototype.hasOwnProperty.call(d, k)) r = fill(d[k], nums);
        }
      }
      if (r == null) r = rule(core, d);
      if (r == null && allowFrag) r = frag(core, d);
    }
    c[ck] = r;
    return r;
  }
  function trStr(x, allowFrag) {
    var d = D[cur];
    if (!d || typeof x !== 'string') return x;
    var m = x.match(/^(\s*)([\s\S]*?)(\s*)$/), core = m[2].replace(/\s+/g, ' ');
    if (!core) return x;
    var r = find(core, d, allowFrag !== false);
    return r == null ? x : m[1] + r + m[3];
  }

  /* ---------- procházení DOM ---------- */
  function skipEl(el, sel) { return !!(el && el.closest && el.closest(sel)); }
  function txt(n) {
    var v = n.nodeValue;
    if (n.__yt === v || !v || !/\S/.test(v)) return;
    var p = n.parentNode;
    if (p && p.nodeType === 1 && skipEl(p, SKIP)) return;
    var t = trStr(v, !skipEl(p, NOFRAG));
    if (t !== v) { n.__yt = t; n.nodeValue = t; }
  }
  function attr(el, a) {
    var v = el.getAttribute(a);
    if (!v || (el.__ya && el.__ya[a] === v) || skipEl(el, SKIP)) return;
    var t = trStr(v, !skipEl(el, NOFRAG));
    if (t !== v) { (el.__ya = el.__ya || {})[a] = t; el.setAttribute(a, t); }
  }
  function walk(n) {
    if (n.nodeType === 3) return txt(n);
    if (n.nodeType !== 1 || /^(SCRIPT|STYLE|TEXTAREA)$/.test(n.nodeName)) return;
    if (n.matches && n.matches(SKIP)) return;
    for (var i = 0; i < ATTRS.length; i++) if (n.hasAttribute(ATTRS[i])) attr(n, ATTRS[i]);
    for (var c = n.firstChild; c; c = c.nextSibling) walk(c);
  }
  function start() {
    if (!D[cur]) return;
    document.title = trStr(document.title, false);
    walk(document.documentElement);
    new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        if (m.type === 'childList') { for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]); }
        else if (m.type === 'characterData') txt(m.target);
        else if (m.type === 'attributes') attr(m.target, m.attributeName);
      }
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  var oa = window.alert, oc = window.confirm;
  window.alert = function (m) { return oa.call(window, trStr(String(m))); };
  window.confirm = function (m) { return oc.call(window, trStr(String(m))); };

  /* ---------- přepínač v hlavičce ---------- */
  function bindSelect() {
    var el = document.getElementById('jazyk');
    if (!el) return;
    el.value = cur;
    el.addEventListener('change', function () { api.set(el.value); });
  }
  function ready() { bindSelect(); start(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
})();
