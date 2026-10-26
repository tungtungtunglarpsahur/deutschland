import os
WORK = os.environ.get('WORK', '.work')
SRC = os.environ.get('SRC', '.src')
import json, re, unicodedata, math
from shapely.geometry import shape, Point, mapping
from shapely.ops import unary_union, polylabel
gem=json.load(open(WORK+'/gem.geojson'))['features']
cities=json.load(open(WORK+'/cities_stage1.json'))
kf_raw=json.load(open(SRC+'/lk/package/data/districts.json'))
STATES=['Schleswig-Holstein','Hamburg','Niedersachsen','Bremen','Nordrhein-Westfalen','Hessen','Rheinland-Pfalz','Baden-Württemberg','Bayern','Saarland','Berlin','Brandenburg','Mecklenburg-Vorpommern','Sachsen','Sachsen-Anhalt','Thüringen']
ABBR=['SH','HH','NI','HB','NW','HE','RP','BW','BY','SL','BE','BB','MV','SN','ST','TH']
def strict(s):
    return re.sub(r'[^a-z0-9äöü]','',s.lower().replace('ß','ss'))
def norm(s):
    s=s.lower().replace('ß','ss'); s=unicodedata.normalize('NFKD',s); s=''.join(c for c in s if not unicodedata.combining(c))
    s=re.sub(r'\bsankt\b','st',s); s=re.sub(r'\bst\.','st ',s)
    return re.sub(r'[^a-z0-9]','',s)
kreisfrei=set()
for x in kf_raw:
    if x['type'] in ('Kreisfreie Stadt','Stadtkreis') and not x['name'].startswith('Eisenach'):
        n=x['name'].split(',')[0]
        n={'Oldenburg (Oldenburg)':'Oldenburg (Oldb)'}.get(n,n)
        kreisfrei.add(strict(n))
# ---------- display names ----------
SPECIAL={
 'Bernstadt a.d.Eigen':'Bernstadt auf dem Eigen',
 'Hann.Münden':'Hann. Münden',
 'Königstein/Sächs.Schw.':'Königstein (Sächsische Schweiz)',
 'Tambach-Dietharz/Thür.Wald':'Tambach-Dietharz',
 'Frankenberg/Sa.':'Frankenberg/Sachsen',
 'Weilheim i.OB':'Weilheim in Oberbayern',
}
REPL=[(r' i\.d\.OPf\.',' in der Oberpfalz'),(r' i\.d\.Rhön',' in der Rhön'),(r' i\.Bay\.',' in Bayern'),(r' i\.UFr\.',' in Unterfranken'),
      (r' i\.Allgäu',' im Allgäu'),(r' i\.Grabfeld',' im Grabfeld'),(r' i\.Rottal',' im Rottal'),(r' i\.Fichtelgebirge',' im Fichtelgebirge'),
      (r' a\.d\.',' an der '),(r' v\.d\.',' vor der '),(r' a\.',' am '),(r' b\.',' bei '),(r'\(Rhld\.\)','(Rheinland)')]
def display(official):
    if official in SPECIAL: return SPECIAL[official]
    n=official
    for a,b in REPL: n=re.sub(a,b,n)
    return re.sub(r'\s+',' ',n).strip()
QUAL=r'\s+(an der|am|im|in der|in|ob der|bei|auf dem|auf|vor der|unter|zu)\s+'
def short(n):
    s=re.split(r'\s*\(|/', n)[0]
    s=re.split(QUAL, s)[0]
    return s.strip()
out=[]
for idx,c in enumerate(cities):
    gis=c['gi']; g0=gem[gis[0]]['properties']
    official=c.get('rename') or g0['GEM']
    disp=display(official)
    pop=sum(gem[i]['properties']['EWZ'] or 0 for i in gis)
    geom=unary_union([shape(gem[i]['geometry']) for i in gis])
    p=Point(c['lon'],c['lat'])
    if geom.buffer(0.004).contains(p): pt=p
    else:
        part=max(geom.geoms,key=lambda g:g.area) if geom.geom_type=='MultiPolygon' else geom
        pt=polylabel(part,tolerance=0.0005)
    st=STATES.index(c['state'])
    krs=g0['KRS']
    kfrei = strict(official) in kreisfrei or strict(g0['GEM']) in kreisfrei
    if c['state'] in ('Berlin','Hamburg'): kfrei=True
    if kfrei: krs=official
    out.append({'i':idx,'gis':gis,'official':official,'name':disp,'short':short(disp),'pop':int(pop),'lon':round(pt.x,5),'lat':round(pt.y,5),'s':st,'krs':krs,'kf':kfrei,'src':c['src']})
