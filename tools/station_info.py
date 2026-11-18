"""匯入車站設施、歷史異動與周邊公共景點資料。"""
import csv
import io
import json
import re
import sys
import urllib.request
from collections import defaultdict
from datetime import date
from math import cos, hypot, radians
from pathlib import Path
from zipfile import ZipFile

from psycopg.types.json import Jsonb

from od_postgres import database, open_reference, search_schema, write_schema
from station_hubs_wikidata import wikidata_hubs
from station_hospitals_ntpc import new_taipei_hospitals


SCHEMA = 'exitpulse_station_info'
ROOT = Path(__file__).resolve().parents[1]
FACILITIES = 'https://data.taipei/api/dataset/659b9f55-a687-4e55-a17b-ceca5743c514/resource/f69dfd66-3d8e-408a-9645-c02384bda5b8/download'
ENTRANCES = 'https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=307a7f61-e302-4108-a817-877ccbfca7c1'
BASICS = 'https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=c77e91bf-067c-475e-917b-545ff62b7d76'
ATTRACTIONS = 'https://media.taiwan.net.tw/XMLReleaseAll_public/v2.0/Zh_tw/Attraction-json.zip'
YOUBIKE_TP = 'https://tcgbusfs.blob.core.windows.net/dotapp/youbike/v2/youbike_immediate.json'
YOUBIKE_NTPC = 'https://data.ntpc.gov.tw/api/datasets/010E5B15-3823-4B20-B401-B1CF000550C5/json?page=0&size=5000'
OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
TAIPEI_HOSPITALS = ('https://data.taipei/api/dataset/ffdd5753-30db-4c38-b65f-b77892773d60'
                    '/resource/04a3d195-ee97-467a-b066-e471ff99d15d/download')
TAIPEI_BUS_TERMINALS = ('https://data.taipei/api/frontstage/tpeod/dataset/resource.download'
                        '?rid=b857c906-aaf6-4747-8233-6f39ba8b8718')
WIKI_SUMMARY = 'https://zh.wikipedia.org/api/rest_v1/page/summary/'
MOI_POP_API = 'https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014/'
FEATURES = ('電梯', '廁所', '哺集乳室')

HUB_KIND = {
    'hospital': '醫院',
    'university': '大學',
    'college': '學院',
    'mall': '商場',
    'department_store': '百貨',
    'industrial': '園區',
    'commercial': '商辦大樓',
    'company': '企業總部',
    'government': '政府機關',
    'arts_centre': '藝文場館',
    'stadium': '體育館',
    'railway_station': '鐵路車站',
    'bus_station': '客運轉運站',
}

DISTRICT_CENTERS = {
    '臺北市中正區': (121.519, 25.032), '臺北市大同區': (121.513, 25.063), '臺北市中山區': (121.533, 25.068),
    '臺北市松山區': (121.557, 25.050), '臺北市大安區': (121.543, 25.026), '臺北市萬華區': (121.499, 25.035),
    '臺北市信義區': (121.572, 25.033), '臺北市士林區': (121.525, 25.095), '臺北市北投區': (121.501, 25.132),
    '臺北市內湖區': (121.589, 25.083), '臺北市南港區': (121.607, 25.055), '臺北市文山區': (121.570, 24.989),
    '新北市板橋區': (121.459, 25.012), '新北市三重區': (121.488, 25.061), '新北市中和區': (121.498, 24.999),
    '新北市永和區': (121.516, 25.008), '新北市新莊區': (121.433, 25.036), '新北市新店區': (121.542, 24.967),
    '新北市土城區': (121.443, 24.972), '新北市蘆洲區': (121.473, 25.085), '新北市汐止區': (121.641, 25.068),
    '新北市樹林區': (121.420, 24.991), '新北市淡水區': (121.443, 25.172), '新北市泰山區': (121.431, 25.058),
    '新北市五股區': (121.438, 25.084), '桃園市龜山區': (121.356, 25.022),
}

