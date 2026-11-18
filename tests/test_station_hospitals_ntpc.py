import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from station_hospitals_ntpc import match_hospitals


class NewTaipeiHospitalMatchTest(unittest.TestCase):
    def test_matches_registered_name_and_door_number(self):
        name = '中英醫療社團法人板英醫院'
        registry = [{'hosp_id': 'example', 'hosp_name': name,
                     'hosp_addr': '新北市板橋區文化路1段267、269、271號1-4樓'}]
        point = {'name': name, 'addr': '新北市板橋區文化路一段267號',
                 'marktype': '9930101', 'lon': 121.464578, 'lat': 25.018488}
        matches = match_hospitals(registry, [point, point])
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]['tags']['name'], name)
        self.assertEqual(match_hospitals(registry, [dict(point, addr='新北市板橋區文化路二段267號')]), [])
        self.assertEqual(match_hospitals(registry, [dict(point, marktype='9930301')]), [])
