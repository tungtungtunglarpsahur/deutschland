"""App-Icons erzeugen: Deutschland bei Nacht mit den größten Städten als Lichter.

Aufruf (im Repo-Hauptordner):  python3 tools/make_icons.py
Benötigt: Pillow
"""
import json
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
M = json.loads((ROOT / 'data/map.json').read_text(encoding='utf-8'))
C = json.loads((ROOT / 'data/cities.json').read_text(encoding='utf-8'))

sx, sy = M['t']['scale']
tx, ty = M['t']['translate']
arcs = []
for a in M['arcs']:
    x = y = 0
    pts = []
    for dx, dy in a:
        x += dx
        y += dy
        pts.append((x * sx + tx, y * sy + ty))
    arcs.append(pts)


def ring(idx):
    pts = []
    for i in idx:
        a = arcs[i] if i >= 0 else arcs[~i][::-1]
        pts.extend(a if not pts else a[1:])
    return pts


land = [[ring(r) for r in poly] for poly in M['land']]
x0, y0, x1, y1 = M['bbox']

NIGHT = (10, 22, 48)
LAND = (24, 46, 92)
EDGE = (120, 146, 205)


def render(size, pad_ratio, n_lights, path):
    ss = 4
    S = size * ss
    pad = S * pad_ratio
    k = min((S - 2 * pad) / (x1 - x0), (S - 2 * pad) / (y1 - y0))
    ox = (S - (x1 - x0) * k) / 2
    oy = (S - (y1 - y0) * k) / 2

    def P(x, y):
        return (ox + (x - x0) * k, oy + (y1 - y) * k)

    img = Image.new('RGB', (S, S), NIGHT)
    d = ImageDraw.Draw(img)
    for poly in land:
        d.polygon([P(*p) for p in poly[0]], fill=LAND)
    for poly in land:
        d.line([P(*p) for p in poly[0]] + [P(*poly[0][0])], fill=EDGE, width=max(1, int(S / 260)))

    lights = sorted(C, key=lambda c: -c['p'])[:n_lights]
    glow = Image.new('RGB', (S, S), (0, 0, 0))
    g = ImageDraw.Draw(glow)
    dots = Image.new('L', (S, S), 0)
    dd = ImageDraw.Draw(dots)
    for c in lights:
        x, y = P(c['x'], c['y'])
        r = S / 180 * (0.7 + 0.55 * math.log10(max(c['p'], 20000) / 20000))
        gr = r * 3.2
        g.ellipse([x - gr, y - gr, x + gr, y + gr], fill=(150, 112, 50))
        dd.ellipse([x - r, y - r, x + r, y + r], fill=255)
    glow = glow.filter(ImageFilter.GaussianBlur(S / 70))
    img = ImageChops.add(img, glow)
    img.paste((255, 255, 255), (0, 0), dots)
    img = img.resize((size, size), Image.LANCZOS)
    img.save(path, optimize=True)


out = ROOT / 'icons'
out.mkdir(exist_ok=True)
render(512, 0.08, 90, out / 'icon-512.png')
render(192, 0.08, 60, out / 'icon-192.png')
render(180, 0.09, 60, out / 'apple-touch-icon.png')
render(512, 0.2, 90, out / 'icon-maskable-512.png')
render(32, 0.04, 8, out / 'favicon-32.png')
print('Icons geschrieben nach', out)
