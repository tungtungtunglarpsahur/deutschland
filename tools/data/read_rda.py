import os
WORK = os.environ.get('WORK', '.work')
SRC = os.environ.get('SRC', '.src')
import rdata, sys, pickle
parsed = rdata.parser.parse_file(SRC+'/vg250/data/vg250.rda')
# Convert without default class conversion to keep raw structure
conv = rdata.conversion.SimpleConverter(default_encoding="utf-8")
obj = conv.convert(parsed)
print(type(obj), list(obj.keys()) if hasattr(obj,'keys') else '')
v = obj['vg250']
print(type(v))
try:
    print(v.columns, len(v))
    print(v.head())
except Exception as e:
    print('err', e)
pickle.dump(obj, open(WORK+'/vg250.pkl','wb'))
