"""API 合約測試，不需要資料庫：分析行程以替身取代。"""
import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps' / 'api'))
sys.path.insert(0, str(ROOT / 'tools'))

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
import runner as runner_module  # noqa: E402


# 用替身取代分析行程，回傳呼叫紀錄供檢查
def stub(reply=None, error=None):
    calls = []

    async def run(script, arguments):
        calls.append((script, arguments))
        if error:
            raise error
        return reply or {'exitCode': 0, 'output': '{"ok":true}', 'error': ''}
    main.runner.run = run
    return calls


# 路由、驗證與錯誤對應
class Contract(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.original = main.runner.run

    def tearDown(self):
        main.runner.run = self.original

    def test_health(self):
        self.assertEqual(self.client.get('/health').json(), {'status': 'ok'})

    def test_directory_etags_validate_only_successful_current_representations(self):
        for endpoint in ('months', 'availability', 'catalog'):
            path = f'/api/v1/od/{endpoint}'
            stub()
            first = self.client.get(path)
            self.assertEqual(first.headers['cache-control'], 'public, max-age=5')
            etag = first.headers['etag']
            unchanged = self.client.get(path, headers={'If-None-Match': '"other", ' + etag[2:]})
            self.assertEqual((unchanged.status_code, unchanged.content), (304, b''))
            self.assertEqual(unchanged.headers['etag'], etag)
            stub({'exitCode': 0, 'output': '{"ok":false}', 'error': ''})
            updated = self.client.get(path, headers={'If-None-Match': etag})
            self.assertEqual(updated.status_code, 200)
            self.assertNotEqual(updated.headers['etag'], etag)
            stub(error=runner_module.Busy())
            failure = self.client.get(path, headers={'If-None-Match': '*'})
            self.assertEqual(failure.status_code, 429)
            self.assertNotIn('etag', failure.headers)


    def test_ready_reads_the_month_catalog(self):
        calls = stub()
        self.assertEqual(self.client.get('/ready').json(), {'status': 'ready'})
        self.assertEqual(calls, [('od_postgres.py', [])])
        stub({'exitCode': 9, 'output': '', 'error': 'connection refused'})
        self.assertEqual(self.client.get('/ready').status_code, 503)
        stub(error=runner_module.Unavailable())
        self.assertEqual(self.client.get('/ready').status_code, 503)

    def test_place_search_falls_back_to_station_names(self):
        original = main.places.find
        try:
            for failure in (main.UpstreamLimited(), main.httpx.ConnectError('down')):
                async def fail(_q, failure=failure):
                    raise failure
                main.places.find = fail
                response = self.client.get('/api/v1/map/places', params={'q': '臺北車站'})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()[0]['name'], '台北車站')
                self.assertEqual(response.json()[0]['category'], '捷運站')
            self.assertEqual(self.client.get('/api/v1/map/places', params={'q': '西門站'}).json()[0]['name'], '西門站')
            response = self.client.get('/api/v1/map/places', params={'q': '不存在的地方'})
            self.assertEqual(response.status_code, 503)
        finally:
            main.places.find = original

    def test_success_passes_the_worker_output_through(self):
        calls = stub()
        response = self.client.get('/api/v1/od/matrix', params={'period': '2026-09', 'start': 7, 'end': 10})
        self.assertEqual((response.status_code, response.text), (200, '{"ok":true}'))
        self.assertEqual(calls[0], ('query_od.py', ['matrix', '--limit', '12', '--period', '2026-09', '--days', 'weekday',
                                                    '--start', '7', '--end', '10']))

    def test_worker_exit_codes_map_to_http_answers(self):
        cases = {2: (422, None), 3: (404, None), 4: (422, 'unrecorded_hours'), 9: (503, None)}
        for exit_code, (status, code) in cases.items():
            stub({'exitCode': exit_code, 'output': '', 'error': 'boom'})
            response = self.client.get('/api/v1/od/months')
            self.assertEqual(response.status_code, status, exit_code)
            self.assertEqual(response.json().get('code'), code, exit_code)

    def test_station_without_records_gets_its_own_message(self):
        stub({'exitCode': 2, 'output': '', 'error': '某站: not in the selected periods'})
        response = self.client.get('/api/v1/od/station', params={'name': '某站', 'period': '2026-09'})
        self.assertEqual(response.status_code, 422)
        self.assertIn('沒有旅次紀錄', response.json()['error'])
        stub({'exitCode': 2, 'output': '', 'error': 'selected hours do not cover the same dates'})
        self.assertIn('無法比較', self.client.get('/api/v1/od/months').json()['error'])

    def test_hours_mismatch_body_is_returned_as_is(self):
        body = '{"code":"hours_mismatch","error":"x","recordedHours":{"baseline":[7],"current":[7]},"suggested":[7,8]}'
        stub({'exitCode': 5, 'output': body, 'error': ''})
        response = self.client.get('/api/v1/od/months')
        self.assertEqual((response.status_code, response.text), (422, body))

    def test_busy_and_timeout(self):
        stub(error=runner_module.Busy())
        self.assertEqual(self.client.get('/api/v1/od/months').status_code, 429)
        stub(error=runner_module.Unavailable())
        self.assertEqual(self.client.get('/api/v1/od/months').status_code, 504)

    def test_invalid_requests_are_400_and_never_reach_the_runner(self):
        calls = stub()
        bad = [
            ('/api/v1/od/radar', {'baseline': '2026-09', 'current': '2026-09', 'start': 7, 'end': 10, 'weekend': 'false'}),
            ('/api/v1/od/radar', {'baseline': '2022-09', 'current': '2026-09', 'start': 10, 'end': 7, 'weekend': 'false'}),
            ('/api/v1/od/radar', {'baseline': '2022-09', 'current': '2026-09', 'start': 7, 'end': 10, 'weekend': 'false', 'type': 'x'}),
            ('/api/v1/od/radar', {'baseline': '2022-09', 'current': '2026-09'}),
            ('/api/v1/od/matrix', {'period': '2026-09', 'limit': 99}),
            ('/api/v1/od/station-info', {'name': ''}),
            ('/api/v1/od/station', {'name': 'x', 'period': '2026-13'}),
            ('/api/v1/od/relation-hours', {'origin': 'a', 'destination': 'b', 'date': '2026-09'}),
        ]
        for path, params in bad:
            response = self.client.get(path, params=params)
            self.assertEqual(response.status_code, 400, (path, params))
            self.assertIn('error', response.json())
        self.assertEqual(calls, [])

    def test_radar_builds_the_same_arguments_as_before(self):
        calls = stub()
        response = self.client.get('/api/v1/od/radar', params={'baseline': '2022-09', 'current': '2026-09', 'start': 7, 'end': 10,
                                                               'weekend': 'true', 'minimum': 20.5, 'origin': 'a', 'destination': 'b'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get('cache-control'), 'public, max-age=300, stale-while-revalidate=600')
        self.assertEqual(calls[0][1], ['2022-09', '2026-09', '--start', '7', '--end', '10', '--minimum', '20.5', '--type',
                                       'all', '--limit', '500', '--direct', 'a', 'b', '--weekend'])


    def test_workday_is_accepted_as_a_day_type(self):
        calls = stub()
        self.assertEqual(self.client.get('/api/v1/od/network', params={'period': '2026-09', 'days': 'workday'}).status_code, 200)
        self.assertIn('workday', calls[0][1])
        self.assertEqual(self.client.get('/api/v1/od/network', params={'period': '2026-09', 'days': 'holiday'}).status_code, 400)

    def test_leaders_builds_arguments_and_rejects_bad_limit(self):
        calls = stub()
        response = self.client.get('/api/v1/od/leaders', params={'period': '2026-09', 'compare': '2022-09', 'start': 7, 'end': 10})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls[0], ('leaders.py', ['--limit', '10', '--period', '2026-09', '--days', 'weekday',
                                                   '--start', '7', '--end', '10', '--compare', '2022-09']))
        for limit in (0, 21):
            self.assertEqual(self.client.get('/api/v1/od/leaders', params={'period': '2026-09', 'limit': limit}).status_code, 400)
        self.assertEqual(self.client.get('/api/v1/od/leaders', params={'period': '2026-13'}).status_code, 400)


