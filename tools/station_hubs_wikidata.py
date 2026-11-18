"""Public facility coordinates used when OpenStreetMap Overpass is unavailable."""
import json
import re
from urllib.parse import urlencode
from urllib.request import Request, urlopen


QUERY = """
SELECT DISTINCT ?item ?itemLabel ?location ?kind WHERE {
  SERVICE wikibase:box {
    ?item wdt:P625 ?location .
    bd:serviceParam wikibase:cornerSouthWest "Point(121.40 24.93)"^^geo:wktLiteral ;
                    wikibase:cornerNorthEast "Point(121.70 25.22)"^^geo:wktLiteral .
  }
  VALUES (?class ?kind) {
    (wd:Q3918 "university") (wd:Q31374404 "mall")
    (wd:Q11315 "mall") (wd:Q216107 "department_store") (wd:Q1378975 "arts_centre")
    (wd:Q329683 "industrial") (wd:Q3469910 "arts_centre")
    (wd:Q55488 "railway_station") (wd:Q494829 "bus_station")
  }
  ?item wdt:P31 ?class .
  FILTER NOT EXISTS { ?item wdt:P31 wd:Q928830 }
  FILTER NOT EXISTS { ?item wdt:P576 ?closed . FILTER (?closed <= NOW()) }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "zh-tw,zh-hant,zh,en". }
}
LIMIT 1000
"""
POINT = re.compile(r'Point\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)')
ITEM = re.compile(r'https?://www\.wikidata\.org/entity/(Q\d+)')
KINDS = {'university', 'mall', 'department_store', 'arts_centre', 'industrial', 'railway_station', 'bus_station'}
HISTORICAL_LABEL = re.compile('舊館|舊址|遺址|鍋爐室|故居|菊元百貨')
SHARED_RAIL_STATIONS = {
    'Q700588': '台北車站（台鐵、高鐵）',
    'Q698107': '板橋車站（台鐵、高鐵）',
    'Q698337': '南港車站（台鐵、高鐵）',
}
LOCAL_LABELS = {
    'Q106916689': '環球購物中心板橋車站店',
    'Q106916690': '環球購物中心南港車站店',
}


def wikidata_hubs():
    url = 'https://query.wikidata.org/sparql?' + urlencode({'query': QUERY, 'format': 'json'})
    request = Request(url, headers={
        'User-Agent': 'ExitPulse/1.0 (Taipei Metro open data project)',
        'Accept': 'application/sparql-results+json',
    })
    try:
        with urlopen(request, timeout=30) as response:
            rows = json.load(response)['results']['bindings']
    except (OSError, ValueError, KeyError) as error:
        print(f'警告：無法取得 Wikidata 設施資料：{error}')
        return []
    return parse_hub_rows(rows)


def parse_hub_rows(rows):
    if len(rows) >= 1000:
        print('警告：Wikidata 設施查詢已達筆數上限')
        return []
    result = []
    for row in rows:
        match = ITEM.fullmatch(row['item']['value'])
        point = POINT.fullmatch(row['location']['value'])
        label = row['itemLabel']['value'].strip()
        kind = row['kind']['value']
        if not match or not point or not label or label == match[1] or HISTORICAL_LABEL.search(label):
            continue
        item = match[1]
        if item == 'Q107366036':  # The former Neo19 mall ceased operation in 2023.
            continue
        # Several hospital records carry another branch's coordinates.
        if kind not in KINDS:
            continue
        if kind == 'railway_station' and any(term in label for term in ('捷運', '輕軌', '緊急', '停靠', '臨時', '信號場')):
            continue
        if kind == 'bus_station' and '轉運站' not in label:
            continue
        lng, lat = map(float, point.groups())
        result.append({
            'lon': lng, 'lat': lat,
            'tags': {'name': SHARED_RAIL_STATIONS.get(item) or LOCAL_LABELS.get(item, label), 'amenity': kind},
            'source': f'https://www.wikidata.org/wiki/{item}',
            'sourceLabel': 'Wikidata（CC0）',
        })
    return result
