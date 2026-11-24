"""query_od 查詢測試：站名正規化、起訖關係、矩陣與單日明細，需與原始資料逐筆對照。"""
import os
import sys
import unittest
from collections import OrderedDict
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from query_od import Period, UnrecordedHours, _load_workday_totals, _period_events, _selected_days, _workday_totals, _workdays, calendar_query, canonical, get_network, get_station, get_trend, matrix_query, network_query, relation_hour_series, relation_hours_query, relations, station_query
from od_postgres import metadata, open_month, open_reference
from query_od import _covered_stations

MONTH = '2026-09'
POSTGRES = os.getenv('EXITPULSE_DATABASE_URL') or os.getenv('PGDATABASE')


class NameTests(unittest.TestCase):
    def test_line_prefixes_and_aliases_collapse_to_one_station(self):
        self.assertEqual(canonical('BL板橋'), '板橋')
        self.assertEqual(canonical('Y板橋'), '板橋')
        self.assertEqual(canonical('大橋頭站'), '大橋頭')
        self.assertEqual(canonical('BR1'), 'BR1')

    def test_destination_coverage_uses_only_overlapping_scopes_and_station_aliases(self):
        first, second = '2026-09-01', '2026-09-02'
        info = {'destinations': ['BL板橋'], 'coverageScopes': [
            {'dates': [first], 'destinations': ['Y板橋', '幸福']},
            {'dates': [second], 'destinations': ['BL板橋']},
        ]}
        self.assertEqual(_covered_stations(info, {first}, 'destinations'), {'板橋', '幸福'})
        self.assertEqual(_covered_stations(info, {first, second}, 'destinations'), {'板橋'})
        self.assertEqual(_covered_stations({'destinations': ['Y板橋']}, {first}, 'destinations'), {'板橋'})


class RelationTests(unittest.TestCase):
    def test_absent_station_is_none_and_quiet_station_is_zero(self):
        now = SimpleNamespace(stations={'A', 'B', 'C'}, flows={('A', 'B'): 10.0})
        before = SimpleNamespace(stations={'A', 'C'}, flows={('A', 'C'): 4.0})
        rows, total = relations(now, before, 'A', True, 10)
        by = {r['station']: r for r in rows}
        self.assertEqual(total, 2)
        self.assertEqual(by['B']['compareDaily'], None)
        self.assertEqual(by['C']['daily'], 0)
        self.assertEqual(by['C']['compareDaily'], 4)

    def test_absent_origin_station_returns_none_not_zero(self):
        now = SimpleNamespace(stations={'A', 'B'}, flows={('A', 'B'): 12.0})
        before = SimpleNamespace(stations={'B'}, flows={})
        rows, _ = relations(now, before, 'A', True, 10)
        self.assertEqual(rows[0]['daily'], 12)
        self.assertIsNone(rows[0]['compareDaily'])
        self.assertIsNone(rows[0]['compareShare'])

    def test_daily_pair_profile_distinguishes_unrecorded_hour_from_known_zero(self):
        by_hour = relation_hour_series({7, 8}, [(7, 12, None)])
        self.assertEqual(by_hour[7], {'hour': 7, 'forward': 12, 'reverse': 0, 'recorded': True})
        self.assertEqual(by_hour[8], {'hour': 8, 'forward': 0, 'reverse': 0, 'recorded': True})
        self.assertEqual(by_hour[9], {'hour': 9, 'forward': None, 'reverse': None, 'recorded': False})


def matrix_args(period, days, start, end, limit=12):
    return SimpleNamespace(period=period, days=days, start=start, end=end, limit=limit)


