import os
WORK = os.environ.get('WORK', '.work')
SRC = os.environ.get('SRC', '.src')
import json, re, unicodedata, math
from shapely.geometry import shape, Point
from shapely.ops import unary_union, polylabel
from shapely.strtree import STRtree
gem=json.load(open(WORK+'/gem.geojson'))['features']
geoms=[shape(f['geometry']) for f in gem]
tree=STRtree(geoms)
src=json.load(open(SRC+'/german-cities/germany.json'))
STATE={'North Rhine-Westphalia':'Nordrhein-Westfalen','Bavaria':'Bayern','Baden-Württemberg':'Baden-Württemberg','Hesse':'Hessen','Saxony':'Sachsen','Lower Saxony':'Niedersachsen','Rhineland-Palatinate':'Rheinland-Pfalz','Thuringia':'Thüringen','Brandenburg':'Brandenburg','Saxony-Anhalt':'Sachsen-Anhalt','Mecklenburg-Western Pomerania':'Mecklenburg-Vorpommern','Schleswig-Holstein':'Schleswig-Holstein','Saarland':'Saarland','Bremen':'Bremen','Berlin':'Berlin','Hamburg':'Hamburg'}
EXO={'Cologne':'Köln','Munich':'München','Brunswick':'Braunschweig','Hanover':'Hannover','Constance':'Konstanz','Nuremberg':'Nürnberg','Hamelin':'Hameln','Herne city':'Herne','Stadt Tegernsee':'Tegernsee','FriedrichstadtFrederiksstad':'Friedrichstadt'}
def norm(s):
    s=s.lower().replace('ß','ss'); s=unicodedata.normalize('NFKD',s); s=''.join(c for c in s if not unicodedata.combining(c))
    s=re.sub(r'\bsankt\b','st',s); s=re.sub(r'\bst\.','st ',s)
    return re.sub(r'[^a-z0-9]','',s)
def clean(n):
    n=EXO.get(n,n)
    n=re.sub(r'^Hanseatic City of ','',n)
    n=re.sub(r', [A-Z][A-Za-z\- ]+$','',n)   # ", Bavaria", ", Germany", ...
    return n
def base(s):
    s=re.split(r'\s*\(|/|,', s)[0]
    s=re.split(r' (an der|am|im|in|ob der|bei|auf|vor der|a\. ?d\.|a\.|i\.|b\.|v\.d\.|i\.d\.)\b', s)[0]
    return norm(s.strip())
bystate={}
for i,f in enumerate(gem):
    p=f['properties']
    if (p['EWZ'] or 0)>0: bystate.setdefault(p['LAN'],[]).append(i)
def dist(i,lon,lat):
    c=geoms[i].representative_point()
    return math.hypot((c.x-lon)*math.cos(math.radians(lat)),c.y-lat)*111
cities=[]; issues=[]
for c in src:
    raw=c['name']; st=STATE[c['state']]
    lat=float(c['coords']['lat']); lon=float(c['coords']['lon'])
    if raw=='Essen' and st=='Niedersachsen': raw='Esens'
    name=clean(raw)
    p=Point(lon,lat)
    pip=[i for i in tree.query(p) if geoms[i].contains(p) and (gem[i]['properties']['EWZ'] or 0)>0]
    cand=set(i for i in bystate[st] if norm(gem[i]['properties']['GEM'])==norm(name) or base(gem[i]['properties']['GEM'])==base(name))
    # PIP hit with similar name prefix also candidate (handles Frisian/Danish double names)
    if not cand:
        for i in pip:
            if norm(gem[i]['properties']['GEM'])[:4]==norm(name)[:4]: cand.add(i)
    if not cand:
        issues.append(('NOCAND',raw,st,lat,lon,[gem[i]['properties']['GEM'] for i in pip])); continue
    best=min(cand,key=lambda i:dist(i,lon,lat))
    d=dist(best,lon,lat)
    if d>20: issues.append(('FAR',raw,st,gem[best]['properties']['GEM'],round(d,1)))
    cities.append({'gi':[int(best)],'src':raw,'lat':lat,'lon':lon,'state':st})
# --- manual changes since 2021 ---
def find(name,st):
    r=[i for i in bystate[st] if gem[i]['properties']['GEM']==name]; assert len(r)==1,(name,r); return r[0]
# Berga/Elster + Wünschendorf/Elster -> Berga-Wünschendorf (1.1.2024)
b=find('Berga/Elster','Thüringen'); w=find('Wünschendorf/Elster','Thüringen')
for c in cities:
    if c['gi']==[b]: c['gi']=[int(b),int(w)]; c['rename']='Berga-Wünschendorf'
# Haar (Landkreis München) Stadt since January 2025
h=find('Haar','Bayern')
cities.append({'gi':[int(h)],'src':'Haar','lat':48.1089,'lon':11.7278,'state':'Bayern'})
# Tamm: Stadt seit 1.3.2022 (315. Stadt in BW); Oberderdingen: Stadt seit 1.11.2023 (316. Stadt in BW)
t=find('Tamm','Baden-Württemberg')
cities.append({'gi':[int(t)],'src':'Tamm','lat':48.9196,'lon':9.1155,'state':'Baden-Württemberg'})
o=find('Oberderdingen','Baden-Württemberg')
cities.append({'gi':[int(o)],'src':'Oberderdingen','lat':49.0656,'lon':8.8031,'state':'Baden-Württemberg'})
# sanity: duplicates
from collections import Counter
cnt=Counter(tuple(c['gi']) for c in cities)
dups=[k for k,v in cnt.items() if v>1]
print('cities',len(cities),'issues',len(issues),'dups',dups)
for k in dups: print([ (c['src'],c['lat'],c['lon']) for c in cities if tuple(c['gi'])==k], gem[k[0]]['properties'])
for x in issues: print(x)
json.dump(cities,open(WORK+'/cities_stage1.json','w'),ensure_ascii=False)