# 請求合併、快取與排隊上限
class Runner(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.runner = runner_module.Runner()
        self.runs = 0

        async def execute(key, script, arguments):
            self.runs += 1
            await asyncio.sleep(0.05)
            reply = {'exitCode': 0, 'output': '1', 'error': ''}
            self.runner._store(key, reply, 60)
            return reply
        self.runner._execute = execute

    async def test_identical_requests_share_one_run_and_then_hit_the_cache(self):
        replies = await asyncio.gather(*[self.runner.run('query_od.py', ['x']) for _ in range(5)])
        self.assertEqual(self.runs, 1)
        self.assertTrue(all(r['output'] == '1' for r in replies))
        await self.runner.run('query_od.py', ['x'])
        self.assertEqual(self.runs, 1)

    async def test_od_disconnect_removes_last_waiter_from_the_analysis_queue(self):
        queue = asyncio.Queue()
        connected = asyncio.Event()
        await queue.put({'type': 'http.request', 'body': b'', 'more_body': False})
        slots = self.runner.worker_slots
        for _ in range(runner_module.WORKERS):
            await slots.acquire()

        async def handler(_scope, _receive, _send):
            connected.set()
            await self.runner.run('query_od.py', ['abandoned'])

        async def send(_message):
            self.fail('disconnected client received a response')

        middleware = main.CancelDisconnectedOdQuery(handler)
        request = asyncio.create_task(middleware(
            {'type': 'http', 'method': 'GET', 'path': '/api/v1/od/network'}, queue.get, send,
        ))
        await asyncio.wait_for(connected.wait(), timeout=1)
        self.assertEqual(self.runner.admitted, 1)
        await queue.put({'type': 'http.disconnect'})
        await asyncio.wait_for(request, timeout=1)
        self.assertEqual(self.runner.admitted, 0)
        self.assertEqual(self.runner.inflight, {})
        self.assertEqual(self.runs, 0)

    async def test_callers_beyond_workers_plus_queue_get_busy(self):
        limit = runner_module.WORKERS + runner_module.QUEUE
        tasks = [asyncio.ensure_future(self.runner.run('query_od.py', [str(i)])) for i in range(limit)]
        await asyncio.sleep(0)
        with self.assertRaises(runner_module.Busy):
            await self.runner.run('query_od.py', ['one more'])
        await asyncio.gather(*tasks)
        self.assertEqual(self.runner.admitted, 0)

    async def test_timeout_keeps_running_work_charged_and_drops_abandoned_queue(self):
        with patch.object(runner_module, 'WORKERS', 1), patch.object(runner_module, 'QUEUE', 1), \
                patch.object(runner_module, 'TIMEOUT', 0.02):
            engine = runner_module.Runner()
            started = asyncio.Event()
            finish = asyncio.Event()
            executed = []

            async def execute(_key, _script, arguments):
                executed.append(arguments[0])
                if arguments[0] == 'running':
                    started.set()
                    await finish.wait()
                return {'exitCode': 0, 'output': '{}', 'error': ''}

            engine._execute = execute
            call = asyncio.create_task(engine.run('query_od.py', ['running']))
            await started.wait()
            running = next(iter(engine.inflight.values())).task
            try:
                with self.assertRaises(runner_module.Unavailable):
                    await call
                for i in range(3):
                    with self.assertRaises(runner_module.Unavailable):
                        await engine.run('query_od.py', [f'queued-{i}'])
                    self.assertEqual(len(engine.inflight), 1)
                self.assertEqual(engine.admitted, 0)
                self.assertEqual(executed, ['running'])
            finally:
                finish.set()
                await running
                await asyncio.sleep(0)
            self.assertEqual((await engine.run('query_od.py', ['next']))['exitCode'], 0)
            self.assertEqual(executed, ['running', 'next'])

    async def test_cancelled_waiter_preserves_the_duplicate_and_running_capacity(self):
        with patch.object(runner_module, 'WORKERS', 1), patch.object(runner_module, 'QUEUE', 1):
            engine = runner_module.Runner()
            started, finish = asyncio.Event(), asyncio.Event()

            async def execute(_key, _script, arguments):
                if arguments == ['running']:
                    started.set()
                    await finish.wait()
                return {'exitCode': 0, 'output': arguments[0], 'error': ''}

            engine._execute = execute
            first = asyncio.create_task(engine.run('query_od.py', ['running']))
            await started.wait()
            duplicate = asyncio.create_task(engine.run('query_od.py', ['running']))
            await asyncio.sleep(0)
            first.cancel()
            await asyncio.gather(first, return_exceptions=True)
            queued = asyncio.create_task(engine.run('query_od.py', ['queued']))
            await asyncio.sleep(0)
            duplicate.cancel()
            await asyncio.gather(duplicate, return_exceptions=True)
            try:
                with self.assertRaises(runner_module.Busy):
                    await engine.run('query_od.py', ['over-capacity'])
            finally:
                finish.set()
                self.assertEqual((await queued)['output'], 'queued')

    async def test_catalog_change_evicts_stale_analysis_cache(self):
        engine = runner_module.Runner()
        engine._store(('query_od.py', ('2026-09',)), {'exitCode': 0, 'output': 'cached', 'error': ''}, 1800)
        engine._store(('od_postgres.py', ()), {'exitCode': 0, 'output': '["2026-09"]', 'error': ''}, 5)
        self.assertIn(('query_od.py', ('2026-09',)), engine.cache)

        # 目錄字串未變，應保留分析快取
        engine._store(('od_postgres.py', ()), {'exitCode': 0, 'output': '["2026-09"]', 'error': ''}, 5)
        self.assertIn(('query_od.py', ('2026-09',)), engine.cache)

        # 一旦目錄出現新月份，立即清掉舊分析快取
        engine._store(('od_postgres.py', ()), {'exitCode': 0, 'output': '["2026-09","2026-10"]', 'error': ''}, 5)
        self.assertNotIn(('query_od.py', ('2026-09',)), engine.cache)
        self.assertIn(('od_postgres.py', ()), engine.cache)


if __name__ == '__main__':
    unittest.main()
