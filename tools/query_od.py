"""針對已匯入的 OD 月份執行車站與全網維度查詢。

期間可為單一月份（YYYY-MM，依所選日別與進站時段計算日均）或單一日期（YYYY-MM-DD，直接讀取 `trips` 原始表）。

  station NAME --period P [--compare P] [--days weekday|workday|weekend|all] [--start H --end H] [--limit N]
  network --period P [--compare P] [--days ...] [--start --end]
  trend [NAME] [--days ...]          所有已匯入月份的月度日均趨勢
  calendar MONTH [NAME]              單一月份內每日進出站統計

含路線前綴的轉乘站名（BL板橋、Y板橋、G大坪林、O景安、O頭前庄）與大橋頭站會合併為地圖主站名，確保跨月查詢時仍視為同一車站。
"""
import argparse
import json
import re
import sys
from collections import OrderedDict, defaultdict
from datetime import date
from types import SimpleNamespace

from od_postgres import MonthNotFound, UncomparableError, UnrecordedHours, metadata, open_month, open_reference, table_exists

PREFIX = re.compile(r'^(BL|BR|G|R|O|Y)(?=[^\x00-\x7f])')
ALIASES = {'大橋頭站': '大橋頭'}


def canonical(name):
    return ALIASES.get(name, PREFIX.sub('', name))


def _covered_stations(info, dates, side):
    scopes = [{canonical(name) for name in scope[side]}
              for scope in info.get('coverageScopes', ()) if dates.intersection(scope['dates'])]
    if scopes:
        return set.intersection(*scopes)
    return {canonical(name) for name in info.get(side, ())}


WORKDAY_SQL = '((weekend=0 AND off=0) OR (weekend=1 AND off=0 AND note IS NOT NULL))'
WORKDAY_CACHE_LIMIT = 24
_workday_cache = OrderedDict()


def _workdays(month):
    with open_reference() as ref:
        return {d for (d,) in ref.execute(f'SELECT date FROM day WHERE month=%s AND present=1 AND {WORKDAY_SQL}', (month,))}


def day_type(d, days):
    return days == 'all' or (date.fromisoformat(d).weekday() >= 5) == (days == 'weekend')


def _month_flows(db, start, end, weekend):
    band = f'{start}-{end}'
    if table_exists(db, 'band_flows') and db.execute('SELECT 1 FROM band_flows WHERE band=%s LIMIT 1', (band,)).fetchone():
        return db.execute(
            'SELECT origin,destination,SUM(trips)::bigint FROM band_flows '
            'WHERE band=%s AND weekend=ANY(%s) GROUP BY origin,destination ORDER BY origin,destination',
            (band, list(weekend)),
        ).fetchall()
    return db.execute(
        'SELECT origin,destination,SUM(trips)::bigint FROM flows '
        'WHERE hour>=%s AND hour<%s AND weekend=ANY(%s) GROUP BY origin,destination ORDER BY origin,destination',
        (start, end, list(weekend)),
    ).fetchall()


def _month_hours(db, weekend):
    flags = (list(weekend),)
    if table_exists(db, 'station_hour_flow'):
        return db.execute(
            'SELECT hour,station,SUM(entries)::bigint,SUM(exits)::bigint FROM station_hour_flow '
            'WHERE weekend=ANY(%s) GROUP BY hour,station', flags,
        ).fetchall()
    return db.execute(
        'SELECT hour,station,SUM(entries)::bigint,SUM(exits)::bigint FROM ('
        'SELECT hour,origin AS station,trips AS entries,0 AS exits FROM flows WHERE weekend=ANY(%s) '
        'UNION ALL SELECT hour,destination,0,trips FROM flows WHERE weekend=ANY(%s)'
        ') AS sides GROUP BY hour,station', flags * 2,
    ).fetchall()


