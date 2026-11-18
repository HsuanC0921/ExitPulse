"""以少量常駐行程執行 OD 分析。

每個行程自帶一組 PostgreSQL 連線池，直接呼叫 tools/od_worker.dispatch，所以一次請求不必重啟 Python 或重連資料庫。
相同條件同時進來只跑一次，結果短暫快取，超過排隊上限就回 Busy，不會無限等待。
"""
import asyncio
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKERS = int(os.environ.get('EXITPULSE_WORKERS', 2))
QUEUE = int(os.environ.get('EXITPULSE_QUEUE_LIMIT', 40))
TIMEOUT = float(os.environ.get('EXITPULSE_TIMEOUT_SECONDS', 30))
SQL_TIMEOUT = float(os.environ.get('EXITPULSE_SQL_TIMEOUT_SECONDS', TIMEOUT))
CATALOG_TTL, ANSWER_TTL, CACHE_LIMIT = 5, 120, 1024


class Busy(Exception):
    """同時等待的呼叫數超過行程數加排隊上限。"""


class Unavailable(Exception):
    """分析逾時，或分析行程異常結束。"""


@dataclass
class Query:
    waiters: int = 0
    submitted: bool = False
    task: asyncio.Task | None = None


# 行程初始化：載入 tools、切到專案根目錄、建立這個行程專用的連線池
def _init():
    sys.path.insert(0, str(ROOT / 'tools'))
    os.chdir(ROOT)
    import od_postgres
    od_postgres._pool = od_postgres.ConnectionPool(statement_timeout_ms=max(1, int(min(SQL_TIMEOUT, TIMEOUT) * 1000)))


# 在分析行程內執行一次查詢
def _run(script, arguments):
    from od_worker import dispatch
    return dispatch({'script': script, 'arguments': arguments})


# 行程池、結果快取、重複請求合併與排隊上限都在這個類別
class Runner:
    def __init__(self):
        self.pool = None
        self.cache = {}
        self.inflight = {}
        self.admitted = 0
        self.worker_slots = asyncio.Semaphore(WORKERS)
        self.closed = False

    def _executor(self):
        if self.pool is None:
            self.pool = ProcessPoolExecutor(max_workers=WORKERS, initializer=_init)
        return self.pool

    def close(self):
        self.closed = True
        for query in self.inflight.values():
            if not query.submitted:
                query.task.cancel()
        self._discard_pool()

    def _discard_pool(self):
        if self.pool:
            self.pool.shutdown(wait=False, cancel_futures=True)
            self.pool = None

    async def run(self, script, arguments):
        """回傳 {exitCode, output, error}，滿載拋 Busy，逾時或行程死亡拋 Unavailable。"""
        if self.closed:
            raise Unavailable
        key = (script, tuple(arguments))
        hit = self.cache.get(key)
        if hit and hit[1] > time.monotonic():
            return hit[0]
        limit = WORKERS + QUEUE
        query = self.inflight.get(key)
        if self.admitted >= limit or (query is None and len(self.inflight) >= limit):
            raise Busy
        if query is None:
            query = self.inflight[key] = Query()
            query.task = asyncio.create_task(self._scheduled(query, key, script, arguments))
            query.task.add_done_callback(lambda task: self._finished(key, query, task))
        self.admitted += 1
        query.waiters += 1
        try:
            return await asyncio.wait_for(asyncio.shield(query.task), TIMEOUT)
        except asyncio.TimeoutError:
            raise Unavailable from None
        finally:
            self.admitted -= 1
            query.waiters -= 1
            if not query.waiters and not query.submitted and not query.task.done():
                # Keep queued work cancellable until a real process slot is available.
                self.inflight.pop(key)
                query.task.cancel()

    def _finished(self, key, query, task):
        if self.inflight.get(key) is query:
            self.inflight.pop(key)
        if not task.cancelled():
            task.exception()  # Retrieve errors even if the last caller has gone away.

    async def _scheduled(self, query, key, script, arguments):
        async with self.worker_slots:
            query.submitted = True
            return await self._execute(key, script, arguments)

    async def _execute(self, key, script, arguments):
        pool = self._executor()
        try:
            reply = await asyncio.get_running_loop().run_in_executor(pool, _run, script, arguments)
        except BrokenProcessPool:
            if self.pool is pool:
                self._discard_pool()
            raise Unavailable from None
        if reply['exitCode'] == 6:  # PostgreSQL cancelled a statement at its deadline.
            raise Unavailable
        if reply['exitCode'] == 0:
            self._store(key, reply, CATALOG_TTL if script == 'od_postgres.py' else ANSWER_TTL)
        return reply

    # 寫入快取，滿了先清掉過期項目，仍滿就不再新增
    def _store(self, key, reply, ttl):
        now = time.monotonic()
        if len(self.cache) >= CACHE_LIMIT:
            self.cache = {k: v for k, v in self.cache.items() if v[1] > now}
        if len(self.cache) >= CACHE_LIMIT and key not in self.cache:
            # 仍滿就移除最早寫入的一筆（dict 保持寫入順序）
            self.cache.pop(next(iter(self.cache)))
        self.cache.pop(key, None)
        self.cache[key] = (reply, now + ttl)
