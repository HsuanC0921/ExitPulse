"""Check the PostgreSQL aggregates against the totals recorded at import."""
import sys

from psycopg import Error

from import_od_range import months
from od_postgres import metadata, open_month


def main(start, end):
    failures = []
    requested = list(months(start, end))
    for month in requested:
        try:
            with open_month(month) as db:
                meta = metadata(db)
                for table in ('flows', 'trips', 'day_flows'):
                    if db.execute(f'SELECT COALESCE(SUM(trips), 0) FROM {table}').fetchone()[0] != meta['total']:
                        raise ValueError(f'{table}: trip totals differ')
                sums = db.execute('SELECT SUM(entries), SUM(exits) FROM station_hours').fetchone()
                if meta['month'] != month or sums != (meta['total'], meta['total']):
                    raise ValueError('station-hour totals or month metadata differ')
        except (Error, OSError, ValueError, KeyError) as error:
            failures.append((month, str(error)))
    print(f'檢查 {len(requested)} 個月，失敗 {len(failures)} 個月')
    for month, error in failures:
        print(f'{month}: {error}')
    return bool(failures)


if __name__ == '__main__':
    sys.exit(main(*sys.argv[1:]))