def _selected_days(db, dates, start, end):
    dates = sorted(dates)
    if (start, end) == (0, 24) and table_exists(db, 'day_flows'):
        rows = db.execute(
            'SELECT origin,destination,SUM(trips)::bigint FROM day_flows '
            'WHERE date=ANY(%s) GROUP BY origin,destination ORDER BY origin,destination', (dates,),
        ).fetchall()
    else:
        rows = db.execute(
            'SELECT a.name,b.name,SUM(t.trips)::bigint FROM trips t '
            'JOIN stations a ON a.id=t.origin JOIN stations b ON b.id=t.destination '
            'WHERE t.day=ANY(%s) AND t.hour>=%s AND t.hour<%s '
            'GROUP BY t.origin,t.destination,a.name,b.name ORDER BY t.origin,t.destination',
            ([int(d[8:]) for d in dates], start, end),
        ).fetchall()
    hourly = db.execute(
        'SELECT hour,station,SUM(entries)::bigint,SUM(exits)::bigint FROM station_hours '
        'WHERE date=ANY(%s) GROUP BY hour,station', (dates,),
    ).fetchall()
    return rows, hourly


def _workday_totals(db, dates, workdays, start, end):
    weekdays = {day for day in dates if day_type(day, 'weekday')}
    removed, added = weekdays - workdays, workdays - weekdays
    if len(removed) + len(added) >= len(workdays):
        return _selected_days(db, workdays, start, end)
    rows, hourly = _month_flows(db, start, end, (0,)), _month_hours(db, (0,))
    totals = {(origin, destination): trips for origin, destination, trips in rows}
    hours = {(hour, station): (entries, exits) for hour, station, entries, exits in hourly}
    for sign, changed_dates in ((-1, removed), (1, added)):
        if not changed_dates:
            continue
        changed_flows, changed_hours = _selected_days(db, changed_dates, start, end)
        for origin, destination, trips in changed_flows:
            key = (origin, destination)
            totals[key] = totals.get(key, 0) + sign * trips
        for hour, station, entries, exits in changed_hours:
            key = (hour, station)
            before_in, before_out = hours.get(key, (0, 0))
            hours[key] = (before_in + sign * entries, before_out + sign * exits)
    # Match the direct scan's order so monthly averages round the same at a half-unit.
    order_by = 'name' if (start, end) == (0, 24) and table_exists(db, 'day_flows') else 'id'
    order = {name: i for i, (name,) in enumerate(db.execute(f'SELECT name FROM stations ORDER BY {order_by}'))}
    ordered = sorted(totals.items(), key=lambda item: (order[item[0][0]], order[item[0][1]]))
    return ([(o, d, n) for (o, d), n in ordered if n],
            [(h, s, e, x) for (h, s), (e, x) in hours.items() if e or x])


def _load_workday_totals(db, info, workdays, start, end):
    # Workday totals are reused by station, network and leaders in the same worker.
    revision = info.get('sha256')
    if not revision:
        return _workday_totals(db, info['dates'], workdays, start, end)
    key = (info['month'], revision, info.get('supplementalSha256'), frozenset(workdays), start, end)
    if key in _workday_cache:
        _workday_cache.move_to_end(key)
        return _workday_cache[key]
    result = _workday_totals(db, info['dates'], workdays, start, end)
    _workday_cache[key] = result
    if len(_workday_cache) > WORKDAY_CACHE_LIMIT:
        _workday_cache.popitem(last=False)
    return result


