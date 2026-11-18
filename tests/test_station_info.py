"""車站沿革里程碑與開放資料整合測試。"""
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import station_info


class StationHistorySourceTests(unittest.TestCase):
    def test_station_lines_include_the_source_for_each_line_opening(self):
        lines = station_info._station_lines('台北車站')

        self.assertGreaterEqual(len(lines), 2)
        self.assertTrue(all(line['source'].startswith('http') for line in lines))
        self.assertTrue(all(line['opened'] and line['stationCode'] for line in lines))

    def test_catchment_population_aggregates_nearby_districts_and_weighted_yoy(self):
        pop = {
            '臺北市南港區': {'period': '11510', 'population': 110000, 'yoyPct': 1.0},
            '新北市汐止區': {'period': '11510', 'population': 210000, 'yoyPct': 2.0},
        }
        res = station_info.catchment_population(121.6075, 25.0521, '臺北市南港區', pop)

        self.assertIsNotNone(res)
        self.assertEqual(res['districts'][0], '南港區')
        self.assertIn('汐止區', res['districts'])
        self.assertEqual(res['population'], 320000)
        self.assertEqual(res['period'], '11510')
        self.assertAlmostEqual(res['yoyPct'], 1.7, places=1)

    def test_fetch_wiki_story_skips_disambiguation_and_caps_two_sentences(self):
        responses = [
            {'type': 'disambiguation', 'extract': '可能指多個捷運車站。'},
            {
                'type': 'standard',
                'extract': '南港站位於臺北市南港區，為臺北捷運板南線車站。本站在南港軟體園區通勤上扮演要角。第三句應被省略。',
                'content_urls': {'desktop': {'page': 'https://zh.wikipedia.org/wiki/南港站'}},
            },
        ]

        def fake_urlopen(req, timeout=8):
            payload = responses.pop(0)
            return io.BytesIO(json.dumps(payload, ensure_ascii=False).encode('utf-8'))

        with patch.object(station_info.urllib.request, 'urlopen', side_effect=fake_urlopen):
            story = station_info.fetch_wiki_story('南港')

        self.assertIsNotNone(story)
        self.assertEqual(story['sourceLabel'], '維基百科（CC BY-SA）')
        self.assertNotIn('第三句', story['summary'])
        self.assertIn('板南線車站', story['summary'])

    def test_nearby_hubs_falls_back_to_cache_when_overpass_fails(self):
        cached = [
            {'type': 'node', 'lat': 25.053, 'lon': 121.608, 'tags': {'name': '南港軟體園區', 'landuse': 'industrial'}},
            {'type': 'node', 'lat': 25.100, 'lon': 121.700, 'tags': {'name': '遠方商場', 'shop': 'mall'}},
        ]
        with tempfile.TemporaryDirectory() as tmp:
            tmp_root = Path(tmp)
            (tmp_root / 'data').mkdir()
            (tmp_root / 'data' / 'osm-hubs.json').write_text(json.dumps(cached, ensure_ascii=False), encoding='utf-8')
            with patch.object(station_info, 'ROOT', tmp_root), \
                 patch.object(station_info.urllib.request, 'urlopen', side_effect=OSError('502 Bad Gateway')):
                hubs = station_info.nearby_hubs({'南港': (121.6075, 25.0521)}, force_refresh=True, retry_delay=0)

        self.assertIn('南港', hubs)
        self.assertEqual(len(hubs['南港']), 1)
        self.assertEqual(hubs['南港'][0]['name'], '南港軟體園區')
        self.assertEqual(hubs['南港'][0]['kind'], '園區')

    def test_nearby_youbike_reads_case_insensitive_quantity_and_handles_missing_capacity(self):
        tp_rows = [
            {'sno': '500101001', 'sna': 'YouBike2.0_南港車站', 'ar': '忠孝東路七段', 'act': '1', 'Quantity': '36', 'latitude': '25.0525', 'longitude': '121.6078'},
            {'sno': '500101002', 'sna': 'YouBike2.0_缺容量測試站', 'ar': '南港路', 'act': '1', 'latitude': '25.0528', 'longitude': '121.6079'},
        ]
        ntpc_rows = [
            {'sna': 'YouBike2.0_板橋車站', 'ar': '縣民大道', 'tot_quantity': '48', 'lat': '25.0143', 'lng': '121.4637'},
        ]

        def fake_urlopen(url, timeout=25):
            payload = tp_rows if 'youbike_immediate' in str(url) else ntpc_rows
            return io.BytesIO(json.dumps(payload, ensure_ascii=False).encode('utf-8'))

        with patch.object(station_info.urllib.request, 'urlopen', side_effect=fake_urlopen):
            res = station_info.nearby_youbike({'南港': (121.6075, 25.0521), '板橋': (121.4637, 25.0143)})

        by_name = {item['name']: item for item in res['南港']}
        self.assertEqual(by_name['南港車站']['capacity'], 36)
        self.assertEqual(by_name['缺容量測試站']['capacity'], 0)
        self.assertEqual(res['板橋'][0]['capacity'], 48)


if __name__ == '__main__':
    unittest.main()
