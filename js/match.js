// Eingabe-Abgleich: Schreibweisen normalisieren, Städte und Gemeinden nachschlagen, Tippfehler erkennen.

// Füllwörter, die beim Vergleich wegfallen dürfen („Frankfurt am Main“ = „Frankfurt Main“)
const FILLER = new Set(['an', 'am', 'im', 'in', 'der', 'die', 'dem', 'den', 'bei', 'auf', 'vor', 'zu', 'a', 'd', 'i', 'b', 'v']);
const QUALIFIER = /\s+(?:an der|am|im|in der|in|ob der|bei|auf dem|auf|vor der|unter|zu|a\.d\.|a\.|i\.d\.|i\.|b\.|v\.d\.)(?:\s+|(?=[A-ZÄÖÜ]))/;
// Amtliche Abkürzungen, die Leute meist ausschreiben
const EXPAND = [
  [/Westf\./g, 'Westfalen'], [/Rhld\./g, 'Rheinland'], [/Vogtl\./g, 'Vogtland'], [/Erzgeb\./g, 'Erzgebirge'],
  [/\/Sa\./g, '/Sachsen'], [/O\.L\./g, 'Oberlausitz'], [/\(Oldb\)/g, '(Oldenburg)'], [/Thür\./g, 'Thüringen'],
  [/Sächs\.\s?Schw\./g, 'Sächsische Schweiz'],
];

function fold(s, umlautAsE) {
  s = String(s).toLowerCase().trim();
  if (umlautAsE) s = s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue');
  s = s.replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/\bsankt\b/g, 'st').replace(/\bst\./g, 'st ');
  return s;
}

const plainKey = (name, e = true) => fold(name, e).replace(/[^a-z0-9]/g, '');
const compactKey = (name, e = true) => fold(name, e).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(w => !FILLER.has(w)).join('');

/** Hauptschlüssel für Tippfehler-Vergleich. */
export function mainKey(name) { return plainKey(name, true); }

/** Name ohne Zusatz: „Halle (Saale)“ → „Halle“, „Frankfurt am Main“ → „Frankfurt“. */
export function shortName(name) {
  let s = String(name).split(/\s*\(|\//)[0];
  s = s.split(QUALIFIER)[0];
  return s.trim();
}

function variants(name) {
  const out = new Set([name]);
  let x = name;
  for (const [re, rep] of EXPAND) x = x.replace(re, rep);
  out.add(x);
  return out;
}

// Damerau-Levenshtein mit Abbruch, sobald die Grenze sicher überschritten ist
function distance(a, b, max) {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev2 = null, prev = new Array(lb + 1), cur = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i; let rowMin = cur[0];
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v; if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev; prev = cur; cur = new Array(lb + 1);
  }
  return prev[lb];
}

function put(map, key, id) {
  if (!key) return;
  let set = map.get(key);
  if (!set) map.set(key, set = new Set());
  set.add(id);
}

export class Matcher {
  /**
   * @param {Array} places  [{n, b?, a?, p}] – Städte und Gemeinden
   */
  constructor(places) {
    this.places = places;
    this.exact = new Map();   // voller Name oder Kurzname, Umlaut als ae/oe/ue
    this.loose = new Map();   // Umlaut ohne e („Munchen“), nur als Rückfall
    this.shortKey = [];
    this.fuzzy = [];
    places.forEach((c, id) => {
      const short = c.b || shortName(c.n);
      const fullNames = new Set();
      const shortNames = new Set([short]);
      for (const n of [c.n, ...(c.a || [])]) {
        // Ein Alias, der nur der Kurzname ist („Neustadt“), ist mehrdeutig und zählt als Kurzname
        if (n !== c.n && plainKey(n) === plainKey(short)) { shortNames.add(n); continue; }
        for (const v of variants(n)) fullNames.add(v);
      }
      for (const a of c.a || []) shortNames.add(shortName(a));
      for (const n of fullNames) {
        put(this.exact, plainKey(n), id); put(this.exact, compactKey(n), id);
        put(this.loose, plainKey(n, false), id); put(this.loose, compactKey(n, false), id);
      }
      for (const n of shortNames) {
        put(this.exact, plainKey(n), id);
        put(this.loose, plainKey(n, false), id);
      }
      this.shortKey[id] = plainKey(short);
      this.fuzzy.push([plainKey(c.n), id]);
      if (plainKey(short) !== plainKey(c.n)) this.fuzzy.push([plainKey(short), id]);
    });
    this.byShort = new Map();
    this.shortKey.forEach((k, id) => {
      if (!this.byShort.has(k)) this.byShort.set(k, []);
      this.byShort.get(k).push(id);
    });
  }

  lookup(map, keys) {
    const ids = new Set();
    for (const k of keys) { const s = map.get(k); if (s) for (const id of s) ids.add(id); }
    return [...ids].sort((x, y) => this.places[y].p - this.places[x].p);
  }

  /**
   * Prüft eine Eingabe.
   * @returns {{type:'found', id, others:number, short:string}
   *          |{type:'dupe', id}
   *          |{type:'unknown', suggestion?:number, suggestionFound?:boolean}
   *          |{type:'empty'}}
   */
  check(input, isFound) {
    const raw = String(input || '').trim();
    if (!raw || !plainKey(raw)) return { type: 'empty' };
    const eKeys = [plainKey(raw), compactKey(raw)];
    let ids = this.lookup(this.exact, eKeys);
    // Umlaute ohne e („Munchen“) nur, wenn sonst nichts passt
    if (!ids.length) ids = this.lookup(this.loose, [plainKey(raw, false), compactKey(raw, false)]);
    if (ids.length) {
      // Bei gleichen Namen zuerst der größte noch fehlende Ort
      const open = ids.filter(id => !isFound(id));
      if (!open.length) return { type: 'dupe', id: ids[0] };
      const id = open[0];
      return { type: 'found', id, others: open.length - 1, short: this.places[id].b || shortName(this.places[id].n) };
    }
    // Tippfehler: nächste Schreibweise suchen
    const key = eKeys[0];
    const max = key.length >= 9 ? 2 : key.length >= 5 ? 1 : 0;
    if (max > 0) {
      let best = null, bestKey = '', bestD = max + 1;
      for (const [k, id] of this.fuzzy) {
        const d = distance(key, k, max);
        if (d < bestD || (d === bestD && best !== null && this.preferOver(id, best, isFound))) { bestD = d; best = id; bestKey = k; }
      }
      if (best !== null && bestD <= max) {
        let pick = best;
        // Tippfehler im Kurznamen („Neustadtt“): größten noch fehlenden Ort dieses Namens vorschlagen
        if (bestKey === this.shortKey[best]) {
          const open = (this.byShort.get(bestKey) || []).filter(id => !isFound(id));
          if (open.length) pick = open.sort((x, y) => this.places[y].p - this.places[x].p)[0];
        }
        return { type: 'unknown', suggestion: pick, suggestionFound: isFound(pick) };
      }
    }
    return { type: 'unknown' };
  }

  preferOver(a, b, isFound) {
    const fa = isFound(a), fb = isFound(b);
    if (fa !== fb) return !fa;
    return this.places[a].p > this.places[b].p;
  }
}