# Dates are the beginning of regular service for each group of station codes.
DORTS = 'https://data.taipei/api/dataset/3c7b2e71-0ade-4045-8340-cce61078f0df/resource/80b8d553-c71b-45ea-85bc-9073abbee7cd/download'
METRO_NEWS = 'https://www.metro.taipei/News_Content.aspx?n=30CCEFD2A45592BF&s='
OPENING_SECTIONS = {
    'BL': [(1, 1, '2015-07-06'), (2, 7, '2006-05-31'), (8, 9, '2000-08-31'),
           (10, 18, '1999-12-24'), (19, 21, '2000-12-30'), (22, 22, '2008-12-25'),
           (23, 23, '2011-02-27')],
    'BR': [(1, 12, '1996-03-28'), (13, 24, '2009-07-04')],
    'R': [(2, 7, '2013-11-24'), (8, 9, '1998-12-24'), (10, 10, '1997-12-25'),
          (11, 28, '1997-03-28')],
    'G': [(1, 8, '1999-11-11'), (9, 10, '1998-12-24'), (11, 12, '2000-08-31'),
          (13, 19, '2014-11-15')],
    'O': [(1, 4, '1998-12-24'), (5, 6, '2012-09-30'), (7, 12, '2010-11-03'),
          (13, 19, '2012-01-05'), (20, 21, '2013-06-29'), (50, 54, '2010-11-03')],
    'Y': [(7, 20, '2020-01-31')],
}
SPECIAL_OPENINGS = {
    'R01': ('2026-08-30', METRO_NEWS + 'A97320E75E09D797'),
    'R22A': ('1997-03-28', 'https://www.iot.gov.tw/uploads/asset/data/66195e4c367376304acd4cb4/%E6%8D%B7%E9%81%8B%E8%B7%AF%E7%B6%B2%E8%A6%8F%E5%8A%83%E8%A8%AD%E8%A8%88%E5%8F%83%E8%80%83%E6%89%8B%E5%86%8A%E4%B9%8B%E7%A0%94%E7%A9%B6%281-2%29.pdf'),
    'G03A': ('2004-09-29', DORTS),
}
STORIES = {
    '動物園': ('從這裡可到臺北市立動物園，也能轉搭貓空纜車。北捷為了分散假日人潮，在 2002 年增開 2 號出口。', '019'),
    '台北車站': ('捷運在這裡銜接台鐵、高鐵和機場捷運，地下街又把車站和站前商圈連在一起。', 'https://web.metro.taipei/pages2026/WebStation/051'),
    '忠孝新生': ('站名取自忠孝東路、新生南路。臺北科大、華山 1914 和光華商場都在站區周邊。', '089'),
    '東門': ('從這裡可到永康街商圈。兩條捷運線在街區底下交會，施工時共有五條隧道在地下堆疊。', '134'),
    '淡水': ('車站建於舊台鐵淡水站原址。從站前就能走向淡水河岸、老街，或往殼牌倉庫看港口歷史。', '071'),
    '蘆洲': ('中和新蘆線的端點之一，位於三民路和中正路口，靠近通往五股、八里的成蘆橋。', '174'),
    '中山': ('站區連著中山地下街和心中山線形公園。2025 年 5 月，改建後的 1 號出口重新開放，銜接南段綠廊。', METRO_NEWS + 'BF306BC850930F3A'),
    '科技大樓': ('復興南路西側的 2 號出口在 2026 年 6 月新增，旅客可直接從車站走到龍生綜合大樓。', METRO_NEWS + '509A7794C72C2926'),
}
EXIT_CHANGES = {
    ('動物園', '1'): {'opened': '1996-03-28', 'source': 'https://web.metro.taipei/c/stationstory/019/019.html'},
    ('動物園', '2'): {'opened': '2002-11-16', 'source': 'https://web.metro.taipei/c/stationstory/019/019.html'},
    ('科技大樓', '2'): {'opened': '2026-06-08', 'source': METRO_NEWS + '509A7794C72C2926'},
    ('中山', '1'): {'closed': '2023-02-20', 'reopened': '2025-05-31', 'source': METRO_NEWS + 'BF306BC850930F3A',
                'closureSource': METRO_NEWS + '5653FA0C8CDEF0B2'},
    ('中正紀念堂', '2'): {'closed': '2025-05-19', 'reopened': '2026-06-30',
                   'source': 'https://www.metro.taipei/News.aspx?PageSize=20&n=30CCEFD2A45592BF&page=8&sms=72544237BBE4C5F6',
                   'closureSource': METRO_NEWS + '3FE340B701161F5E'},
}


