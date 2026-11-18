"""Import an inclusive month range with bounded parallel workers and resume support."""
import argparse
import concurrent.futures
import subprocess
import sys
import os
from pathlib import Path

from od_postgres import MonthNotFound, database, init_catalog, metadata, open_month
ROOT = Path(__file__).resolve().parents[1]


def months(start, end):
    y, m = map(int, start.split('-'))
    end_y, end_m = map(int, end.split('-'))
    if not 1 <= m <= 12 or not 1 <= end_m <= 12 or (y, m) > (end_y, end_m):
        raise ValueError('Invalid month range')
    while (y, m) <= (end_y, end_m):
        yield f'{y:04}-{m:02}'
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def already_imported(month):
    try:
        with open_month(month) as db:
            data = metadata(db)
        return data.get('month') == month and all(k in data for k in ('sha256', 'daily', 'rows', 'total', 'hours', 'origins', 'destinations'))
    except MonthNotFound:
        return False


def run(month):
    if already_imported(month):
        return month, 0, '已匯入'
    process = subprocess.run([sys.executable, '-u', str(ROOT / 'tools' / 'import_od.py'), month, '--skip-reference'],
                             cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace',
                             env={**os.environ, 'PYTHONUTF8': '1'})
    return month, process.returncode, (process.stdout + process.stderr).strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('start')
    parser.add_argument('end')
    parser.add_argument('--jobs', type=int, default=3, choices=range(1, 5))
    args = parser.parse_args()
    with database() as db:
        init_catalog(db)
    requested = list(months(args.start, args.end))
    failed = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as pool:
        for month, code, message in pool.map(run, requested):
            print(f'{month}: {message}', flush=True)
            if code:
                failed.append(month)
    print(f'完成 {len(requested) - len(failed)}/{len(requested)} 個月；失敗：{", ".join(failed) or "無"}', flush=True)
    if len(failed) < len(requested):
        from build_ref import main as build_reference
        build_reference()
    return bool(failed)


if __name__ == '__main__':
    sys.exit(main())
