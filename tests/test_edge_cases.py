"""邊界測試：API 驗證、地點搜尋、每月自動更新的守門與回滾。不需要資料庫與網路。"""
import asyncio
import subprocess
import sys
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps' / 'api'))
sys.path.insert(0, str(ROOT / 'tools'))

import httpx  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
import places  # noqa: E402
import rollback_month  # noqa: E402
import update_monthly  # noqa: E402


class ApiBoundaries(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.original = main.runner.run
        self.calls = []

        async def run(script, arguments):
            self.calls.append((script, arguments))
            return {'exitCode': 0, 'output': '{"results":[],"total":0}', 'error': ''}
        main.runner.run = run

    def tearDown(self):
        main.runner.run = self.original

    def status(self, path, **params):
        return self.client.get(path, params=params).status_code

    def test_same_station_pair_is_rejected_before_the_worker(self):
        months = {'baseline': '2025-09', 'current': '2026-09', 'weekend': False}
        self.assertEqual(self.status('/api/v1/od/pair', origin='台北車站', destination='台北車站', **months), 400)
        self.assertEqual(self.status('/api/v1/od/pair', origin='台北車站 ', destination='台北車站', **months), 400)
        self.assertEqual(self.status('/api/v1/od/radar', origin='西門', destination='西門', start=7, end=10, **months), 400)
        self.assertEqual(self.calls, [])

    def test_blank_and_overlong_station_names(self):
        for name in ('', '   ', '站' * 21):
            self.assertEqual(self.status('/api/v1/od/station', name=name, period='2026-09'), 400, repr(name))
        self.assertEqual(self.calls, [])

    def test_station_names_reach_the_worker_trimmed(self):
        self.assertEqual(self.status('/api/v1/od/station', name=' 西門 ', period='2026-09'), 200)
        self.assertEqual(self.calls[0][1][1], '西門')

    def test_hour_range_boundaries(self):
        base = {'baseline': '2025-09', 'current': '2026-09', 'weekend': False}
        for start, end in ((10, 10), (12, 7), (-1, 7), (7, 25)):
            self.assertEqual(self.status('/api/v1/od/radar', start=start, end=end, **base), 400, (start, end))
        self.assertEqual(self.status('/api/v1/od/radar', start=0, end=24, **base), 200)

    def test_minimum_threshold_boundaries(self):
        base = {'baseline': '2025-09', 'current': '2026-09', 'weekend': False, 'start': 7, 'end': 10}
        for minimum, expected in ((0, 200), (10000, 200), (-1, 400), (10000.5, 400), ('nan', 400), ('inf', 400)):
            self.assertEqual(self.status('/api/v1/od/radar', minimum=minimum, **base), expected, minimum)

    def test_place_query_length(self):
        for q in ('', '台', ' 台 ', '台' * 81):
            self.assertEqual(self.status('/api/v1/map/places', q=q), 400, len(q))


@contextmanager
def photon(features=None, status=200, error=None):
    """把 Photon 換成固定回應，不連網。"""
    def handler(_request):
        if error:
            raise error
        return httpx.Response(status, json={'features': features or []})
    real = httpx.AsyncClient
    with patch.object(places.httpx, 'AsyncClient', lambda **kw: real(transport=httpx.MockTransport(handler), **kw)):
        yield


def point(name, lng=121.5, lat=25.04, **props):
    return {'geometry': {'type': 'Point', 'coordinates': [lng, lat]}, 'properties': {'name': name, **props}}


class PlaceBoundaries(unittest.TestCase):
    def find(self, q, **fake):
        with photon(**fake):
            return asyncio.run(places.PlaceSearch().find(q))

    def test_skips_polygons_unnamed_and_out_of_area_features(self):
        polygon = {'geometry': {'type': 'Polygon', 'coordinates': [[[121.5, 25.0]]]}, 'properties': {'name': '大安森林公園'}}
        unnamed = {'geometry': {'type': 'Point', 'coordinates': [121.5, 25.0]}, 'properties': {'name': None}}
        features = [polygon, unnamed, point('高雄車站', 120.3, 22.6), point('台北101', osm_value='attraction', district='信義區')]
        found = self.find('101', features=features)
        self.assertEqual([p['name'] for p in found], ['台北101'])
        self.assertEqual((found[0]['category'], found[0]['area']), ('景點', '信義區'))

    def test_duplicates_collapse_and_results_cap_at_five(self):
        features = [point('同名')] * 3 + [point(f'地點{i}', 121.5 + i / 100) for i in range(8)]
        found = self.find('地點', features=features)
        self.assertEqual(len(found), 5)
        self.assertEqual([p['name'] for p in found].count('同名'), 1)

    def test_upstream_429_and_network_failure_raise_for_the_route_to_fall_back(self):
        with self.assertRaises(places.UpstreamLimited):
            self.find('西門', status=429)
        with self.assertRaises(httpx.ConnectError):
            self.find('西門', error=httpx.ConnectError('down'))

    def test_local_station_fallback(self):
        names = lambda q: [p['name'] for p in places.local_matches(q)]
        self.assertEqual(names('臺北車站')[0], '台北車站')
        self.assertEqual(names('台北車站站')[0], '台北車站')
        self.assertEqual(names('西門')[0], '西門站')
        self.assertEqual(names('北投')[0], '北投站')  # 完全相符排在「新北投」前
        self.assertEqual(names('站'), [])
        self.assertEqual(names('火星'), [])
        self.assertLessEqual(len(names('大')), 5)


class FakeDb:
    def __init__(self):
        self.statements = []

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, statement, params=None):
        self.statements.append((str(statement), params))
        return MagicMock()

    def commit(self):
        self.statements.append(('COMMIT', None))