class Period:
    """Loads one period's flows as canonical (origin, destination) -> average daily trips."""

    def __init__(self, spec, days, start, end, *, daily_totals_only=False):
        self.spec, self.is_date = spec, len(spec) == 10
        self.daily_totals_only = self.is_date and daily_totals_only
        self.month = spec[:7]
        with open_month(self.month) as db:
            self.metadata = metadata(db)
            self.stations = {canonical(s) for s in self.metadata['stations']}
            if self.is_date:
                if spec not in self.metadata['dates']:
                    raise ValueError(f'{spec}: date not in this month')
                self.days, self.hours = 1, (start, end)
                recorded_dates = {spec}
                coverage = self.metadata.get('hourDates', {})
                covered = lambda h: spec in coverage[str(h)] if str(h) in coverage else h in self.metadata['hours']
                if not any(covered(h) for h in range(start, end)):
                    raise UnrecordedHours(f'{spec}: no recorded hours in {start}-{end}')
                if self.daily_totals_only:
                    rows = ()
                elif (start, end) == (0, 24):
                    rows = db.execute('SELECT origin,destination,trips FROM day_flows WHERE date=%s ORDER BY origin,destination', (spec,)).fetchall()
                else:
                    rows = db.execute('SELECT a.name,b.name,SUM(t.trips)::bigint FROM trips t JOIN stations a ON a.id=t.origin JOIN stations b ON b.id=t.destination '
                                      'WHERE t.day=%s AND t.hour>=%s AND t.hour<%s GROUP BY t.origin,t.destination,a.name,b.name ORDER BY t.origin,t.destination', (int(spec[8:]), start, end)).fetchall()
                hourly = db.execute('SELECT hour,station,entries,exits FROM station_hours WHERE date=%s', (spec,)).fetchall()
                self.stations = {canonical(s) for _, s, _, _ in hourly}
                self.hour_days = [1 if covered(h) else 0 for h in range(24)]
            else:
                self.hours = (start, end)
                workdays = _workdays(self.month) if days == 'workday' else None
                candidate = {d for d in self.metadata['dates'] if (d in workdays if workdays is not None else day_type(d, days))}
                coverage = self.metadata.get('hourDates', {})
                observed = [set(coverage[str(h)]) & candidate if str(h) in coverage
                            else candidate if h in self.metadata['hours'] else set() for h in range(24)]
                self.hour_days = [len(dates) for dates in observed]
                selected = observed[start:end]
                if not any(selected):
                    raise UnrecordedHours(f'{spec}: no recorded hours in {start}-{end}')
                recorded_dates = set.union(*selected)
                if (start, end) == (0, 24):
                    # A daily total includes every recorded slot on that date, including holiday service.
                    self.days = len(recorded_dates)
                elif any(dates != selected[0] for dates in selected):
                    raise ValueError(f'{spec}: selected hours do not cover the same dates')
                else:
                    self.days = len(selected[0])
                if days == 'workday':
                    rows, hourly = _load_workday_totals(db, self.metadata, candidate, start, end)
                else:
                    weekend = {'weekday': (0,), 'weekend': (1,), 'all': (0, 1)}[days]
                    rows, hourly = _month_flows(db, start, end, weekend), _month_hours(db, weekend)
        self.origins = _covered_stations(self.metadata, recorded_dates, 'origins')
        self.destinations = _covered_stations(self.metadata, recorded_dates, 'destinations')
        self.flows = defaultdict(float)
        for o, d, n in rows:
            self.flows[(canonical(o), canonical(d))] += n / self.days
        self.entries_by_hour, self.exits_by_hour = defaultdict(lambda: [0] * 24), defaultdict(lambda: [0] * 24)
        for h, s, entries, exits in hourly:
            self.entries_by_hour[canonical(s)][h] += entries
            self.exits_by_hour[canonical(s)][h] += exits

    def label(self):
        start, end = self.hours
        return {'spec': self.spec, 'kind': 'date' if self.is_date else 'month', 'days': self.days,
                'hours': [start, end], 'recordedHours': [hour for hour in range(start, end) if self.hour_days[hour]]}

    def hourly(self, station, which):
        series = (self.entries_by_hour if which == 'entries' else self.exits_by_hour).get(station)
        if station not in self.stations:
            return [None] * 24
        return [round((series[h] if series else 0) / self.hour_days[h], 1) if self.hour_days[h] else None for h in range(24)]

    def totals(self):
        if self.daily_totals_only:
            start, end = self.hours

            def band_totals(by_hour):
                return {station: float(total) for station, counts in by_hour.items()
                        if (total := sum(counts[start:end]))}

            # station_hours is built from the same OD rows, grouped by entry hour for both sides.
            return band_totals(self.entries_by_hour), band_totals(self.exits_by_hour)
        entries, exits = defaultdict(float), defaultdict(float)
        for (o, d), n in self.flows.items():
            entries[o] += n
            exits[d] += n
        return entries, exits


