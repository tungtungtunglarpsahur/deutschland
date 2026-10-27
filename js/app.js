// Stadtlichter – App-Logik: Eingabe, Spielstand, Liste, Ortsschild und Infokarte.
import { buildGeometry, bboxOfPolygons } from './geo.js';
import { Matcher } from './match.js';
import { MapView } from './map.js';

const STATES = ['Schleswig-Holstein', 'Hamburg', 'Niedersachsen', 'Bremen', 'Nordrhein-Westfalen', 'Hessen', 'Rheinland-Pfalz', 'Baden-Württemberg', 'Bayern', 'Saarland', 'Berlin', 'Brandenburg', 'Mecklenburg-Vorpommern', 'Sachsen', 'Sachsen-Anhalt', 'Thüringen'];
const ABBR = ['SH', 'HH', 'NI', 'HB', 'NW', 'HE', 'RP', 'BW', 'BY', 'SL', 'BE', 'BB', 'MV', 'SN', 'ST', 'TH'];
const STORE = 'stadtlichter:v1';
const HESSEN_KREIS = new Set(['Bergstraße', 'Groß-Gerau', 'Offenbach']);
const nf = new Intl.NumberFormat('de-DE');
const pf = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const el = {};
let places = [], townTotal = 0, matcher = null, map = null, geo = null;
const found = [];            // [{id, t}] in Fundreihenfolge
const foundSet = new Set();
let foundTowns = 0, foundPop = 0;
let sortMode = 'new', showMissing = false, selected = -1, sign = null;
let stateBoxes = [], stateTotals = [], stateFound = [];
let saveKeys = [], nameCount = new Map();

/* ---------- Daten ---------- */
// Zeile: [Name, Land, Einwohner, x, y, Kreis, Merkmale, andere Schreibweisen | 0, Kurzname | 0]
function toPlace(r) {
  return { n: r[0], s: r[1], p: r[2], x: r[3], y: r[4], k: r[5], t: !!(r[6] & 1), kf: !!(r[6] & 2), gf: !!(r[6] & 4), a: r[7] || undefined, b: r[8] || undefined };
}

function getMatcher() {
  if (!matcher) matcher = new Matcher(places);
  return matcher;
}

/* ---------- Hilfen ---------- */
function expandAbbr(n) {
  return n
    .replace(/ i\.d\.OPf\./g, ' in der Oberpfalz').replace(/ i\.Fichtelgebirge/g, ' im Fichtelgebirge')
    .replace(/ a\.d\./g, ' an der ').replace(/ a\./g, ' am ').replace(/ b\./g, ' bei ').replace(/ v\.d\./g, ' vor der ')
    .replace(/\s+/g, ' ').trim();
}

function kreisLabel(c) {
  if (!c.k) {
    if (c.s === 10 || c.s === 1) return 'Stadtstaat';
    if (c.s === 3) return 'Land Bremen';
    return c.s === 7 ? 'Stadtkreis' : 'Kreisfreie Stadt';
  }
  const k = expandAbbr(c.k);
  if (/kreis|Region|Regionalverband/i.test(k)) return k;
  if (c.s === 0 || c.s === 4 || (c.s === 5 && HESSEN_KREIS.has(k))) return 'Kreis ' + k;
  return 'Landkreis ' + k;
}

const kind = c => c.t ? 'Stadt' : c.gf ? 'Gemeindefreier Bezirk' : 'Gemeinde';

function describe(c) {
  if (c.s === 10 || c.s === 1) return 'Stadtstaat';
  if (c.s === 3) return 'Kreisfreie Stadt, Land Bremen';
  if (!c.k) return `${kreisLabel(c)}, ${STATES[c.s]}`;
  return `${kind(c)}, ${kreisLabel(c)}, ${STATES[c.s]}`;
}

// Name mit Kreis, wenn es den Namen mehrfach gibt
const nameWithKreis = c => nameCount.get(c.n) > 1 ? `${c.n} (${kreisLabel(c)})` : c.n;

function formatPop(p) {
  return p >= 1e6 ? pf.format(p / 1e6) + ' Mio.' : nf.format(p);
}