def opening(line, code):
    if code in SPECIAL_OPENINGS:
        return SPECIAL_OPENINGS[code]
    number = int(code[len(line):])
    return next((starts, DORTS) for first, last, starts in OPENING_SECTIONS[line] if first <= number <= last)


def line_openings():
    """Map present-day line memberships to their first dates of regular service."""
    codes = json.loads((ROOT / 'apps/web/public/metro/station-codes.json').read_text(encoding='utf8'))
    return {line: {station: opening(line, code)[0] for station, code in stations.items()}
            for line, stations in codes.items()}


def nearby_attractions(stops):
    with urllib.request.urlopen(ATTRACTIONS, timeout=45) as response:
        archive = io.BytesIO(response.read())
    with ZipFile(archive) as package:
        attractions = json.loads(package.read('AttractionList.json'))['Attractions']
    nearby = defaultdict(dict)
    for place in attractions:
        lng, lat = place['PositionLon'], place['PositionLat']
        if lng is None or lat is None or not (120.9 < lng < 121.8 and 24.9 < lat < 25.3):
            continue
        name = place['AttractionName'].strip()
        if not name:
            continue
        description = ' '.join((place['Description'] or '').split())
        sentences = re.split(r'(?<=[。！？])', description, maxsplit=1)
        summary = sentences[0].strip()
        if len(summary) > 96:
            summary = summary[:95].rstrip() + '…'
        for station, (station_lng, station_lat) in stops.items():
            meters = round(111_195 * hypot((lng - station_lng) * cos(radians(station_lat)), lat - station_lat))
            if meters <= 700 and (name not in nearby[station] or meters < nearby[station][name]['distance']):
                nearby[station][name] = {'name': name, 'distance': meters, 'summary': summary, 'lng': lng, 'lat': lat}
    return {name: sorted(places.values(), key=lambda place: (place['distance'], place['name']))[:5]
            for name, places in nearby.items()}


def nearby_youbike(stops):
    """抓取雙北 YouBike 2.0 公開資料，配對各捷運站 450 公尺內最近的 4 個場站與車柱數。"""
    nearby = defaultdict(dict)
    sources = (
        (YOUBIKE_TP, 'latitude', 'longitude', 'quantity'),
        (YOUBIKE_NTPC, 'lat', 'lng', 'tot_quantity'),
    )
    for url, lat_k, lng_k, cap_k in sources:
        try:
            with urllib.request.urlopen(url, timeout=25) as response:
                items = json.loads(response.read().decode('utf-8-sig'))
        except Exception as error:
            print(f'警告：無法取得 YouBike 資料（{url}）：{error}')
            continue
        if not isinstance(items, list):
            continue
        for row in items:
            if not isinstance(row, dict):
                continue
            low = {str(k).lower(): v for k, v in row.items()}
            if str(low.get('act', '1')) != '1':
                continue
            try:
                lat = float(low[lat_k])
                lng = float(low[lng_k])
                raw_cap = low.get(cap_k)
                cap = int(float(raw_cap)) if raw_cap not in (None, '') else 0
            except (KeyError, TypeError, ValueError):
                continue
            name = str(low.get('sna') or '').removeprefix('YouBike2.0_').strip()
            if not name:
                continue
            address = str(low.get('ar') or '').strip()
            for station, (station_lng, station_lat) in stops.items():
                meters = round(111_195 * hypot((lng - station_lng) * cos(radians(station_lat)), lat - station_lat))
                if meters <= 450 and (name not in nearby[station] or meters < nearby[station][name]['distance']):
                    nearby[station][name] = {'name': name, 'distance': meters, 'capacity': cap, 'address': address, 'lng': lng, 'lat': lat}
    return {name: sorted(sites.values(), key=lambda site: (site['distance'], site['name']))[:4]
            for name, sites in nearby.items()}


