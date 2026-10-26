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
let cities = [], matcher = null, map = null, geo = null;
const found = [];            // [{id, t}] in Fundreihenfolge
const foundSet = new Set();
let sortMode = 'new', showMissing = false, selected = -1, sign = null, stateBoxes = [], stateTotals = [];

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

function formatPop(p) {
  return p >= 1e6 ? pf.format(p / 1e6) + ' Mio.' : nf.format(p);
}

function keyOf(id) { const c = cities[id]; return c.n + '|' + c.s; }

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({ v: 1, f: found.map(f => [keyOf(f.id), f.t]), sort: sortMode }));
  } catch (e) { /* Speicher nicht verfügbar */ }
}

function restore() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { data = null; }
  if (!data || data.v !== 1) return;
  const byKey = new Map(cities.map((c, i) => [keyOf(i), i]));
  for (const [k, t] of data.f || []) {
    const id = byKey.get(k);
    if (id !== undefined && !foundSet.has(id)) { found.push({ id, t }); foundSet.add(id); }
  }
  if (['new', 'az', 'pop'].includes(data.sort)) sortMode = data.sort;
}

/* ---------- Anzeige ---------- */
function updateScore() {
  const n = found.length, total = cities.length;
  el.count.textContent = nf.format(n);
  el.total.textContent = nf.format(total);
  el.tabCount.textContent = nf.format(n);
  const r = total ? n / total : 0;
  el.bar.style.width = (r * 100).toFixed(2) + '%';
  el.bar.parentElement.setAttribute('aria-valuenow', String(n));
  el.bar.parentElement.setAttribute('aria-valuemax', String(total));
  el.pct.textContent = pf.format(r * 100) + ' %';
  let pop = 0;
  for (const f of found) pop += cities[f.id].p;
  el.pop.textContent = formatPop(pop) + ' Einwohner';
}

function rowFor(id) {
  const c = cities[id];
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'row';
  b.dataset.id = id;
  b.innerHTML = `<span class="row-name">${esc(c.n)}</span><span class="badge" title="${esc(STATES[c.s])}">${ABBR[c.s]}</span><span class="row-pop">${nf.format(c.p)}</span>`;
  b.setAttribute('aria-label', `${c.n}, ${STATES[c.s]}, ${nf.format(c.p)} Einwohner`);
  li.appendChild(b);
  return li;
}

function renderList() {
  const ids = found.map(f => f.id);
  if (sortMode === 'new') ids.reverse();
  else if (sortMode === 'az') ids.sort((a, b) => cities[a].n.localeCompare(cities[b].n, 'de'));
  else ids.sort((a, b) => cities[b].p - cities[a].p);
  const frag = document.createDocumentFragment();
  for (const id of ids) frag.appendChild(rowFor(id));
  el.list.replaceChildren(frag);
  el.empty.hidden = ids.length > 0;
  el.sort.value = sortMode;
}

function addRow(id) {
  el.empty.hidden = true;
  if (sortMode !== 'new') { renderList(); }
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
  const per = new Array(16).fill(0);
  for (const f of found) per[cities[f.id].s]++;
  const order = STATES.map((n, i) => i).sort((a, b) => STATES[a].localeCompare(STATES[b], 'de'));
  const frag = document.createDocumentFragment();
  for (const s of order) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'row state-row';
    b.dataset.state = s;
    const r = stateTotals[s] ? per[s] / stateTotals[s] : 0;
    b.innerHTML = `<span class="row-name">${esc(STATES[s])}</span><span class="row-pop">${nf.format(per[s])} / ${nf.format(stateTotals[s])}</span><span class="bar"><span style="width:${(r * 100).toFixed(2)}%"></span></span>`;
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
  const c = cities[id];
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
  const c = cities[id];
  const isFound = foundSet.has(id);
  el.cardName.textContent = c.n;
  el.cardMeta.textContent = `${kreisLabel(c)}, ${STATES[c.s]}`;
  el.cardPop.textContent = `${nf.format(c.p)} Einwohner`;
  el.cardMissing.hidden = isFound;
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
    const c = cities[sign.id];
    const [x, y] = map.toScreen(c.x, c.y);
    const sx = clamp(x, sign.w / 2 + m, W - sign.w / 2 - m);
    const sy = clamp(y - 3, sign.h + m, H - m);
    sign.el.style.transform = `translate(${(sx - sign.w / 2).toFixed(1)}px, ${(sy - sign.h).toFixed(1)}px)`;
  }
  if (!el.card.hidden && selected >= 0) {
    const c = cities[selected];
    const [x, y] = map.toScreen(c.x, c.y);
    const w = +el.card.dataset.w || 220, h = +el.card.dataset.h || 100;
    let cx = clamp(x - w / 2, m, W - w - m);
    let cy = y - h - 18;
    if (cy < m + 50) cy = y + 18;
    cy = clamp(cy, m, H - h - m);
    el.card.style.transform = `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px)`;
  }
}

/* ---------- Spiel ---------- */
function addCity(id) {
  if (foundSet.has(id)) return;
  found.push({ id, t: Date.now() });
  foundSet.add(id);
  map.addFound(id);
  updateScore();
  addRow(id);
  renderStates();
  save();
  showSign(id);
  if (selected >= 0 && selected !== id) closeCard();
}

