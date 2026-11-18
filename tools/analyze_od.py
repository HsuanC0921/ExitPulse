"""比較兩個已匯入的 OD 彙總資料；進站結束小時採排除上界。"""
import argparse
import json
import math
import sys
from collections import defaultdict
from datetime import date

from od_postgres import HoursMismatch as _BaseHoursMismatch, MonthNotFound, UncomparableError, metadata, open_month

# 2026 uses line-prefixed names asymmetrically in origin and destination fields.
# Keep these interchange stations out until the operator's naming rules are verified.
AMBIGUOUS_INTERCHANGES = {'大坪林', '景安', '頭前庄', 'BL板橋'}
LINE_SCOPED_INTERCHANGES = {'G大坪林', 'O景安', 'O頭前庄', 'Y板橋'}


CHANGE_TYPES = {
    'all': lambda r: True,
    'increase': lambda r: r['deltaSharePp'] > 0,
    'decrease': lambda r: r['deltaSharePp'] < 0,
    'reversal': lambda r: r['reversal'],
}


class HoursMismatch(_BaseHoursMismatch):
    def __init__(self, payload=None, message='這個時段無法比較。'):
        super().__init__(payload or {}, message)


def hour_dates(info, weekend):
    candidate = {d for d in info['dates'] if (date.fromisoformat(d).weekday() >= 5) == bool(weekend)}
    return [set(info['hourDates'].get(str(h), [])) & candidate
            if 'hourDates' in info else candidate if h in info['hours'] else set()
            for h in range(24)]


def hours_mismatch(baseline, current, start, end, weekend):
    periods = []
    for month in (baseline, current):
        with open_month(month) as db:
            periods.append(hour_dates(metadata(db), weekend))
    # A suggestion must pass the same date-coverage rule as the actual query.
    candidates = [(a, b) for a in range(24) for b in range(a + 1, 25)
                  if all(p[a] and all(p[h] == p[a] for h in range(a, b)) for p in periods)]
    within = [(a, b) for a, b in candidates if start <= a < b <= end]
    suggested = min(within or candidates, key=lambda span: (-(span[1] - span[0]), abs(span[0] - start), span[0]), default=None)
    return dict(code='hours_mismatch', error='這組時段的紀錄日期不完整，請改選可比較時段。',
                recordedHours=dict(zip(('baseline', 'current'), ([h for h in range(24) if p[h]] for p in periods))),
                suggested=list(suggested) if suggested else None)


def comparable_stations(a, b):
    common = set(a['origins']) & set(a['destinations']) & set(b['origins']) & set(b['destinations'])
    if LINE_SCOPED_INTERCHANGES & (set(a['stations']) | set(b['stations'])):
        common -= AMBIGUOUS_INTERCHANGES
    return common


def read_month(month, start, end, weekend):
    with open_month(month) as db:
        info = metadata(db)
        rows = db.execute('SELECT origin,destination,SUM(trips)::bigint FROM flows WHERE hour >= %s AND hour < %s AND weekend = %s GROUP BY origin,destination',
                          (start, end, int(weekend))).fetchall()
    if not all(k in info for k in ('origins', 'destinations', 'hours')):
        raise ValueError(f'{month}: reimport to record station roles and available hours')
    candidate_dates = {d for d in info['dates'] if (date.fromisoformat(d).weekday() >= 5) == bool(weekend)}
    if 'hourDates' in info:
        observed = [set(info['hourDates'].get(str(h), [])) & candidate_dates for h in range(start, end)]
        if not observed or not observed[0] or any(days != observed[0] for days in observed):
            raise HoursMismatch(f'{month}: selected hours do not cover the same dates; cannot safely compare aggregated totals')
        days = len(observed[0])
    else:
        if not set(range(start, end)).issubset(info['hours']):
            raise HoursMismatch(f'{month}: selected hours are not present in this dataset')
        days = len(candidate_dates)
    return info, days, {(o, d): n for o, d, n in rows}


def compare(baseline, current, days_a, days_b, stations, minimum=20, only=None):
    """Return comparable pairs; zero means absent sparse aggregate, never absent station."""
    totals_a, totals_b = defaultdict(int), defaultdict(int)
    for flows, totals in ((baseline, totals_a), (current, totals_b)):
        for (origin, dest), count in flows.items():
            if origin in stations and dest in stations:
                totals[origin] += count
    results = []
    pairs = (only,) if only else baseline.keys() | current.keys()
    for origin, dest in pairs:
        if origin not in stations or dest not in stations or origin == dest:
            continue
        a, b = baseline.get((origin, dest), 0), current.get((origin, dest), 0)
        ta, tb = totals_a[origin], totals_b[origin]
        if not ta or not tb or (only is None and max(a / days_a, b / days_b) < minimum):
            continue
        delta = (b / tb - a / ta) * 100
        reverse_a, reverse_b = baseline.get((dest, origin), 0), current.get((dest, origin), 0)
        idx_a = (a - reverse_a) / (a + reverse_a) if a + reverse_a else None
        idx_b = (b - reverse_b) / (b + reverse_b) if b + reverse_b else None
        reversal = idx_a is not None and idx_b is not None and idx_a * idx_b < 0 and min(abs(idx_a), abs(idx_b)) >= .1 and abs(idx_b - idx_a) >= .25 and min((a + reverse_a) / days_a, (b + reverse_b) / days_b) >= minimum
        # Square-root scale tempers large hubs; score is a ranking aid, not a statistical test.
        score = abs(delta) * math.sqrt(min(max(a / days_a, b / days_b), 500) / 100) * (1.25 if reversal else 1)
        results.append(dict(origin=origin, destination=dest, baselineTrips=a, currentTrips=b,
                            baselineOriginTotal=ta, currentOriginTotal=tb, baselineDaily=a / days_a,
                            currentDaily=b / days_b, deltaSharePp=delta, growth=(b / days_b / (a / days_a) - 1) if a else None,
                            reverseBaseline=reverse_a, reverseCurrent=reverse_b,
                            directionBaseline=idx_a, directionCurrent=idx_b, reversal=reversal, score=score))
    return sorted(results, key=lambda r: (-r['score'], r['origin'], r['destination']))