def rounded(v, digits=1):
    return None if v is None else round(v, digits)


def relations(a, b, station, outbound, limit):
    """Counterpart stations ranked by daily trips; a station missing from a period is None, a quiet one is 0."""
    def side(p):
        if p is None:
            return {}
        out = defaultdict(float)
        for (o, d), n in p.flows.items():
            if outbound and o == station and d != station:
                out[d] += n
            elif not outbound and d == station and o != station:
                out[o] += n
        return out
    sa, sb = side(a), side(b)
    total_a, total_b = sum(sa.values()), sum(sb.values())
    names = sorted(sa.keys() | sb.keys(), key=lambda s: (-max(sa.get(s, 0), sb.get(s, 0)), s))
    rows = []
    a_ok = station in a.stations
    b_ok = b is not None and station in b.stations
    for s in names[:limit]:
        row = {'station': s, 'daily': rounded(sa.get(s, 0) if a_ok and s in a.stations else None),
               'share': rounded(sa.get(s, 0) / total_a * 100, 2) if total_a and a_ok and s in a.stations else None}
        if b is not None:
            row['compareDaily'] = rounded(sb.get(s, 0) if b_ok and s in b.stations else None)
            row['compareShare'] = rounded(sb.get(s, 0) / total_b * 100, 2) if total_b and b_ok and s in b.stations else None
        rows.append(row)
    return rows, len(names)


def _period_events(spec, days):
    with open_reference() as db:
        if len(spec) == 10:
            rows = db.execute('SELECT date,weekend,off,note FROM day WHERE date=%s AND present=1', (spec,)).fetchall()
        elif days == 'workday':
            rows = db.execute(
                f'SELECT date,weekend,off,note FROM day WHERE month=%s AND present=1 AND {WORKDAY_SQL} ORDER BY date',
                (spec,),
            ).fetchall()
        else:
            flag = {'weekday': (0,), 'weekend': (1,), 'all': (0, 1)}[days]
            marks = ','.join('%s' for _ in flag)
            rows = db.execute(
                f'SELECT date,weekend,off,note FROM day WHERE month=%s AND present=1 AND weekend IN ({marks}) ORDER BY date',
                (spec, *flag),
            ).fetchall()
    off_days = [{'date': d, 'note': note or '國定假日'} for d, w, off, note in rows if off]
    makeup_days = [{'date': d, 'note': note or '補行上班'} for d, w, off, note in rows if w and not off and note]
    return {'offDays': off_days, 'makeupDays': makeup_days}


def station_query(args):
    a = Period(args.period, args.days, args.start, args.end)
    b = Period(args.compare, args.days, args.start, args.end) if args.compare else None
    station = canonical(args.name)
    if station not in a.stations and (b is None or station not in b.stations):
        raise ValueError(f'{station}: not in the selected periods')
    ea, xa = a.totals()
    out = {'station': station, 'period': a.label(), 'compare': b.label() if b else None,
           'present': station in a.stations,
           'exitCovered': station in a.destinations,
           'entries': rounded(ea.get(station, 0) if station in a.stations else None),
           'exits': rounded(xa.get(station, 0) if station in a.stations else None),
           'events': _period_events(args.period, args.days),
           'hourly': {'entries': a.hourly(station, 'entries'), 'exits': a.hourly(station, 'exits')}}
    out['outbound'], out['outboundTotal'] = relations(a, b, station, True, args.limit)
    out['inbound'], out['inboundTotal'] = relations(a, b, station, False, args.limit)
    if b:
        eb, xb = b.totals()
        out['comparePresent'] = station in b.stations
        out['compareExitCovered'] = station in b.destinations
        out['compareEntries'] = rounded(eb.get(station, 0) if station in b.stations else None)
        out['compareExits'] = rounded(xb.get(station, 0) if station in b.stations else None)
        out['hourly']['compareEntries'] = b.hourly(station, 'entries')
        out['hourly']['compareExits'] = b.hourly(station, 'exits')
    return out


