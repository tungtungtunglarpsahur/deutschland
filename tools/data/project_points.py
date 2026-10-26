import os
WORK = os.environ.get('WORK', '.work')
SRC = os.environ.get('SRC', '.src')
import json
from pyproj import Transformer
PROJ='+proj=lcc +lat_1=48.67 +lat_2=53.67 +lat_0=51 +lon_0=10.45 +datum=WGS84 +units=m +no_defs'
tf=Transformer.from_crs('EPSG:4326',PROJ,always_xy=True)
labels=[('Dänemark',9.75,55.55,'c'),('Niederlande',5.75,52.45,'c'),('Belgien',5.05,50.55,'c'),('Luxemburg',6.05,49.62,'c'),('Frankreich',6.55,48.35,'c'),
        ('Schweiz',8.25,47.05,'c'),('Österreich',12.9,47.45,'c'),('Tschechien',14.65,49.85,'c'),('Polen',15.75,52.55,'c'),('Schweden',13.6,55.85,'c'),
        ('Nordsee',7.2,54.55,'s'),('Ostsee',12.4,54.82,'s')]
out=[]
for n,lon,lat,k in labels:
    x,y=tf.transform(lon,lat); out.append({'n':n,'x':round(x),'y':round(y),'k':k})
json.dump(out,open(WORK+'/labels_proj.json','w'),ensure_ascii=False)
cities=json.load(open(WORK+'/cities_stage2.json'))
ABBR=['SH','HH','NI','HB','NW','HE','RP','BW','BY','SL','BE','BB','MV','SN','ST','TH']
final=[]
for c in cities:
    x,y=tf.transform(c['lon'],c['lat'])
    d={'n':c['name'],'s':c['s'],'p':c['pop'],'x':round(x/10)*10,'y':round(y/10)*10,'k':c['krs'] if not c['kf'] else ''}
    if c['aliases']: d['a']=c['aliases']
    if c['short']!=c['name']: d['b']=c['short']
    final.append(d)
json.dump(final,open(WORK+'/cities_final.json','w'),ensure_ascii=False,separators=(',',':'))
import os; print(len(final), os.path.getsize(WORK+'/cities_final.json'))
print(final[0], final[500])