def fetch_wiki_story(station_name):
    """從中文維基百科 REST API 抓取車站沿革與背景摘要（排除消歧義頁，最多前 2 句，附來源連結）。"""
    import urllib.parse
    candidates = (
        f'{station_name}站_(臺北捷運)',
        f'臺北捷運{station_name}站',
        f'台北捷運{station_name}站',
        f'{station_name}站',
        f'{station_name}車站',
    )
    for candidate in candidates:
        url = WIKI_SUMMARY + urllib.parse.quote(candidate)
        req = urllib.request.Request(url, headers={'User-Agent': 'ExitPulse/1.0', 'Accept-Language': 'zh-TW'})
        try:
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read().decode('utf-8'))
        except Exception:
            continue
        if data.get('type') == 'disambiguation':
            continue
        extract = str(data.get('extract') or '').strip()
        if not extract or ('捷運' not in extract and '車站' not in extract):
            continue
        sentences = [s for s in extract.split('。') if s.strip()]
        summary = '。'.join(sentences[:2]).strip()
        if summary and not summary.endswith('。'):
            summary += '。'
        if len(summary) > 160:
            summary = summary[:158].rstrip() + '…'
        page_url = ((data.get('content_urls') or {}).get('desktop') or {}).get('page') or f'https://zh.wikipedia.org/wiki/{urllib.parse.quote(candidate)}'
        return {'summary': summary, 'source': page_url, 'sourceLabel': '維基百科（CC BY-SA）'}
    return None


def nearby_hubs(stops, force_refresh=False, retry_delay=1.5):
    """從 OSM Overpass 取得雙北醫院、大學、園區、百貨商場與知名企業總部，含快取優先與重試退避。"""
    import time
    import urllib.parse
    cache_path = ROOT / 'data' / 'osm-hubs.json'
    elements = None
    if not force_refresh and cache_path.exists():
        age_seconds = time.time() - cache_path.stat().st_mtime
        if age_seconds < 7 * 86400:
            try:
                elements = json.loads(cache_path.read_text(encoding='utf-8'))
            except Exception:
                elements = None
    if not elements:
        query = (
            '[out:json][timeout:40];('
            'nw["amenity"~"^(hospital|university|college|arts_centre)$"]["name"](24.93,121.40,25.22,121.70);'
            'nw["shop"~"^(mall|department_store)$"]["name"](24.93,121.40,25.22,121.70);'
            'nw["landuse"="industrial"]["name"](24.93,121.40,25.22,121.70);'
            ');out center;'
        )
        body = urllib.parse.urlencode({'data': query}).encode('utf-8')
        endpoints = (
            (OVERPASS_URL, 2),
            ('https://overpass.kumi.systems/api/interpreter', 2),
            ('https://maps.mail.ru/osm/tools/overpass/api/interpreter', 1),
        )
        deadline = time.monotonic() + 180
        for endpoint, max_attempts in endpoints:
            for attempt in range(max_attempts):
                remaining = deadline - time.monotonic()
                if remaining <= 2:
                    print('警告：OSM 重要設施查詢已達 3 分鐘上限，停止重試')
                    break
                req = urllib.request.Request(endpoint, data=body, headers={
                    'User-Agent': 'ExitPulse/1.0', 'Accept': 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded',
                })
                try:
                    with urllib.request.urlopen(req, timeout=min(45, max(5, int(remaining)))) as resp:
                        elements = json.loads(resp.read().decode('utf-8')).get('elements') or []
                        if elements:
                            cache_path.parent.mkdir(parents=True, exist_ok=True)
                            cache_path.write_text(json.dumps(elements, ensure_ascii=False), encoding='utf-8')
                            break
                except Exception as error:
                    print(f'警告：無法從 {endpoint} 取得 OSM 重要設施資料（第 {attempt + 1} 次：{error}）')
                    if attempt + 1 < max_attempts and retry_delay > 0 and deadline - time.monotonic() > retry_delay + 2:
                        time.sleep(retry_delay)
            if elements or time.monotonic() >= deadline - 2:
                break
        if not elements and cache_path.exists():
            try:
                elements = json.loads(cache_path.read_text(encoding='utf-8'))
                print('已改用本地快取 data/osm-hubs.json')
            except Exception:
                elements = None
    if not elements:
        terminals = taipei_bus_terminals()
        terminal_names = {normalized(site['tags']['name']) for site in terminals}
        wiki = [site for site in wikidata_hubs()
                if not (site['tags']['amenity'] == 'bus_station' and normalized(site['tags']['name']) in terminal_names)]
        elements = [*wiki, *terminals, *taipei_hospitals(), *new_taipei_hospitals(stops)]
    return group_hubs(stops, elements)


