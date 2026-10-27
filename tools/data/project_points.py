"""Orte und Beschriftungen in die Kartenprojektion umrechnen und data/places.json schreiben.

Zeilenformat: [Name, Land, Einwohner, x, y, Kreis, Merkmale, andere Schreibweisen | 0, Kurzname | 0]
Merkmale (Bits): 1 = Stadt, 2 = kreisfrei, 4 = gemeindefreier Bezirk. Kreis ist leer bei kreisfreien Städten.
"""
import os
import json

from pyproj import Transformer

WORK = os.environ.get('WORK', '.work')
PROJ = '+proj=lcc +lat_1=48.67 +lat_2=53.67 +lat_0=51 +lon_0=10.45 +datum=WGS84 +units=m +no_defs'
tf = Transformer.from_crs('EPSG:4326', PROJ, always_xy=True)

labels = [('Dänemark', 9.75, 55.55, 'c'), ('Niederlande', 5.75, 52.45, 'c'), ('Belgien', 5.05, 50.55, 'c'), ('Luxemburg', 6.05, 49.62, 'c'),
          ('Frankreich', 6.55, 48.35, 'c'), ('Schweiz', 8.25, 47.05, 'c'), ('Österreich', 12.9, 47.45, 'c'), ('Tschechien', 14.65, 49.85, 'c'),
          ('Polen', 15.75, 52.55, 'c'), ('Schweden', 13.6, 55.85, 'c'), ('Nordsee', 7.2, 54.55, 's'), ('Ostsee', 12.4, 54.82, 's')]
out = []
for n, lon, lat, k in labels:
    x, y = tf.transform(lon, lat)
    out.append({'n': n, 'x': round(x), 'y': round(y), 'k': k})
json.dump(out, open(WORK + '/labels_proj.json', 'w'), ensure_ascii=False)

places = json.load(open(WORK + '/places_stage2.json'))
rows = []
for c in places:
    x, y = tf.transform(c['lon'], c['lat'])
    flags = (1 if c['town'] else 0) | (2 if c['kf'] else 0) | (4 if c['gf'] else 0)
    row = [c['name'], c['s'], c['pop'], round(x / 10) * 10, round(y / 10) * 10, '' if c['kf'] else c['krs'], flags]
    short = c['short'] if c['short'] != c['name'] else 0
    if c['aliases'] or short:
        row.append(c['aliases'] or 0)
    if short:
        row.append(short)
    rows.append(row)
with open(WORK + '/places_final.json', 'w') as f:
    f.write('[\n' + ',\n'.join(json.dumps(r, ensure_ascii=False, separators=(',', ':')) for r in rows) + '\n]\n')
print('Orte', len(rows), os.path.getsize(WORK + '/places_final.json'), 'Bytes')
