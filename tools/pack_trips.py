"""Pack existing PostgreSQL trips by hour and origin. Stage, publish, validate, then finalize."""
import argparse
import json
from concurrent.futures import ThreadPoolExecutor

from psycopg import sql

from od_postgres import (
    MONTH_TABLES, create_table, create_trip_view, database, finish_table, month_schema, months,
    search_schema, table_exists,
)


GROUPED_TRIPS = (
    'SELECT day, hour, origin, array_agg(destination ORDER BY destination) AS destinations, '
    'array_agg(trips ORDER BY destination) AS counts FROM {table} GROUP BY day, hour, origin'
)


def use_month(db, month):
    schema = month_schema(month)
    db.execute('SELECT pg_advisory_xact_lock(hashtext(%s))', (schema,))
    search_schema(db, schema)


def source_signature(db, table):
    return json.dumps(db.execute(
        'SELECT to_regclass(%s)::oid, '
        '(SELECT md5(jsonb_object_agg(key, value)::text) FROM metadata), '
        '(SELECT md5(jsonb_object_agg(id, name)::text) FROM stations)',
        (table,),
    ).fetchone())


def stage(db, month):
    if table_exists(db, 'trip_groups'):
        kind = db.execute("SELECT relkind FROM pg_class WHERE oid = to_regclass('trips')").fetchone()
        if kind == ('v',):
            return f'{month}: already published'
        require_staged(db, 'trips')
        return f'{month}: already staged and source signature matches'
    signature = source_signature(db, 'trips')
    definition = MONTH_TABLES['trip_groups']
    create_table(db, 'trip_groups', definition)
    db.execute('INSERT INTO trip_groups ' + GROUPED_TRIPS.format(table='trips'))
    finish_table(db, 'trip_groups', definition)
    mismatch, groups, rows = db.execute(
        'SELECT count(*) FILTER (WHERE (s.destinations, s.counts) IS DISTINCT FROM (p.destinations, p.counts)), '
        'count(*), COALESCE(sum(cardinality(s.counts)), 0) FROM ('
        + GROUPED_TRIPS.format(table='trips')
        + ') s FULL JOIN trip_groups p USING (day, hour, origin)'
    ).fetchone()
    if mismatch or source_signature(db, 'trips') != signature:
        raise ValueError(f'{month}: {mismatch} mismatched groups or changed source signature')
    db.execute(sql.SQL('COMMENT ON TABLE trip_groups IS {}').format(sql.Literal(signature)))
    return f'{month}: exact match for {rows:,} rows in {groups:,} groups'


def require_staged(db, source):
    signature = db.execute("SELECT obj_description(to_regclass('trip_groups'), 'pg_class')").fetchone()[0]
    if signature is None or not table_exists(db, source) or signature != source_signature(db, source):
        raise ValueError(f'{source}: staged table missing or source signature changed')


def publish(db):
    require_staged(db, 'trips')
    db.execute('ALTER TABLE trips RENAME TO trips_unpacked')
    create_trip_view(db)


def finalize(db):
    require_staged(db, 'trips_unpacked')
    db.execute('DROP TABLE trips_unpacked')
    db.execute('COMMENT ON TABLE trip_groups IS NULL')


def revert(db):
    require_staged(db, 'trips_unpacked')
    db.execute('DROP VIEW trips')
    db.execute('ALTER TABLE trips_unpacked RENAME TO trips')


def stage_month(month):
    with database() as db:
        use_month(db, month)
        result = stage(db, month)
    print(result, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=('stage', 'publish', 'finalize', 'revert'))
    parser.add_argument('months', nargs='*')
    parser.add_argument('--jobs', type=int, default=1, help='parallel months during staging')
    args = parser.parse_args()
    if args.jobs < 1:
        parser.error('--jobs must be positive')
    with database() as db:
        registered = months(db)
    selected = sorted(set(args.months or registered))
    if not selected or set(selected) - set(registered):
        parser.error('all selected months must be present in the catalog')

    if args.phase == 'stage':
        with ThreadPoolExecutor(max_workers=args.jobs) as workers:
            list(workers.map(stage_month, selected))
        return

    operation = {'publish': publish, 'finalize': finalize, 'revert': revert}[args.phase]
    with database() as db:
        db.execute("SET LOCAL lock_timeout = '5s'")
        for month in selected:
            use_month(db, month)
            operation(db)
    print(f'{args.phase}: committed for {len(selected)} months', flush=True)


if __name__ == '__main__':
    main()