def taipei_bus_terminals():
    try:
        terminal_rows = rows(TAIPEI_BUS_TERMINALS)
    except (OSError, ValueError) as error:
        print(f'警告：無法取得臺北市轉運站資料：{error}')
        return []
    terminals = []
    for row in terminal_rows:
        name = row.get('站名', '').strip()
        try:
            a, b = float(row['經度']), float(row['緯度'])
        except (KeyError, TypeError, ValueError):
            continue
        # The published CSV currently puts latitude under the longitude header.
        lng, lat = max(a, b), min(a, b)
        if name and 121.4 <= lng <= 121.7 and 24.93 <= lat <= 25.22:
            terminals.append({
                'lon': lng, 'lat': lat, 'tags': {'name': name, 'amenity': 'bus_station'},
                'source': 'https://data.taipei/dataset/detail?id=78d3bc44-f897-49b6-8294-a1bf3966f648',
                'sourceLabel': '臺北市公運處',
            })
    return terminals


def taipei_hospitals():
    try:
        source_rows = rows(TAIPEI_HOSPITALS)
    except (OSError, ValueError) as error:
        print(f'警告：無法取得臺北市醫院清冊：{error}')
        return []
    hospitals = []
    for row in source_rows:
        name = row.get('機構名稱', '').split('\t', 1)[0].strip()
        try:
            lng, lat = float(row['經度']), float(row['緯度'])
        except (KeyError, TypeError, ValueError):
            continue
        if name and 121.4 <= lng <= 121.7 and 24.93 <= lat <= 25.22:
            short = name.rsplit('法人', 1)[-1].strip().replace('國立臺灣大學醫學院附設醫院', '臺大醫院', 1)
            hospitals.append({
                'lon': lng, 'lat': lat,
                'tags': {'name': short, 'amenity': 'hospital'}, 'officialName': name,
                'source': 'https://data.gov.tw/dataset/121182',
                'sourceLabel': '臺北市衛生局',
            })
    return hospitals


def group_hubs(stops, elements):
    nearby = defaultdict(dict)
    for el in elements:
        tags = el.get('tags') or {}
        name = str(tags.get('name:zh-Hant') or tags.get('name:zh') or tags.get('name') or '').strip()
        if not name or (len(name) > 24 and 'source' not in el):
            continue
        lat = el.get('lat') or (el.get('center') or {}).get('lat')
        lng = el.get('lon') or (el.get('center') or {}).get('lon')
        if lat is None or lng is None:
            continue
        lat, lng = float(lat), float(lng)
        raw_kind = tags.get('amenity') or tags.get('shop') or tags.get('office') or tags.get('building') or tags.get('landuse') or ''
        kind = HUB_KIND.get(raw_kind, '重要設施')
        for station, (station_lng, station_lat) in stops.items():
            meters = round(111_195 * hypot((lng - station_lng) * cos(radians(station_lat)), lat - station_lat))
            key = normalized(name)
            if meters <= 700 and (key not in nearby[station] or meters < nearby[station][key]['distance']):
                item = {'name': name, 'kind': kind, 'distance': meters, 'lng': lng, 'lat': lat}
                if 'source' in el:
                    item.update(source=el['source'], sourceLabel=el['sourceLabel'])
                if 'registerSource' in el:
                    item['registerSource'] = el['registerSource']
                if 'officialName' in el:
                    item['officialName'] = el['officialName']
                nearby[station][key] = item
    return {name: sorted(items.values(), key=lambda x: (x['distance'], x['name']))[:4]
            for name, items in nearby.items()}


