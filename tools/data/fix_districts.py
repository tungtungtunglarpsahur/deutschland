import os
WORK = os.environ.get('WORK', '.work')
SRC = os.environ.get('SRC', '.src')
import json
gem=json.load(open(WORK+'/gem.geojson'))['features']
FIX={'Ralingen':('Trier-Saarburg','Rheinland-Pfalz'),'Reichenau':('Konstanz','Baden-Württemberg'),'Bodman-Ludwigshafen':('Konstanz','Baden-Württemberg'),
     'Sigmarszell':('Lindau (Bodensee)','Bayern'),'Rerik':('Rostock','Mecklenburg-Vorpommern'),'Fuhlendorf':('Vorpommern-Rügen','Mecklenburg-Vorpommern'),
     'Breege':('Vorpommern-Rügen','Mecklenburg-Vorpommern'),'Dranske':('Vorpommern-Rügen','Mecklenburg-Vorpommern'),
     'Riesbürg':('Ostalbkreis','Baden-Württemberg'),'Gallmersgarten':('Neustadt a.d.Aisch-Bad Windsheim','Bayern'),'Silbitz':('Saale-Holzland-Kreis','Thüringen'),
     'Krummesse':('Herzogtum Lauenburg','Schleswig-Holstein')}
n=0
for f in gem:
    p=f['properties']
    if p['GEM'] in FIX and (p['GEM']!='Fuhlendorf' or p['LAN']=='Mecklenburg-Vorpommern'):
        p['KRS'],p['LAN']=FIX[p['GEM']]; n+=1
print('Kreise korrigiert:',n)
bad=[f['properties'] for f in gem if f['properties']['KRS'] is None or f['properties']['LAN'] is None]
print('remaining None',bad)
json.dump({'type':'FeatureCollection','features':gem},open(WORK+'/gem.geojson','w'),ensure_ascii=False)
