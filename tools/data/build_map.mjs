// Combine simplified VG250 topology + Natural Earth context layers into one compact map.json
import fs from 'node:fs';
import * as topo from 'topojson-client';
import polylabel from 'polylabel';

const [,, topoFile, outFile] = process.argv;
const WORK = process.env.WORK || '.work';
const T = JSON.parse(fs.readFileSync(topoFile, 'utf8'));
const places = JSON.parse(fs.readFileSync(`${WORK}/places_stage2.json`, 'utf8'));
const objName = Object.keys(T.objects)[0];
const gem = T.objects[objName];
const geoms = gem.geometries;
const tr = T.transform;
console.log('arcs', T.arcs.length, 'geoms', geoms.length, 'transform', tr);

const P = g => g.properties;
// ---- meshes (arc index lists) ----
const outline = topo.meshArcs(T, gem, (a, b) => a === b);
const states = topo.meshArcs(T, gem, (a, b) => a !== b && P(a).s !== P(b).s);
const districts = topo.meshArcs(T, gem, (a, b) => a !== b && P(a).s === P(b).s && P(a).d !== P(b).d);
const munis = topo.meshArcs(T, gem, (a, b) => a !== b && P(a).d === P(b).d);
const land = topo.mergeArcs(T, geoms.filter(g => P(g).s >= 0));
// Winzige Lücken zwischen Gemeinden (Splitter) aus Landfläche und Außenlinie entfernen
function ringAreaArcs(ring) {
  const pts = [];
  for (const i of ring) {
    const a = T.arcs[i < 0 ? ~i : i];
    let x = 0, y = 0; const ap = [];
    for (const [dx, dy] of a) { x += dx; y += dy; ap.push([x * tr.scale[0], y * tr.scale[1]]); }
    if (i < 0) ap.reverse();
    pts.push(...(pts.length ? ap.slice(1) : ap));
  }
  let s = 0;
  for (let i = 0, n = pts.length, j = n - 1; i < n; j = i++) s += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return Math.abs(s / 2) / 1e6; // km²
}
let droppedHoles = 0;
land.arcs = land.arcs.filter(poly => ringAreaArcs(poly[0]) >= 0.02).map(poly => [poly[0], ...poly.slice(1).filter(h => { const keep = ringAreaArcs(h) >= 0.05; if (!keep) droppedHoles++; return keep; })]);
outline.arcs = land.arcs.flat();
console.log('dropped sliver holes', droppedHoles);
console.log('mesh lines: outline', outline.arcs.length, 'states', states.arcs.length, 'districts', districts.arcs.length, 'munis', munis.arcs.length, 'land polys', land.arcs.length);

