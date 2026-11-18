"""需連線 PostgreSQL 的 FastAPI 合約測試：使用 TestClient 驗證真實資料回應與錯誤碼。"""
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps' / 'api'))
sys.path.insert(0, str(ROOT / 'tools'))

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from analyze_od import get_pair, get_radar  # noqa: E402
from od_postgres import get_availability, get_catalog, get_months, open_month  # noqa: E402
from query_od import get_calendar, get_matrix, get_network, get_relation_hours, get_station, get_trend  # noqa: E402
from station_info import get_station_info  # noqa: E402

POSTGRES = os.getenv('EXITPULSE_DATABASE_URL') or os.getenv('PGDATABASE')


@unittest.skipUnless(POSTGRES, 'PostgreSQL connection not configured')
class RealDatabaseContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main.app)

    def test_months_and_station_match_imported_functions(self):
        r_months = self.client.get('/api/v1/od/months')
        self.assertEqual(r_months.status_code, 200)
        self.assertEqual(r_months.json(), get_months())

        r_st = self.client.get('/api/v1/od/station', params={
            'name': '台北車站', 'period': '2026-09', 'compare': '2022-09',
            'days': 'weekday', 'start': 7, 'end': 10,
        })
        self.assertEqual(r_st.status_code, 200)
        self.assertEqual(r_st.json(), get_station('台北車站', '2026-09', '2022-09', 'weekday', 7, 10, limit=200))

    def test_radar_pair_and_matrix_contracts(self):
        r_radar = self.client.get('/api/v1/od/radar', params={
            'baseline': '2022-09', 'current': '2026-09', 'start': 7, 'end': 10, 'weekend': False,
        })
        self.assertEqual(r_radar.status_code, 200)
        self.assertEqual(r_radar.json()['commonStations'], get_radar('2022-09', '2026-09', 7, 10, False)['commonStations'])

        r_pair = self.client.get('/api/v1/od/pair', params={
            'baseline': '2022-09', 'current': '2026-09', 'origin': '台北車站', 'destination': '市政府', 'weekend': False,
        })
        self.assertEqual(r_pair.status_code, 200)
        self.assertEqual(r_pair.json(), get_pair('2022-09', '2026-09', '台北車站', '市政府', False))

        r_mat = self.client.get('/api/v1/od/matrix', params={
            'period': '2026-09', 'days': 'weekday', 'start': 7, 'end': 10, 'limit': 12,
        })
        self.assertEqual(r_mat.status_code, 200)
        self.assertEqual(r_mat.json(), get_matrix('2026-09', 'weekday', 7, 10, 12))

    def test_hours_mismatch_unrecorded_hours_missing_month_and_bad_request(self):
        # 2022-09 與 2026-09 在 02-07 時段有紀錄小時不同，應回 422 hours_mismatch
        r_mismatch = self.client.get('/api/v1/od/radar', params={
            'baseline': '2022-09', 'current': '2026-09', 'start': 2, 'end': 7, 'weekend': False,
        })
        self.assertEqual(r_mismatch.status_code, 422)
        body = r_mismatch.json()
        self.assertEqual(body.get('code'), 'hours_mismatch')
        self.assertIn('recordedHours', body)
        self.assertIn('suggested', body)

        # 2026-09-15 的 02-05 時段無旅次紀錄，應回 422 unrecorded_hours
        r_unrec = self.client.get('/api/v1/od/matrix', params={
            'period': '2026-09-15', 'days': 'all', 'start': 2, 'end': 5,
        })
        self.assertEqual(r_unrec.status_code, 422)
        self.assertEqual(r_unrec.json().get('code'), 'unrecorded_hours')

        # 尚未匯入的月份應回 404
        r_missing = self.client.get('/api/v1/od/matrix', params={
            'period': '1999-01', 'days': 'weekday', 'start': 7, 'end': 10,
        })
        self.assertEqual(r_missing.status_code, 404)

        # 不合法參數應回 400
        r_bad = self.client.get('/api/v1/od/radar', params={
            'baseline': '2026-09', 'current': '2026-09', 'start': 7, 'end': 10, 'weekend': False,
        })
        self.assertEqual(r_bad.status_code, 400)

    def test_pair_workday_uses_the_reference_calendar_for_ranking_and_hourly_profile(self):
        params = {'baseline': '2022-09', 'current': '2026-09', 'days': 'workday',
                  'origin': '南港', 'destination': '南港展覽館'}
        radar = self.client.get('/api/v1/od/radar', params={**params, 'start': 7, 'end': 8})
        pair = self.client.get('/api/v1/od/pair', params=params)
        self.assertEqual(radar.status_code, 200)
        self.assertEqual(pair.status_code, 200)
        ranking, profile = radar.json(), pair.json()
        self.assertEqual(ranking['daysType'], 'workday')
        self.assertEqual(profile['daysType'], 'workday')
        self.assertEqual(ranking['days'][1], 20)
        self.assertEqual(profile['current']['forward'][7], round(ranking['results'][0]['currentDaily'], 1))
        self.assertIsNone(profile['current']['forward'][2])
        self.assertEqual(self.client.get('/api/v1/od/pair', params={**params, 'weekend': True}).status_code, 400)

    def test_remaining_endpoints_match_imported_functions(self):
        r_avail = self.client.get('/api/v1/od/availability')
        self.assertEqual(r_avail.status_code, 200)
        self.assertEqual(r_avail.json(), get_availability())

        r_cat = self.client.get('/api/v1/od/catalog')
        self.assertEqual(r_cat.status_code, 200)
        self.assertEqual(r_cat.json(), get_catalog())

        r_info = self.client.get('/api/v1/od/station-info', params={'name': '台北車站', 'period': '2026-09'})
        self.assertEqual(r_info.status_code, 200)
        self.assertEqual(r_info.json(), get_station_info('台北車站', '2026-09'))

        r_net = self.client.get('/api/v1/od/network', params={'period': '2026-09', 'days': 'weekday', 'start': 7, 'end': 10})
        self.assertEqual(r_net.status_code, 200)
        self.assertEqual(r_net.json(), get_network('2026-09', None, 'weekday', 7, 10, False))

        r_trend = self.client.get('/api/v1/od/trend', params={'name': '台北車站', 'days': 'weekday'})
        self.assertEqual(r_trend.status_code, 200)
        self.assertEqual(r_trend.json(), get_trend('台北車站', 'weekday'))

        r_cal = self.client.get('/api/v1/od/calendar', params={'month': '2026-09', 'name': '台北車站'})
        self.assertEqual(r_cal.status_code, 200)
        self.assertEqual(r_cal.json(), get_calendar('2026-09', '台北車站'))

        r_rel = self.client.get('/api/v1/od/relation-hours', params={'origin': '台北車站', 'destination': '市政府', 'date': '2026-09-15'})
        self.assertEqual(r_rel.status_code, 200)
        self.assertEqual(r_rel.json(), get_relation_hours('台北車站', '市政府', '2026-09-15'))

    def test_destination_coverage_is_explicit_for_station_and_network(self):
        params = {'period': '2026-09', 'compare': '2022-09', 'days': 'weekday', 'start': 7, 'end': 10}
        station = self.client.get('/api/v1/od/station', params={**params, 'name': '幸福'})
        self.assertEqual(station.status_code, 200)
        self.assertGreater(station.json()['entries'], 0)
        self.assertIs(station.json()['exitCovered'], False)
        self.assertIs(station.json()['compareExitCovered'], True)

        network = self.client.get('/api/v1/od/network', params=params)
        self.assertEqual(network.status_code, 200)
        self.assertIs(network.json()['exitCovered'], False)
        rows = {row['station']: row for row in network.json()['stations']}
        self.assertIs(rows['幸福']['exitCovered'], False)
        self.assertIs(rows['幸福']['compareExitCovered'], True)
        self.assertIs(rows['台北車站']['exitCovered'], True)

    def test_group_flow_matches_station_pairs_and_discloses_missing_coverage(self):
        query = [('period', '2026-09'), ('compare', '2022-09'), ('days', 'weekday'),
                 ('start', 7), ('end', 10), ('origin', '台北車站'), ('origin', '市政府')]
        response = self.client.get('/api/v1/od/group-flow', params=query + [
            ('destination', '亞東醫院'), ('destination', '亞東醫院'), ('destination', '西門'),
        ])
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result['destinations'], ['亞東醫院', '西門'])
        with open_month('2026-09') as db:
            total = db.execute(
                'SELECT SUM(trips) FROM flows WHERE weekend=0 AND hour BETWEEN 7 AND 9 '
                'AND origin IN (%s, %s) AND destination IN (%s, %s)',
                ('台北車站', '市政府', '亞東醫院', '西門')).fetchone()[0]
        self.assertEqual(result['current']['daily'], float(round(total / result['current']['period']['days'], 3)))
        self.assertEqual(result['current']['missingDestinations'], [])

        incomplete = self.client.get('/api/v1/od/group-flow', params=query + [('destination', '幸福')])
        self.assertEqual(incomplete.status_code, 200)
        self.assertIsNone(incomplete.json()['current']['daily'])
        self.assertEqual(incomplete.json()['current']['missingDestinations'], ['幸福'])
        self.assertIsNotNone(incomplete.json()['compare']['daily'])
        self.assertEqual(self.client.get('/api/v1/od/group-flow', params=query).status_code, 400)


if __name__ == '__main__':
    unittest.main()
