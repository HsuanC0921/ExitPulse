import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from station_hubs_wikidata import parse_hub_rows
from station_info import group_hubs


class WikidataHubsTest(unittest.TestCase):
    def test_ignores_misclassified_heritage_and_only_places_nearby_sites(self):
        def row(item, label, point, kind):
            return {
                'item': {'value': f'http://www.wikidata.org/entity/{item}'},
                'itemLabel': {'value': label},
                'location': {'value': point},
                'kind': {'value': kind},
            }

        places = parse_hub_rows([
            row('Q113771780', '臺大醫院舊館西址鍋爐室', 'Point(121.518 25.046)', 'hospital'),
            row('Q1', '測試商場', 'Point(121.517 25.047)', 'mall'),
            row('Q2', '遠處場館', 'Point(121.600 25.050)', 'arts_centre'),
        ])
        result = group_hubs({'台北車站': (121.517, 25.046)}, places)
        self.assertEqual([place['name'] for place in result['台北車站']], ['測試商場'])
        self.assertEqual(result['台北車站'][0]['source'], 'https://www.wikidata.org/wiki/Q1')
        self.assertEqual(result['台北車站'][0]['sourceLabel'], 'Wikidata（CC0）')
