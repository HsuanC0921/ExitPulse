"""Smoke-check the ExitPulse API and, optionally, the web build."""
import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

TIMEOUT = 30
RADAR_KEYS = {'baseline', 'current', 'days', 'hours', 'weekend', 'minimum', 'type',
              'commonStations', 'excluded', 'total', 'results'}
RESULT_KEYS = {'origin', 'destination', 'baselineTrips', 'currentTrips', 'baselineOriginTotal',
               'currentOriginTotal', 'baselineDaily', 'currentDaily', 'deltaSharePp', 'growth',
               'reverseBaseline', 'reverseCurrent', 'directionBaseline', 'directionCurrent',
               'reversal', 'score'}
STATION_A, STATION_B = '松山', '台北小巨蛋'


def fetch(url):
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def get_json(url, expect=200):
    status, body = fetch(url)
    if status != expect:
        raise AssertionError(f'status {status}, expected {expect}')
    return json.loads(body)


def query(url, **params):
    return f'{url}?{urllib.parse.urlencode(params)}'


def check_health(api):
    body = get_json(f'{api}/health')
    assert body.get('status') == 'ok', body


def check_months(api):
    months = get_json(f'{api}/api/v1/od/months')
    assert isinstance(months, list) and months, 'empty month list'
    assert months == sorted(months), 'months not sorted'


def radar_url(api, **extra):
    params = dict(baseline='2022-09', current='2026-09', start=7, end=10, weekend='false',
                  minimum=20, type='all')
    params.update(extra)
    return query(f'{api}/api/v1/od/radar', **params)


def check_radar(api):
    body = get_json(radar_url(api))
    missing = RADAR_KEYS - body.keys()
    assert not missing, f'missing keys {sorted(missing)}'
    results = body['results']
    assert results, 'no results'
    assert len(results) <= 500, f'{len(results)} results exceeds the API limit of 500'
    assert body['total'] >= len(results), 'total < len(results)'
    for r in results:
        missing = RESULT_KEYS - r.keys()
        assert not missing, f'result missing {sorted(missing)}'


def check_radar_bad_type(api):
    get_json(radar_url(api, type='bogus'), expect=400)


def check_radar_same_month(api):
    get_json(radar_url(api, baseline='2026-09', current='2026-09'), expect=400)


def check_pair(api):
    body = get_json(query(f'{api}/api/v1/od/pair', baseline='2022-09', current='2026-09',
                          origin=STATION_A, destination=STATION_B, weekend='false'))
    for period in ('baseline', 'current'):
        for direction in ('forward', 'reverse'):
            arr = body[period][direction]
            assert len(arr) == 24, f'{period}.{direction} has {len(arr)} entries'
            for v in arr:
                assert v is None or (isinstance(v, (int, float)) and not isinstance(v, bool)), v


def check_pair_same_station(api):
    get_json(query(f'{api}/api/v1/od/pair', baseline='2022-09', current='2026-09',
                   origin=STATION_A, destination=STATION_A, weekend='false'), expect=400)


def check_web_root(web):
    status, body = fetch(f'{web}/')
    assert status == 200, f'status {status}'
    assert b'app-root' in body, 'no app-root element'


def check_web_default(web):
    body = get_json(f'{web}/od/default.json')
    assert isinstance(body.get('results'), list) and body['results'], 'no results in default.json'


def check_web_stations(web):
    get_json(f'{web}/metro/stations.geojson')


def check_station_date_band(api):
    body = get_json(query(f'{api}/api/v1/od/station', name='台北車站', period='2026-09-15', compare='2026-09-08', start=7, end=10))
    assert body['present'] and body['outbound'] and body['compare'], 'empty station answer'
    assert len(body['hourly']['entries']) == 24, 'hourly is not 24 slots'


def check_network(api):
    body = get_json(query(f'{api}/api/v1/od/network', period='2026-09', compare='2025-09', days='weekday'))
    assert len(body['stations']) > 100 and body['total'] > 0, 'network too small'


def check_matrix(api):
    endpoint = f'{api}/api/v1/od/matrix'
    body = get_json(query(endpoint, period='2026-09', days='weekend', start=7, end=10, limit=5))
    stations = body['stations']
    assert len(stations) == len(set(stations)) == len(body['cells']) == 5
    assert all(len(row) == 5 and all(isinstance(value, (int, float)) and value >= 0 for value in row)
               for row in body['cells'])
    assert body['period']['hours'] == [7, 10] and body['period']['days'] == 8
    partial = get_json(query(endpoint, period='2026-09-15', start=2, end=7))
    assert partial['period']['hours'] == [2, 7] and partial['period']['recordedHours'] == [5, 6]
    missing = get_json(query(endpoint, period='2026-09-15', start=2, end=3), expect=422)
    assert missing.get('code') == 'unrecorded_hours'
    get_json(query(endpoint, period='2026-09', limit=1), expect=400)


def check_calendar_trend(api):
    cal = get_json(query(f'{api}/api/v1/od/calendar', month='2026-09', name='板橋'))
    assert len(cal['dates']) == 30, f"{len(cal['dates'])} dates in September"
    trend = get_json(query(f'{api}/api/v1/od/trend', name='板橋', days='weekday'))
    assert len(trend['months']) >= 60, 'trend too short'


def check_bad_period(api):
    get_json(query(f'{api}/api/v1/od/station', name='台北車站', period='2026-9'), expect=400)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--api', default='http://127.0.0.1:5011')
    parser.add_argument('--web', default=None)
    args = parser.parse_args()
    api = args.api.rstrip('/')

    checks = [
        ('health', lambda: check_health(api)),
        ('months', lambda: check_months(api)),
        ('radar 2022-09 vs 2026-09 7-10 weekday', lambda: check_radar(api)),
        ('radar type=bogus -> 400', lambda: check_radar_bad_type(api)),
        ('radar same month -> 400', lambda: check_radar_same_month(api)),
        ('pair 24-hour arrays', lambda: check_pair(api)),
        ('pair origin==destination -> 400', lambda: check_pair_same_station(api)),
        ('station by date and hour band, compared', lambda: check_station_date_band(api)),
        ('network month vs month', lambda: check_network(api)),
        ('matrix weekend band, unrecorded hour and invalid limit', lambda: check_matrix(api)),
        ('calendar and trend', lambda: check_calendar_trend(api)),
        ('station bad period -> 400', lambda: check_bad_period(api)),
    ]
    if args.web:
        web = args.web.rstrip('/')
        checks += [
            ('web root has app-root', lambda: check_web_root(web)),
            ('web od/default.json', lambda: check_web_default(web)),
            ('web metro/stations.geojson', lambda: check_web_stations(web)),
        ]

    failed = 0
    for name, fn in checks:
        try:
            fn()
            print(f'PASS {name}')
        except Exception as e:  # report every check, keep going
            failed += 1
            print(f'FAIL {name}: {e}')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