// ---- district sanity: districts that consist of disconnected pieces ----
const byD = new Map();
for (const g of geoms) { if (P(g).s < 0) continue; const k = P(g).d; if (!byD.has(k)) byD.set(k, []); byD.get(k).push(g); }
let odd = 0;
for (const [k, gs] of byD) {
  const m = topo.mergeArcs(T, gs);
  if (m.arcs.length > 1) {
    // count pieces that are not tiny islands
    const pieces = topo.feature(T, { type: 'MultiPolygon', arcs: m.arcs }).geometry.coordinates;
    const areas = pieces.map(p => Math.abs(ringArea(p[0])) / 1e6).sort((a, b) => b - a);
    if (areas.length > 1 && areas[1] > 3) { odd++; console.log('  multi-piece district', k, areas.slice(0, 4).map(a => a.toFixed(1))); }
  }
}
console.log('districts', byD.size, 'odd', odd);
function ringArea(r) { let s = 0; for (let i = 0, n = r.length, j = n - 1; i < n; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return s / 2; }

// ---- Flächen der Orte (Städte und Gemeinden) ----
const byPlace = new Map();
for (const g of geoms) { const c = P(g).c; if (c >= 0) { if (!byPlace.has(c)) byPlace.set(c, []); byPlace.get(c).push(g); } }
const placePolys = places.map((c, i) => {
  const gs = byPlace.get(i);
  if (!gs) throw new Error('keine Fläche für Ort ' + i + ' ' + c.name);
  // einzelne Gemeinde: Bögen direkt übernehmen, sonst zusammenführen
  if (gs.length === 1) return gs[0].type === 'Polygon' ? [gs[0].arcs] : gs[0].arcs;
  return topo.mergeArcs(T, gs).arcs; // MultiPolygon-Bögen
});

// ---- state label points ----
const STATE_NAMES = ['Schleswig-Holstein', 'Hamburg', 'Niedersachsen', 'Bremen', 'Nordrhein-Westfalen', 'Hessen', 'Rheinland-Pfalz', 'Baden-Württemberg', 'Bayern', 'Saarland', 'Berlin', 'Brandenburg', 'Mecklenburg-Vorpommern', 'Sachsen', 'Sachsen-Anhalt', 'Thüringen'];
const stateLabels = [];
for (let s = 0; s < 16; s++) {
  const m = topo.mergeArcs(T, geoms.filter(g => P(g).s === s));
  const f = topo.feature(T, { type: 'MultiPolygon', arcs: m.arcs }).geometry.coordinates;
  // largest piece
  let best = null, ba = -1;
  for (const poly of f) { const a = Math.abs(ringArea(poly[0])); if (a > ba) { ba = a; best = poly; } }
  const p = polylabel(best, 500);
  stateLabels.push({ n: STATE_NAMES[s], x: Math.round(p[0]), y: Math.round(p[1]), a: Math.round(ba / 1e6) });
}

// ---- quantize helper for context layers (same transform as topology) ----
const qx = x => Math.round((x - tr.translate[0]) / tr.scale[0]);
const qy = y => Math.round((y - tr.translate[1]) / tr.scale[1]);
function encLine(coords) { // delta encoded flat int array
  const out = []; let px = 0, py = 0, first = true;
  for (const [x, y] of coords) {
    const X = qx(x), Y = qy(y);
    if (!first && X === px && Y === py) continue;
    out.push(first ? X : X - px, first ? Y : Y - py); px = X; py = Y; first = false;
  }
  return out;
}
function polysOf(geom) { return geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : []; }

const nb = JSON.parse(fs.readFileSync(`${WORK}/neighbors.geojson`, 'utf8'));
const neighbors = [];
for (const f of nb.features) {
  for (const poly of polysOf(f.geometry)) neighbors.push({ c: f.properties.ADM0_A3, r: poly.map(encLine) });
}
const rv = JSON.parse(fs.readFileSync(`${WORK}/rivers.geojson`, 'utf8'));
const rivers = [];
for (const f of rv.features) {
  const g = f.geometry; if (!g) continue;
  const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
  const sr = f.properties.scalerank ?? 10;
  for (const l of lines) { const e = encLine(l); if (e.length >= 4) rivers.push({ w: sr, l: e }); }
}
const lk = JSON.parse(fs.readFileSync(`${WORK}/lakes.geojson`, 'utf8'));
const lakes = [];
for (const f of lk.features) for (const poly of polysOf(f.geometry)) lakes.push(poly.map(encLine));

// projected label positions for neighbors and seas (lon/lat -> need projection: use d3-geo with same params)
// mapshaper used proj4 LCC; replicate with d3 conic conformal on a sphere is not identical (ellipsoid vs sphere),
// so instead we compute label points by locating them via provided projected samples (see labels.json from python/pyproj).
const extra = JSON.parse(fs.readFileSync(`${WORK}/labels_proj.json`, 'utf8'));

// bbox of all VG250 arcs (projected meters)
let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
for (const a of T.arcs) { let x = 0, y = 0; for (const [dx, dy] of a) { x += dx; y += dy; const X = x * tr.scale[0] + tr.translate[0], Y = y * tr.scale[1] + tr.translate[1]; if (X < bx0) bx0 = X; if (X > bx1) bx1 = X; if (Y < by0) by0 = Y; if (Y > by1) by1 = Y; } }
const out = {
  v: 1,
  t: tr,
  bbox: [Math.round(bx0), Math.round(by0), Math.round(bx1), Math.round(by1)],
  arcs: T.arcs,
  outline: outline.arcs,
  states: states.arcs,
  districts: districts.arcs,
  munis: munis.arcs,
  land: land.arcs,
  places: placePolys,
  stateLabels,
  neighbors,
  rivers,
  lakes,
  labels: extra,
};
fs.writeFileSync(outFile, JSON.stringify(out));
console.log('wrote', outFile, (fs.statSync(outFile).size / 1e6).toFixed(2), 'MB');
