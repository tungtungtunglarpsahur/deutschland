"""Stufe 2: Anzeigenamen, Kurznamen, andere Schreibweisen, Einwohner und Beschriftungspunkt je Ort.

Ausgabe: WORK/places_stage2.json
"""
import os
import json
import re
import unicodedata
from collections import Counter

from shapely.geometry import Point, shape
from shapely.ops import polylabel, unary_union

WORK = os.environ.get('WORK', '.work')
SRC = os.environ.get('SRC', '.src')

gem = json.load(open(WORK + '/gem.geojson'))['features']
places = json.load(open(WORK + '/places_stage1.json'))
kf_raw = json.load(open(SRC + '/lk/package/data/districts.json'))
STATES = ['Schleswig-Holstein', 'Hamburg', 'Niedersachsen', 'Bremen', 'Nordrhein-Westfalen', 'Hessen', 'Rheinland-Pfalz', 'Baden-Württemberg',
          'Bayern', 'Saarland', 'Berlin', 'Brandenburg', 'Mecklenburg-Vorpommern', 'Sachsen', 'Sachsen-Anhalt', 'Thüringen']
UNINCORPORATED = {'Lohheide', 'Osterheide'}  # bewohnte gemeindefreie Bezirke, amtlich bei den Gemeinden mitgezählt


def strict(s):
    return re.sub(r'[^a-z0-9äöü]', '', s.lower().replace('ß', 'ss'))


def norm(s):
    s = s.lower().replace('ß', 'ss')
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r'\bsankt\b', 'st', s)
    s = re.sub(r'\bst\.', 'st ', s)
    return re.sub(r'[^a-z0-9]', '', s)


kreisfrei = set()
for x in kf_raw:
    if x['type'] in ('Kreisfreie Stadt', 'Stadtkreis') and not x['name'].startswith('Eisenach'):
        n = x['name'].split(',')[0]
        n = {'Oldenburg (Oldenburg)': 'Oldenburg (Oldb)'}.get(n, n)
        kreisfrei.add(strict(n))

# ---------- Anzeigenamen: amtliche Abkürzungen ausschreiben ----------
SPECIAL = {
    'Bernstadt a.d.Eigen': 'Bernstadt auf dem Eigen',
    'Hann.Münden': 'Hann. Münden',
    'Königstein/Sächs.Schw.': 'Königstein (Sächsische Schweiz)',
    'Tambach-Dietharz/Thür.Wald': 'Tambach-Dietharz',
    'Frankenberg/Sa.': 'Frankenberg/Sachsen',
    'Weilheim i.OB': 'Weilheim in Oberbayern',
    'Neukirchen b.Hl.Blut': 'Neukirchen beim Heiligen Blut',
}
REPL = [
    (r' a\.d\.Eigen', ' auf dem Eigen'), (r' a\.Darß', ' auf dem Darß'),
    (r' i\.d\.O\.L\.', ' in der Oberlausitz'), (r' i\.d\.OPf\.', ' in der Oberpfalz'), (r' i\.d\.', ' in der '),
    (r' i\.Bay\.', ' in Bayern'), (r' i\.UFr\.', ' in Unterfranken'), (r' i\.OFr\.', ' in Oberfranken'),
    (r' i\.NB\b', ' in Niederbayern'), (r' i\.OB\b', ' in Oberbayern'), (r' i\.Schw\.', ' in Schwaben'),
    (r' i\.Odw\.', ' im Odenwald'), (r' i\.', ' im '),
    (r' a\.d\.', ' an der '), (r' v\.d\.', ' vor der '), (r' a\.', ' am '), (r' b\.', ' bei '),
    (r'\(Rhld\.\)', '(Rheinland)'),
]


def display(official):
    if official in SPECIAL:
        return SPECIAL[official]
    n = official
    for a, b in REPL:
        n = re.sub(a, b, n)
    return re.sub(r'\s+', ' ', n).strip()


QUAL = r'\s+(an der|am|im|in der|in|ob der|bei|beim|auf dem|auf|vor der|unter|zu)\s+'


def short(n):
    s = re.split(r'\s*\(|/', n)[0]
    s = re.split(QUAL, s)[0]
    return s.strip()


def label_point(geom, lon=None, lat=None):
    if lon is not None:
        p = Point(lon, lat)
        if geom.buffer(0.004).contains(p):
            return p
    part = max(geom.geoms, key=lambda g: g.area) if geom.geom_type == 'MultiPolygon' else geom
    return polylabel(part, tolerance=0.0005)


