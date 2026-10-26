import os
WORK = os.environ.get('WORK', '.work')
SRC = os.environ.get('SRC', '.src')
import json, re
gem=json.load(open(WORK+'/gem.geojson'))['features']
cities=json.load(open(WORK+'/cities_stage2.json'))
kf_raw=json.load(open(SRC+'/lk/package/data/districts.json'))
STATES=['Schleswig-Holstein','Hamburg','Niedersachsen','Bremen','Nordrhein-Westfalen','Hessen','Rheinland-Pfalz','Baden-Württemberg','Bayern','Saarland','Berlin','Brandenburg','Mecklenburg-Vorpommern','Sachsen','Sachsen-Anhalt','Thüringen']
def strict(s): return re.sub(r'[^a-z0-9äöü]','',s.lower().replace('ß','ss'))
kreisfrei=set()
for x in kf_raw:
    if x['type'] in ('Kreisfreie Stadt','Stadtkreis') and not x['name'].startswith('Eisenach'):
        n=x['name'].split(',')[0]; n={'Oldenburg (Oldenburg)':'Oldenburg (Oldb)'}.get(n,n); kreisfrei.add(strict(n))
cityof={}
for c in cities:
    for g in c['gis']: cityof[g]=c['i']
feats=[]; nsk=0
for i,f in enumerate(gem):
    p=f['properties']
    if p['LAN'] not in STATES:
        s=-1; d='W'
    else:
        s=STATES.index(p['LAN'])
        if strict(p['GEM']) in kreisfrei and (strict(p['KRS'])==strict(p['GEM']) or p['GEM']=='Landau in der Pfalz' or p['LAN'] in ('Berlin','Hamburg')):
            d='SK:'+p['GEM']; nsk+=1
        else: d='LK:'+p['KRS']+'|'+str(s)
    feats.append({'type':'Feature','properties':{'g':i,'c':cityof.get(i,-1),'d':d,'s':s},'geometry':f['geometry']})
json.dump({'type':'FeatureCollection','features':feats},open(WORK+'/gem_in.geojson','w'),ensure_ascii=False)
print('features',len(feats),'SK',nsk,'water',sum(1 for f in feats if f['properties']['s']==-1))