/* ---------- Speichern ---------- */
// Städte: „Name|Land“ (wie in Version 1), Gemeinden: „g|Name|Land|Kreis“
function buildKeys() {
  const seen = new Map();
  saveKeys = places.map(c => {
    let k = c.t ? `${c.n}|${c.s}` : `g|${c.n}|${c.s}|${c.k}`;
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    return n > 1 ? `${k}#${n}` : k;
  });
}

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({ v: 1, f: found.map(f => [saveKeys[f.id], f.t]), sort: sortMode }));
  } catch (e) { /* Speicher nicht verfügbar */ }
}

function restore() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { data = null; }
  if (!data || data.v !== 1) return;
  const byKey = new Map(saveKeys.map((k, i) => [k, i]));
  for (const [k, t] of data.f || []) {
    const id = byKey.get(k);
    if (id !== undefined && !foundSet.has(id)) { found.push({ id, t }); foundSet.add(id); }
  }
  if (['new', 'az', 'pop'].includes(data.sort)) sortMode = data.sort;
}

/* ---------- Zählen ---------- */
function recount() {
  foundTowns = 0; foundPop = 0;
  stateFound = Array.from({ length: 16 }, () => ({ all: 0, towns: 0 }));
  for (const f of found) count(f.id);
}

function count(id) {
  const c = places[id];
  foundPop += c.p;
  stateFound[c.s].all++;
  if (c.t) { foundTowns++; stateFound[c.s].towns++; }
}

/* ---------- Anzeige ---------- */
const pct = (a, b) => (b ? (a / b) * 100 : 0).toFixed(2) + '%';

function updateScore() {
  const n = found.length, total = places.length;
  el.count.textContent = nf.format(n);
  el.total.textContent = nf.format(total);
  el.tabCount.textContent = nf.format(n);
  el.barTown.style.width = pct(foundTowns, total);
  el.barGem.style.width = pct(n - foundTowns, total);
  el.progress.setAttribute('aria-valuenow', String(n));
  el.progress.setAttribute('aria-valuemax', String(total));
  el.progress.setAttribute('aria-valuetext', `${nf.format(n)} von ${nf.format(total)} Gemeinden, davon ${nf.format(foundTowns)} von ${nf.format(townTotal)} Städten`);
  el.towns.textContent = nf.format(foundTowns);
  el.townTotal.textContent = nf.format(townTotal);
  el.pop.textContent = formatPop(foundPop) + ' Einwohner';
}

function rowFor(id) {
  const c = places[id];
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'row';
  b.dataset.id = id;
  const sub = nameCount.get(c.n) > 1 ? ` <span class="row-sub">${esc(kreisLabel(c))}</span>` : '';
  b.innerHTML = `<span class="mark${c.t ? ' mark-town' : ''}" aria-hidden="true"></span><span class="row-name">${esc(c.n)}${sub}</span><span class="badge" title="${esc(STATES[c.s])}">${ABBR[c.s]}</span><span class="row-pop">${nf.format(c.p)}</span>`;
  b.setAttribute('aria-label', `${kind(c)} ${nameWithKreis(c)}, ${STATES[c.s]}, ${nf.format(c.p)} Einwohner`);
  li.appendChild(b);
  return li;
}

function renderList() {
  const ids = found.map(f => f.id);
  if (sortMode === 'new') ids.reverse();
  else if (sortMode === 'az') ids.sort((a, b) => places[a].n.localeCompare(places[b].n, 'de'));
  else ids.sort((a, b) => places[b].p - places[a].p);
  const frag = document.createDocumentFragment();
  for (const id of ids) frag.appendChild(rowFor(id));
  el.list.replaceChildren(frag);
  el.empty.hidden = ids.length > 0;
  el.sort.value = sortMode;
}

function addRow(id) {
  el.empty.hidden = true;
  if (sortMode !== 'new') renderList();
  else el.list.prepend(rowFor(id));
  flashRow(id, sortMode === 'new');
}