def load_cached_district_pop():
    """讀取由 update_auxiliary.py 快取的雙北行政區人口月資料（{行政區: {period, population, yoyPct}}）。"""
    path = ROOT / 'data' / 'district-pop.json'
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def catchment_population(station_lng, station_lat, primary_district, district_pop):
    """計算車站半徑 6 公里內鄰近行政區（如南港連帶汐止）人口合計與年增減。"""
    if not district_pop:
        return None
    picked = []
    for dist, (d_lng, d_lat) in DISTRICT_CENTERS.items():
        if dist not in district_pop:
            continue
        meters = round(111_195 * hypot((d_lng - station_lng) * cos(radians(station_lat)), d_lat - station_lat))
        if dist == primary_district or meters <= 6000:
            picked.append((0 if dist == primary_district else meters, dist))
    picked.sort()
    names = [d for _, d in picked[:4]]
    if len(names) < 2:
        return None
    total_pop = sum(district_pop[d]['population'] for d in names)
    prev_total = 0.0
    has_prev = True
    for d in names:
        yoy = district_pop[d].get('yoyPct')
        if yoy is None:
            has_prev = False
            break
        prev_total += district_pop[d]['population'] / (1 + yoy / 100)
    yoy_pct = round((total_pop / prev_total - 1) * 100, 1) if has_prev and prev_total > 0 else None
    period = district_pop[names[0]].get('period', '')
    short_names = [n.removeprefix('臺北市').removeprefix('新北市').removeprefix('桃園市') for n in names]
    return {'districts': short_names, 'period': period, 'population': total_pop, 'yoyPct': yoy_pct}


def rows(url):
    with urllib.request.urlopen(url, timeout=30) as response:
        data = response.read()
    for encoding in ('utf-8-sig', 'cp950'):
        try:
            return list(csv.DictReader(io.StringIO(data.decode(encoding))))
        except UnicodeDecodeError:
            if encoding == 'cp950':
                raise


def normalized(value):
    return ''.join(value.replace('臺', '台').replace('／', '/').split())


def rebuild():
    metro = ROOT / 'apps/web/public/metro'
    codes = json.loads((metro / 'station-codes.json').read_text(encoding='utf8'))
    names = {normalized(name): name for line in codes.values() for name in line}
    prefixes = sorted(names, key=len, reverse=True)
    stops = {feature['properties']['name']: feature['geometry']['coordinates']
             for feature in json.loads((metro / 'stations.geojson').read_text(encoding='utf8'))['features']
             if feature['properties']['name'] in names.values()}
    attractions = nearby_attractions(stops)
    youbike = nearby_youbike(stops)
    hubs = nearby_hubs(stops)
    district_pop = load_cached_district_pop()
    by_code = {}
    for row in rows(BASICS):
        address = re.sub(r'\d{5,6}(?=[臺台]北市|新北市)', '', row['StationAddress'].strip("'"))
        for code in row['StationID'].strip("'").split(','):
            by_code[code.strip()] = address
    station_codes = defaultdict(list)
    for line, stations in codes.items():
        for name, code in stations.items():
            station_codes[name].append((line, code))
    details, exits = defaultdict(list), defaultdict(list)
    for row in rows(FACILITIES):
        label = normalized(row['車站名稱'])
        station = label.split('(')[0]
        name = names.get(station) or names.get(station.removesuffix('站'))
        if name is None:
            raise ValueError(f'Unknown station in facilities: {label}')
        for feature in FEATURES:
            value = row[feature].strip()
            if value:
                details[name].append({'label': feature, 'area': label.partition('(')[2].removesuffix(')'), 'value': value})
    for row in rows(ENTRANCES):
        label = row['出入口名稱'].strip()
        station = next((n for n in prefixes if normalized(label).startswith(n)), None)
        flag = row['是否為無障礙用'].strip()
        if station is None or flag not in ('是', '否'):
            raise ValueError(f'Unrecognized entrance: {label}')
        name, code = names[station], row['出入口編號'].strip()
        change = EXIT_CHANGES.get((name, code))
        exits[name].append({'code': code, 'name': label, 'label': code,
                            'lng': float(row['經度']), 'lat': float(row['緯度']), 'accessible': flag == '是',
                            'history': change})
    records = []
    for name, line_codes in sorted(station_codes.items()):
        opened, source = min(opening(line, code) for line, code in line_codes)
        addresses = list(dict.fromkeys(by_code[code] for _, code in line_codes if by_code.get(code)))
        story = STORIES.get(name)
        story_obj = (
            {'summary': story[0], 'source': f'https://web.metro.taipei/c/stationstory/{story[1]}/{story[1]}.html' if story[1].isdigit() else story[1]}
            if story else fetch_wiki_story(name)
        )
        dist_info = None
        catchment_info = None
        primary_key = None
        for addr in addresses:
            m = re.match(r'^(臺北市|台北市|新北市|桃園市)([^區市鎮鄉]+?[區市鎮鄉])', addr)
            if m:
                key = m.group(1).replace('台', '臺') + m.group(2)
                if key in district_pop:
                    primary_key = key
                    dist_info = {'district': key, **district_pop[key]}
                    break
        if name in stops:
            s_lng, s_lat = stops[name]
            catchment_info = catchment_population(s_lng, s_lat, primary_key, district_pop)
        records.append((name, Jsonb({
            'retrieved': date.today().isoformat(), 'facilities': details[name], 'entrances': exits[name],
            'opening': {'date': opened, 'source': source}, 'addresses': addresses,
            'nearby': attractions.get(name, []), 'youbike': youbike.get(name, []),
            'hubs': hubs.get(name, []), 'districtPop': dist_info, 'catchmentPop': catchment_info,
            'story': story_obj,
        })))
    with database() as db:
        write_schema(db, SCHEMA)
        db.execute('CREATE TABLE stations (name text PRIMARY KEY, payload jsonb NOT NULL)')
        db.cursor().executemany('INSERT INTO stations VALUES (%s, %s)', records)
    print(f'{len(records)} stations, {len(attractions)} stations with attractions, {sum(map(len, exits.values()))} entrances')