class MatrixTests(unittest.TestCase):
    def test_preserves_same_station_trips_and_distinguishes_covered_zero_from_absence(self):
        period = SimpleNamespace(
            stations={'A', 'B'},
            origins={'A', 'B'},
            destinations={'A', 'B'},
            flows={('A', 'A'): 3.0, ('A', 'B'): 7.0, ('B', 'B'): 1 / 23},
            totals=lambda: ({'A': 10.0}, {'A': 3.0, 'B': 7.0}),
            label=lambda: {'spec': '2026-09-15', 'days': 1, 'hours': [7, 8]},
        )
        with patch('query_od.Period', return_value=period):
            result = matrix_query(matrix_args('2026-09-15', 'all', 7, 8))
        self.assertEqual(result['stations'], ['A', 'B'])
        self.assertEqual(result['cells'], [[3.0, 7.0], [0.0, 0.043]])
        period.destinations = {'A'}
        with patch('query_od.Period', return_value=period):
            self.assertEqual(matrix_query(matrix_args('2026-09-15', 'all', 7, 8))['missingDestinations'], ['B'])

    def test_reference_failure_does_not_claim_the_period_has_no_holidays(self):
        with patch('query_od.open_reference', side_effect=RuntimeError('reference unavailable')):
            with self.assertRaisesRegex(RuntimeError, 'reference unavailable'):
                _period_events('2026-09', 'all')

    def test_workday_cache_respects_data_revision_and_actual_workdays(self):
        first, second = '2026-09-01', '2026-09-02'
        info = {'month': '2026-09', 'sha256': 'original', 'dates': [first, second]}
        with patch('query_od._workday_cache', OrderedDict()), patch('query_od._workday_totals') as compute:
            _load_workday_totals(None, info, {first}, 7, 10)
            _load_workday_totals(None, info, {first}, 7, 10)
            self.assertEqual(compute.call_count, 1)
            _load_workday_totals(None, info, {first, second}, 7, 10)
            _load_workday_totals(None, dict(info, sha256='updated'), {first}, 7, 10)
            self.assertEqual(compute.call_count, 3)

    def test_monthly_daily_totals_only_skips_pair_flows_and_averages_by_days(self):
        class FakeMonthDB:
            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

        meta = {
            'stations': ['台北車站', '市政府'],
            'origins': ['台北車站', '市政府'],
            'destinations': ['台北車站', '市政府'],
            'dates': ['2026-09-01', '2026-09-02'],
            'hours': [7, 8],
        }
        hourly = [
            (7, '台北車站', 200, 100),
            (8, '台北車站', 100, 50),
            (7, '市政府', 60, 140),
        ]
        with (patch('query_od.open_month', return_value=FakeMonthDB()),
              patch('query_od.metadata', return_value=meta),
              patch('query_od._month_hours', return_value=hourly) as month_hours,
              patch('query_od._month_flows', side_effect=AssertionError('should not scan pair flows'))):
            period = Period('2026-09', 'weekday', 7, 9, daily_totals_only=True)
            entries, exits = period.totals()
        self.assertEqual(month_hours.call_count, 1)
        self.assertEqual(period.flows, {})
        self.assertEqual(entries['台北車站'], 150.0)
        self.assertEqual(exits['台北車站'], 75.0)
        self.assertEqual(entries['市政府'], 30.0)
        self.assertEqual(exits['市政府'], 70.0)

    def test_relation_hours_prefers_trip_groups_when_available(self):
        executed = []

        class FakeCursor:
            def __init__(self, rows):
                self._rows = rows

            def fetchall(self):
                return self._rows

        class FakeMonthDB:
            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def execute(self, sql, params=()):
                executed.append((sql, params))
                if 'FROM stations' in sql:
                    return FakeCursor([(1, '南港'), (2, '南港展覽館')])
                if 'FROM station_hours' in sql:
                    return FakeCursor([('南港',), ('南港展覽館',)])
                return FakeCursor([(7, 120, 45)])

        meta = {'dates': ['2026-09-15'], 'hours': [7, 8]}
        args = SimpleNamespace(origin='南港', destination='南港展覽館', date='2026-09-15')
        with (patch('query_od.open_month', return_value=FakeMonthDB()),
              patch('query_od.metadata', return_value=meta),
              patch('query_od.table_exists', return_value=True)):
            result = relation_hours_query(args)
        self.assertTrue(any('FROM trip_groups tg' in sql for sql, _ in executed))
        self.assertEqual(result['byHour'][7], {'hour': 7, 'forward': 120, 'reverse': 45, 'recorded': True})


