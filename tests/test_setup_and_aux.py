"""自動化建庫（setup.py）與輔助更新（update_auxiliary.py）單元測試。"""
from datetime import date
from pathlib import Path
import sys
import unittest
from unittest.mock import MagicMock, patch

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import json
import os
import notify
import setup
import update_auxiliary


class SetupBootstrapTests(unittest.TestCase):
    def test_parse_dbname_and_maintenance_url_support_uri_and_libpq(self):
        uri = 'postgresql://exitpulse:secret@127.0.0.1:55432/exitpulse_custom?sslmode=disable'
        self.assertEqual(setup.parse_dbname(uri), 'exitpulse_custom')
        self.assertEqual(
            setup.maintenance_url(uri),
            'postgresql://exitpulse:secret@127.0.0.1:55432/postgres?sslmode=disable',
        )

        libpq = 'host=db user=exitpulse dbname=my_db password=pw'
        self.assertEqual(setup.parse_dbname(libpq), 'my_db')
        self.assertEqual(setup.maintenance_url(libpq), 'host=db user=exitpulse dbname=postgres password=pw')

    def test_months_back_wraps_across_years(self):
        self.assertEqual(setup.months_back('2026-03', 12), '2025-04')
        self.assertEqual(setup.months_back('2026-01', 1), '2026-01')

    def test_ensure_database_exists_creates_missing_utf8_database(self):
        admin_conn = MagicMock()
        admin_ctx = MagicMock()
        admin_ctx.__enter__.return_value = admin_conn
        admin_ctx.__exit__.return_value = False
        target_conn = MagicMock()

        calls = []

        def fake_connect(url, **kwargs):
            calls.append((url, kwargs))
            if len(calls) == 1:
                raise psycopg.errors.InvalidCatalogName('database "exitpulse" does not exist')
            if 'dbname=postgres' in url or '/postgres' in url:
                return admin_ctx
            return target_conn

        with patch('psycopg.connect', side_effect=fake_connect):
            setup.ensure_database_exists('postgresql://exitpulse:pw@127.0.0.1:55432/exitpulse')

        self.assertEqual(len(calls), 3)
        admin_conn.execute.assert_called_once()
        sql_arg = admin_conn.execute.call_args[0][0]
        self.assertIn('CREATE DATABASE', sql_arg.as_string(None))
        self.assertIn("ENCODING 'UTF8'", sql_arg.as_string(None))
        target_conn.close.assert_called_once()


class AuxiliaryYearsTests(unittest.TestCase):
    def test_target_holiday_years_checks_current_and_next_year_by_default(self):
        with patch.object(update_auxiliary, 'date') as mock_date:
            mock_date.today.return_value = date(2026, 11, 21)
            self.assertEqual(update_auxiliary.target_holiday_years(), [2026, 2027])
        self.assertEqual(update_auxiliary.target_holiday_years(2028), [2028])


class NotifyTests(unittest.TestCase):
    def test_send_alert_skips_cleanly_when_unconfigured(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(notify.send_alert('Test', 'Msg'))

    def test_build_alert_payload_contains_discord_and_slack_keys(self):
        payload = notify.build_alert_payload('更新失敗', 'HTTP 500', host='test-host')
        self.assertEqual(payload['title'], '更新失敗')
        self.assertIn('[test-host ·', payload['content'])
        self.assertEqual(payload['content'], payload['text'])

    def test_send_alert_posts_json_to_configured_webhook(self):
        captured = {}

        class FakeResp:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return b'ok'

        def fake_urlopen(req, timeout=0):
            captured['url'] = req.full_url
            captured['body'] = json.loads(req.data.decode('utf-8'))
            return FakeResp()

        with patch.dict(os.environ, {'EXITPULSE_ALERT_WEBHOOK': 'https://example.invalid/hook'}, clear=True):
            with patch('urllib.request.urlopen', side_effect=fake_urlopen):
                self.assertTrue(notify.send_alert('任務失敗', 'exit 1'))

        self.assertEqual(captured['url'], 'https://example.invalid/hook')
        self.assertIn('exit 1', captured['body']['content'])


if __name__ == '__main__':
    unittest.main()