function submit(text) {
  const res = matcher.check(text, id => foundSet.has(id));
  if (res.type === 'empty') return;
  if (res.type === 'found') {
    const c = cities[res.id];
    addCity(res.id);
    el.input.value = '';
    el.form.classList.remove('has-text');
    if (found.length === cities.length) {
      say(`<b>Alle ${nf.format(cities.length)} Städte gefunden.</b> Deutschland leuchtet.`, 'ok');
      return;
    }
    let extra = '';
    if (res.others > 0) extra = res.others === 1
      ? ` Noch eine weitere Stadt heißt ${esc(res.short)}.`
      : ` Noch ${nf.format(res.others)} weitere Städte heißen ${esc(res.short)}.`;
    say(`<b>${esc(c.n)}</b> gefunden.${extra}`, 'ok');
    return;
  }
  if (res.type === 'dupe') {
    const c = cities[res.id];
    say(`<b>${esc(c.n)}</b> hast du schon.`);
    el.input.value = '';
    el.form.classList.remove('has-text');
    flashRow(res.id, false);
    map.select(res.id); selected = -1;
    setTimeout(() => { if (selected < 0) map.select(-1); }, 1600);
    return;
  }
  shake();
  if (res.type === 'gemeinde') {
    say(`<b>${esc(res.name)}</b> ist eine Gemeinde, aber keine Stadt.`, 'bad');
    el.input.select();
    return;
  }
  if (res.suggestion !== undefined) {
    const c = cities[res.suggestion];
    if (res.suggestionFound) say(`Meintest du <b>${esc(c.n)}</b>? Die hast du schon.`);
    else say(`Meintest du <button type="button" class="suggest" data-id="${res.suggestion}">${esc(c.n)}</button>?`);
  } else {
    say(`Keine Stadt namens <b>„${esc(text.trim())}“</b> gefunden.`, 'bad');
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
  el.form.addEventListener('submit', e => { e.preventDefault(); submit(el.input.value); });
  el.input.addEventListener('input', () => el.form.classList.toggle('has-text', el.input.value.trim().length > 0));
  el.feedback.addEventListener('click', e => {
    const b = e.target.closest('.suggest');
    if (!b) return;
    const id = +b.dataset.id;
    if (!foundSet.has(id)) {
      addCity(id);
      say(`<b>${esc(cities[id].n)}</b> gefunden.`, 'ok');
    }
    el.input.value = '';
    el.form.classList.remove('has-text');
    el.input.focus();
  });
  el.list.addEventListener('click', e => {
    const b = e.target.closest('.row');
    if (!b) return;
    const id = +b.dataset.id;
    map.flyToCity(id);
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
      else if (inInput) { el.input.value = ''; el.form.classList.remove('has-text'); }
      return;
    }
    if (inInput || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
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
  for (const id of ['map', 'canvas', 'overlay', 'loading', 'count', 'total', 'bar', 'pct', 'pop', 'feedback']) el[id] = $(id);
  Object.assign(el, {
    form: $('guess'), input: $('city'), tabCount: $('tab-count'), list: $('found-list'), empty: $('found-empty'),
    listScroll: $('found-scroll'), states: $('state-list'), sort: $('sort'), tabFound: $('tab-found'), tabStates: $('tab-states'),
    paneFound: $('pane-found'), paneStates: $('pane-states'), toggleMissing: $('toggle-missing'), reset: $('reset'),
    confirm: $('confirm'), resetYes: $('reset-yes'), resetNo: $('reset-no'), card: $('card'), cardName: $('card-name'),
    cardMeta: $('card-meta'), cardPop: $('card-pop'), cardMissing: $('card-missing'), cardClose: $('card-close'),
  });
  bindUI();
  let mapData;
  try {
    [mapData, cities] = await Promise.all([getJSON('data/map.json'), getJSON('data/cities.json')]);
  } catch (e) {
    el.loading.innerHTML = '<p class="loading-error">Die Kartendaten konnten nicht geladen werden. Prüfe die Verbindung und lade die Seite neu.</p>';
    console.error(e);
    return;
  }
  geo = buildGeometry(mapData);
  matcher = new Matcher(cities);
  getJSON('data/gemeinden.json').then(list => matcher.setGemeinden(list)).catch(() => {});

  stateTotals = new Array(16).fill(0);
  const boxes = Array.from({ length: 16 }, () => [Infinity, Infinity, -Infinity, -Infinity]);
  cities.forEach((c, id) => {
    stateTotals[c.s]++;
    const b = boxes[c.s];
    const cb = bboxOfPolygons(geo.arcs, geo.cityPolys[id]);
    b[0] = Math.min(b[0], cb[0]); b[1] = Math.min(b[1], cb[1]); b[2] = Math.max(b[2], cb[2]); b[3] = Math.max(b[3], cb[3]);
  });
  stateBoxes = boxes;

  restore();
  map = new MapView({
    container: el.map,
    canvas: el.canvas,
    geo,
    cities,
    onTap: id => { if (id >= 0) openCard(id); else closeCard(); },
    onFrame: positionOverlays,
  });
  map.setFound(found.map(f => f.id));
  updateScore();
  renderList();
  renderStates();
  if (found.length) say(`Willkommen zurück. ${nf.format(found.length)} Städte leuchten schon.`);

  if (document.fonts && document.fonts.load) {
    Promise.all([document.fonts.load('400 13px "D-DIN-PRO"'), document.fonts.load('700 13px "D-DIN-PRO"')])
      .then(() => map.fontsChanged())
      .catch(() => {});
  }
  requestAnimationFrame(() => el.loading.classList.add('done'));
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) el.input.focus({ preventScroll: true });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    try { navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) { /* nicht verfügbar */ }
  }
}

main();
