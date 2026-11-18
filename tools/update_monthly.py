"""每月自動更新排程腳本：檢查索引 -> 假日曆守門 -> 單線程匯入 -> 新站座標檢查 -> 對帳與合理性檢查 -> 備份 -> 發布 -> 冒煙測試。

環境變數：
- EXITPULSE_DATABASE_URL：PostgreSQL 連線字串
- EXITPULSE_API_URL：冒煙測試 API 網址（預設 http://127.0.0.1:5011）
- EXITPULSE_WEB_URL：冒煙測試 Web 網址（選填）
- EXITPULSE_WEBHOOK_URL：通知推播網址（選填，支援 ntfy.sh 或一般 JSON/文字 webhook）
- EXITPULSE_DEFAULT_JSON：靜態 od/default.json 輸出路徑（選填，預設 apps/web/public/od/default.json）
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))

import build_ref
import import_od
import od_postgres
import rollback_month


def notify(message: str, is_error: bool = False):
    prefix = '[ExitPulse 異常] ' if is_error else '[ExitPulse 更新] '
    full = prefix + message
    print(full, flush=True)
    hook = os.environ.get('EXITPULSE_WEBHOOK_URL', '').strip()
    if not hook:
        return
    try:
        req = urllib.request.Request(
            hook,
            data=full.encode('utf-8'),
            headers={'Content-Type': 'text/plain; charset=utf-8', 'Title': 'ExitPulse Auto Update'},
            method='POST',
        )
        urllib.request.urlopen(req, timeout=10).read()
    except Exception as error:
        print(f'通知發送失敗：{error}', file=sys.stderr)


def run_step(title: str, args: list[str], capture: bool = False) -> subprocess.CompletedProcess:
    print(f'\n== {title}', flush=True)
    res = subprocess.run(
        [sys.executable, '-u', *args],
        cwd=ROOT,
        env={**os.environ, 'PYTHONUTF8': '1'},
        text=True,
        capture_output=capture,
    )
    if capture and res.stdout:
        print(res.stdout, end='')
    if capture and res.stderr:
        print(res.stderr, end='', file=sys.stderr)
    if res.returncode != 0:
        raise RuntimeError(f'{title} 失敗（結束碼 {res.returncode}）')
    return res


def check_holiday_file(year: str):
    path = ROOT / 'tools' / 'holidays' / f'{year}.json'
    if not path.exists():
        raise RuntimeError(f'缺少 {year} 年假日曆檔案：{path}，已阻斷發布避免國定假日被當成平日計算。')


def daily_average(db, month: str) -> float:
    """該月平均每日旅次。用日平均比較，大小月天數不同才不會誤判。"""
    schema = od_postgres.sql.Identifier(od_postgres.month_schema(month))
    total, days = db.execute(od_postgres.sql.SQL(
        'SELECT COALESCE(SUM(trips), 0), COUNT(DISTINCT date) FROM {}.day_flows').format(schema)).fetchone()
    return total / days if days else 0.0


def check_volume_sanity(db, target_month: str):
    """比對新月份與前三個月的平均每日旅次，落差超過 ±40% 則阻斷發布。"""
    previous = [m for m in od_postgres.months(db) if m < target_month][-3:]
    if len(previous) < 2:
        return
    averages = [daily_average(db, m) for m in previous]
    avg_prev = sum(averages) / len(averages)
    if avg_prev <= 0:
        return
    current = daily_average(db, target_month)
    ratio = current / avg_prev
    if ratio < 0.6 or ratio > 1.4:
        raise RuntimeError(
            f'{target_month} 平均每日旅次（{current:,.0f}）與前三個月平均（{avg_prev:,.0f}）落差超過 ±40%（比值 {ratio:.2f}），已暫停發布。'
        )


def backup_catalog_and_ref():
    if not shutil.which('pg_dump'):
        print('提示：找不到 pg_dump，略過發布前備份。')
        return
    url = os.environ.get('EXITPULSE_DATABASE_URL', '')
    if not url:
        return
    backup_dir = ROOT / 'data' / 'backups'
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    dest = backup_dir / f'catalog-ref-{stamp}.sql'
    res = subprocess.run(
        ['pg_dump', url, '--schema=exitpulse_catalog', f'--schema={od_postgres.REFERENCE_SCHEMA}', '-f', str(dest)],
        capture_output=True,
        text=True,
    )
    if res.returncode != 0:
        raise RuntimeError(f'pg_dump 備份失敗：{res.stderr.strip()}')
    backups = sorted(backup_dir.glob('catalog-ref-*.sql'))
    for old in backups[:-5]:
        old.unlink(missing_ok=True)
    print(f'已完成目錄與參考資料備份：{dest.name}')


def regenerate_default_json(latest_month: str):
    """用最新月份與去年同月產生前端靜態 fallback 檔 od/default.json。"""
    y, m = map(int, latest_month.split('-'))
    baseline = f'{y - 1:04d}-{m:02d}'
    with od_postgres.database() as db:
        if not od_postgres.month_exists(db, baseline):
            rows = od_postgres.months(db)
            if len(rows) < 2:
                return
            baseline = rows[-2]
    res = run_step(
        f'重產 od/default.json（{baseline} -> {latest_month}）',
        ['tools/query_od.py', baseline, latest_month, '--start', '7', '--end', '10', '--limit', '500'],
        capture=True,
    )
    payload = json.loads(res.stdout)
    target = Path(os.environ.get('EXITPULSE_DEFAULT_JSON', str(ROOT / 'apps' / 'web' / 'public' / 'od' / 'default.json')))
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
    tmp.replace(target)
    print(f'已更新靜態預設比較：{target}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true', help='只檢查是否有新月份，不執行匯入')
    args = parser.parse_args()

    with od_postgres.database() as db:
        existing = set(od_postgres.months(db))

    available = sorted(item['month'] for item in import_od.fetch_index())
    pending = [m for m in available if m not in existing and (not existing or m > min(existing))]
    if not pending:
        print(f'目前資料庫已是最新（共 {len(existing)} 個月）。')
        return

    print(f'發現待匯入月份：{", ".join(pending)}')
    if args.dry_run:
        return

    api_url = os.environ.get('EXITPULSE_API_URL', 'http://127.0.0.1:5011')
    web_url = os.environ.get('EXITPULSE_WEB_URL', '')

    for month in pending:
        try:
            check_holiday_file(month[:4])
            run_step(f'匯入 {month}（單執行緒防記憶體尖峰）', ['tools/import_od_range.py', month, month, '--jobs', '1'])

            ref_res = run_step('更新參考資料並檢查新站座標', ['tools/build_ref.py'], capture=True)
            if 'no coordinates for:' in (ref_res.stdout or ''):
                raise RuntimeError('偵測到新通車車站缺少座標（unplaced），已阻斷發布，請先補齊座標資料。')

            run_step(f'對帳 {month}', ['tools/verify_od.py', month, month])
            with od_postgres.database() as db:
                check_volume_sanity(db, month)
                backup_catalog_and_ref()
                od_postgres.publish_month(db, month)
                db.commit()

            regenerate_default_json(month)
            smoke_args = ['tools/smoke.py', '--api', api_url]
            if web_url:
                smoke_args += ['--web', web_url]
            try:
                run_step('執行線上冒煙測試', smoke_args)
            except Exception:
                rollback_month.rollback(month, drop_schema=False)
                raise

            # 清理暫存 CSV 避免長期佔用 VPS 磁碟
            cache_file = import_od.CACHE / f'{month}.csv'
            if cache_file.exists():
                cache_file.unlink()
            notify(f'已成功自動發布 {month} 捷運旅次資料並通過冒煙測試。')
        except Exception as error:
            notify(f'更新 {month} 失敗：{error}', is_error=True)
            sys.exit(1)


if __name__ == '__main__':
    main()
