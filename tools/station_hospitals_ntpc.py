"""Match New Taipei hospital registrations to NLSC point locations."""
import json
import re
from math import cos, hypot, radians
from unicodedata import normalize
from urllib.request import urlopen


REGISTER = 'https://data.ntpc.gov.tw/datasets/85bfcaa8-9932-4d06-a2ec-731171191883'
REGISTER_JSON = REGISTER.replace('/datasets/', '/api/datasets/') + '/json?page=0&size=1000'
POINT_SOURCE = 'https://data.gov.tw/dataset/139250'
POINTS = 'https://api.nlsc.gov.tw/other/MarkBufferAnlys/med'
ADDRESS = re.compile(r'^(新北市[^區]+區[^0-9]+(?:[0-9]+段)?[^0-9]*(?:[0-9]+巷)?[^0-9]*(?:[0-9]+弄)?)([0-9]+(?:之[0-9]+)?)(?=號|、)')
SECTIONS = str.maketrans('一二三四五六七八九', '123456789')
RADIUS = 3000


def simplified(value):
    return ''.join(normalize('NFKC', value).replace('台', '臺').split())


def address_key(value):
    address = re.sub(r'[一二三四五六七八九](?=[段巷弄號])',
                     lambda m: m[0].translate(SECTIONS), simplified(value))
    match = ADDRESS.match(address)
    return match.groups() if match else None


def hospital_name(value):
    return simplified(value).split('(', 1)[0]


def distance(a, b):
    return 111_195 * hypot((a[0] - b[0]) * cos(radians(b[1])), a[1] - b[1])


def query_centers(stops):
    uncovered = set(tuple(p) for p in stops.values())
    while uncovered:
        center = max(sorted(uncovered), key=lambda a: sum(distance(a, b) <= RADIUS - 710 for b in uncovered))
        yield center
        uncovered = {p for p in uncovered if distance(center, p) > RADIUS - 710}


def match_hospitals(registrations, points):
    registry = {}
    for row in registrations:
        key = address_key(row['hosp_addr'])
        if key and not row['hosp_name'].strip().endswith('診所'):
            registry[(hospital_name(row['hosp_name']), key)] = row
    matches = {}
    for point in points:
        key = address_key(point.get('addr', ''))
        row = registry.get((hospital_name(point.get('name', '')), key))
        if point.get('marktype') != '9930101' or not row:
            continue
        lng, lat = float(point['lon']), float(point['lat'])
        if not (121.3 <= lng <= 122 and 24.7 <= lat <= 25.3):
            continue
        name = row['hosp_name'].split('(', 1)[0].strip()
        short = point.get('sname', '').strip()
        if not short or hospital_name(short) not in hospital_name(name):
            short = name
        matches.setdefault(row['hosp_id'], set()).add((short, name, lng, lat))
    return [
        {'lon': lng, 'lat': lat, 'tags': {'name': short, 'amenity': 'hospital'}, 'officialName': name,
         'source': POINT_SOURCE, 'sourceLabel': '國土測繪中心', 'registerSource': REGISTER}
        for locations in matches.values() if len(locations) == 1
        for short, name, lng, lat in locations
    ]


def read_json(url):
    with urlopen(url, timeout=15) as response:
        payload = json.load(response)
    if not isinstance(payload, list):
        raise ValueError(f'Unexpected response from {url}')
    return payload


def new_taipei_hospitals(stops):
    try:
        registrations = read_json(REGISTER_JSON)
    except (OSError, ValueError) as error:
        print(f'警告：無法取得新北市醫院清冊：{error}')
        return []
    points = []
    for lng, lat in query_centers(stops):
        try:
            points.extend(read_json(f'{POINTS}/{lng}/{lat}/{RADIUS}'))
        except (OSError, ValueError) as error:
            print(f'警告：無法取得 {lng}, {lat} 附近的醫療設施座標：{error}')
    return match_hospitals(registrations, points)
