"""Mixed-load stress test for the ExitPulse OD API."""
import argparse
import json
import math
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

TIMEOUT = 30
BANDS = [(7, 10), (10, 16), (16, 19), (19, 24)]
TYPES = ['all', 'increase', 'decrease', 'reversal']
PAIRS = [('松山', '台北小巨蛋'), ('南港', '南港展覽館')]
HANDLED = {200, 422}  # 422 is a valid "cannot compare" answer
REQUIRED = {
    'radar': {'baseline', 'current', 'results'},
    'pair': {'origin', 'destination', 'baseline', 'current'},
    'station': {'station', 'period', 'hourly', 'outbound', 'inbound'},
    'network': {'period', 'total', 'stations'},
    'catalog': {'summary', 'months', 'stations'},
    'leaders': {'period', 'busiestStations', 'busiestPairs'},
}


def pct(values, p):
    s = sorted(values)
    if not s:
        return 0.0
    return s[max(0, math.ceil(p / 100 * len(s)) - 1)]


def build_workload(api, months, n, rng, *, workday=False):
    specs = []
    for _ in range(n):
        base, cur = rng.sample(months, 2)
        is_weekend = rng.random() < 0.5
        weekend = str(is_weekend).lower()
        days = 'workday' if workday else 'weekend' if is_weekend else 'weekday'
        kind = (rng.choice(['station', 'network', 'leaders']) if workday
                else rng.choices(['radar', 'pair', 'station', 'network', 'catalog'], [4, 2, 2, 2, 1])[0])
        if kind == 'pair':
            origin, dest = rng.choice(PAIRS)
            params = dict(baseline=base, current=cur, origin=origin, destination=dest, weekend=weekend)
        elif kind == 'radar':
            start, end = rng.choice(BANDS)
            params = dict(baseline=base, current=cur, start=start, end=end, weekend=weekend,
                          minimum=20, type=rng.choice(TYPES))
        elif kind in ('station', 'network', 'leaders'):
            start, end = rng.choice(BANDS)
            params = dict(period=cur, compare=base, days=days, start=start, end=end)
            if kind == 'station':
                params['name'] = '台北車站'
        else:
            params = {}
        suffix = '?' + urllib.parse.urlencode(params) if params else ''
        specs.append((kind, f'{api}/api/v1/od/{kind}{suffix}'))
    return specs


def run_one(kind, url):
    t0 = time.perf_counter()
    err = None
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT) as r:
            status = r.status
            body = json.load(r)
            if not isinstance(body, dict) or not REQUIRED[kind].issubset(body):
                raise ValueError(f'malformed {kind} response')
    except urllib.error.HTTPError as e:
        status = e.code
        e.read()
    except Exception as e:  # timeouts and connection failures count as errors
        status, err = None, repr(e)
    return kind, status, (time.perf_counter() - t0) * 1000, err


def summarize(label, rows):
    if not rows:
        print(f'{label}: n=0')
        return
    lat = [r[2] for r in rows]
    errors = sum(r[1] not in HANDLED for r in rows)
    handled = sum(r[1] == 422 for r in rows)
    print(f'{label}: n={len(rows)} errors={errors} handled_422={handled} '
          f'p50={pct(lat, 50):.0f}ms p95={pct(lat, 95):.0f}ms max={max(lat):.0f}ms')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--api', default='http://127.0.0.1:5011')
    parser.add_argument('--requests', type=int, default=200)
    parser.add_argument('--concurrency', type=int, default=20)
    parser.add_argument('--p95-ms', type=float, default=3000)
    parser.add_argument('--mode', choices=('mixed', 'duplicate', 'workday'), default='mixed')
    args = parser.parse_args()
    api = args.api.rstrip('/')

    with urllib.request.urlopen(f'{api}/api/v1/od/months', timeout=TIMEOUT) as r:
        months = json.loads(r.read())
    if len(months) < 2:
        sys.exit('need at least two months from /api/v1/od/months')
    months = months[::max(1, len(months) // 6)][:6]

    specs = build_workload(api, months, args.requests, random.Random(42), workday=args.mode == 'workday')
    if args.mode == 'duplicate':
        specs = [('catalog', f'{api}/api/v1/od/catalog')] * args.requests
    with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        t0 = time.perf_counter()
        rows = list(ex.map(lambda s: run_one(*s), specs))
        elapsed = time.perf_counter() - t0

    errors = [r for r in rows if r[1] not in HANDLED]
    overall_p95 = pct([r[2] for r in rows], 95)
    print(f'months={len(months)} requests={len(rows)} errors={len(errors)} '
          f'handled_422={sum(r[1] == 422 for r in rows)} elapsed={elapsed:.2f}s '
          f'req_per_s={len(rows) / elapsed:.1f}')
    lat = [r[2] for r in rows]
    print(f'overall: p50={pct(lat, 50):.0f}ms p95={overall_p95:.0f}ms max={max(lat):.0f}ms')
    for kind in sorted({row[0] for row in rows}):
        summarize(kind, [r for r in rows if r[0] == kind])
    for kind, status, _, err in errors[:5]:
        print(f'error sample: {kind} status={status} {err or ""}', file=sys.stderr)

    if errors or overall_p95 > args.p95_ms:
        print(f'FAIL errors={len(errors)} p95={overall_p95:.0f}ms limit={args.p95_ms:.0f}ms')
        sys.exit(1)
    print('PASS')


if __name__ == '__main__':
    main()