@unittest.skipUnless(POSTGRES, 'PostgreSQL connection not configured')
class RawDetailTests(unittest.TestCase):
    def test_daily_pair_profile_matches_raw_trips_and_coverage(self):
        args = SimpleNamespace(origin='台北車站', destination='忠孝新生', date=f'{MONTH}-15')
        answer = relation_hours_query(args)
        self.assertEqual(len(answer['byHour']), 24)
        with open_month(MONTH) as db:
            names = db.execute('SELECT id,name FROM stations').fetchall()
            origins = [sid for sid, name in names if canonical(name) == args.origin]
            destinations = [sid for sid, name in names if canonical(name) == args.destination]
            raw = db.execute(
                'SELECT hour, '
                'SUM(trips) FILTER (WHERE origin=ANY(%s) AND destination=ANY(%s)), '
                'SUM(trips) FILTER (WHERE origin=ANY(%s) AND destination=ANY(%s)) '
                'FROM trips WHERE day=15 AND '
                '((origin=ANY(%s) AND destination=ANY(%s)) OR (origin=ANY(%s) AND destination=ANY(%s))) '
                'GROUP BY hour',
                (origins, destinations, destinations, origins, origins, destinations, destinations, origins),
            ).fetchall()

        observed = {hour: (forward or 0, reverse or 0) for hour, forward, reverse in raw}
        for row in answer['byHour']:
            if row['recorded']:
                self.assertEqual((row['forward'], row['reverse']), observed.get(row['hour'], (0, 0)))
            else:
                self.assertIsNone(row['forward'])
                self.assertIsNone(row['reverse'])

    def test_daily_pair_rejects_a_station_before_official_opening(self):
        args = SimpleNamespace(origin='十四張', destination='台北車站', date='2020-01-02')
        with self.assertRaisesRegex(ValueError, 'not present on this date'):
            relation_hours_query(args)

    def test_matrix_weekday_and_weekend_band_match_raw_trips(self):
        for days, day_filter in [('weekday', 0), ('weekend', 1)]:
            with self.subTest(days=days), open_month(MONTH) as db:
                answer = matrix_query(matrix_args(MONTH, days, 7, 10, 5))
                covered_days = db.execute(
                    'SELECT COUNT(DISTINCT day) FROM trips WHERE hour>=7 AND hour<10 '
                    'AND (EXTRACT(ISODOW FROM MAKE_DATE(2026,9,day))>=6)::int=%s', (day_filter,),
                ).fetchone()[0]
                raw = {}
                for origin, destination, count in db.execute(
                    'SELECT o.name,d.name,SUM(t.trips) FROM trips t '
                    'JOIN stations o ON o.id=t.origin JOIN stations d ON d.id=t.destination '
                    'WHERE t.hour>=7 AND t.hour<10 AND (EXTRACT(ISODOW FROM MAKE_DATE(2026,9,t.day))>=6)::int=%s '
                    'GROUP BY o.name,d.name', (day_filter,),
                ):
                    pair = canonical(origin), canonical(destination)
                    raw[pair] = raw.get(pair, 0) + count
                self.assertEqual(answer['period']['days'], covered_days)
                self.assertEqual(list(answer['period']['hours']), [7, 10])
                self.assertEqual(len(answer['stations']), 5)
                for origin, row in zip(answer['stations'], answer['cells'], strict=True):
                    for destination, value in zip(answer['stations'], row, strict=True):
                        self.assertEqual(value, round(raw.get((origin, destination), 0) / covered_days, 3))

    def test_matrix_unrecorded_hour_and_preopening_station(self):
        with self.assertRaises(UnrecordedHours):
            matrix_query(matrix_args('2026-09-15', 'all', 2, 3))
        early = matrix_query(matrix_args('2020-01-02', 'all', 7, 10, 200))
        self.assertNotIn('十四張', early['stations'])

    def test_partial_window_discloses_hours_while_totalling_only_recorded_trips(self):
        partial = matrix_query(matrix_args('2026-09-15', 'all', 2, 7))
        covered = matrix_query(matrix_args('2026-09-15', 'all', 5, 7))
        self.assertEqual(partial['period']['hours'], [2, 7])
        self.assertEqual(partial['period']['recordedHours'], [5, 6])
        self.assertEqual(partial['stations'], covered['stations'])
        self.assertEqual(partial['cells'], covered['cells'])

    def test_date_and_band_match_the_raw_rows(self):
        day = Period(f'{MONTH}-15', 'all', 7, 10)
        with open_month(MONTH) as db:
            raw = db.execute('SELECT SUM(trips) FROM trips WHERE day=15 AND hour>=7 AND hour<10').fetchone()[0]
        self.assertEqual(sum(day.flows.values()), raw)

    def test_daily_network_station_totals_match_raw_od_for_both_dates(self):
        current, compare = f'{MONTH}-15', f'{MONTH}-08'
        answer = get_network(current, compare, 'all', 7, 10, hourly=True)
        with open_month(MONTH) as db:
            for day, entry_key, exit_key in (
                (15, 'entries', 'exits'), (8, 'compareEntries', 'compareExits'),
            ):
                for side, key in (('origin', entry_key), ('destination', exit_key)):
                    expected = {}
                    for name, trips in db.execute(
                        f'SELECT s.name, SUM(t.trips) FROM trips t JOIN stations s ON s.id=t.{side} '
                        'WHERE t.day=%s AND t.hour>=7 AND t.hour<10 GROUP BY s.name', (day,),
                    ):
                        name = canonical(name)
                        expected[name] = expected.get(name, 0) + trips
                    actual = {row['station']: row[key] for row in answer['stations'] if row[key]}
                    self.assertEqual(actual, expected)
        self.assertEqual(sum(v or 0 for v in answer['hourly'][7:10]), answer['total'])

    def test_whole_day_matches_hourly_detail(self):
        whole = Period(f'{MONTH}-15', 'all', 0, 24)
        with open_month(MONTH) as db:
            raw = db.execute('SELECT SUM(trips) FROM trips WHERE day=15').fetchone()[0]
        self.assertEqual(sum(whole.flows.values()), raw)

    def test_daily_detail_adds_up_to_the_month(self):
        with open_month(MONTH) as db:
            raw = db.execute('SELECT SUM(trips) FROM trips').fetchone()[0]
            total = int(db.execute("SELECT value FROM metadata WHERE key='total'").fetchone()[0])
        self.assertEqual(raw, total)

    def test_whole_month_counts_weekdays_despite_new_year_night_service(self):
        period = Period('2020-01', 'weekday', 0, 24)
        self.assertEqual(period.days, 23)
        self.assertEqual(period.hour_days[2], 1)
        self.assertGreater(period.totals()[0]['新北產業園區'], 0)

    def test_midmonth_new_station_before_opening_is_absent_not_zero(self):
        early = Period('2020-01-02', 'all', 0, 24)
        self.assertNotIn('十四張', early.stations)
        net = network_query(SimpleNamespace(period='2020-01-02', compare='2020-01-31', days='all', start=0, end=24, hourly=False))
        by = {r['station']: r for r in net['stations']}
        self.assertIsNone(by['十四張']['entries'])
        self.assertIsNone(by['十四張']['exits'])
        self.assertGreater(by['十四張']['compareEntries'], 0)
        st = station_query(SimpleNamespace(name='十四張', period='2020-01-31', compare='2020-01-02', days='all', start=0, end=24, limit=10))
        self.assertFalse(st['comparePresent'])
        self.assertIsNone(st['compareEntries'])
        self.assertIsNone(st['compareExits'])
        cal = calendar_query(SimpleNamespace(month='2020-01', name='十四張'))
        by_date = {d['date']: d for d in cal['dates']}
        self.assertIsNone(by_date['2020-01-02']['entries'])
        self.assertIsNone(by_date['2020-01-02']['exits'])
        self.assertGreater(by_date['2020-01-19']['entries'], 0)