def hourly_profile(month, origin, dest, weekend):
    """Average daily trips per entry hour, both directions; None marks an hour the month did not record."""
    with open_month(month) as db:
        info = metadata(db)
        rows = db.execute('SELECT hour,origin,SUM(trips)::bigint FROM flows WHERE weekend = %s AND ((origin = %s AND destination = %s) OR (origin = %s AND destination = %s)) GROUP BY hour,origin',
                          (int(weekend), origin, dest, dest, origin)).fetchall()
    candidate = {d for d in info['dates'] if (date.fromisoformat(d).weekday() >= 5) == bool(weekend)}
    def days(h):
        if 'hourDates' in info:
            return len(set(info['hourDates'].get(str(h), [])) & candidate)
        return len(candidate) if h in info['hours'] else 0
    trips = {(h, o): n for h, o, n in rows}
    out = {'forward': [], 'reverse': []}
    for h in range(24):
        n = days(h)
        out['forward'].append(round(trips.get((h, origin), 0) / n, 1) if n else None)
        out['reverse'].append(round(trips.get((h, dest), 0) / n, 1) if n else None)
    return out


def get_pair(baseline, current, origin, destination, weekend=False):
    return dict(
        origin=origin,
        destination=destination,
        weekend=weekend,
        baseline=hourly_profile(baseline, origin, destination, weekend),
        current=hourly_profile(current, origin, destination, weekend),
    )


def get_radar(baseline, current, start=7, end=10, weekend=False, minimum=20, change_type='all', limit=10, direct=None):
    if not 0 <= start < end <= 24 or minimum < 0 or not 1 <= limit <= 500 or change_type not in CHANGE_TYPES:
        raise UncomparableError('Invalid hours or minimum')
    try:
        a, da, fa = read_month(baseline, start, end, weekend)
        b, db, fb = read_month(current, start, end, weekend)
    except _BaseHoursMismatch:
        raise HoursMismatch(hours_mismatch(baseline, current, start, end, weekend))
    common = comparable_stations(a, b)
    if direct:
        pair = tuple('大橋頭站' if name == '大橋頭' and '大橋頭' not in common else name for name in direct)
        if pair[0] == pair[1] or not all(name in common for name in pair):
            raise UncomparableError('The selected stations cannot be compared in both months')
        results = compare(fa, fb, da, db, common, minimum, only=pair)
    else:
        results = [r for r in compare(fa, fb, da, db, common, minimum) if CHANGE_TYPES[change_type](r)]
    all_stations = set(a['stations']) | set(b['stations'])
    excluded = []
    for station in sorted(all_stations - common):
        if station in AMBIGUOUS_INTERCHANGES | LINE_SCOPED_INTERCHANGES:
            reason = 'interchange_scope_unverified'
        elif station not in a['stations']:
            reason = 'absent_in_baseline'
        elif station not in b['stations']:
            reason = 'absent_in_current'
        else:
            reason = 'not_present_in_both_station_roles'
        excluded.append({'station': station, 'reason': reason})
    return dict(
        baseline=baseline, current=current, days=[da, db], hours=[start, end],
        weekend=weekend, minimum=minimum, type=change_type, commonStations=len(common),
        excluded=excluded, total=len(results), results=results[:limit],
    )


def main(argv=None):
    parser = argparse.ArgumentParser(prog='analyze_od.py')
    parser.add_argument('baseline')
    parser.add_argument('current')
    parser.add_argument('--start', type=int, default=7)
    parser.add_argument('--end', type=int, default=10)
    parser.add_argument('--weekend', action='store_true')
    parser.add_argument('--minimum', type=float, default=20)
    parser.add_argument('--type', choices=CHANGE_TYPES, default='all')
    parser.add_argument('--limit', type=int, default=10)
    parser.add_argument('--pair', nargs=2, metavar=('ORIGIN', 'DESTINATION'))
    parser.add_argument('--direct', nargs=2, metavar=('ORIGIN', 'DESTINATION'))
    args = parser.parse_args(argv)
    if args.pair:
        print(json.dumps(get_pair(args.baseline, args.current, args.pair[0], args.pair[1], args.weekend), ensure_ascii=False))
        return
    if not 0 <= args.start < args.end <= 24 or args.minimum < 0 or not 1 <= args.limit <= 500:
        parser.error('Invalid hours or minimum')
    try:
        out = get_radar(args.baseline, args.current, args.start, args.end, args.weekend, args.minimum, args.type, args.limit, args.direct)
    except HoursMismatch as error:
        print(json.dumps(error.payload, ensure_ascii=False))
        sys.exit(5)
    except UncomparableError as error:
        print(error, file=sys.stderr)
        sys.exit(2)
    print(json.dumps(out, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except MonthNotFound as error:
        print(error, file=sys.stderr)
        sys.exit(3)
    except ValueError as error:
        print(error, file=sys.stderr)
        sys.exit(2)
