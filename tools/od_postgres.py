"""每月 OD 快照與跨月基準資料的 PostgreSQL 儲存層。"""
import json
import os
import sys
from queue import LifoQueue
from contextlib import contextmanager
from datetime import date

import psycopg
from psycopg import sql


MONTH_TABLES = {
    'metadata': ('key text, value text NOT NULL', 'key', ()),
    'flows': ('hour smallint, weekend smallint, origin text, destination text, trips bigint NOT NULL',
              'hour, weekend, origin, destination', ('trips',)),
    'trip_groups': ('day smallint, hour smallint, origin smallint, destinations smallint[] NOT NULL, '
                    'counts integer[] NOT NULL, CHECK (cardinality(destinations) = cardinality(counts) '
                    'AND cardinality(counts) > 0)', 'day, hour, origin', ()),
    'stations': ('id smallint, name text NOT NULL UNIQUE', 'id', ()),
    'day_flows': ('date text, origin text, destination text, trips bigint NOT NULL',
                  'date, origin, destination', ('trips',)),
    'station_hours': ('date text, hour smallint, station text, entries bigint NOT NULL, exits bigint NOT NULL',
                      'date, hour, station', ('entries', 'exits')),
    'band_flows': ('weekend smallint, band text, origin text, destination text, trips bigint NOT NULL',
                   'weekend, band, origin, destination', ('trips',)),
    'station_hour_flow': ('weekend smallint, hour smallint, station text, entries bigint NOT NULL, exits bigint NOT NULL',
                          'weekend, hour, station', ('entries', 'exits')),
}
REF_TABLES = {
    'station': ('id integer, name text NOT NULL UNIQUE, lines text, lon double precision, lat double precision, first_month text, last_month text',
                'id', ()),
    'station_alias': ('raw text, station_id integer NOT NULL REFERENCES station(id)', 'raw', ()),
    'station_month': ('station_id integer REFERENCES station(id), month text', 'station_id, month', ()),
    'day': ('date text, month text NOT NULL, weekend smallint NOT NULL, off smallint NOT NULL, note text, present smallint NOT NULL',
            'date', ()),
    'station_day': ('station_id integer REFERENCES station(id), date text REFERENCES day(date), entries bigint NOT NULL, exits bigint NOT NULL',
                    'station_id, date', ('entries', 'exits')),
}
REFERENCE_SCHEMA = 'exitpulse_ref'
CATALOG = 'exitpulse_catalog.months'
TRIP_ROWS_SELECT = (
    'SELECT day, hour, origin, destination, trips FROM trip_groups '
    'CROSS JOIN LATERAL unnest(destinations, counts) AS pairs(destination, trips)'
)

_pool = None


class ConnectionPool:
    """Small process-local pool; transactions never cross request boundaries."""

    def __init__(self, minimum=2, maximum=4, *, statement_timeout_ms=None):
        self.idle = LifoQueue(maxsize=maximum)
        self.connections = []
        self.statement_timeout_ms = statement_timeout_ms
        try:
            for _ in range(minimum):
                self.idle.put(self._connect())
        except Exception:
            self.close()
            raise

    def _connect(self):
        db = psycopg.connect(os.environ.get('EXITPULSE_DATABASE_URL', ''),
                             connect_timeout=5, application_name='ExitPulse worker')
        if self.statement_timeout_ms is not None:
            try:
                with db.transaction():
                    db.execute("SELECT set_config('statement_timeout', %s, false)", (str(self.statement_timeout_ms),))
            except Exception:
                db.close()
                raise
        self.connections.append(db)
        return db

    @contextmanager
    def connection(self):
        if self.idle.empty():
            if len(self.connections) >= self.idle.maxsize:
                raise RuntimeError('OD connection pool exhausted')
            db = self._connect()
        else:
            db = self.idle.get_nowait()
        try:
            # Verify idle sockets before starting the request transaction.
            try:
                db.execute('SELECT 1')
                db.rollback()
            except (psycopg.OperationalError, psycopg.InterfaceError):
                db.close()
                self.connections.remove(db)
                db = self._connect()
            with db.transaction():
                yield db
        finally:
            if db.closed:
                if db in self.connections:
                    self.connections.remove(db)
            else:
                self.idle.put_nowait(db)

    def close(self):
        for db in self.connections:
            db.close()
        self.connections.clear()


class OdAnalysisError(ValueError):
    exit_code = 2


class UncomparableError(OdAnalysisError):
    exit_code = 2


class MonthNotFound(OdAnalysisError):
    exit_code = 3


class UnrecordedHours(OdAnalysisError):
    exit_code = 4


class HoursMismatch(OdAnalysisError):
    exit_code = 5

    def __init__(self, payload, message='這個時段無法比較。'):
        super().__init__(message)
        self.payload = payload


def init_pool(minimum=2, maximum=4):
    global _pool
    if _pool is None:
        _pool = ConnectionPool(minimum=minimum, maximum=maximum)
    return _pool


def close_pool():
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def month_schema(month):
    if len(month) != 7 or date.fromisoformat(month + '-01').isoformat()[:7] != month:
        raise ValueError(f'Invalid month: {month}')
    return 'exitpulse_' + month.replace('-', '_')


def database():
    if _pool is not None:
        return _pool.connection()
    return psycopg.connect(os.environ.get('EXITPULSE_DATABASE_URL', ''), connect_timeout=5,
                           application_name='ExitPulse')


@contextmanager
def open_month(month):
    schema = month_schema(month)
    with database() as db:
        if not month_exists(db, month):
            raise MonthNotFound(f'{month}: not imported')
        search_schema(db, schema)
        yield db