def network_query(args):
    a = Period(args.period, args.days, args.start, args.end, daily_totals_only=True)
    b = Period(args.compare, args.days, args.start, args.end, daily_totals_only=True) if args.compare else None
    ea, xa = a.totals()
    eb, xb = b.totals() if b else ({}, {})
    rows = []
    for s in sorted(a.stations | (b.stations if b else set())):
        row = {'station': s, 'entries': rounded(ea.get(s, 0) if s in a.stations else None),
               'exits': rounded(xa.get(s, 0) if s in a.stations else None), 'exitCovered': s in a.destinations}
        if b:
            row['compareExitCovered'] = s in b.destinations
            row['compareEntries'] = rounded(eb.get(s, 0) if s in b.stations else None)
            row['compareExits'] = rounded(xb.get(s, 0) if s in b.stations else None)
        rows.append(row)
    rows.sort(key=lambda r: (r['entries'] is None, -(r['entries'] or 0), r['station']))
    out = {'period': a.label(), 'compare': b.label() if b else None, 'total': rounded(sum(ea.values())),
           'compareTotal': rounded(sum(eb.values())) if b else None,
           'exitCovered': a.stations <= a.destinations,
           'events': _period_events(args.period, args.days),
           'stations': rows}
    if b:
        out['compareExitCovered'] = b.stations <= b.destinations
    if args.hourly:
        grouped = zip(*a.entries_by_hour.values()) if a.entries_by_hour else ([0] for _ in range(24))
        out['hourly'] = [round(sum(values) / days, 1) if days else None
                         for values, days in zip(grouped, a.hour_days)]
    return out


def trend_query(args):
    """Average daily entries and exits per month, from the cross-month series."""
    station = canonical(args.name) if args.name else None
    if args.days == 'workday':
        cond, cond_params = WORKDAY_SQL, ()
        d_cond = '((d.weekend=0 AND d.off=0) OR (d.weekend=1 AND d.off=0 AND d.note IS NOT NULL))'
    else:
        flag = {'weekday': (0,), 'weekend': (1,), 'all': (0, 1)}[args.days]
        marks = ','.join('%s' for _ in flag)
        cond, cond_params = f'weekend IN ({marks})', flag
        d_cond = f'd.weekend IN ({marks})'
    with open_reference() as db:
        sid = None
        if station:
            row = db.execute('SELECT id FROM station WHERE name=%s', (station,)).fetchone()
            sid = row[0] if row else -1
        days = dict(db.execute(f'SELECT month,COUNT(*) FROM day WHERE present=1 AND {cond} GROUP BY month', cond_params))
        where = ' AND sd.station_id=%s' if sid else ''
        sums = {m: (e, x) for m, e, x in db.execute(
            f'SELECT d.month,SUM(sd.entries)::bigint,SUM(sd.exits)::bigint FROM station_day sd JOIN day d ON d.date=sd.date WHERE {d_cond}{where} GROUP BY d.month',
            (*cond_params, *([sid] if sid else [])))}
        in_month = {m for (m,) in db.execute('SELECT month FROM station_month WHERE station_id=%s', (sid,))} if sid else None
        months = [m for (m,) in db.execute('SELECT DISTINCT month FROM day WHERE present=1 ORDER BY month')]
    rows = []
    for m in months:
        n = days.get(m, 0)
        row = {'month': m, 'days': n, 'entries': None, 'exits': None}
        if n and (in_month is None or m in in_month):
            e, x = sums.get(m, (0, 0))
            row['entries'], row['exits'] = rounded(e / n), rounded(x / n)
        rows.append(row)
    return {'station': station, 'days': args.days, 'months': rows}


