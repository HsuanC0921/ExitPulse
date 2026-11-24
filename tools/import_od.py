"""Download indexed Taipei Metro OD files and build a compact hourly aggregate.

Usage: python tools/import_od.py 2019-09 2026-09
Weekday means Monday–Friday, not the government holiday calendar.
"""
import calendar
import csv
import hashlib
import json
import os
import shutil
import time
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import date
from pathlib import Path

from od_postgres import MONTH_TABLES, copy_rows, create_table, database, finish_table, init_catalog, month_schema, publish_month, write_schema

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'data' / 'od-cache'
INDEX = 'https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=eb481f58-1238-4cff-8caa-fa7bb20cb4f4'
# The official OD index begins in January 2017. There is no December 2016 spill file.
FIRST_PUBLISHED_MONTH = '2017-01'


def fetch_index():
    """從臺北市資料大平臺索引取得所有可用月份與下載網址。"""
    with urllib.request.urlopen(INDEX, timeout=60) as response:
        rows = csv.DictReader(response.read().decode('utf-8-sig').splitlines())
        items = []
        for row in rows:
            year, mon = int(row['西元年']), int(row['月'])
            url = row['URL'].replace('http://', 'https://', 1)
            items.append({'month': f'{year:04d}-{mon:02d}', 'url': url})
        return items


def download(month):
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f'{month}.csv'
    if path.exists():
        return path
    match = next((r for r in fetch_index() if r['month'] == month), None)
    if not match:
        raise ValueError(f'No official index entry for {month}')
    url = match['url']
    # 下載網址來自遠端索引，只接受 https，避免被指到 file: 或其他協定
    if not url.startswith('https://'):
        raise ValueError(f'Refusing non-https download URL for {month}')
    # Adjacent January/December imports can request the same source concurrently.
    temp = path.with_name(f'{month}.{os.getpid()}.part')
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=60) as response, temp.open('wb') as target:
                shutil.copyfileobj(response, target, length=1024 * 1024)
                expected = response.headers.get('Content-Length')
            if expected is not None and temp.stat().st_size != int(expected):
                raise IOError('incomplete download')
            break
        except (OSError, urllib.error.URLError):
            temp.unlink(missing_ok=True)
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)
    if path.exists():
        temp.unlink()
    else:
        try:
            temp.replace(path)
        except PermissionError:
            if not path.exists():
                raise
            temp.unlink()
    return path


def month_rows(path, year, mon, spill_only=False):
    """December may contain early New Year's Day records belonging to January."""
    with path.open(encoding='utf-8-sig', newline='') as f:
        reader = csv.reader(f)
        if next(reader) != ['日期', '時段', '進站', '出站', '人次']:
            raise ValueError(f'{path}: unexpected CSV header')
        for row in reader:
            if len(row) != 5:
                raise ValueError(f'{path}: malformed row')
            day = date.fromisoformat(row[0])
            if (day.year, day.month) == (year, mon):
                yield row
            elif spill_only:
                continue
            elif mon == 12 and day == date(year + 1, 1, 1) and int(row[1]) <= 5:
                continue
            else:
                raise ValueError(f'{path}: unexpected date {day}')


def month_sources(month):
    sources = [(download(month), False)]
    year, mon = map(int, month.split('-'))
    if mon == 1 and month != FIRST_PUBLISHED_MONTH:
        sources.append((download(f'{year - 1:04}-12'), True))
    return sources


