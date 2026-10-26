// Kartenansicht: Canvas-Renderer mit Zoom, Pinch, Schwung und Lichtern für gefundene Städte.
import { polygonsPath } from './geo.js';

const PAL = {
  sea: '#0a1630',
  neighbor: '#0f1e3e',
  neighborEdge: 'rgba(120,150,215,0.22)',
  land: '#142a52',
  lake: '#0c1d3e',
  river: '#2b528f',
  muni: [168, 190, 240],
  district: 'rgba(168,190,240,0.20)',
  state: 'rgba(196,210,248,0.62)',
  outline: 'rgba(214,226,255,0.85)',
  stateLabel: [170, 188, 230],
  neighborLabel: 'rgba(130,152,205,0.55)',
  seaLabel: 'rgba(92,138,205,0.75)',
  areaFill: 'rgba(255,238,205,0.20)',
  areaEdge: 'rgba(255,246,228,0.42)',
  dot: '#ffffff',
  halo: 'rgba(10,22,48,0.92)',
  label: '#f4f6ff',
  missing: 'rgba(255,135,135,0.85)',
  sign: '#f6c21c',
};
const FONT = '"D-DIN-PRO", "DIN Alternate", "Bahnschrift", "Arial Narrow", system-ui, sans-serif';

function makeGlow() {
  const s = 64, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,236,196,0.85)');
  grd.addColorStop(0.25, 'rgba(255,214,150,0.38)');
  grd.addColorStop(0.6, 'rgba(255,196,120,0.10)');
  grd.addColorStop(1, 'rgba(255,190,110,0)');
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  return c;
}