LINE_TITLES = {'BL': '板南線', 'BR': '文湖線', 'G': '松山新店線', 'R': '淡水信義線', 'O': '中和新蘆線', 'Y': '環狀線'}


def _station_lines(station_name):
    codes = json.loads((ROOT / 'apps/web/public/metro/station-codes.json').read_text(encoding='utf8'))
    out = []
    for line, mapping in codes.items():
        if station_name in mapping:
            sc = mapping[station_name]
            opened, source = opening(line, sc)
            out.append({'code': line, 'name': LINE_TITLES.get(line, line), 'stationCode': sc,
                        'opened': opened, 'source': source})
    return out


def _period_rank(station_name, target_period=None):
    is_date = bool(target_period and len(target_period) == 10)
    target_month = target_period[:7] if target_period else None
    with open_reference() as rdb:
        if is_date:
            day_rows = rdb.execute(
                'SELECT s.name, sd.entries::bigint, sd.exits::bigint '
                'FROM station_day sd JOIN day d ON d.date=sd.date JOIN station s ON s.id=sd.station_id '
                'WHERE d.date=%s AND d.present=1 ORDER BY sd.entries DESC, s.name',
                (target_period,),
            ).fetchall()
            if day_rows:
                for idx, (n, e, x) in enumerate(day_rows, 1):
                    if n == station_name:
                        return {'month': target_month, 'period': target_period, 'isDate': True,
                                'dailyEntries': int(e), 'dailyExits': int(x),
                                'rank': idx, 'totalStations': len(day_rows), 'yoyPct': None}
        if target_month:
            month = target_month
        else:
            month = rdb.execute('SELECT MAX(month) FROM day WHERE present=1').fetchone()[0]
        if not month:
            return None
        days = rdb.execute('SELECT COUNT(*) FROM day WHERE month=%s AND present=1', (month,)).fetchone()[0] or 0
        if not days:
            return None
        rows = rdb.execute(
            'SELECT s.name, SUM(sd.entries)::bigint, SUM(sd.exits)::bigint '
            'FROM station_day sd JOIN day d ON d.date=sd.date JOIN station s ON s.id=sd.station_id '
            'WHERE d.month=%s AND d.present=1 GROUP BY s.name ORDER BY SUM(sd.entries) DESC, s.name',
            (month,),
        ).fetchall()
        yoy_month = f'{int(month[:4]) - 1}{month[4:]}'
        yoy_row = rdb.execute(
            'SELECT SUM(sd.entries)::bigint, (SELECT COUNT(*) FROM day WHERE month=%s AND present=1) '
            'FROM station_day sd JOIN day d ON d.date=sd.date JOIN station s ON s.id=sd.station_id '
            'WHERE d.month=%s AND d.present=1 AND s.name=%s',
            (yoy_month, yoy_month, station_name),
        ).fetchone()
    for idx, (n, e, x) in enumerate(rows, 1):
        if n == station_name:
            yoy_pct = None
            if yoy_row and yoy_row[0] and yoy_row[1]:
                prev_daily = yoy_row[0] / yoy_row[1]
                if prev_daily > 0:
                    yoy_pct = round(((e / days) / prev_daily - 1) * 100, 1)
            return {'month': month, 'period': month, 'isDate': False,
                    'dailyEntries': round(e / days), 'dailyExits': round(x / days),
                    'rank': idx, 'totalStations': len(rows), 'yoyPct': yoy_pct}
    return None


