"""Rebuild PostgreSQL's cross-month reference from the published monthly snapshots.

station        id, name, lines, lon, lat, first_month, last_month     one row per physical station, stable id
station_alias  raw, station_id                                         every spelling the open data used
station_month  station_id, month                                       which months a station appears in
day            date, month, weekend, off, note, present               calendar: weekday, government holiday, make-up workday
station_day    station_id, date, entries, exits                        one row per station and date, for trends and calendars

`weekend` is the day of the week. `off` marks a government holiday and `note` carries its name, or
"補行上班" on a make-up workday. Dates outside the open data (present = 0) stay so the calendar is complete.

Usage: python tools/build_ref.py
"""
import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

from od_postgres import (REFERENCE_SCHEMA, REF_TABLES, copy_rows, create_table, database, finish_table,
                         index_reference, metadata, month_schema, months, search_schema, write_schema)
from query_od import canonical

ROOT = Path(__file__).resolve().parents[1]
HOLIDAYS = ROOT / 'tools' / 'holidays'
STATIONS = ROOT / 'apps' / 'web' / 'public' / 'metro' / 'stations.geojson'

def calendar():
    """Every date of the covered years with its weekday, holiday flag and note."""
    days = {}
    for path in sorted(HOLIDAYS.glob('*.json')):
        for row in json.loads(path.read_text(encoding='utf-8')):
            d = date(int(row['date'][:4]), int(row['date'][4:6]), int(row['date'][6:]))
            note = row['description'] or None
            weekend = d.weekday() >= 5
            # The source marks every weekend as a holiday. Only a named day, or a weekday that is off, counts here.
            off = bool(row['isHoliday']) and (not weekend or note is not None)
            if weekend and not row['isHoliday']:
                note = note or '補行上班'
            days[d.isoformat()] = (weekend, off, note)
    return days


def main():
    geo = {f['properties']['name']: f for f in json.loads(STATIONS.read_text(encoding='utf-8'))['features']}
    names, aliases, presence, present_dates = {}, {}, defaultdict(set), set()
    unplaced = []
    with database() as db:
        db.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
        shards = months(db)
        for month in shards:
            search_schema(db, month_schema(month))
            meta = metadata(db)
            present_dates.update(meta['dates'])
            for raw in meta['stations']:
                name = canonical(raw)
                names.setdefault(name, len(names) + 1)
                aliases[raw] = name
                presence[name].add(month)
        write_schema(db, REFERENCE_SCHEMA)
        create_table(db, 'station', REF_TABLES['station'])
        stations, station_months = [], []
        for name, sid in names.items():
            f = geo.get(name) or geo.get(name + '站')
            available = sorted(presence[name])
            if f is None:
                unplaced.append(name)
            lon, lat = (f['geometry']['coordinates'] if f else (None, None))
            stations.append((sid, name, f['properties']['lines'] if f else None, lon, lat, available[0], available[-1]))
            station_months.extend((sid, m) for m in available)
        copy_rows(db, 'station', stations)
        finish_table(db, 'station', REF_TABLES['station'])
        for table in ('station_month', 'station_alias', 'day'):
            create_table(db, table, REF_TABLES[table])
        copy_rows(db, 'station_month', station_months)
        copy_rows(db, 'station_alias', ((raw, names[name]) for raw, name in aliases.items()))
        cal = calendar()
        for d in sorted(present_dates):
            cal.setdefault(d, (date.fromisoformat(d).weekday() >= 5, False, None))
        copy_rows(db, 'day', ((d, d[:7], int(w), int(o), n, int(d in present_dates)) for d, (w, o, n) in sorted(cal.items())))
        for table in ('station_month', 'station_alias', 'day'):
            finish_table(db, table, REF_TABLES[table])
        create_table(db, 'station_day', REF_TABLES['station_day'])
        for month in shards:
            search_schema(db, month_schema(month))
            sums = defaultdict(lambda: [0, 0])
            for d, station, entries, exits in db.execute('SELECT date,station,SUM(entries)::bigint,SUM(exits)::bigint FROM station_hours GROUP BY date,station'):
                s = sums[(names[canonical(station)], d)]
                s[0] += entries
                s[1] += exits
            search_schema(db, REFERENCE_SCHEMA)
            copy_rows(db, 'station_day', ((sid, d, e, x) for (sid, d), (e, x) in sums.items()))
        finish_table(db, 'station_day', REF_TABLES['station_day'])
        index_reference(db)
        counts = {t: db.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0] for t in ('station', 'station_alias', 'day', 'station_day')}
    print(counts)
    if unplaced:
        print('no coordinates for:', ', '.join(unplaced))


if __name__ == '__main__':
    sys.exit(main())