def calendar_query(args):
    with open_reference() as db:
        days = db.execute('SELECT date,weekend,off,note FROM day WHERE month=%s AND present=1 ORDER BY date', (args.month,)).fetchall()
        if not days:
            raise MonthNotFound(f'{args.month}: not imported')
        station = canonical(args.name) if args.name else None
        sid = None
        if station:
            row = db.execute('SELECT s.id FROM station s JOIN station_month m ON m.station_id=s.id WHERE s.name=%s AND m.month=%s', (station, args.month)).fetchone()
            if not row:
                raise ValueError(f'{station}: not in {args.month}')
            sid = row[0]
        where, params = (' AND station_id=%s', [sid]) if sid else ('', [])
        rows = {d: (e, x) for d, e, x in db.execute(f"SELECT date,SUM(entries)::bigint,SUM(exits)::bigint FROM station_day WHERE date LIKE %s{where} GROUP BY date", (args.month + '-%', *params))}
    return {'month': args.month, 'station': station, 'dates': [
        {'date': d, 'weekend': bool(w), 'holiday': bool(off), 'note': note,
         'entries': rows[d][0] if d in rows else None, 'exits': rows[d][1] if d in rows else None}
        for d, w, off, note in days]}


def relation_hour_series(recorded_hours, rows):
    totals = {hour: (forward or 0, reverse or 0) for hour, forward, reverse in rows}
    by_hour = []
    for hour in range(24):
        recorded = hour in recorded_hours
        forward, reverse = totals.get(hour, (0, 0))
        by_hour.append({
            'hour': hour,
            'forward': forward if recorded else None,
            'reverse': reverse if recorded else None,
            'recorded': recorded,
        })
    return by_hour


def relation_hours_query(args):
    """Raw hourly trips between two stations for one imported date, preserving coverage gaps."""
    day = date.fromisoformat(args.date).isoformat()
    if day != args.date:
        raise ValueError(f'{args.date}: invalid date')
    month = day[:7]
    origin, destination = canonical(args.origin), canonical(args.destination)
    if not origin or not destination or origin == destination:
        raise ValueError('Choose two different stations')

    with open_month(month) as db:
        info = metadata(db)
        if day not in info['dates']:
            raise ValueError(f'{day}: date not in this month')
        coverage = info.get('hourDates', {})
        recorded = {
            hour for hour in range(24)
            if (day in coverage[str(hour)] if str(hour) in coverage else hour in info['hours'])
        }
        stations = db.execute('SELECT id,name FROM stations').fetchall()
        ids_by_name = defaultdict(list)
        for station_id, name in stations:
            ids_by_name[canonical(name)].append(station_id)
        origin_ids, destination_ids = ids_by_name.get(origin, []), ids_by_name.get(destination, [])
        present = {canonical(name) for (name,) in db.execute(
            'SELECT DISTINCT station FROM station_hours WHERE date=%s', (day,)
        ).fetchall()}
        if not origin_ids or not destination_ids or origin not in present or destination not in present:
            raise ValueError('A selected station is not present on this date')
        rows = db.execute(
            'SELECT hour, '
            'SUM(trips) FILTER (WHERE origin=ANY(%s) AND destination=ANY(%s)), '
            'SUM(trips) FILTER (WHERE origin=ANY(%s) AND destination=ANY(%s)) '
            'FROM trips WHERE day=%s AND '
            '((origin=ANY(%s) AND destination=ANY(%s)) OR (origin=ANY(%s) AND destination=ANY(%s))) '
            'GROUP BY hour',
            (origin_ids, destination_ids, destination_ids, origin_ids, int(day[8:]),
             origin_ids, destination_ids, destination_ids, origin_ids),
        ).fetchall()

    return {
        'date': day,
        'origin': origin,
        'destination': destination,
        'recordedHours': sorted(recorded),
        'byHour': relation_hour_series(recorded, rows),
    }


def matrix_query(args):
    a = Period(args.period, args.days, args.start, args.end)
    ea, xa = a.totals()
    top = sorted(a.stations, key=lambda s: (-(ea.get(s, 0) + xa.get(s, 0)), s))[:args.limit]
    # Keep a single trip in a whole month distinguishable from zero.
    cells = [[rounded(a.flows.get((o, d), 0.0), 3) for d in top] for o in top]
    return {'period': a.label(), 'stations': top, 'cells': cells,
            'missingOrigins': [station for station in top if station not in a.origins],
            'missingDestinations': [station for station in top if station not in a.destinations]}


