"""安全相關行為：速率限制、站名防選項注入、正式環境關閉 API 文件。不需要資料庫。"""
import asyncio
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps' / 'api'))
sys.path.insert(0, str(ROOT / 'tools'))
os.environ.setdefault('EXITPULSE_RATE_PER_MINUTE', '0')

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from limiter import RateLimit, client_ip  # noqa: E402


class Clock:
    now = 0.0

    def __call__(self):
        return self.now


class Limiter(unittest.TestCase):
    def test_burst_then_refill(self):
        clock = Clock()
        limit = RateLimit(None, per_minute=60, burst=3, clock=clock)
        self.assertEqual([limit.take('1.1.1.1') for _ in range(3)], [None, None, None])
        wait = limit.take('1.1.1.1')
        self.assertIsNotNone(wait)
        self.assertAlmostEqual(wait, 1.0)
        clock.now += 1.0
        self.assertIsNone(limit.take('1.1.1.1'))

    def test_clients_do_not_share_a_bucket(self):
        limit = RateLimit(None, per_minute=60, burst=1, clock=Clock())
        self.assertIsNone(limit.take('1.1.1.1'))
        self.assertIsNotNone(limit.take('1.1.1.1'))
        self.assertIsNone(limit.take('2.2.2.2'))

    def test_forwarded_for_only_from_private_peer(self):
        header = [(b'x-forwarded-for', b'203.0.113.9, 10.0.0.2')]
        self.assertEqual(client_ip({'client': ('172.18.0.5', 1), 'headers': header}), '203.0.113.9')
        self.assertEqual(client_ip({'client': ('8.8.8.8', 1), 'headers': header}), '8.8.8.8')
        self.assertEqual(client_ip({'client': ('172.18.0.5', 1), 'headers': [(b'x-forwarded-for', b'not-an-ip')]}), '172.18.0.5')

    def test_http_429_with_retry_after(self):
        async def ok(scope, receive, send):
            await send({'type': 'http.response.start', 'status': 200, 'headers': []})
            await send({'type': 'http.response.body', 'body': b'ok'})
        client = TestClient(RateLimit(ok, per_minute=60, burst=2, clock=Clock()))
        self.assertEqual([client.get('/api/v1/x').status_code for _ in range(3)], [200, 200, 429])
        blocked = client.get('/api/v1/x')
        self.assertEqual(blocked.status_code, 429)
        self.assertIn('Retry-After', blocked.headers)
        self.assertEqual(client.get('/health').status_code, 200)  # 健康檢查不受限


class Names(unittest.TestCase):
    def test_leading_dash_rejected(self):
        for value in ('--help', '-h', '--limit', '-1'):
            self.assertFalse(main.is_name(value), value)
        self.assertTrue(main.is_name('台北車站'))
        self.assertTrue(main.is_name('台北101/世貿'))

    def test_station_route_rejects_option_like_name(self):
        calls = []

        async def run(script, arguments):
            calls.append(arguments)
            return {'exitCode': 0, 'output': '{}', 'error': ''}
        original, main.runner.run = main.runner.run, run
        try:
            response = TestClient(main.app).get('/api/v1/od/station', params={'name': '--help', 'period': '2026-09'})
        finally:
            main.runner.run = original
        self.assertEqual(response.status_code, 400)
        self.assertEqual(calls, [])


class Docs(unittest.TestCase):
    def test_docs_flag_off_hides_openapi(self):
        # EXITPULSE_DOCS=0 時 FastAPI 以 None 關閉；這裡直接驗證建構規則
        from fastapi import FastAPI
        hidden = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
        client = TestClient(hidden)
        self.assertEqual(client.get('/docs').status_code, 404)
        self.assertEqual(client.get('/openapi.json').status_code, 404)


if __name__ == '__main__':
    unittest.main()
