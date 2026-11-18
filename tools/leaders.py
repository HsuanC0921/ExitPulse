"""榜單查詢：最忙的站、最忙的站對，帶比較期間時再加上成長與衰退最多的站。

用法：leaders.py --period P [--compare P] [--days weekday|workday|weekend|all] [--start H --end H] [--limit N]
結束碼與 query_od.py 相同：2 無法比較、3 月份未匯入、4 時段無紀錄。
"""
import argparse
import json
import sys

from analyze_od import AMBIGUOUS_INTERCHANGES, LINE_SCOPED_INTERCHANGES
from od_postgres import MonthNotFound
from query_od import Period, UnrecordedHours, rounded

# 基準期每日進站量低於這個值的站不列入成長排名，避免小基數放大百分比
GROWTH_FLOOR = 200


def leaders(period, compare=None, days='weekday', start=0, end=24, limit=10):
    a = Period(period, days, start, end)
    entries, exits = a.totals()
    out = {
        'period': a.label(), 'compare': None,
        'busiestStations': [{'station': s, 'entries': rounded(entries[s]), 'exits': rounded(exits.get(s, 0))}
                            for s in sorted(entries, key=lambda s: (-entries[s], s))[:limit]],
        # 同站進出不算站對
        'busiestPairs': [{'origin': o, 'destination': d, 'daily': rounded(n)}
                         for (o, d), n in sorted(((k, v) for k, v in a.flows.items() if k[0] != k[1]),
                                                 key=lambda kv: (-kv[1], kv[0]))[:limit]],
        'risingStations': None, 'fallingStations': None,
    }
    if compare:
        b = Period(compare, days, start, end)
        out['compare'] = b.label()
        eb, xb = b.totals()
        # 與站對比較同一套規則：兩期都同時有進站與出站紀錄，且不是站名口徑未確認的轉乘站
        unclear = AMBIGUOUS_INTERCHANGES | LINE_SCOPED_INTERCHANGES
        both = [s for s in entries if s in exits and s in eb and s in xb and s not in unclear and eb[s] >= GROWTH_FLOOR]
        rows = [{'station': s, 'baseline': rounded(eb[s]), 'current': rounded(entries[s]),
                 'delta': rounded(entries[s] - eb[s]), 'growthPct': rounded((entries[s] / eb[s] - 1) * 100)} for s in both]
        out['risingStations'] = sorted((r for r in rows if r['growthPct'] > 0), key=lambda r: (-r['growthPct'], r['station']))[:limit]
        out['fallingStations'] = sorted((r for r in rows if r['growthPct'] < 0), key=lambda r: (r['growthPct'], r['station']))[:limit]
    return out


def main(argv=None):
    parser = argparse.ArgumentParser(prog='leaders.py')
    parser.add_argument('--period', required=True)
    parser.add_argument('--compare')
    parser.add_argument('--days', choices=('weekday', 'workday', 'weekend', 'all'), default='weekday')
    parser.add_argument('--start', type=int, default=0)
    parser.add_argument('--end', type=int, default=24)
    parser.add_argument('--limit', type=int, default=10)
    args = parser.parse_args(argv)
    if not 0 <= args.start < args.end <= 24:
        parser.error('invalid hours')
    if not 1 <= args.limit <= 50:
        parser.error('invalid limit')
    try:
        result = leaders(args.period, args.compare, args.days, args.start, args.end, args.limit)
    except MonthNotFound as error:
        print(error, file=sys.stderr)
        sys.exit(3)
    except UnrecordedHours as error:
        print(error, file=sys.stderr)
        sys.exit(4)
    except ValueError as error:
        print(error, file=sys.stderr)
        sys.exit(2)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