def _zh_date(iso):
    if not iso or len(iso) != 10:
        return iso
    y, m, d = iso.split('-')
    return f'{int(y)} 年 {int(m)} 月 {int(d)} 日'


def _zh_month(ym):
    if not ym or len(ym) != 7:
        return ym
    y, m = ym.split('-')
    return f'{int(y)} 年 {int(m)} 月'


def _entrance_state(entrances, ref_date):
    open_list, unknown_list, closed_notes, future_notes = [], [], [], []
    for e in entrances:
        h = e.get('history') or {}
        code = e.get('code') or e.get('label') or ''
        opened = h.get('opened')
        closed = h.get('closed')
        reopened = h.get('reopened')
        if ref_date and not opened:
            unknown_list.append(e)
            continue
        if ref_date and opened and opened > ref_date:
            future_notes.append(f'{code} 號出口在 {_zh_date(opened)} 才啟用')
            continue
        if ref_date and closed and closed <= ref_date and (not reopened or ref_date < reopened):
            closed_notes.append(f'{code} 號出口當時施工封閉中')
            continue
        open_list.append(e)
    return open_list, unknown_list, closed_notes, future_notes


def _compose_story(station_name, payload, lines, stats, period=None):
    parts = []
    ref_date = (period + '-31') if period and len(period) == 7 else period
    opened_raw = (payload.get('opening') or {}).get('date')
    opened = _zh_date(opened_raw)
    active_lines = [l for l in lines if not ref_date or l['opened'] <= ref_date]
    future_lines = [l for l in lines if ref_date and l['opened'] > ref_date]
    when_label = _zh_date(period) if period and len(period) == 10 else (_zh_month(period) if period else '')

    if ref_date and not active_lines and lines:
        parts.append(f'{station_name}在 {when_label}尚未通車（於 {opened}正式營運）。')
    elif active_lines and future_lines:
        active_text = '、'.join(l['name'] for l in active_lines)
        future_text = '、'.join(f"{l['name']}（{_zh_date(l['opened'])}）" for l in future_lines)
        parts.append(f'{when_label}時由{active_text}營運，後續加入轉乘：{future_text}。')

    existing = payload.get('story')
    if existing and existing.get('summary') and (not ref_date or active_lines):
        parts.append(existing['summary'].strip())

    entrances = payload.get('entrances') or []
    if entrances and ref_date:
        _, _, closed_notes, future_notes = _entrance_state(entrances, ref_date)
        if closed_notes or future_notes:
            parts.append('當時出口異動：' + '、'.join(closed_notes + future_notes) + '。')

    source = (existing or {}).get('source') or (payload.get('opening') or {}).get('source') or DORTS
    return {'summary': ' '.join(parts), 'source': source}


def get_station_info(name, period=None):
    station_name = name.removesuffix('站') if name == '大橋頭站' else name
    with database() as db:
        search_schema(db, SCHEMA)
        match = db.execute('SELECT payload FROM stations WHERE name=%s', (station_name,)).fetchone()
        if not match:
            return None
        payload = dict(match[0])
        lines = _station_lines(station_name)
        stats = _period_rank(station_name, period)
        payload['lines'] = lines
        if period:
            payload['period'] = period
        if stats:
            payload['latestStats'] = stats
        payload['story'] = _compose_story(station_name, payload, lines, stats, period)
        return payload


def query(name, period=None):
    payload = get_station_info(name, period)
    print('null' if payload is None else json.dumps(payload, ensure_ascii=False))


if __name__ == '__main__':
    if sys.argv[1:] == ['--import']:
        rebuild()
    else:
        query(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
