// Kartendaten dekodieren (TopoJSON-ähnliche Bögen, Lambert-Projektion in Metern) und Path2D-Objekte bauen.

export function decodeArcs(data) {
  const [sx, sy] = data.t.scale, [tx, ty] = data.t.translate;
  return data.arcs.map(a => {
    const out = new Float64Array(a.length * 2);
    let x = 0, y = 0;
    for (let i = 0; i < a.length; i++) {
      x += a[i][0]; y += a[i][1];
      out[2 * i] = x * sx + tx;
      out[2 * i + 1] = y * sy + ty;
    }
    return out;
  });
}

export function decodeFlat(flat, t) {
  const [sx, sy] = t.scale, [tx, ty] = t.translate;
  const out = new Float64Array(flat.length);
  let x = 0, y = 0;
  for (let i = 0; i < flat.length; i += 2) {
    x += flat[i]; y += flat[i + 1];
    out[i] = x * sx + tx; out[i + 1] = y * sy + ty;
  }
  return out;
}

// Bögen eines Linienzugs/Rings an einen Pfad anhängen
function appendArcs(path, arcs, idx) {
  let first = true;
  for (const i of idx) {
    const rev = i < 0;
    const a = arcs[rev ? ~i : i];
    const n = a.length / 2;
    if (rev) {
      for (let k = n - 1; k >= 0; k--) {
        if (first) { path.moveTo(a[2 * k], a[2 * k + 1]); first = false; }
        else if (k !== n - 1) path.lineTo(a[2 * k], a[2 * k + 1]);
      }
    } else {
      for (let k = 0; k < n; k++) {
        if (first) { path.moveTo(a[0], a[1]); first = false; }
        else if (k !== 0) path.lineTo(a[2 * k], a[2 * k + 1]);
      }
    }
  }
}

export function linesPath(arcs, lines) {
  const p = new Path2D();
  for (const line of lines) appendArcs(p, arcs, line);
  return p;
}

export function polygonsPath(arcs, polygons) {
  const p = new Path2D();
  for (const poly of polygons) for (const ring of poly) { appendArcs(p, arcs, ring); p.closePath(); }
  return p;
}

export function flatPath(coords, close) {
  const p = new Path2D();
  p.moveTo(coords[0], coords[1]);
  for (let i = 2; i < coords.length; i += 2) p.lineTo(coords[i], coords[i + 1]);
  if (close) p.closePath();
  return p;
}

export function bboxOfPolygons(arcs, polygons) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const poly of polygons) for (const i of poly[0]) {
    const a = arcs[i < 0 ? ~i : i];
    for (let k = 0; k < a.length; k += 2) {
      const x = a[k], y = a[k + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return [x0, y0, x1, y1];
}

/** Alles, was die Karte zeichnet, als Path2D in Projektionsmetern. */
export function buildGeometry(data) {
  const arcs = decodeArcs(data);
  const t = data.t;
  const neighbors = new Map();
  for (const n of data.neighbors) {
    if (!neighbors.has(n.c)) neighbors.set(n.c, new Path2D());
    const p = neighbors.get(n.c);
    for (const ring of n.r) {
      const c = decodeFlat(ring, t);
      if (c.length < 6) continue;
      p.moveTo(c[0], c[1]);
      for (let i = 2; i < c.length; i += 2) p.lineTo(c[i], c[i + 1]);
      p.closePath();
    }
  }
  const lakes = new Path2D();
  for (const lk of data.lakes) for (const ring of lk) {
    const c = decodeFlat(ring, t);
    if (c.length < 6) continue;
    lakes.moveTo(c[0], c[1]);
    for (let i = 2; i < c.length; i += 2) lakes.lineTo(c[i], c[i + 1]);
    lakes.closePath();
  }
  // Flüsse nach Rang bündeln (weniger Zeichenaufrufe)
  const riverBands = [[0, 4], [5, 6], [7, 8], [9, 99]].map(([lo, hi]) => ({ lo, hi, path: new Path2D() }));
  for (const r of data.rivers) {
    const band = riverBands.find(b => r.w >= b.lo && r.w <= b.hi);
    const c = decodeFlat(r.l, t);
    band.path.moveTo(c[0], c[1]);
    for (let i = 2; i < c.length; i += 2) band.path.lineTo(c[i], c[i + 1]);
  }
  return {
    arcs,
    bbox: data.bbox,
    land: polygonsPath(arcs, data.land),
    outline: linesPath(arcs, data.outline),
    states: linesPath(arcs, data.states),
    districts: linesPath(arcs, data.districts),
    munis: linesPath(arcs, data.munis),
    neighbors,
    lakes,
    rivers: riverBands,
    cityPolys: data.cities,          // Bogenlisten, Pfade werden bei Bedarf gebaut
    stateLabels: data.stateLabels,
    labels: data.labels,
  };
}
