"""以來源 IP 為單位的速率限制（記憶體內的 token bucket），只管 /api/。

單一使用者用不同參數避開結果快取時，不會把全域排隊塞滿而讓其他人收到 429。
EXITPULSE_RATE_PER_MINUTE 為補充速度（0 代表關閉），EXITPULSE_RATE_BURST 為瞬間可用的次數。
"""
import ipaddress
import logging
import os
import time

from fastapi.responses import JSONResponse

log = logging.getLogger('exitpulse.api')
PER_MINUTE = float(os.environ.get('EXITPULSE_RATE_PER_MINUTE', 240))
BURST = float(os.environ.get('EXITPULSE_RATE_BURST', 80))
MAX_CLIENTS, IDLE_SECONDS, LOG_EVERY = 10_000, 600, 60


def client_ip(scope):
    """直連的對端是內網（反向代理）時才採用 X-Forwarded-For 的第一個位址，否則一律用對端本身，避免被偽造。"""
    peer = (scope.get('client') or ('', 0))[0]
    try:
        trusted = ipaddress.ip_address(peer).is_private
    except ValueError:
        trusted = False
    if trusted:
        for name, value in scope['headers']:
            if name == b'x-forwarded-for':
                try:
                    return str(ipaddress.ip_address(value.decode('latin-1').split(',')[0].strip()))
                except ValueError:
                    break
    return peer


class RateLimit:
    def __init__(self, app, per_minute=PER_MINUTE, burst=BURST, clock=time.monotonic):
        self.app, self.rate, self.burst, self.clock = app, per_minute / 60, burst, clock
        self.buckets, self.logged = {}, {}

    def take(self, ip):
        """扣一次；回傳 None 代表放行，否則回傳需要等待的秒數。"""
        now = self.clock()
        tokens, stamp = self.buckets.get(ip, (self.burst, now))
        tokens = min(self.burst, tokens + (now - stamp) * self.rate)
        if len(self.buckets) >= MAX_CLIENTS and ip not in self.buckets:
            self.buckets = {k: v for k, v in self.buckets.items() if now - v[1] < IDLE_SECONDS}
            self.logged = {k: v for k, v in self.logged.items() if now - v < LOG_EVERY}
        if tokens < 1:
            self.buckets[ip] = (tokens, now)
            return (1 - tokens) / self.rate
        self.buckets[ip] = (tokens - 1, now)
        return None

    async def __call__(self, scope, receive, send):
        if self.rate <= 0 or scope['type'] != 'http' or not scope['path'].startswith('/api/'):
            await self.app(scope, receive, send)
            return
        ip = client_ip(scope)
        wait = self.take(ip)
        if wait is None:
            await self.app(scope, receive, send)
            return
        now = self.clock()
        if now - self.logged.get(ip, -LOG_EVERY) >= LOG_EVERY:
            self.logged[ip] = now
            log.warning('Rate limit exceeded: client=%s path=%s', ip, scope['path'])
        response = JSONResponse({'error': '請求太頻繁，請稍後再試。'}, status_code=429,
                                headers={'Retry-After': str(max(1, round(wait)))})
        await response(scope, receive, send)