@unittest.skipUnless(POSTGRES, 'PostgreSQL connection not configured')
class ReferenceTests(unittest.TestCase):
    def setUp(self):
        self.db = self.enterContext(open_reference())

    def test_named_holidays_and_make_up_workdays(self):
        day = lambda d: self.db.execute('SELECT weekend,off,note FROM day WHERE date=%s', (d,)).fetchone()
        self.assertEqual(day('2025-10-10'), (0, 1, '國慶日'))
        self.assertEqual(day('2025-10-11')[:2], (1, 0))
        self.assertEqual(day('2025-02-08')[:2], (1, 0))
        self.assertIsNotNone(day('2025-02-08')[2])

    def test_every_alias_points_at_one_station(self):
        rows = self.db.execute("SELECT name FROM station WHERE name ~ '^[A-Z][^A-Za-z0-9]'").fetchall()
        self.assertEqual(rows, [])

    def test_series_agrees_with_the_month_file(self):
        sid = self.db.execute('SELECT id FROM station WHERE name=%s', ('板橋',)).fetchone()[0]
        series = self.db.execute("SELECT SUM(entries) FROM station_day WHERE station_id=%s AND date LIKE %s", (sid, MONTH + '-%')).fetchone()[0]
        with open_month(MONTH) as db:
            names = [n for (n,) in db.execute('SELECT DISTINCT station FROM station_hours')]
            aliases = [n for n in names if canonical(n) == '板橋']
            shard = db.execute("SELECT SUM(entries) FROM station_hours WHERE station = ANY(%s)", (aliases,)).fetchone()[0]
        self.assertEqual(series, shard)

    def test_workday_excludes_holidays_and_includes_makeup_days(self):
        oct_work = _workdays('2025-10')
        self.assertNotIn('2025-10-10', oct_work)
        self.assertNotIn('2025-10-11', oct_work)
        feb_work = _workdays('2025-02')
        self.assertIn('2025-02-08', feb_work)

        wk = get_network(MONTH, days='weekday')
        wd = get_network(MONTH, days='workday')
        expected_workdays = len(_workdays(MONTH))
        self.assertLessEqual(wd['period']['days'], wk['period']['days'])
        self.assertEqual(wd['period']['days'], expected_workdays)
        st = get_station('台北車站', MONTH, days='workday')
        self.assertEqual(st['period']['days'], expected_workdays)
        tr = get_trend('台北車站', days='workday')
        sep_row = next(r for r in tr['months'] if r['month'] == MONTH)
        self.assertEqual(sep_row['days'], expected_workdays)

    def test_workday_aggregates_match_direct_day_scan(self):
        for month, start, end in [('2025-02', 7, 10), ('2025-10', 0, 24), (MONTH, 8, 11)]:
            with self.subTest(month=month, hours=(start, end)), open_month(month) as db:
                dates = set(metadata(db)['dates'])
                workdays = dates & _workdays(month)
                actual_flows, actual_hours = _workday_totals(db, dates, workdays, start, end)
                expected_flows, expected_hours = _selected_days(db, workdays, start, end)
                self.assertEqual(actual_flows, expected_flows)
                self.assertEqual(sorted(actual_hours), sorted(expected_hours))


if __name__ == '__main__':
    unittest.main()