@contextmanager
def open_reference():
    with database() as db:
        search_schema(db, REFERENCE_SCHEMA)
        yield db


def search_schema(db, schema):
    db.execute(sql.SQL('SET LOCAL search_path TO {}').format(sql.Identifier(schema)))


def init_catalog(db):
    db.execute("SELECT pg_advisory_xact_lock(hashtext('exitpulse_catalog'))")
    db.execute('CREATE SCHEMA IF NOT EXISTS exitpulse_catalog')
    db.execute(f'CREATE TABLE IF NOT EXISTS {CATALOG} (month text PRIMARY KEY)')


def months(db):
    return [row[0] for row in db.execute(f'SELECT month FROM {CATALOG} ORDER BY month')]


def month_exists(db, month):
    return db.execute(f'SELECT 1 FROM {CATALOG} WHERE month=%s', (month,)).fetchone() is not None


def publish_month(db, month):
    db.execute(f'INSERT INTO {CATALOG} VALUES (%s) ON CONFLICT DO NOTHING', (month,))


def write_schema(db, schema):
    # Serialize re-imports of the same schema. DDL and COPY roll back together.
    db.execute('SELECT pg_advisory_xact_lock(hashtext(%s))', (schema,))
    ident = sql.Identifier(schema)
    db.execute(sql.SQL('DROP SCHEMA IF EXISTS {} CASCADE').format(ident))
    db.execute(sql.SQL('CREATE SCHEMA {}').format(ident))
    search_schema(db, schema)


def create_table(db, table, definition):
    fields = definition[0]
    db.execute(f'CREATE TABLE {table} ({fields})')


def finish_table(db, table, definition):
    db.execute(f'ALTER TABLE {table} ADD PRIMARY KEY ({definition[1]})')
    db.execute(f'ANALYZE {table}')


def create_trip_view(db):
    db.execute('CREATE VIEW trips AS ' + TRIP_ROWS_SELECT)


def copy_rows(db, table, rows):
    with db.cursor().copy(f'COPY {table} FROM STDIN') as stream:
        for row in rows:
            stream.write_row(row)


def metadata(db):
    return {k: json.loads(v) for k, v in db.execute('SELECT key,value FROM metadata')}


def table_exists(db, table):
    return db.execute('SELECT to_regclass(%s) IS NOT NULL', (table,)).fetchone()[0]


def index_reference(db):
    db.execute('CREATE INDEX day_month ON day(month, date)')
    db.execute('CREATE INDEX station_day_date ON station_day(date text_pattern_ops)')


def get_months():
    with database() as db:
        return months(db)


def get_availability():
    with open_reference() as db:
        rows = db.execute('SELECT s.name,array_agg(m.month ORDER BY m.month), '
                          '(SELECT MIN(sd.date) FROM station_day sd WHERE sd.station_id=s.id) '
                          'FROM station s JOIN station_month m ON s.id=m.station_id GROUP BY s.id')
        return {name: {'months': ms, 'firstDate': first} for name, ms, first in rows}


def get_catalog():
    from station_info import line_openings

    with open_reference() as db:
        month_rows = db.execute(
            "SELECT month, COUNT(*) FILTER (WHERE present=1) AS present_days, COUNT(*) AS total_days, "
            "COALESCE(array_agg(date ORDER BY date) FILTER (WHERE present=0), '{}') AS missing_dates "
            "FROM day GROUP BY month HAVING COUNT(*) FILTER (WHERE present=1) > 0 ORDER BY month"
        ).fetchall()
        sc_map = dict(db.execute('SELECT month, COUNT(*) FROM station_month GROUP BY month').fetchall())
        st_rows = db.execute(
            'WITH sd AS ('
            '  SELECT station_id, MIN(date) AS first_date, MAX(date) AS last_date, COUNT(*) AS day_count '
            '  FROM station_day GROUP BY station_id'
            '), sm AS ('
            '  SELECT station_id, COUNT(*) AS month_count '
            '  FROM station_month GROUP BY station_id'
            ') '
            'SELECT s.name, sd.first_date, sd.last_date, COALESCE(sd.day_count, 0), COALESCE(sm.month_count, 0) '
            'FROM station s '
            'LEFT JOIN sd ON sd.station_id=s.id '
            'LEFT JOIN sm ON sm.station_id=s.id '
            'ORDER BY sd.first_date NULLS LAST, s.name'
        ).fetchall()
        opening_map = {}
        if table_exists(db, 'exitpulse_station_info.stations'):
            opening_map = dict(db.execute("SELECT name, payload->'opening'->>'date' FROM exitpulse_station_info.stations").fetchall())
        months_out = [
            {'month': m, 'days': int(p), 'expectedDays': int(t), 'missingDates': list(md), 'stationCount': int(sc_map.get(m, 0))}
            for m, p, t, md in month_rows
        ]
        stations_out = [
            {'name': n, 'officialOpening': opening_map.get(n), 'firstDate': fd, 'lastDate': ld, 'days': int(dc), 'months': int(mc)}
            for n, fd, ld, dc, mc in st_rows
        ]
        return {
            'summary': {
                'months': len(months_out),
                'days': sum(m['days'] for m in months_out),
                'missingDays': sum(len(m['missingDates']) for m in months_out),
                'stations': len(stations_out),
                'range': [months_out[0]['month'], months_out[-1]['month']] if months_out else [],
            },
            'months': months_out,
            'stations': stations_out,
            'lineOpenings': line_openings(),
        }


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv == ['availability']:
        print(json.dumps(get_availability(), ensure_ascii=False))
    elif argv == ['catalog']:
        print(json.dumps(get_catalog(), ensure_ascii=False))
    else:
        print(json.dumps(get_months()))


if __name__ == '__main__':
    main()
