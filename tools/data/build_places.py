"""Stufe 1: alle Orte (Städte und übrige Gemeinden) den VG250-Gemeindeflächen zuordnen.

Städte kommen aus der Wikipedia-Liste (pensnarik/german-cities) plus Änderungen bis 2025,
alle übrigen bewohnten Gemeinden direkt aus VG250. Ausgabe: WORK/places_stage1.json
"""
import os
import json
import math
import re
import unicodedata
from collections import Counter

from shapely.geometry import Point, shape
from shapely.strtree import STRtree

WORK = os.environ.get('WORK', '.work')
SRC = os.environ.get('SRC', '.src')

gem = json.load(open(WORK + '/gem.geojson'))['features']
geoms = [shape(f['geometry']) for f in gem]
tree = STRtree(geoms)
src = json.load(open(SRC + '/german-cities/germany.json'))

STATE = {'North Rhine-Westphalia': 'Nordrhein-Westfalen', 'Bavaria': 'Bayern', 'Baden-Württemberg': 'Baden-Württemberg', 'Hesse': 'Hessen',
         'Saxony': 'Sachsen', 'Lower Saxony': 'Niedersachsen', 'Rhineland-Palatinate': 'Rheinland-Pfalz', 'Thuringia': 'Thüringen',
         'Brandenburg': 'Brandenburg', 'Saxony-Anhalt': 'Sachsen-Anhalt', 'Mecklenburg-Western Pomerania': 'Mecklenburg-Vorpommern',
         'Schleswig-Holstein': 'Schleswig-Holstein', 'Saarland': 'Saarland', 'Bremen': 'Bremen', 'Berlin': 'Berlin', 'Hamburg': 'Hamburg'}
EXO = {'Cologne': 'Köln', 'Munich': 'München', 'Brunswick': 'Braunschweig', 'Hanover': 'Hannover', 'Constance': 'Konstanz',
       'Nuremberg': 'Nürnberg', 'Hamelin': 'Hameln', 'Herne city': 'Herne', 'Stadt Tegernsee': 'Tegernsee',
       'FriedrichstadtFrederiksstad': 'Friedrichstadt'}


def norm(s):
    s = s.lower().replace('ß', 'ss')
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r'\bsankt\b', 'st', s)
    s = re.sub(r'\bst\.', 'st ', s)
    return re.sub(r'[^a-z0-9]', '', s)


def clean(n):
    n = EXO.get(n, n)
    n = re.sub(r'^Hanseatic City of ', '', n)
    n = re.sub(r', [A-Z][A-Za-z\- ]+$', '', n)   # ", Bavaria", ", Germany", ...
    return n


def base(s):
    s = re.split(r'\s*\(|/|,', s)[0]
    s = re.split(r' (an der|am|im|in|ob der|bei|auf|vor der|a\. ?d\.|a\.|i\.|b\.|v\.d\.|i\.d\.)\b', s)[0]
    return norm(s.strip())


bystate = {}
for i, f in enumerate(gem):
    p = f['properties']
    if (p['EWZ'] or 0) > 0:
        bystate.setdefault(p['LAN'], []).append(i)


def dist(i, lon, lat):
    c = geoms[i].representative_point()
    return math.hypot((c.x - lon) * math.cos(math.radians(lat)), c.y - lat) * 111


# ---------- Städte ----------
towns, issues = [], []
for c in src:
    raw = c['name']
    st = STATE[c['state']]
    lat, lon = float(c['coords']['lat']), float(c['coords']['lon'])
    if raw == 'Essen' and st == 'Niedersachsen':
        raw = 'Esens'
    name = clean(raw)
    p = Point(lon, lat)
    pip = [i for i in tree.query(p) if geoms[i].contains(p) and (gem[i]['properties']['EWZ'] or 0) > 0]
    cand = set(i for i in bystate[st] if norm(gem[i]['properties']['GEM']) == norm(name) or base(gem[i]['properties']['GEM']) == base(name))
    if not cand:  # friesische/dänische Doppelnamen: Lage + Namensanfang
        for i in pip:
            if norm(gem[i]['properties']['GEM'])[:4] == norm(name)[:4]:
                cand.add(i)
    if not cand:
        issues.append(('NOCAND', raw, st, lat, lon, [gem[i]['properties']['GEM'] for i in pip]))
        continue
    best = min(cand, key=lambda i: dist(i, lon, lat))
    d = dist(best, lon, lat)
    if d > 20:
        issues.append(('FAR', raw, st, gem[best]['properties']['GEM'], round(d, 1)))
    towns.append({'gi': [int(best)], 'src': raw, 'lat': lat, 'lon': lon, 'state': st, 'town': True})


def find(name, st):
    r = [i for i in bystate[st] if gem[i]['properties']['GEM'] == name]
    assert len(r) == 1, (name, r)
    return int(r[0])


# ---------- Änderungen seit der Liste von 2021 ----------
# Berga/Elster + Wünschendorf/Elster -> Stadt Berga-Wünschendorf (1.1.2024)
b, w = find('Berga/Elster', 'Thüringen'), find('Wünschendorf/Elster', 'Thüringen')
for c in towns:
    if c['gi'] == [b]:
        c['gi'] = [b, w]
        c['rename'] = 'Berga-Wünschendorf'
# Tamm (Stadt seit 1.3.2022), Oberderdingen (seit 1.11.2023), Haar (seit Januar 2025)
towns.append({'gi': [find('Tamm', 'Baden-Württemberg')], 'src': 'Tamm', 'lat': 48.9196, 'lon': 9.1155, 'state': 'Baden-Württemberg', 'town': True})
towns.append({'gi': [find('Oberderdingen', 'Baden-Württemberg')], 'src': 'Oberderdingen', 'lat': 49.0656, 'lon': 8.8031, 'state': 'Baden-Württemberg', 'town': True})
towns.append({'gi': [find('Haar', 'Bayern')], 'src': 'Haar', 'lat': 48.1089, 'lon': 11.7278, 'state': 'Bayern', 'town': True})

cnt = Counter(g for c in towns for g in c['gi'])
dups = [g for g, n in cnt.items() if n > 1]
assert not dups, [gem[g]['properties'] for g in dups]

# ---------- übrige Gemeinden ----------
used = set(cnt)
others = []
for i, f in enumerate(gem):
    p = f['properties']
    if i in used or (p['EWZ'] or 0) <= 0:
        continue  # Stadt oder unbewohntes gemeindefreies Gebiet
    others.append({'gi': [i], 'src': p['GEM'], 'lat': None, 'lon': None, 'state': p['LAN'], 'town': False})

places = towns + others
print('Städte', len(towns), 'Gemeinden', len(others), 'zusammen', len(places))
for x in issues:
    print('  Hinweis:', x)
json.dump(places, open(WORK + '/places_stage1.json', 'w'), ensure_ascii=False)
