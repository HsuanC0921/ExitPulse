"""analyze_od 比較邏輯測試：可比較時段建議、新站與單邊站、逆轉與逐時剖面。"""
import json
import os
import subprocess
import sys
import unittest
import tempfile
from contextlib import nullcontext
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import analyze_od
from analyze_od import comparable_stations, compare, hourly_profile
from import_od import month_rows
from od_postgres import database


class ComparisonTests(unittest.TestCase):
    def test_suggested_hours_preserve_date_coverage_and_day_type(self):
        baseline = dict(dates=['2024-01-01', '2024-01-02', '2024-01-06'], hours=[5, 6, 7, 8],
                        hourDates={'5': ['2024-01-01'], '6': ['2024-01-01', '2024-01-02'],
                                   '7': ['2024-01-01', '2024-01-02'], '8': ['2024-01-06']})
        current = dict(dates=['2025-01-01'], hours=[5, 6, 7, 8])
        with mock.patch.object(analyze_od, 'open_month', side_effect=lambda _: nullcontext(None)), \
                mock.patch.object(analyze_od, 'metadata', side_effect=[baseline, current]):
            result = analyze_od.hours_mismatch('2024-01', '2025-01', 2, 8, False)
        self.assertEqual(result['suggested'], [6, 8])
        self.assertEqual(result['recordedHours'], {'baseline': [5, 6, 7], 'current': [5, 6, 7, 8]})

    def test_no_safe_common_hour_has_no_suggestion(self):
        periods = [dict(dates=['2024-01-01'], hours=[5]), dict(dates=['2025-01-01'], hours=[6])]
        with mock.patch.object(analyze_od, 'open_month', side_effect=lambda _: nullcontext(None)), \
                mock.patch.object(analyze_od, 'metadata', side_effect=periods):
            result = analyze_od.hours_mismatch('2024-01', '2025-01', 2, 7, False)
        self.assertIsNone(result['suggested'])

    def test_new_year_spill_is_assigned_to_actual_calendar_month(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / '2021-12.csv'
            path.write_text('日期,時段,進站,出站,人次\n2021-12-31,23,A,B,3\n2022-01-01,02,A,B,4\n', encoding='utf-8')
            self.assertEqual([row[0] for row in month_rows(path, 2021, 12)], ['2021-12-31'])
            self.assertEqual([row[0] for row in month_rows(path, 2022, 1, True)], ['2022-01-01'])

    def test_new_and_one_sided_stations_are_not_comparable(self):
        old = {'origins': ['A', 'B'], 'destinations': ['A', 'B'], 'stations': ['A', 'B']}
        new = {'origins': ['A', 'B', 'C'], 'destinations': ['A', 'C'], 'stations': ['A', 'B', 'C']}
        self.assertEqual(comparable_stations(old, new), {'A'})

    def test_proportional_growth_has_no_share_change(self):
        old = {('A', 'B'): 100, ('A', 'C'): 100}
        new = {('A', 'B'): 200, ('A', 'C'): 200}
        rows = compare(old, new, 10, 10, {'A', 'B', 'C'}, 0)
        self.assertTrue(all(r['deltaSharePp'] == 0 for r in rows))

    def test_reversal_and_missing_station(self):
        old = {('A', 'B'): 80, ('B', 'A'): 20, ('A', 'X'): 1000}
        new = {('A', 'B'): 20, ('B', 'A'): 80, ('A', 'X'): 10000}
        rows = compare(old, new, 1, 1, {'A', 'B'}, 10)
        ab = next(r for r in rows if r['origin'] == 'A')
        self.assertTrue(ab['reversal'])
        self.assertEqual(ab['baselineOriginTotal'], 80)
        self.assertEqual(ab['currentOriginTotal'], 20)
        self.assertEqual(len(rows), 2)

    def test_zero_baseline_has_no_growth_rate(self):
        rows = compare({('A', 'C'): 10}, {('A', 'B'): 10}, 1, 1, {'A', 'B', 'C'}, 0)
        ab = next(r for r in rows if r['destination'] == 'B')
        self.assertIsNone(ab['growth'])

    def test_a_manually_selected_pair_can_be_below_the_ranking_threshold(self):
        baseline = {('A', 'B'): 2, ('A', 'C'): 100, ('B', 'A'): 4}
        current = {('A', 'B'): 4, ('A', 'C'): 100, ('B', 'A'): 2}
        stations = {'A', 'B', 'C'}
        ranked = compare(baseline, current, 1, 1, stations, 20)
        picked = compare(baseline, current, 1, 1, stations, 20, only=('A', 'B'))
        self.assertNotIn(('A', 'B'), [(row['origin'], row['destination']) for row in ranked])
        self.assertEqual([(row['baselineTrips'], row['currentTrips'], row['reversal']) for row in picked], [(2, 4, False)])


SCRIPT = Path(__file__).resolve().parents[1] / 'tools' / 'analyze_od.py'
# 2024-01-01..03 are weekdays, 2024-01-06 is a Saturday: 3 weekday dates.
HOURLY_FLOWS = [
    (7, 0, 'A', 'B', 30),
    (7, 0, 'B', 'A', 6),
    (7, 1, 'A', 'B', 999),  # weekend row, must be ignored for weekday
    (7, 0, 'A', 'C', 50),   # other destination, must be ignored
    (9, 0, 'B', 'A', 9),    # reverse-only hour
]


class HourlyProfileTests(unittest.TestCase):
    def _profile(self, flows, weekend=0):
        if not (os.getenv('EXITPULSE_DATABASE_URL') or os.getenv('PGDATABASE')):
            self.skipTest('PostgreSQL connection not configured')
        with database() as db:
            db.execute('CREATE TEMP TABLE flows (hour INTEGER, weekend INTEGER, origin TEXT, destination TEXT, trips INTEGER, PRIMARY KEY(hour, weekend, origin, destination))')
            db.execute('CREATE TEMP TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
            db.cursor().executemany('INSERT INTO flows VALUES (%s,%s,%s,%s,%s)', flows)
            meta = dict(dates=['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-06'],
                        hours=[7, 9], stations=['A', 'B'], origins=['A', 'B'], destinations=['A', 'B'])
            db.cursor().executemany('INSERT INTO metadata VALUES (%s,%s)', [(k, json.dumps(v)) for k, v in meta.items()])
            with mock.patch.object(analyze_od, 'open_month', return_value=nullcontext(db)):
                return hourly_profile('2024-01', 'A', 'B', weekend)

    def test_weekday_average_per_hour(self):
        self.assertEqual(self._profile(HOURLY_FLOWS)['forward'][7], 10.0)  # 30 trips / 3 weekdays

    def test_hour_missing_from_metadata_is_none(self):
        out = self._profile(HOURLY_FLOWS)
        self.assertIsNone(out['forward'][8])
        self.assertIsNone(out['reverse'][8])

    def test_present_hour_without_trips_is_zero(self):
        self.assertEqual(self._profile(HOURLY_FLOWS)['forward'][9], 0.0)

    def test_reverse_direction_is_computed_separately(self):
        out = self._profile(HOURLY_FLOWS)
        self.assertEqual(out['reverse'][7], 2.0)  # 6 trips / 3 weekdays
        self.assertEqual(out['reverse'][9], 3.0)
        self.assertEqual(out['forward'][9], 0.0)

    def test_zero_limit_is_rejected_before_file_access(self):
        proc = subprocess.run([sys.executable, str(SCRIPT), '2099-01', '2099-02', '--limit', '0'],
                              capture_output=True, text=True)
        self.assertEqual(proc.returncode, 2)
        self.assertIn('Invalid hours or minimum', proc.stderr)


if __name__ == '__main__':
    unittest.main()
