import os
WORK = os.environ.get('WORK', '.work')
SRC = os.environ.get('SRC', '.src')
import json, re
gem=json.load(open(WORK+'/gem.geojson'))['features']
cities=json.load(open(WORK+'/cities_stage2.json'))
town_g=set(g for c in cities for g in c['gis'])
REPL=[(r' i\.d\.OPf\.',' in der Oberpfalz'),(r' i\.d\.Rhön',' in der Rhön'),(r' i\.Bay\.',' in Bayern'),(r' i\.UFr\.',' in Unterfranken'),(r' i\.OB\b',' in Oberbayern'),
      (r' i\.Allgäu',' im Allgäu'),(r' i\.Grabfeld',' im Grabfeld'),(r' i\.Rottal',' im Rottal'),(r' i\.Fichtelgebirge',' im Fichtelgebirge'),(r' i\.Isartal',' im Isartal'),
      (r' a\.d\.',' an der '),(r' v\.d\.',' vor der '),(r' a\.',' am '),(r' b\.',' bei '),(r'\(Rhld\.\)','(Rheinland)')]
def disp(n):
    for a,b in REPL: n=re.sub(a,b,n)
    return re.sub(r'\s+',' ',n).strip()
names=set()
for i,f in enumerate(gem):
    p=f['properties']
    if i in town_g or not p['GEM'] or (p['EWZ'] or 0)==0: continue
    names.add(disp(p['GEM']))
names=sorted(names)
json.dump(names,open(WORK+'/gemeinden.json','w'),ensure_ascii=False,separators=(',',':'))
import os; print(len(names), os.path.getsize(WORK+'/gemeinden.json'))
print([n for n in names if '.' in n][:40])
