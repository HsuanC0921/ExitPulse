"""地圖的地點搜尋：限速並快取的 Photon（OpenStreetMap 資料）代理。"""
import asyncio
import json
import os
import time
from functools import cache
from pathlib import Path

import httpx

BOUNDS = (120.65, 24.2, 122.45, 25.7)  # 經度下限、緯度下限、經度上限、緯度上限（雙北桃園一帶）
ENDPOINT = os.environ.get('EXITPULSE_PLACES_ENDPOINT', 'https://photon.komoot.io/api/')
TTL, CACHE_LIMIT, MAX_WAITING = 30 * 60, 128, 2
STATIONS = Path(__file__).resolve().parents[2] / 'apps' / 'web' / 'public' / 'metro' / 'stations.geojson'

OSM_CATEGORIES = {
    'park': '公園',
    'hospital': '醫院',
    'clinic': '診所',
    'school': '學校',
    'university': '大學',
    'college': '學院',
    'library': '圖書館',
    'museum': '博物館',
    'attraction': '景點',
    'viewpoint': '景點',
    'mall': '商場',
    'department_store': '百貨',
    'supermarket': '超市',
    'cafe': '咖啡廳',
    'restaurant': '餐廳',
    'fast_food': '餐飲',
    'hotel': '飯店',
    'station': '車站',
    'bus_station': '轉運站',
    'cinema': '影城',
    'stadium': '體育場',
    'sports_centre': '運動中心',
    'place_of_worship': '宗教場所',
    'townhall': '公家機關',
    'government': '公家機關',
}


class TooMany(Exception):
    """排隊中的請求已滿，呼叫端回 429。"""


class UpstreamLimited(Exception):
    """Photon 回 429，呼叫端回 429 並說明是來源限流。"""


@cache
def _stations():
    features = json.loads(STATIONS.read_text(encoding='utf8'))['features']
    return [(f['properties']['name'], *f['geometry']['coordinates'][:2]) for f in features]


def local_matches(q):
    """Photon 不能用時的備援：只比對捷運站名，台／臺視為同字，結尾的「站」可省略。"""
    key = q.strip().replace('臺', '台').removesuffix('站')
    if not key:
        return []
    hits = [(name, lng, lat) for name, lng, lat in _stations() if key in name.replace('臺', '台')]
    hits.sort(key=lambda hit: (hit[0].replace('臺', '台') != key, len(hit[0])))
    return [{'name': name if name.endswith('站') else f'{name}站', 'area': '', 'address': '', 'category': '捷運站', 'lng': lng, 'lat': lat}
            for name, lng, lat in hits[:5]]


class PlaceSearch:
    def __init__(self):
        self.cache = {}
        self.next_free = 0.0
        self.waiting = 0

    async def _take_slot(self):
        """每秒最多一個請求，後面最多排 MAX_WAITING 個。"""
        now = time.monotonic()
        wait = max(0.0, self.next_free - now)
        if wait and self.waiting >= MAX_WAITING:
            raise TooMany
        self.next_free = max(now, self.next_free) + 1.0
        if wait:
            self.waiting += 1
            try:
                await asyncio.sleep(wait)
            finally:
                self.waiting -= 1

    async def find(self, q):
        """回傳 [{name, area, lng, lat}]，被限速拋 TooMany，Photon 失敗拋 httpx.HTTPError。"""
        query = q.strip()
        hit = self.cache.get(query)
        if hit and hit[1] > time.monotonic():
            return hit[0]
        await self._take_slot()
        params = {'q': query.replace('台北', '臺北'), 'bbox': ','.join(map(str, BOUNDS)), 'limit': 6}
        async with httpx.AsyncClient(timeout=7, headers={'User-Agent': 'ExitPulse/1.0'}) as client:
            response = await client.get(ENDPOINT, params=params)
            if response.status_code == 429:
                raise UpstreamLimited
            response.raise_for_status()
            features = response.json()['features']
        matches = []
        for feature in features:
            geometry = feature['geometry']
            if geometry.get('type') != 'Point':
                continue
            lng, lat = geometry['coordinates'][:2]
            if not (BOUNDS[0] <= lng <= BOUNDS[2] and BOUNDS[1] <= lat <= BOUNDS[3]):
                continue
            props = feature['properties']
            name = props.get('name') or props.get('street')
            if not isinstance(name, str):
                continue
            area = next((props[k] for k in ('district', 'city', 'county') if isinstance(props.get(k), str)), '')
            street = props.get('street') if isinstance(props.get('street'), str) else ''
            house = props.get('housenumber') if isinstance(props.get('housenumber'), str) else ''
            address = f'{area}{street}{house}'.strip()
            osm_val = str(props.get('osm_value') or '')
            category = OSM_CATEGORIES.get(osm_val, '')
            if not any(p['name'] == name and abs(p['lng'] - lng) < .001 and abs(p['lat'] - lat) < .001 for p in matches):
                matches.append({'name': name, 'area': area, 'address': address, 'category': category, 'lng': lng, 'lat': lat})
        result = matches[:5]
        if len(self.cache) >= CACHE_LIMIT:
            self.cache.clear()
        self.cache[query] = (result, time.monotonic() + TTL)
        return result
