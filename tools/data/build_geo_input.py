"""Gemeindeflächen mit Ort, Kreis und Land verschlagworten (Eingabe für mapshaper)."""
import os
import json
import re

WORK = os.environ.get('WORK', '.work')
SRC = os.environ.get('SRC', '.src')

gem = json.load(open(WORK + '/gem.geojson'))['features']
places = json.load(open(WORK + '/places_stage2.json'))
kf_raw = json.load(open(SRC + '/lk/package/data/districts.json'))
STATES = ['Schleswig-Holstein', 'Hamburg', 'Niedersachsen', 'Bremen', 'Nordrhein-Westfalen', 'Hessen', 'Rheinland-Pfalz', 'Baden-Württemberg',
          'Bayern', 'Saarland', 'Berlin', 'Brandenburg', 'Mecklenburg-Vorpommern', 'Sachsen', 'Sachsen-Anhalt', 'Thüringen']


def strict(s):
    return re.sub(r'[^a-z0-9äöü]', '', s.lower().replace('ß', 'ss'))


kreisfrei = set()
for x in kf_raw:
    if x['type'] in ('Kreisfreie Stadt', 'Stadtkreis') and not x['name'].startswith('Eisenach'):
        n = x['name'].split(',')[0]
        n = {'Oldenburg (Oldenburg)': 'Oldenburg (Oldb)'}.get(n, n)
        kreisfrei.add(strict(n))

placeof = {}
for o in places:
    for g in o['gis']:
        placeof[g] = o['i']
feats, nsk = [], 0
for i, f in enumerate(gem):
    p = f['properties']
    s = STATES.index(p['LAN'])
    if strict(p['GEM']) in kreisfrei and (strict(p['KRS']) == strict(p['GEM']) or p['GEM'] == 'Landau in der Pfalz' or p['LAN'] in ('Berlin', 'Hamburg')):
        d = 'SK:' + p['GEM']
        nsk += 1
    else:
        d = 'LK:' + p['KRS'] + '|' + str(s)
    feats.append({'type': 'Feature', 'properties': {'g': i, 'c': placeof.get(i, -1), 'd': d, 's': s}, 'geometry': f['geometry']})
json.dump({'type': 'FeatureCollection', 'features': feats}, open(WORK + '/gem_in.geojson', 'w'), ensure_ascii=False)
print('Flächen', len(feats), 'kreisfreie Städte', nsk, 'ohne Ort (gemeindefrei)', sum(1 for f in feats if f['properties']['c'] < 0))
