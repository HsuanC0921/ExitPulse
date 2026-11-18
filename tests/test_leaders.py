"""榜單查詢測試：需連線 PostgreSQL，沒有設定資料庫時略過。"""
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))

POSTGRES = os.getenv('EXITPULSE_DATABASE_URL') or os.getenv('PGDATABASE')


@unittest.skipUnless(POSTGRES, 'PostgreSQL connection not configured')
class LeadersTests(unittest.TestCase):
    def test_busiest_lists_are_sorted_and_exclude_same_station_pairs(self):
        import leaders
        result = leaders.leaders('2026-09', None, 'weekday', 7, 10, 5)
        daily = [row['daily'] for row in result['busiestPairs']]
        self.assertEqual(daily, sorted(daily, reverse=True))
        self.assertTrue(all(row['origin'] != row['destination'] for row in result['busiestPairs']))
        self.assertEqual(len(result['busiestStations']), 5)
        self.assertIsNone(result['risingStations'])

    def test_growth_only_counts_stations_comparable_in_both_periods(self):
        import leaders
        from analyze_od import AMBIGUOUS_INTERCHANGES, LINE_SCOPED_INTERCHANGES
        result = leaders.leaders('2026-09', '2022-09', 'weekday', 7, 10, 10)
        names = {r['station'] for r in result['risingStations'] + result['fallingStations']}
        self.assertFalse(names & (AMBIGUOUS_INTERCHANGES | LINE_SCOPED_INTERCHANGES))
        self.assertTrue(all(r['growthPct'] > 0 for r in result['risingStations']))
        self.assertTrue(all(r['growthPct'] < 0 for r in result['fallingStations']))
        self.assertTrue(all(r['baseline'] >= leaders.GROWTH_FLOOR for r in result['risingStations']))

    def test_missing_month_raises_month_not_found(self):
        import leaders
        from od_postgres import MonthNotFound
        with self.assertRaises(MonthNotFound):
            leaders.leaders('2099-01')


if __name__ == '__main__':
    unittest.main()