function flashRow(id, scrollTop) {
  const row = el.list.querySelector(`.row[data-id="${id}"]`);
  if (!row) return;
  row.classList.remove('flash');
  void row.offsetWidth;
  row.classList.add('flash');
  if (scrollTop) el.listScroll.scrollTo({ top: 0, behavior: 'smooth' });
  else row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function renderStates() {
  const order = STATES.map((n, i) => i).sort((a, b) => STATES[a].localeCompare(STATES[b], 'de'));
  const frag = document.createDocumentFragment();
  for (const s of order) {
    const tot = stateTotals[s], got = stateFound[s];
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'row state-row';
    b.dataset.state = s;
    const towns = tot.all === tot.towns ? '' : `<span class="row-sub">davon Städte ${nf.format(got.towns)} / ${nf.format(tot.towns)}</span>`;
    b.innerHTML = `<span class="row-name">${esc(STATES[s])}</span><span class="row-pop">${nf.format(got.all)} / ${nf.format(tot.all)}</span>`
      + `<span class="bar"><span class="bar-town" style="width:${pct(got.towns, tot.all)}"></span><span class="bar-gem" style="width:${pct(got.all - got.towns, tot.all)}"></span></span>${towns}`;
    li.appendChild(b);
    frag.appendChild(li);
  }
  el.states.replaceChildren(frag);
}

function say(html, cls = '') {
  el.feedback.className = 'feedback ' + cls;
  el.feedback.innerHTML = html;
}

/* ---------- Ortsschild und Karte ---------- */
function showSign(id) {
  if (sign) sign.el.remove();
  const c = places[id];
  const node = document.createElement('div');
  node.className = 'sign pop';
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML = `<span class="sign-anim"><span class="sign-box"><span class="sign-inner"><span class="sign-name">${esc(c.n)}</span><span class="sign-kreis">${esc(kreisLabel(c))}</span></span></span><span class="sign-post"></span></span>`;
  el.overlay.appendChild(node);
  sign = { el: node, id, w: node.offsetWidth, h: node.offsetHeight };
  positionOverlays();
  const mine = sign;
  setTimeout(() => { if (sign === mine) { node.remove(); sign = null; } }, 3200);
}

function openCard(id) {
  if (sign) { sign.el.remove(); sign = null; }
  selected = id;
  map.select(id);
  const c = places[id];
  el.cardName.textContent = c.n;
  el.cardMeta.textContent = describe(c);
  el.cardPop.textContent = `${nf.format(c.p)} Einwohner`;
  el.cardMissing.hidden = foundSet.has(id);
  el.card.hidden = false;
  el.card.dataset.w = el.card.offsetWidth;
  el.card.dataset.h = el.card.offsetHeight;
  positionOverlays();
}

function closeCard() {
  selected = -1;
  if (map) map.select(-1);
  el.card.hidden = true;
}

function positionOverlays() {
  if (!map) return;
  const W = map.W, H = map.H, m = 10;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  if (sign) {
    const c = places[sign.id];
    const [x, y] = map.toScreen(c.x, c.y);
    const sx = clamp(x, sign.w / 2 + m, W - sign.w / 2 - m);
    const sy = clamp(y - 3, sign.h + m, H - m);
    sign.el.style.transform = `translate(${(sx - sign.w / 2).toFixed(1)}px, ${(sy - sign.h).toFixed(1)}px)`;
  }
  if (!el.card.hidden && selected >= 0) {
    const c = places[selected];
    const [x, y] = map.toScreen(c.x, c.y);
    const w = +el.card.dataset.w || 220, h = +el.card.dataset.h || 100;
    const cx = clamp(x - w / 2, m, W - w - m);
    let cy = y - h - 18;
    if (cy < m + 50) cy = y + 18;
    cy = clamp(cy, m, H - h - m);
    el.card.style.transform = `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px)`;
  }
}

/* ---------- Spiel ---------- */
function addPlace(id) {
  if (foundSet.has(id)) return;
  found.push({ id, t: Date.now() });
  foundSet.add(id);
  count(id);
  map.addFound(id);
  updateScore();
  addRow(id);
  renderStates();
  save();
  showSign(id);
  if (selected >= 0 && selected !== id) closeCard();
}

function foundMessage(id, others = 0, short = '') {
  const c = places[id];
  if (found.length === places.length) return `<b>Alle ${nf.format(places.length)} Gemeinden gefunden.</b> Deutschland leuchtet.`;
  if (c.t && foundTowns === townTotal) return `<b>Alle ${nf.format(townTotal)} Städte gefunden.</b> Jetzt fehlen noch ${nf.format(places.length - found.length)} Gemeinden.`;
  let extra = '';
  if (others > 0) extra = others === 1
    ? ` Noch ein weiterer Ort heißt ${esc(short)}.`
    : ` Noch ${nf.format(others)} weitere Orte heißen ${esc(short)}.`;
  return `${kind(c)} <b>${esc(nameWithKreis(c))}</b> gefunden.${extra}`;
}

function clearInput() {
  el.input.value = '';
  el.form.classList.remove('has-text');
}

function submit(text) {
  const res = getMatcher().check(text, id => foundSet.has(id));
  if (res.type === 'empty') return;
  if (res.type === 'found') {
    addPlace(res.id);
    clearInput();
    say(foundMessage(res.id, res.others, res.short), 'ok');
    return;
  }
  if (res.type === 'dupe') {
    say(`<b>${esc(nameWithKreis(places[res.id]))}</b> hast du schon.`);
    clearInput();
    flashRow(res.id, false);
    map.select(res.id); selected = -1;
    setTimeout(() => { if (selected < 0) map.select(-1); }, 1600);
    return;
  }
  shake();
  const typed = esc(text.trim());
  if (res.suggestion !== undefined) {
    const c = places[res.suggestion];
    if (res.suggestionFound) say(`Keine Gemeinde „${typed}“. Meintest du <b>${esc(nameWithKreis(c))}</b>? Die hast du schon.`);
    else say(`Keine Gemeinde „${typed}“. Meintest du <button type="button" class="suggest" data-id="${res.suggestion}">${esc(nameWithKreis(c))}</button>?`);
  } else {
    say(`Keine Stadt oder Gemeinde namens <b>„${typed}“</b>. Ortsteile zählen nicht.`, 'bad');
  }
  el.input.select();
}

function shake() {
  el.input.classList.remove('shake');
  void el.input.offsetWidth;
  el.input.classList.add('shake');
}

function resetGame() {
  found.length = 0;
  foundSet.clear();
  recount();
  closeCard();
  map.setFound([]);
  updateScore();
  renderList();
  renderStates();
  save();
  say('Neues Spiel. Alle Lichter sind aus.');
}

/* ---------- Viewport (iPad-Tastatur) ---------- */
function syncViewport() {
  const vv = window.visualViewport;
  const root = document.documentElement.style;
  root.setProperty('--app-h', (vv ? vv.height : window.innerHeight) + 'px');
  root.setProperty('--app-top', (vv ? Math.max(0, vv.offsetTop) : 0) + 'px');
}

/* ---------- Start ---------- */
function bindUI() {
  el.form.addEventListener('submit', e => { e.preventDefault(); if (places.length) submit(el.input.value); });
  el.input.addEventListener('input', () => el.form.classList.toggle('has-text', el.input.value.trim().length > 0));
  el.feedback.addEventListener('click', e => {
    const b = e.target.closest('.suggest');
    if (!b) return;
    const id = +b.dataset.id;
    if (!foundSet.has(id)) {
      addPlace(id);
      say(foundMessage(id), 'ok');
    }
    clearInput();
    el.input.focus();
  });
  el.list.addEventListener('click', e => {
    const b = e.target.closest('.row');
    if (!b) return;
    const id = +b.dataset.id;
    map.flyToPlace(id);
    openCard(id);
  });
  el.states.addEventListener('click', e => {
    const b = e.target.closest('.row');
    if (!b) return;
    closeCard();
    map.flyToBox(stateBoxes[+b.dataset.state]);
  });
  el.sort.addEventListener('change', () => {
    sortMode = el.sort.value;
    renderList();
    save();
  });
  for (const t of [el.tabFound, el.tabStates]) t.addEventListener('click', () => {
    const states = t === el.tabStates;
    el.tabFound.setAttribute('aria-selected', String(!states));
    el.tabStates.setAttribute('aria-selected', String(states));
    el.paneFound.hidden = states;
    el.paneStates.hidden = !states;
    el.sort.hidden = states;
  });
  el.toggleMissing.addEventListener('click', () => {
    showMissing = !showMissing;
    el.toggleMissing.setAttribute('aria-pressed', String(showMissing));
    el.toggleMissing.textContent = showMissing ? 'Fehlende ausblenden' : 'Fehlende zeigen';
    map.setShowMissing(showMissing);
  });
  el.reset.addEventListener('click', () => { el.reset.hidden = true; el.confirm.hidden = false; el.resetNo.focus(); });
  el.resetNo.addEventListener('click', () => { el.confirm.hidden = true; el.reset.hidden = false; });
  el.resetYes.addEventListener('click', () => { el.confirm.hidden = true; el.reset.hidden = false; resetGame(); });
  $('zoom-in').addEventListener('click', () => map.zoomBy(2));
  $('zoom-out').addEventListener('click', () => map.zoomBy(0.5));
  $('zoom-fit').addEventListener('click', () => { closeCard(); map.fit(); });
  el.cardClose.addEventListener('click', closeCard);
  document.addEventListener('keydown', e => {
    const inInput = document.activeElement === el.input;
    if (e.key === 'Escape') {
      if (!el.card.hidden) closeCard();
      else if (inInput) clearInput();
      return;
    }
    if (inInput || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    if (!map) return;
    if (e.key === '+' || e.key === '=') { map.zoomBy(2); e.preventDefault(); return; }
    if (e.key === '-') { map.zoomBy(0.5); e.preventDefault(); return; }
    if (e.key.length === 1 && /\p{L}/u.test(e.key)) el.input.focus();
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncViewport);
    window.visualViewport.addEventListener('scroll', syncViewport);
  }
  window.addEventListener('resize', syncViewport);
  syncViewport();
}

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function main() {
  for (const id of ['map', 'canvas', 'overlay', 'loading', 'count', 'total', 'progress', 'towns', 'pop', 'feedback']) el[id] = $(id);
  Object.assign(el, {
    barTown: $('bar-town'), barGem: $('bar-gem'), townTotal: $('town-total'),
    form: $('guess'), input: $('city'), tabCount: $('tab-count'), list: $('found-list'), empty: $('found-empty'),
    listScroll: $('found-scroll'), states: $('state-list'), sort: $('sort'), tabFound: $('tab-found'), tabStates: $('tab-states'),
    paneFound: $('pane-found'), paneStates: $('pane-states'), toggleMissing: $('toggle-missing'), reset: $('reset'),
    confirm: $('confirm'), resetYes: $('reset-yes'), resetNo: $('reset-no'), card: $('card'), cardName: $('card-name'),
    cardMeta: $('card-meta'), cardPop: $('card-pop'), cardMissing: $('card-missing'), cardClose: $('card-close'),
  });
  bindUI();
  let mapData, rows;
  try {
    [mapData, rows] = await Promise.all([getJSON('data/map.json'), getJSON('data/places.json')]);
  } catch (e) {
    el.loading.innerHTML = '<p class="loading-error">Die Kartendaten konnten nicht geladen werden. Prüfe die Verbindung und lade die Seite neu.</p>';
    console.error(e);
    return;
  }
  places = rows.map(toPlace);
  geo = buildGeometry(mapData);
  townTotal = places.reduce((n, c) => n + (c.t ? 1 : 0), 0);
  for (const c of places) nameCount.set(c.n, (nameCount.get(c.n) || 0) + 1);
  buildKeys();

  stateTotals = Array.from({ length: 16 }, () => ({ all: 0, towns: 0 }));
  const boxes = Array.from({ length: 16 }, () => [Infinity, Infinity, -Infinity, -Infinity]);
  places.forEach((c, id) => {
    stateTotals[c.s].all++;
    if (c.t) stateTotals[c.s].towns++;
    const b = boxes[c.s];
    const cb = bboxOfPolygons(geo.arcs, geo.placePolys[id]);
    b[0] = Math.min(b[0], cb[0]); b[1] = Math.min(b[1], cb[1]); b[2] = Math.max(b[2], cb[2]); b[3] = Math.max(b[3], cb[3]);
  });
  stateBoxes = boxes;

  restore();
  recount();
  map = new MapView({
    container: el.map,
    canvas: el.canvas,
    geo,
    places,
    onTap: id => { if (id >= 0) openCard(id); else closeCard(); },
    onFrame: positionOverlays,
  });
  map.setFound(found.map(f => f.id));
  updateScore();
  renderList();
  renderStates();
  if (found.length) say(`Willkommen zurück. ${nf.format(found.length)} ${found.length === 1 ? 'Ort leuchtet' : 'Orte leuchten'} schon.`);

  if (document.fonts && document.fonts.load) {
    Promise.all([document.fonts.load('400 13px "D-DIN-PRO"'), document.fonts.load('700 13px "D-DIN-PRO"')])
      .then(() => map.fontsChanged())
      .catch(() => {});
  }
  requestAnimationFrame(() => el.loading.classList.add('done'));
  // Namensverzeichnis erst nach dem ersten Bild aufbauen (dauert auf dem iPad einen Moment)
  setTimeout(getMatcher, 400);
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) el.input.focus({ preventScroll: true });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    try { navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) { /* nicht verfügbar */ }
  }
}

main();
