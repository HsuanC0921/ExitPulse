"""Load nonzero daily rows and derive PostgreSQL totals by station and time band."""
import argparse
import json
from collections import defaultdict
from datetime import date

from import_od import month_rows, month_sources
from od_postgres import (
    MONTH_TABLES, copy_rows, create_table, create_trip_view, database, finish_table,
    metadata, month_schema, months, open_month,
)


BANDS = ((0, 24), (7, 10), (10, 16), (16, 19), (19, 24))


def add_fast_tables(db):
    for table in ('band_flows', 'station_hour_flow'):
        db.execute(f'DROP TABLE IF EXISTS {table}')
        create_table(db, table, MONTH_TABLES[table])
    for start, end in BANDS:
        db.execute('INSERT INTO band_flows SELECT weekend, %s, origin, destination, SUM(trips) '
                   'FROM flows WHERE hour >= %s AND hour < %s GROUP BY weekend, origin, destination',
                   (f'{start}-{end}', start, end))
    db.execute('INSERT INTO station_hour_flow SELECT weekend, hour, station, SUM(entries), SUM(exits) '
               'FROM (SELECT weekend, hour, origin AS station, trips AS entries, 0 AS exits FROM flows '
               'UNION ALL SELECT weekend, hour, destination, 0, trips FROM flows) AS sides '
               'GROUP BY weekend, hour, station')
    for table in ('band_flows', 'station_hour_flow'):
        finish_table(db, table, MONTH_TABLES[table])


def load_daily(db, month, sources, expected):
    year, mon = map(int, month.split('-'))
    flows, entries, exits = defaultdict(int), defaultdict(int), defaultdict(int)
    ids = {}
    total = rows = 0

    def grouped_rows():
        nonlocal total, rows
        last_slot = None
        by_origin = defaultdict(dict)

        def flush_slot():
            for origin, destinations in by_origin.items():
                ordered = sorted(destinations)
                yield *last_slot, origin, ordered, [destinations[d] for d in ordered]

        for source, spill_only in sources:
            for ds, hour, origin, destination, value in month_rows(source, year, mon, spill_only):
                n = int(value)
                if not n:
                    continue
                h = int(hour)
                total += n
                rows += 1
                flows[(ds, origin, destination)] += n
                entries[(ds, h, origin)] += n
                exits[(ds, h, destination)] += n
                o = ids.setdefault(origin, len(ids) + 1)
                d = ids.setdefault(destination, len(ids) + 1)
                slot = (int(ds[8:]), h)
                if slot != last_slot:
                    yield from flush_slot()
                    by_origin.clear()
                    last_slot = slot
                if d in by_origin[o]:
                    raise ValueError(f'{month}: duplicate {ds} {h} {origin} {destination}')
                by_origin[o][d] = n
        yield from flush_slot()

    # Existing months may still use a physical trips table until migration.
    row = db.execute("SELECT relkind FROM pg_class WHERE oid = to_regclass('trips')").fetchone()
    if row:
        db.execute('DROP VIEW trips' if row[0] == 'v' else 'DROP TABLE trips')
    tables = ('trip_groups', 'stations', 'day_flows', 'station_hours')
    for table in tables:
        db.execute(f'DROP TABLE IF EXISTS {table}')
        create_table(db, table, MONTH_TABLES[table])
    copy_rows(db, 'trip_groups', grouped_rows())
    if total != expected:
        raise ValueError(f'{month}: raw total {total} differs from imported total {expected}')
    copy_rows(db, 'stations', ((i, name) for name, i in ids.items()))
    copy_rows(db, 'day_flows', ((*k, n) for k, n in flows.items()))
    copy_rows(db, 'station_hours', ((*k, entries.get(k, 0), exits.get(k, 0)) for k in entries.keys() | exits.keys()))
    for table in tables:
        finish_table(db, table, MONTH_TABLES[table])
    create_trip_view(db)
    db.execute("INSERT INTO metadata VALUES ('daily', %s) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
               (json.dumps({'built': date.today().isoformat(), 'total': total, 'tripRows': rows}),))
    add_fast_tables(db)
    return rows, len(flows), total


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('months', nargs='*')
    parser.add_argument('--fast-only', action='store_true', help='rebuild derived tables without raw CSV')
    args = parser.parse_args()
    with database() as db:
        selected = args.months or months(db)
    for month in selected:
        with open_month(month) as db:
            db.execute('SELECT pg_advisory_xact_lock(hashtext(%s))', (month_schema(month),))
            if args.fast_only:
                add_fast_tables(db)
            else:
                load_daily(db, month, month_sources(month), metadata(db)['total'])
        print(f'{month}: rebuilt', flush=True)
    if not args.fast_only:
        from build_ref import main as build_reference
        build_reference()


if __name__ == '__main__':
    main()