const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export class MapView {
  constructor({ container, canvas, geo, cities, onTap, onFrame }) {
    this.container = container;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.geo = geo;
    this.cities = cities;
    this.onTap = onTap || (() => {});
    this.onFrame = onFrame || (() => {});
    this.found = new Set();
    this.labelOrder = [];
    this.showMissing = false;
    this.selected = -1;
    this.pulses = [];
    this.cityPaths = new Map();
    this.textW = new Map();
    this.base = document.createElement('canvas');
    this.bctx = this.base.getContext('2d');
    this.baseView = null;
    this.baseDirty = true;
    this.W = 0; this.H = 0; this.dpr = 1;
    this.cx = 0; this.cy = 0; this.k = 1; this.kFit = 1;
    this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    this.pointers = new Map();
    this.gesture = null;
    this.anim = null;
    this.inertia = null;
    this.lastMove = 0;
    this.raf = 0;
    this.idleTimer = 0;
    this.glow = makeGlow();
    this.reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.ready = false;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
    this.bindEvents();
  }

  /* ---------- Zustand ---------- */
  setFound(ids) {
    this.found = new Set(ids);
    this.labelOrder = [...this.found].sort((a, b) => this.cities[b].p - this.cities[a].p);
    this.baseDirty = true;
    this.request();
  }
  addFound(id, pulse = true) {
    this.found.add(id);
    this.labelOrder.push(id);
    this.labelOrder.sort((a, b) => this.cities[b].p - this.cities[a].p);
    if (pulse && !this.reduceMotion) this.pulses.push({ id, t0: performance.now() });
    this.baseDirty = true;
    this.request();
  }
  setShowMissing(on) { this.showMissing = on; this.request(); }
  fontsChanged() { this.textW.clear(); this.stateW?.clear(); this.baseDirty = true; this.request(); }
  select(id) { this.selected = id; this.request(); }

  /* ---------- Geometrie / Ansicht ---------- */
  resize() {
    const r = this.container.getBoundingClientRect();
    const W = Math.max(1, Math.round(r.width)), H = Math.max(1, Math.round(r.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (W === this.W && H === this.H && dpr === this.dpr) return;
    const first = !this.W;
    const relZoom = this.kFit ? this.k / this.kFit : 1;
    this.W = W; this.H = H; this.dpr = dpr;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.canvas.style.width = W + 'px';
    this.canvas.style.height = H + 'px';
    this.kFit = this.fitScale();
    if (first) this.fit(false); else { this.k = this.kFit * relZoom; this.clampView(); }
    this.baseDirty = true;
    this.renderNow();
  }

  fitScale(b = this.geo.bbox, pad = 28) {
    const ins = this.insets;
    const w = this.W - ins.left - ins.right - 2 * pad, h = this.H - ins.top - ins.bottom - 2 * pad;
    return Math.max(1e-6, Math.min(w / (b[2] - b[0]), h / (b[3] - b[1])));
  }

  fitTarget(b = this.geo.bbox, pad = 28) {
    const ins = this.insets;
    const k = this.fitScale(b, pad);
    // Mittelpunkt so verschieben, dass die Einrückungen (Knöpfe) frei bleiben
    const cx = (b[0] + b[2]) / 2 - ((ins.left - ins.right) / 2) / k;
    const cy = (b[1] + b[3]) / 2 + ((ins.top - ins.bottom) / 2) / k;
    return { cx, cy, k };
  }

  fit(animate = true) {
    const t = this.fitTarget();
    if (animate) this.flyTo(t.cx, t.cy, t.k); else { this.cx = t.cx; this.cy = t.cy; this.k = t.k; this.request(); }
  }

  get zoom() { return this.k / this.kFit; }

  clampView() {
    const b = this.geo.bbox, kMin = this.kFit * 0.75, kMax = this.kFit * 64;
    this.k = Math.min(kMax, Math.max(kMin, this.k));
    const mx = (b[2] - b[0]) * 0.35, my = (b[3] - b[1]) * 0.3;
    this.cx = Math.min(b[2] + mx, Math.max(b[0] - mx, this.cx));
    this.cy = Math.min(b[3] + my, Math.max(b[1] - my, this.cy));
  }

  toScreen(x, y) { return [(x - this.cx) * this.k + this.W / 2, (this.cy - y) * this.k + this.H / 2]; }
  toWorld(sx, sy) { return [this.cx + (sx - this.W / 2) / this.k, this.cy - (sy - this.H / 2) / this.k]; }

  zoomAt(sx, sy, factor) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.k *= factor;
    this.clampView();
    this.cx = wx - (sx - this.W / 2) / this.k;
    this.cy = wy + (sy - this.H / 2) / this.k;
    this.clampView();
    this.touch();
  }

  zoomBy(factor) {
    const t0 = { cx: this.cx, cy: this.cy, k: this.k };
    const k = Math.min(this.kFit * 64, Math.max(this.kFit * 0.75, this.k * factor));
    this.flyTo(t0.cx, t0.cy, k, 320);
  }

  flyToCity(id, minZoom = 6) {
    const c = this.cities[id];
    const k = Math.max(this.k, this.kFit * minZoom);
    this.flyTo(c.x, c.y, Math.min(k, this.kFit * 24));
  }

  flyToBox(b) {
    const t = this.fitTarget(b, 40);
    this.flyTo(t.cx, t.cy, Math.min(t.k, this.kFit * 24));
  }

  flyTo(cx, cy, k, dur) {
    this.inertia = null;
    if (this.reduceMotion) { this.cx = cx; this.cy = cy; this.k = k; this.clampView(); this.touch(); return; }
    const from = { cx: this.cx, cy: this.cy, k: this.k };
    const dist = Math.hypot(cx - from.cx, cy - from.cy) * Math.min(k, from.k);
    const zr = Math.abs(Math.log(k / from.k));
    dur = dur || Math.min(1100, Math.max(380, 260 + dist * 0.35 + zr * 160));
    this.anim = { from, to: { cx, cy, k }, t0: performance.now(), dur };
    this.request();
  }

  insetsChanged(ins) { this.insets = ins; this.kFit = this.fitScale(); }

  /* ---------- Ereignisse ---------- */
  bindEvents() {
    const el = this.canvas;
    el.addEventListener('pointerdown', e => this.onDown(e));
    el.addEventListener('pointermove', e => this.onMove(e));
    el.addEventListener('pointerup', e => this.onUp(e));
    el.addEventListener('pointercancel', e => this.onUp(e, true));
    el.addEventListener('wheel', e => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const f = Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.0022));
      this.anim = null; this.inertia = null;
      this.zoomAt(e.clientX - r.left, e.clientY - r.top, f);
    }, { passive: false });
    el.addEventListener('dblclick', e => {
      e.preventDefault();
      if (this.lastPointerType && this.lastPointerType !== 'mouse') return; // Touch-Doppeltipp wird selbst behandelt
      const r = el.getBoundingClientRect();
      this.zoomAnimAt(e.clientX - r.left, e.clientY - r.top, e.shiftKey ? 0.5 : 2);
    });
    // Safari: Seitenzoom per Geste verhindern
    for (const t of ['gesturestart', 'gesturechange']) el.addEventListener(t, e => e.preventDefault());
  }

  zoomAnimAt(sx, sy, factor) {
    const [wx, wy] = this.toWorld(sx, sy);
    const k = Math.min(this.kFit * 64, Math.max(this.kFit * 0.75, this.k * factor));
    const cx = wx - (sx - this.W / 2) / k, cy = wy + (sy - this.H / 2) / k;
    this.flyTo(cx, cy, k, 300);
  }

  local(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  onDown(e) {
    this.lastPointerType = e.pointerType;
    this.canvas.setPointerCapture?.(e.pointerId);
    const [x, y] = this.local(e);
    this.pointers.set(e.pointerId, { x, y, x0: x, y0: y, t0: performance.now() });
    this.anim = null; this.inertia = null;
    this.startGesture();
  }

  startGesture() {
    const pts = [...this.pointers.values()];
    if (pts.length === 1) {
      const p = pts[0];
      this.gesture = { type: 'pan', x: p.x, y: p.y, cx: this.cx, cy: this.cy, moved: false, t0: performance.now(), samples: [{ x: p.x, y: p.y, t: performance.now() }] };
    } else if (pts.length >= 2) {
      const [a, b] = pts;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const [wx, wy] = this.toWorld(mx, my);
      this.gesture = { type: 'pinch', d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), k0: this.k, wx, wy, moved: true };
    }
  }

  onMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const [x, y] = this.local(e);
    p.x = x; p.y = y;
    const g = this.gesture;
    if (!g) return;
    if (g.type === 'pan') {
      const dx = x - g.x, dy = y - g.y;
      if (!g.moved && Math.hypot(dx, dy) > 5) g.moved = true;
      if (g.moved) {
        this.cx = g.cx - dx / this.k;
        this.cy = g.cy + dy / this.k;
        this.clampView();
        const now = performance.now();
        g.samples.push({ x, y, t: now });
        while (g.samples.length > 2 && now - g.samples[0].t > 90) g.samples.shift();
        this.touch();
      }
    } else if (g.type === 'pinch') {
      const pts = [...this.pointers.values()];
      if (pts.length < 2) return;
      const [a, b] = pts;
      const d = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      this.k = g.k0 * d / g.d0;
      this.clampView();
      this.cx = g.wx - (mx - this.W / 2) / this.k;
      this.cy = g.wy + (my - this.H / 2) / this.k;
      this.clampView();
      this.touch();
    }
  }

  onUp(e, cancelled) {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (this.pointers.size > 0) { this.startGesture(); if (this.gesture) this.gesture.moved = true; return; }
    this.gesture = null;
    if (!g || cancelled || !p) return;
    if (g.type === 'pan' && !g.moved && performance.now() - g.t0 < 450) {
      this.handleTap(p.x, p.y, e.pointerType);
      return;
    }
    if (g.type === 'pan' && g.moved && !this.reduceMotion) {
      const s = g.samples;
      if (s.length >= 2) {
        const a = s[0], b = s[s.length - 1], dt = Math.max(16, b.t - a.t);
        const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
        if (performance.now() - b.t < 60 && Math.hypot(vx, vy) > 0.25) {
          this.inertia = { vx, vy, t: performance.now() };
          this.request();
        }
      }
    }
  }

  handleTap(x, y, type) {
    const now = performance.now();
    if (this.lastTap && now - this.lastTap.t < 320 && Math.hypot(x - this.lastTap.x, y - this.lastTap.y) < 30 && type !== 'mouse') {
      this.lastTap = null;
      this.zoomAnimAt(x, y, 2);
      return;
    }
    this.lastTap = { t: now, x, y };
    const id = this.hitTest(x, y, type === 'mouse' ? 12 : 22);
    this.onTap(id);
  }

  hitTest(x, y, radius) {
    let best = -1, bd = radius * radius;
    const test = id => {
      const c = this.cities[id];
      const sx = (c.x - this.cx) * this.k + this.W / 2, sy = (this.cy - c.y) * this.k + this.H / 2;
      const d = (sx - x) ** 2 + (sy - y) ** 2;
      if (d < bd) { bd = d; best = id; }
    };
    for (const id of this.found) test(id);
    if (best < 0 && this.showMissing) for (let id = 0; id < this.cities.length; id++) if (!this.found.has(id)) test(id);
    return best;
  }

  touch() {
    this.lastMove = performance.now();
    this.request();
  }

  /* ---------- Zeichnen ---------- */
  request() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(t => { this.raf = 0; this.frame(t); });
  }

  renderNow() {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    this.frame(performance.now());
  }

  frame(now) {
    let again = false;
    if (this.anim) {
      const a = this.anim, t = Math.min(1, (now - a.t0) / a.dur), e = easeInOut(t);
      this.k = Math.exp(Math.log(a.from.k) + (Math.log(a.to.k) - Math.log(a.from.k)) * e);
      this.cx = a.from.cx + (a.to.cx - a.from.cx) * e;
      this.cy = a.from.cy + (a.to.cy - a.from.cy) * e;
      this.clampView();
      this.lastMove = now;
      if (t < 1) again = true; else this.anim = null;
    }
    if (this.inertia) {
      const i = this.inertia, dt = Math.min(48, now - i.t);
      i.t = now;
      this.cx -= i.vx * dt / this.k;
      this.cy += i.vy * dt / this.k;
      this.clampView();
      const decay = Math.pow(0.0045, dt / 1000);
      i.vx *= decay; i.vy *= decay;
      this.lastMove = now;
      if (Math.hypot(i.vx, i.vy) > 0.02) again = true; else this.inertia = null;
    }
    const interacting = this.pointers.size > 0 || this.anim || this.inertia;
    // Grundkarte neu zeichnen, wenn nötig (bei Bewegung nur, wenn der Puffer nicht mehr reicht)
    const bv = this.baseView;
    let needBase = this.baseDirty || !bv;
    if (!needBase) {
      const s = this.k / bv.k;
      const offX = (bv.cx - this.cx) * this.k, offY = (this.cy - bv.cy) * this.k;
      const halfW = (bv.W / 2 + bv.M) * s, halfH = (bv.H / 2 + bv.M) * s;
      const covers = Math.abs(offX) + this.W / 2 <= halfW + 1 && Math.abs(offY) + this.H / 2 <= halfH + 1;
      const settled = !interacting && now - this.lastMove > 140;
      if (!covers || s > 1.6 || s < 0.62) needBase = true;
      else if (settled && (Math.abs(s - 1) > 1e-3 || Math.abs(offX) > 0.5 || Math.abs(offY) > 0.5 || bv.W !== this.W || bv.H !== this.H)) needBase = true;
      if (!settled && !needBase) {
        clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => this.request(), 160);
      }
    }
    if (needBase) this.renderBase(!interacting);
    this.draw(now);
    if (this.pulses.length) again = true;
    this.onFrame();
    if (again) this.request();
  }

  renderBase(full) {
    const { W, H, dpr } = this;
    const M = Math.round(Math.max(W, H) * 0.22);
    const bw = Math.round((W + 2 * M) * dpr), bh = Math.round((H + 2 * M) * dpr);
    if (this.base.width !== bw || this.base.height !== bh) { this.base.width = bw; this.base.height = bh; }
    const g = this.bctx, k = this.k, z = this.zoom, geo = this.geo;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = PAL.sea;
    g.fillRect(0, 0, bw, bh);
    g.setTransform(k * dpr, 0, 0, -k * dpr, (W / 2 + M - this.cx * k) * dpr, (H / 2 + M + this.cy * k) * dpr);
    g.lineJoin = 'round'; g.lineCap = 'round';
    const px = v => v / k;

    // Nachbarländer
    for (const [code, path] of geo.neighbors) {
      g.fillStyle = code === 'DEU' ? PAL.land : PAL.neighbor;
      g.fill(path, 'evenodd');
    }
    g.strokeStyle = PAL.neighborEdge; g.lineWidth = px(0.8);
    for (const [code, path] of geo.neighbors) if (code !== 'DEU') g.stroke(path);
    // Deutschland
    g.fillStyle = PAL.land; g.fill(geo.land, 'evenodd');
    // Gewässer
    const rs = Math.min(2, 1 + 0.28 * Math.log2(Math.max(1, z)));
    const widths = [1.9, 1.35, 1.0, 0.7];
    g.strokeStyle = PAL.river;
    geo.rivers.forEach((b, i) => { g.lineWidth = px(widths[i] * rs); g.stroke(b.path); });
    g.fillStyle = PAL.lake; g.fill(geo.lakes, 'evenodd');
    g.strokeStyle = PAL.river; g.lineWidth = px(0.7); g.stroke(geo.lakes);
    // Gemeindegrenzen (nur in Ruhe und ab etwas Zoom deutlich)
    if (full || z > 2) {
      const a = Math.min(0.13, 0.03 + 0.022 * Math.max(0, z - 1));
      g.strokeStyle = `rgba(${PAL.muni.join(',')},${a.toFixed(3)})`;
      g.lineWidth = px(z > 6 ? 0.7 : 0.5);
      g.stroke(geo.munis);
    }
    g.strokeStyle = PAL.district; g.lineWidth = px(z > 4 ? 0.9 : 0.65); g.stroke(geo.districts);
    // Gefundene Stadtgebiete
    if (this.found.size) {
      g.fillStyle = PAL.areaFill;
      g.strokeStyle = PAL.areaEdge;
      g.lineWidth = px(0.7);
      for (const id of this.found) {
        const p = this.cityPath(id);
        g.fill(p, 'evenodd');
        if (z > 1.8) g.stroke(p);
      }
    }
    g.strokeStyle = PAL.state; g.lineWidth = px(z > 4 ? 1.5 : 1.15); g.stroke(geo.states);
    g.strokeStyle = PAL.outline; g.lineWidth = px(1.35); g.stroke(geo.outline);

    // Beschriftung (Länder, Meere, Bundesländer)
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const sp = (x, y) => [(x - this.cx) * k + W / 2 + M, (this.cy - y) * k + H / 2 + M];
    for (const l of geo.labels) {
      const [x, y] = sp(l.x, l.y);
      g.font = `400 ${l.k === 's' ? 15 : 13}px ${FONT}`;
      g.fillStyle = l.k === 's' ? PAL.seaLabel : PAL.neighborLabel;
      spaced(g, l.n, x, y, l.k === 's' ? 3 : 1.5);
    }
    this.baseView = { cx: this.cx, cy: this.cy, k, W, H, M };
    this.baseDirty = false;
  }

  cityPath(id) {
    let p = this.cityPaths.get(id);
    if (!p) { p = polygonsPath(this.geo.arcs, this.geo.cityPolys[id]); this.cityPaths.set(id, p); }
    return p;
  }

  draw(now) {
    const { ctx, W, H, dpr } = this;
    const bv = this.baseView;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PAL.sea;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (bv) {
      const s = this.k / bv.k;
      const bx = (bv.cx - this.cx) * this.k + W / 2, by = (this.cy - bv.cy) * this.k + H / 2;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.base, bx - (bv.W / 2 + bv.M) * s, by - (bv.H / 2 + bv.M) * s, (bv.W + 2 * bv.M) * s, (bv.H + 2 * bv.M) * s);
    }
    const z = this.zoom, k = this.k, cx = this.cx, cy = this.cy;
    const zr = Math.min(1.9, 1 + 0.2 * Math.log2(Math.max(1, z)));
    const rad = p => (1.25 + 0.95 * Math.log10(Math.max(p, 1000) / 1000)) * zr;
    const sx = c => (c.x - cx) * k + W / 2, sy = c => (cy - c.y) * k + H / 2;

    // Fehlende Städte (Lösung)
    if (this.showMissing) {
      ctx.strokeStyle = PAL.missing; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let id = 0; id < this.cities.length; id++) {
        if (this.found.has(id)) continue;
        const c = this.cities[id], x = sx(c), y = sy(c);
        if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue;
        const r = Math.max(1.6, rad(c.p) * 0.8);
        ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.stroke();
    }
    if (this.found.size) {
      // Lichthöfe (additiv: dichte Regionen leuchten heller)
      ctx.globalCompositeOperation = 'lighter';
      // kleine Karten (Handy) bekommen kleinere, schwächere Lichthöfe
      const gs = Math.min(1, Math.max(0.55, Math.min(W, H) / 800));
      ctx.globalAlpha = Math.min(0.85, (0.4 + 0.07 * z) * (0.75 + 0.25 * gs));
      for (const id of this.found) {
        const c = this.cities[id], x = sx(c), y = sy(c);
        const gr = (rad(c.p) * 4.4 + 4) * gs;
        if (x < -gr || y < -gr || x > W + gr || y > H + gr) continue;
        ctx.drawImage(this.glow, x - gr, y - gr, gr * 2, gr * 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = PAL.dot;
      ctx.beginPath();
      for (const id of this.found) {
        const c = this.cities[id], x = sx(c), y = sy(c);
        if (x < -8 || y < -8 || x > W + 8 || y > H + 8) continue;
        const r = rad(c.p);
        ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    // Auswahl
    if (this.selected >= 0) {
      const c = this.cities[this.selected], x = sx(c), y = sy(c), r = rad(c.p) + 5;
      ctx.strokeStyle = this.found.has(this.selected) ? PAL.sign : PAL.missing;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    }
    // Puls für neue Funde
    if (this.pulses.length) {
      this.pulses = this.pulses.filter(p => now - p.t0 < 1500);
      for (const p of this.pulses) {
        const t = (now - p.t0) / 1500, c = this.cities[p.id];
        const r = rad(c.p) + 4 + t * 34;
        ctx.strokeStyle = `rgba(246,194,28,${(0.9 * (1 - t)).toFixed(3)})`;
        ctx.lineWidth = 2 * (1 - t) + 0.5;
        ctx.beginPath(); ctx.arc(sx(c), sy(c), r, 0, Math.PI * 2); ctx.stroke();
      }
    }
    this.drawLabels(sx, sy, rad, z);
  }

  drawLabels(sx, sy, rad, z) {
    const { ctx, W, H } = this;
    const cell = 8, cols = Math.ceil(W / cell) + 1, rows = Math.ceil(H / cell) + 1;
    const grid = new Uint8Array(cols * rows);
    const free = (x0, y0, x1, y1) => {
      const a = Math.max(0, Math.floor(x0 / cell)), b = Math.min(cols - 1, Math.floor(x1 / cell));
      const c = Math.max(0, Math.floor(y0 / cell)), d = Math.min(rows - 1, Math.floor(y1 / cell));
      for (let j = c; j <= d; j++) for (let i = a; i <= b; i++) if (grid[j * cols + i]) return false;
      return true;
    };
    const take = (x0, y0, x1, y1) => {
      const a = Math.max(0, Math.floor(x0 / cell)), b = Math.min(cols - 1, Math.floor(x1 / cell));
      const c = Math.max(0, Math.floor(y0 / cell)), d = Math.min(rows - 1, Math.floor(y1 / cell));
      for (let j = c; j <= d; j++) for (let i = a; i <= b; i++) grid[j * cols + i] = 1;
    };
    const maxLabels = Math.min(420, Math.round(70 * z * z));
    let n = 0;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = PAL.halo;
    ctx.fillStyle = PAL.label;
    // Selektierte Stadt zuerst beschriften
    const order = this.selected >= 0 && this.found.has(this.selected) ? [this.selected, ...this.labelOrder.filter(i => i !== this.selected)] : this.labelOrder;
    for (const id of order) {
      if (n >= maxLabels) break;
      const c = this.cities[id], x = sx(c), y = sy(c);
      if (x < -150 || y < -20 || x > W + 150 || y > H + 20) continue;
      const big = c.p >= 100000, size = c.p >= 500000 ? 14 : big ? 13 : 12;
      const font = `${big ? 700 : 400} ${size}px ${FONT}`;
      let w = this.textW.get(id);
      if (w === undefined) { ctx.font = font; w = ctx.measureText(c.n).width; this.textW.set(id, w); }
      const r = rad(c.p), h = size;
      let lx = x + r + 4, align = 'left';
      if (!free(lx - 2, y - h / 2 - 2, lx + w + 2, y + h / 2 + 2)) {
        lx = x - r - 4; align = 'right';
        if (!free(lx - w - 2, y - h / 2 - 2, lx + 2, y + h / 2 + 2)) continue;
      }
      if (align === 'left') take(lx - 2, y - h / 2 - 2, lx + w + 2, y + h / 2 + 2);
      else take(lx - w - 2, y - h / 2 - 2, lx + 2, y + h / 2 + 2);
      take(x - r, y - r, x + r, y + r);
      ctx.font = font;
      ctx.textAlign = align;
      ctx.lineWidth = 3.2;
      ctx.strokeText(c.n, lx, y);
      ctx.fillText(c.n, lx, y);
      n++;
    }
    this.drawStateLabels(free, z);
  }

  // Bundesländer nur dort beschriften, wo keine Stadt-Beschriftung liegt
  drawStateLabels(free, z) {
    const la = z < 1.2 ? 0.62 : z < 3.2 ? 0.62 * (3.2 - z) / 2 : 0;
    if (la < 0.02) return;
    const { ctx, W, H } = this;
    ctx.font = `400 13px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = `rgba(${PAL.stateLabel.join(',')},${la.toFixed(3)})`;
    const sp = 2.2;
    for (const s of this.geo.stateLabels) {
      if (s.a < 1000) continue; // Stadtstaaten nicht beschriften (das wären Lösungen)
      let m = this.stateW?.get(s.n);
      if (!m) {
        const ws = [...s.n].map(ch => ctx.measureText(ch).width);
        m = { ws, total: ws.reduce((a, b) => a + b, 0) + sp * (ws.length - 1) };
        (this.stateW ||= new Map()).set(s.n, m);
      }
      const x = (s.x - this.cx) * this.k + W / 2, y = (this.cy - s.y) * this.k + H / 2;
      const x0 = x - m.total / 2;
      if (x0 + m.total < 0 || x0 > W || y < -10 || y > H + 10) continue;
      if (!free(x0 - 2, y - 9, x0 + m.total + 2, y + 9)) continue;
      let cx = x0;
      [...s.n].forEach((ch, i) => { ctx.fillText(ch, cx, y); cx += m.ws[i] + sp; });
    }
  }
}

// Gesperrter Text (Canvas kennt letterSpacing nicht überall)
function spaced(g, text, x, y, spacing) {
  if ('letterSpacing' in g) {
    g.letterSpacing = spacing + 'px';
    g.fillText(text, x + spacing / 2, y);
    g.letterSpacing = '0px';
    return;
  }
  const chars = [...text];
  const widths = chars.map(ch => g.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  let cx = x - total / 2;
  const prev = g.textAlign;
  g.textAlign = 'left';
  chars.forEach((ch, i) => { g.fillText(ch, cx, y); cx += widths[i] + spacing; });
  g.textAlign = prev;
}
