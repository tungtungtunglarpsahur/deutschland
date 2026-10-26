#!/usr/bin/env bash
# Baut data/map.json, data/cities.json und data/gemeinden.json aus offenen Quellen neu.
# Voraussetzungen: git, node/npm, python3 mit: pip install rdata shapely pyproj pandas
set -euo pipefail
cd "$(dirname "$0")"
export WORK="${WORK:-$PWD/.work}" SRC="${SRC:-$PWD/.src}"
mkdir -p "$WORK" "$SRC"
OUT="$(cd ../.. && pwd)/data"

echo "== Quellen laden"
[ -d "$SRC/german-cities" ] || git clone -q --depth 1 https://github.com/pensnarik/german-cities "$SRC/german-cities"
if [ ! -f "$SRC/vg250/data/vg250.rda" ]; then
  git clone -q --depth 1 --filter=blob:none --no-checkout https://github.com/dimfalk/vg250 "$SRC/vg250"
  git -C "$SRC/vg250" checkout -q HEAD -- data/vg250.rda
fi
if [ ! -d "$SRC/ne/geojson" ]; then
  mkdir -p "$SRC/ne" && git -C "$SRC/ne" init -q && git -C "$SRC/ne" remote add origin https://github.com/nvkelso/natural-earth-vector
  git -C "$SRC/ne" config core.sparseCheckout true
  printf "geojson/ne_10m_rivers_lake_centerlines.geojson\ngeojson/ne_10m_rivers_europe.geojson\ngeojson/ne_10m_lakes.geojson\ngeojson/ne_10m_lakes_europe.geojson\ngeojson/ne_10m_admin_0_countries.geojson\n" > "$SRC/ne/.git/info/sparse-checkout"
  git -C "$SRC/ne" fetch -q --depth 1 --filter=blob:none origin HEAD && git -C "$SRC/ne" checkout -q FETCH_HEAD
fi
if [ ! -f "$SRC/lk/package/data/districts.json" ]; then
  mkdir -p "$SRC/lk" && (cd "$SRC/lk" && npm pack -s landkreise-deutschland@3.0.0 >/dev/null && tar xzf landkreise-deutschland-3.0.0.tgz)
fi
[ -d node_modules ] || npm install --silent

echo "== Gemeinden (VG250) lesen und Städte zuordnen"
python3 -I read_rda.py >/dev/null 2>&1
python3 -I to_geojson.py >/dev/null
python3 -I fix_districts.py
python3 -I build_cities.py
python3 -I build_stage2.py >/dev/null
python3 -I build_geo_input.py

echo "== Projektion, Vereinfachung, Kontextebenen"
PROJ='+proj=lcc +lat_1=48.67 +lat_2=53.67 +lat_0=51 +lon_0=10.45 +datum=WGS84 +units=m +no_defs'
NE="$SRC/ne/geojson"; BOX=-1,43.5,23,58.8
npx mapshaper -i "$WORK/gem_in.geojson" -proj "$PROJ" -simplify weighted 6% keep-shapes -o format=topojson quantization=40000 "$WORK/gem6.topojson"
npx mapshaper -i "$NE/ne_10m_admin_0_countries.geojson" -filter '["FRA","BEL","NLD","LUX","CHE","AUT","CZE","POL","DNK","LIE","ITA","SVK","SWE","HUN","SVN","GBR","NOR","HRV","DEU"].indexOf(ADM0_A3)>-1' -filter-fields ADM0_A3,NAME_DE -clip bbox=$BOX -proj "$PROJ" -simplify 25% keep-shapes -o format=geojson precision=10 "$WORK/neighbors.geojson"
npx mapshaper -i "$NE/ne_10m_rivers_lake_centerlines.geojson" "$NE/ne_10m_rivers_europe.geojson" combine-files -merge-layers force -clip bbox=$BOX -filter-fields scalerank,name,name_de,featurecla,min_zoom -proj "$PROJ" -simplify 40% -o format=geojson precision=10 "$WORK/rivers.geojson"
npx mapshaper -i "$NE/ne_10m_lakes.geojson" "$NE/ne_10m_lakes_europe.geojson" combine-files -merge-layers force -clip bbox=$BOX -filter-fields scalerank,name,name_de,min_zoom -proj "$PROJ" -simplify 40% keep-shapes -o format=geojson precision=10 "$WORK/lakes.geojson"

echo "== Ausgabe"
python3 -I project_points.py
node build_map.mjs "$WORK/gem6.topojson" "$OUT/map.json"
cp "$WORK/cities_final.json" "$OUT/cities.json"
python3 -I build_gemeinden.py
cp "$WORK/gemeinden.json" "$OUT/gemeinden.json"
echo "Fertig: $OUT"