# ---------- aliases ----------
fullset={norm(o['name']) for o in out}|{norm(o['official']) for o in out}
shortset={norm(o['short']) for o in out}
EXON={'Köln':['Cologne'],'München':['Munich'],'Nürnberg':['Nuremberg'],'Braunschweig':['Brunswick'],'Hannover':['Hanover'],'Konstanz':['Constance'],'Hameln':['Hamelin'],
      'Hann. Münden':['Hannoversch Münden','Münden'],'Heilbad Heiligenstadt':['Heiligenstadt'],'Stadt Wehlen':['Wehlen'],'Amt Creuzburg':['Creuzburg'],
      'Eisleben':['Lutherstadt Eisleben'],'Wittenberg':['Lutherstadt Wittenberg'],'Ludwigslust':[],'Dresden':[],'Leipzig':[],'Frankfurt (Oder)':['Frankfurt an der Oder','Frankfurt/Oder'],'Aue-Bad Schlema':['Aue'],'Halle (Saale)':['Halle an der Saale'],
      'Frankfurt am Main':['Frankfurt Main'],'Frankfurt (Oder)':['Frankfurt an der Oder'],'Weiden in der Oberpfalz':['Weiden'],'Neumarkt in der Oberpfalz':['Neumarkt'],
      'Oldenburg (Oldb)':['Oldenburg (Oldenburg)'],'Esens':[],'Dessau-Roßlau':['Dessau'],'Cottbus':['Chóśebuz'],'Bautzen':['Budyšin'],
      'Kempten (Allgäu)':['Kempten im Allgäu'],'Lindau (Bodensee)':['Lindau am Bodensee'],'Radolfzell am Bodensee':['Radolfzell'],
      'Villingen-Schwenningen':['Villingen','Schwenningen'],'Berga-Wünschendorf':['Berga','Berga/Elster','Berga an der Elster']}
for o in out:
    al={o['official'],o['name']}
    src=o['src']
    if src not in ('Cologne','Munich','Brunswick','Hanover','Constance','Nuremberg','Hamelin','Herne city','Essen') and not re.search(r'[A-Z][a-zæøåö]+[A-Z]',src) and ',' not in src:
        al.add(src)
    al.update(EXON.get(o['name'],[]))
    # Bad-less alias
    if o['name'].startswith('Bad '):
        nb=o['name'][4:]
        if norm(nb) not in fullset and norm(nb) not in shortset: al.add(nb)
    # hyphen components
    parts=o['short'].split('-')
    if len(parts)==2:
        for p in parts:
            p=p.strip()
            if len(p)>=4 and norm(p) not in fullset and norm(p) not in shortset: al.add(p)
    o['aliases']=sorted(a for a in al if a and a!=o['name'])
json.dump(out,open(WORK+'/cities_stage2.json','w'),ensure_ascii=False,indent=0)
print(len(out))
for o in out[:3]: print(o)
# show some interesting
for n in ['Frankfurt am Main','Halle (Saale)','Neustadt an der Weinstraße','Bad Homburg vor der Höhe','Weilheim in Oberbayern','Bernstadt auf dem Eigen','Berga-Wünschendorf','Haar','Dessau-Roßlau','Esens','Hann. Münden','St. Ingbert']:
    for o in out:
        if o['name']==n: print(n,'|',o['short'],'|',o['aliases'],'|',o['pop'],o['kf'],o['krs'])
import collections
print(collections.Counter(o['short'] for o in out).most_common(12))
print('kreisfrei count',sum(o['kf'] for o in out))
