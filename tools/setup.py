"""一個指令把空的 ExitPulse 資料庫補滿資料。

    docker compose up -d --wait db      # 或把 EXITPULSE_DATABASE_URL 指向任何 UTF-8 的 PostgreSQL
    python tools/setup.py               # 最近 12 個月
    python tools/setup.py --all         # 2017-01 到最新月份
    python tools/setup.py 2025-01 2026-09

單月含下載約 40 秒。可重複執行，已匯入的月份會略過。
"""
import argparse
import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse, urlunparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))

DEFAULT_URL = 'postgresql://exitpulse:exitpulse@127.0.0.1:55432/exitpulse'
FIRST_MONTH = '2017-01'
FALLBACK_LATEST_MONTH = '2026-09'


def parse_dbname(conninfo: str) -> str | None:
    """從 URI 或 libpq key=value 連線字串取出目標資料庫名稱。"""
    raw = conninfo.strip()
    if not raw:
        return None
    if '://' in raw:
        name = urlparse(raw).path.lstrip('/')
        return name or None
    match = re.search(r"(?:^|\s)(?:dbname|database)=('(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\"|\S+)", raw)
    if not match:
        return None
    return match.group(1).strip("'\"") or None


def maintenance_url(conninfo: str) -> str:
    """將連線字串的目標資料庫替換成系統預設的 postgres 維護庫。"""
    raw = conninfo.strip()
    if '://' in raw:
        parsed = urlparse(raw)
        return urlunparse(parsed._replace(path='/postgres'))
    if re.search(r'(?:^|\s)(?:dbname|database)=\S+', raw):
        return re.sub(r'((?:^|\s))(?:dbname|database)=\S+', r'\1dbname=postgres', raw, count=1)
    return f'{raw} dbname=postgres'


def ensure_database_exists(url: str):
    """連上資料庫；若目標 UTF-8 資料庫尚未建立則自動連進 postgres 維護庫建立。"""
    import psycopg
    from psycopg import sql

    try:
        psycopg.connect(url, connect_timeout=5).close()
        return
    except psycopg.errors.InvalidCatalogName:
        dbname = parse_dbname(url)
        if not dbname or dbname == 'postgres':
            raise
        print(f'偵測到資料庫「{dbname}」尚未建立，正在自動建立 UTF-8 資料庫…', flush=True)
        maint = maintenance_url(url)
        with psycopg.connect(maint, connect_timeout=5, autocommit=True) as admin_db:
            admin_db.execute(sql.SQL("CREATE DATABASE {} ENCODING 'UTF8'").format(sql.Identifier(dbname)))
        psycopg.connect(url, connect_timeout=5).close()
    except psycopg.Error as error:
        sys.exit(f'連不上資料庫：{error}\n先執行 docker compose up -d --wait db，或設定 EXITPULSE_DATABASE_URL。')


def latest_available_month():
    """從 data.taipei 索引取得最新可用月份，抓不到時退回已知最新月份。"""
    try:
        from import_od import fetch_index
        rows = fetch_index()
        months = sorted(row['month'] for row in rows if row.get('month'))
        if months:
            return months[-1]
    except Exception as error:
        print(f'警告：無法從索引取得最新月份（{error}），改用 {FALLBACK_LATEST_MONTH}')
    return FALLBACK_LATEST_MONTH


# 往前推 count 個月，回傳起始月份（含 end 本身）
def months_back(end, count):
    y, m = map(int, end.split('-'))
    index = y * 12 + m - 1 - (count - 1)
    return f'{index // 12:04}-{index % 12 + 1:02}'


# 依序執行一個子步驟，失敗就整個停下來並說明是哪一步
def step(title, *command):
    print(f'\n== {title}', flush=True)
    result = subprocess.run([sys.executable, '-u', *command], cwd=ROOT, env={**os.environ, 'PYTHONUTF8': '1'})
    if result.returncode:
        sys.exit(f'失敗：{title}（結束碼 {result.returncode}）')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('start', nargs='?')
    parser.add_argument('end', nargs='?')
    parser.add_argument('--all', action='store_true', help=f'{FIRST_MONTH} 到最新月份')
    parser.add_argument('--jobs', type=int, default=3, choices=range(1, 5))
    parser.add_argument('--skip-aux', action='store_true', help='略過人口與車站景點／出口／YouBike 輔助資料匯入')
    parser.add_argument('--update-map', action='store_true', help='一併更新 OSM 捷運路網靜態 GeoJSON')
    args = parser.parse_args()
    latest = latest_available_month()
    start, end = args.start, args.end or (args.start and latest)
    if args.all:
        start, end = FIRST_MONTH, latest
    elif not start:
        start, end = months_back(latest, 12), latest

    os.environ.setdefault('EXITPULSE_DATABASE_URL', DEFAULT_URL)
    ensure_database_exists(os.environ['EXITPULSE_DATABASE_URL'])

    step('檢查當年與隔年國定假日曆', 'tools/update_auxiliary.py', '--skip-station-info', '--skip-population')
    step(f'匯入 {start} 到 {end}（從臺北市資料大平臺下載，已匯入的月份會略過）', 'tools/import_od_range.py', start, end, '--jobs', str(args.jobs))
    step('建立跨月與車站參考資料（exitpulse_ref）', 'tools/build_ref.py')
    if not args.skip_aux:
        aux_cmd = ['tools/update_auxiliary.py']
        if args.update_map:
            aux_cmd.append('--with-metro-map')
        step('匯入行政區人口、車站詳情、出口、景點與 YouBike', *aux_cmd)
    step('驗證已匯入月份', 'tools/verify_od.py', start, end)

    try:
        import update_monthly
        print('\n== 重產靜態預設比較 od/default.json', flush=True)
        update_monthly.regenerate_default_json(end)
    except Exception as error:
        print(f'提示：略過重產 od/default.json（{error}）')

    print('\n完成。所有資料庫結構、歷史旅次與輔助資料皆已就緒，啟動方式見 README 的「本機執行」。')


if __name__ == '__main__':
    main()