def group_flow_query(args):
    origins = sorted({canonical(name) for name in args.origin})
    destinations = sorted({canonical(name) for name in args.destination})

    def read(spec):
        period = Period(spec, args.days, args.start, args.end)
        missing_origins = [name for name in origins if name not in period.origins]
        missing_destinations = [name for name in destinations if name not in period.destinations]
        daily = None if missing_origins or missing_destinations else rounded(
            sum(period.flows.get((origin, destination), 0.0) for origin in origins for destination in destinations), 3)
        return {'period': period.label(), 'daily': daily,
                'missingOrigins': missing_origins, 'missingDestinations': missing_destinations}

    return {'origins': origins, 'destinations': destinations, 'current': read(args.period),
            'compare': read(args.compare) if args.compare else None}


def get_station(name, period, compare=None, days='weekday', start=0, end=24, limit=40):
    if not 0 <= start < end <= 24:
        raise UncomparableError('invalid hours')
    if not 1 <= limit <= 200:
        raise UncomparableError('invalid limit')
    return station_query(SimpleNamespace(name=name, period=period, compare=compare, days=days, start=start, end=end, limit=limit))


def get_network(period, compare=None, days='weekday', start=0, end=24, hourly=False):
    if not 0 <= start < end <= 24:
        raise UncomparableError('invalid hours')
    return network_query(SimpleNamespace(period=period, compare=compare, days=days, start=start, end=end, hourly=hourly))


def get_matrix(period, days='weekday', start=0, end=24, limit=12):
    if not 0 <= start < end <= 24:
        raise UncomparableError('invalid hours')
    if not 1 <= limit <= 200:
        raise UncomparableError('invalid limit')
    return matrix_query(SimpleNamespace(period=period, days=days, start=start, end=end, limit=limit))


def get_trend(name=None, days='weekday'):
    return trend_query(SimpleNamespace(name=name, days=days))


def get_calendar(month, name=None):
    return calendar_query(SimpleNamespace(month=month, name=name))


def get_relation_hours(origin, destination, date_spec):
    return relation_hours_query(SimpleNamespace(origin=origin, destination=destination, date=date_spec))


def main(argv=None):
    parser = argparse.ArgumentParser(prog='query_od.py')
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ('station', 'network', 'matrix', 'group-flow'):
        p = sub.add_parser(name)
        if name == 'station':
            p.add_argument('name')
            p.add_argument('--limit', type=int, default=40)
        elif name == 'matrix':
            p.add_argument('--limit', type=int, default=12)
        elif name == 'group-flow':
            p.add_argument('--origin', action='append', required=True)
            p.add_argument('--destination', action='append', required=True)
        else:
            p.add_argument('--hourly', action='store_true')
        p.add_argument('--period', required=True)
        if name != 'matrix':
            p.add_argument('--compare')
        p.add_argument('--days', choices=('weekday', 'workday', 'weekend', 'all'), default='weekday')
        p.add_argument('--start', type=int, default=0)
        p.add_argument('--end', type=int, default=24)
    p = sub.add_parser('trend')
    p.add_argument('name', nargs='?')
    p.add_argument('--days', choices=('weekday', 'workday', 'weekend', 'all'), default='weekday')
    p = sub.add_parser('calendar')
    p.add_argument('month')
    p.add_argument('name', nargs='?')
    p = sub.add_parser('relation-hours')
    p.add_argument('origin')
    p.add_argument('destination')
    p.add_argument('date')
    args = parser.parse_args(argv)
    if hasattr(args, 'start') and not 0 <= args.start < args.end <= 24:
        parser.error('invalid hours')
    if hasattr(args, 'limit') and not 1 <= args.limit <= 200:
        parser.error('invalid limit')
    try:
        result = {'station': station_query, 'network': network_query, 'matrix': matrix_query, 'group-flow': group_flow_query, 'trend': trend_query,
                  'calendar': calendar_query, 'relation-hours': relation_hours_query}[args.command](args)
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