def build(month):
    from import_daily import load_daily

    schema = month_schema(month)
    year, mon = map(int, month.split('-'))
    sources = month_sources(month)
    path = sources[0][0]
    sums = defaultdict(int)
    dates = set()
    stations = set()
    origins, destinations = set(), set()
    common_origins = common_destinations = None
    coverage_scopes = {}
    seen = set()
    slot_counts = {}
    last_slot = None
    count = total = 0
    digest = hashlib.sha256()
    with path.open('rb') as raw:
        for block in iter(lambda: raw.read(1024 * 1024), b''):
            digest.update(block)

    def finish_slot(slot):
        nonlocal common_origins, common_destinations
        slot_origins = {o for o, _ in seen}
        slot_destinations = {d for _, d in seen}
        if len(seen) != len(slot_origins) * len(slot_destinations):
            raise ValueError(f'{month}: incomplete origin/destination matrix in {slot}')
        common_origins = slot_origins if common_origins is None else common_origins & slot_origins
        common_destinations = slot_destinations if common_destinations is None else common_destinations & slot_destinations
        signature = (tuple(sorted(slot_origins)), tuple(sorted(slot_destinations)))
        coverage_scopes.setdefault(signature, set()).add(slot[0])
        slot_counts[slot] = len(seen)

    supplemental_hash = None
    if len(sources) == 2:
        supplemental_digest = hashlib.sha256()
        with sources[1][0].open('rb') as raw:
            for block in iter(lambda: raw.read(1024 * 1024), b''):
                supplemental_digest.update(block)
        supplemental_hash = supplemental_digest.hexdigest()
    for source, spill_only in sources:
        for row in month_rows(source, year, mon, spill_only):
            ds, hour, origin, destination, value = row
            day = date.fromisoformat(ds)
            h, n = int(hour), int(value)
            if (day.year, day.month) != (year, mon) or not 0 <= h <= 23 or n < 0:
                raise ValueError(f'{month}: invalid row {count + 2}')
            slot = (ds, h)
            if slot != last_slot:
                if last_slot is not None:
                    finish_slot(last_slot)
                if slot in slot_counts:
                    raise ValueError(f'{month}: repeated time slot {slot}')
                seen.clear()
                last_slot = slot
            pair = (origin, destination)
            if pair in seen:
                raise ValueError(f'{month}: duplicate {slot} {pair}')
            seen.add(pair)
            dates.add(ds)
            stations.update(pair)
            origins.add(origin)
            destinations.add(destination)
            count += 1
            total += n
            if n:
                sums[(h, int(day.weekday() >= 5), origin, destination)] += n
    if last_slot is not None:
        finish_slot(last_slot)
    expected = {date(year, mon, d).isoformat() for d in range(1, calendar.monthrange(year, mon)[1] + 1)}
    if dates != expected:
        raise ValueError(f'{month}: missing dates: {sorted(expected - dates)}')
    available_hours = []
    for h in range(24):
        counts = {slot_counts.get((d, h), 0) for d in dates}
        if counts != {0}:
            available_hours.append(h)
    if not {7, 8, 9}.issubset(available_hours):
        raise ValueError(f'{month}: missing morning entry hours')
    if sum(sums.values()) != total:
        raise ValueError(f'{month}: aggregate total mismatch')
    with database() as db:
        init_catalog(db)
    with database() as db:
        write_schema(db, schema)
        for table in ('metadata', 'flows'):
            create_table(db, table, MONTH_TABLES[table])
        copy_rows(db, 'flows', ((*key, n) for key, n in sums.items()))
        info = {'month': month, 'sha256': digest.hexdigest(), 'rows': count, 'total': total,
                'dates': sorted(dates), 'stations': sorted(stations), 'origins': sorted(common_origins or ()),
                'destinations': sorted(common_destinations or ()), 'allOrigins': sorted(origins),
                'allDestinations': sorted(destinations), 'coverageScopes': [
                    {'origins': list(o), 'destinations': list(d), 'dates': sorted(ds)}
                    for (o, d), ds in coverage_scopes.items()], 'hours': available_hours,
                'hourDates': {str(h): sorted(d for d in dates if (d, h) in slot_counts) for h in available_hours},
                'supplementalSource': sources[1][0].stem if len(sources) == 2 else None,
                'supplementalSha256': supplemental_hash, 'source': INDEX}
        copy_rows(db, 'metadata', ((k, json.dumps(v, ensure_ascii=False)) for k, v in info.items()))
        for table in ('metadata', 'flows'):
            finish_table(db, table, MONTH_TABLES[table])
        load_daily(db, month, sources, total)
        publish_month(db, month)
    print(f'{month}: {count:,} rows, {total:,} trips, {len(stations)} stations, {len(sums):,} aggregates', flush=True)


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('months', nargs='+')
    parser.add_argument('--skip-reference', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    for arg in args.months:
        build(arg)
    if not args.skip_reference:
        from build_ref import main
        main()