out = []
for idx, c in enumerate(places):
    gis = c['gi']
    g0 = gem[gis[0]]['properties']
    official = c.get('rename') or g0['GEM']
    disp = display(official)
    pop = sum(gem[i]['properties']['EWZ'] or 0 for i in gis)
    geom = unary_union([shape(gem[i]['geometry']) for i in gis])
    pt = label_point(geom, c['lon'], c['lat'])
    st = STATES.index(c['state'])
    krs = g0['KRS']
    kfrei = c['town'] and (strict(official) in kreisfrei or strict(g0['GEM']) in kreisfrei or c['state'] in ('Berlin', 'Hamburg'))
    if kfrei:
        krs = official
    out.append({'i': idx, 'gis': gis, 'official': official, 'name': disp, 'short': short(disp), 'pop': int(pop),
                'lon': round(pt.x, 5), 'lat': round(pt.y, 5), 's': st, 'krs': krs, 'kf': kfrei, 'town': c['town'],
                'gf': official in UNINCORPORATED, 'src': c['src']})

# ---------- andere Schreibweisen ----------
fullset = Counter()
for o in out:
    fullset.update({norm(o['name']), norm(o['official'])})
shortset = Counter(norm(o['short']) for o in out)
EXON = {'Köln': ['Cologne'], 'München': ['Munich'], 'Nürnberg': ['Nuremberg'], 'Braunschweig': ['Brunswick'], 'Hannover': ['Hanover'],
        'Konstanz': ['Constance'], 'Hameln': ['Hamelin'], 'Hann. Münden': ['Hannoversch Münden', 'Münden'],
        'Heilbad Heiligenstadt': ['Heiligenstadt'], 'Stadt Wehlen': ['Wehlen'], 'Amt Creuzburg': ['Creuzburg'],
        'Eisleben': ['Lutherstadt Eisleben'], 'Wittenberg': ['Lutherstadt Wittenberg'],
        'Frankfurt (Oder)': ['Frankfurt an der Oder', 'Frankfurt/Oder'], 'Aue-Bad Schlema': ['Aue'], 'Halle (Saale)': ['Halle an der Saale'],
        'Frankfurt am Main': ['Frankfurt Main'], 'Weiden in der Oberpfalz': ['Weiden'], 'Neumarkt in der Oberpfalz': ['Neumarkt'],
        'Oldenburg (Oldb)': ['Oldenburg (Oldenburg)'], 'Dessau-Roßlau': ['Dessau'], 'Cottbus': ['Chóśebuz'], 'Bautzen': ['Budyšin'],
        'Kempten (Allgäu)': ['Kempten im Allgäu'], 'Lindau (Bodensee)': ['Lindau am Bodensee'], 'Radolfzell am Bodensee': ['Radolfzell'],
        'Villingen-Schwenningen': ['Villingen', 'Schwenningen'], 'Berga-Wünschendorf': ['Berga', 'Berga/Elster', 'Berga an der Elster', 'Wünschendorf']}
FOREIGN = ('Cologne', 'Munich', 'Brunswick', 'Hanover', 'Constance', 'Nuremberg', 'Hamelin', 'Herne city', 'Essen')


def free(name):
    """Alias nur, wenn kein anderer Ort so heißt."""
    k = norm(name)
    return fullset[k] == 0 and shortset[k] == 0


for o in out:
    al = {o['official'], o['name']}
    src = o['src']
    if o['town'] and src not in FOREIGN and not re.search(r'[A-Z][a-zæøåö]+[A-Z]', src) and ',' not in src:
        al.add(src)
    al.update(EXON.get(o['name'], []) if o['town'] else [])
    if o['name'].startswith('Bad ') and free(o['name'][4:]):
        al.add(o['name'][4:])
    parts = o['short'].split('-')
    if len(parts) == 2:
        for p in parts:
            p = p.strip()
            if len(p) >= 4 and free(p):
                al.add(p)
    o['aliases'] = sorted(a for a in al if a and a != o['name'])

# Anzeigenamen der Städte dürfen sich nicht ändern (Spielstände speichern sie)
prev = os.environ.get('PREV_PLACES')
if prev and os.path.exists(prev):
    rows = json.load(open(prev))
    old = [(r['n'], r['s']) if isinstance(r, dict) else (r[0], r[1]) for r in rows if isinstance(r, dict) or r[6] & 1]
    new = [(o['name'], o['s']) for o in out if o['town']]
    changed = sorted(set(old) - set(new))
    assert not changed, ('Städtenamen geändert', changed[:20])

json.dump(out, open(WORK + '/places_stage2.json', 'w'), ensure_ascii=False)
print('Orte', len(out), 'davon Städte', sum(o['town'] for o in out), 'kreisfrei', sum(o['kf'] for o in out),
      'gemeindefreie Bezirke', sum(o['gf'] for o in out))
print('häufigste Kurznamen', Counter(o['short'] for o in out).most_common(8))
