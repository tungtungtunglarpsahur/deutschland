import os
WORK = os.environ.get('WORK', '.work')
SRC = os.environ.get('SRC', '.src')
import pickle, json, numpy as np, math
obj = pickle.load(open(WORK+'/vg250.pkl','rb'))
v = obj['vg250']
feats=[]
for i in range(len(v)):
    row=v.iloc[i]
    g=row['geom']
    # depth: list(rings of ndarray) => polygon ; list(list(ndarray)) => multipolygon
    if isinstance(g[0], np.ndarray):
        polys=[g]
    else:
        polys=g
    coords=[[ [[round(float(x),6),round(float(y),6)] for x,y in ring] for ring in poly] for poly in polys]
    import pandas as pd
    ewz=row['EWZ']; kfl=row['KFL']
    ewz=None if pd.isna(ewz) else ewz
    kfl=None if pd.isna(kfl) else kfl
    gem=None if pd.isna(row['GEM']) else str(row['GEM'])
    krs=None if pd.isna(row['KRS']) else str(row['KRS'])
    lan=None if pd.isna(row['LAN']) else str(row['LAN'])
    feats.append({"type":"Feature","properties":{
        "id":i,"GEM":gem,"KRS":krs,"LAN":lan,
        "EWZ": None if ewz is None or (isinstance(ewz,float) and math.isnan(ewz)) else int(ewz),
        "KFL": None if kfl is None or (isinstance(kfl,float) and math.isnan(kfl)) else float(kfl)},
        "geometry":{"type":"MultiPolygon","coordinates":coords}})
json.dump({"type":"FeatureCollection","features":feats}, open(WORK+'/gem.geojson','w'), ensure_ascii=False)
print(len(feats))
import collections
c=collections.Counter((f['properties']['GEM'],f['properties']['KRS']) for f in feats)
print('dup GEM+KRS', [k for k,n in c.items() if n>1][:30])
print([f['properties'] for f in feats if f['properties']['EWZ'] in (None,0)][:20])
print(sum(1 for f in feats if f['properties']['EWZ'] in (None,0)))