class UpdateGuards(unittest.TestCase):
    def test_missing_holiday_calendar_blocks(self):
        with self.assertRaisesRegex(RuntimeError, '2099'):
            update_monthly.check_holiday_file('2099')
        update_monthly.check_holiday_file('2026')

    def volume(self, current, previous):
        averages = dict(previous, **{'2026-09': current})
        with patch.object(update_monthly.od_postgres, 'months', return_value=list(averages)), \
                patch.object(update_monthly, 'daily_average', side_effect=lambda _db, m: averages[m]):
            update_monthly.check_volume_sanity(object(), '2026-09')

    def test_volume_swing_beyond_forty_percent_blocks(self):
        usual = {'2026-06': 2_000_000, '2026-07': 2_000_000, '2026-08': 2_000_000}
        for current in (1_100_000, 2_900_000, 0):
            with self.assertRaisesRegex(RuntimeError, '±40%'):
                self.volume(current, usual)
        for current in (1_250_000, 2_000_000, 2_750_000):
            self.volume(current, usual)
        self.volume(0, {'2026-08': 2_000_000})  # 只有一個前期月份時不判斷

    def run_update(self, build_ref_output):
        db, notices = FakeDb(), []

        def step(title, args, capture=False):
            out = build_ref_output if args[0] == 'tools/build_ref.py' else ''
            return subprocess.CompletedProcess(args, 0, stdout=out, stderr='')
        with patch.object(sys, 'argv', ['update_monthly.py']), \
                patch.object(update_monthly.od_postgres, 'database', return_value=db), \
                patch.object(update_monthly.od_postgres, 'months', return_value=['2026-08']), \
                patch.object(update_monthly.import_od, 'fetch_index', return_value=[{'month': '2026-09'}]), \
                patch.object(update_monthly, 'run_step', side_effect=step), \
                patch.object(update_monthly, 'check_volume_sanity'), \
                patch.object(update_monthly, 'backup_catalog_and_ref'), \
                patch.object(update_monthly, 'regenerate_default_json'), \
                patch.object(update_monthly.od_postgres, 'publish_month') as publish, \
                patch.object(update_monthly, 'notify', side_effect=lambda m, is_error=False: notices.append((m, is_error))):
            try:
                update_monthly.main()
                code = 0
            except SystemExit as exit_:
                code = exit_.code
        return code, publish, notices

    def test_station_without_coordinates_blocks_publishing(self):
        code, publish, notices = self.run_update('no coordinates for: 新站\n')
        self.assertEqual(code, 1)
        publish.assert_not_called()
        self.assertTrue(notices[-1][1])
        self.assertIn('座標', notices[-1][0])

    def test_clean_update_publishes(self):
        code, publish, notices = self.run_update('stations: 131\n')
        self.assertEqual(code, 0)
        publish.assert_called_once()
        self.assertFalse(notices[-1][1])


class Rollback(unittest.TestCase):
    def test_invalid_month_is_rejected_before_touching_the_database(self):
        with patch.object(rollback_month.od_postgres, 'database', side_effect=AssertionError('不該連線')):
            for month in ('2026-9', 'abc', '2026-13', '2026-09-01', '', '2026-09; DROP'):
                with self.assertRaises(ValueError, msg=month):
                    rollback_month.rollback(month)

    def test_rollback_targets_the_catalog_table_and_month_schema(self):
        db = FakeDb()
        with patch.object(rollback_month.od_postgres, 'database', return_value=db), \
                patch.object(rollback_month.od_postgres, 'month_exists', return_value=True):
            self.assertTrue(rollback_month.rollback('2026-09', drop_schema=True))
        sql = [s for s, _ in db.statements]
        self.assertIn('DELETE FROM exitpulse_catalog.months WHERE month = %s', sql)
        self.assertIn('DROP SCHEMA IF EXISTS "exitpulse_2026_09" CASCADE', sql)
        self.assertEqual(sql[-1], 'COMMIT')


if __name__ == '__main__':
    unittest.main()
