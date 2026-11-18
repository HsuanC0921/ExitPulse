"""一個指令把空的 ExitPulse 資料庫補滿資料。

    docker compose up -d --wait db      # 或把 EXITPULSE_DATABASE_URL 指向任何 UTF-8 的 PostgreSQL
    python tools/setup.py               # 最近 12 個月
    python tools/setup.py --all         # 2017-01 到最新月份
    python tools/setup.py 2025-01 2026-09

單月含下載約 40 秒。可重複執行，已匯入的月份會略過。
"""
import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_URL = 'postgresql://exitpulse:exitpulse@127.0.0.1:55432/exitpulse'
FIRST_MONTH = '2017-01'
FALLBACK_LATEST_MONTH = '2026-09'


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
    args = parser.parse_args()
    latest = latest_available_month()
    start, end = args.start, args.end or (args.start and latest)
    if args.all:
        start, end = FIRST_MONTH, latest
    elif not start:
        start, end = months_back(latest, 12), latest

    os.environ.setdefault('EXITPULSE_DATABASE_URL', DEFAULT_URL)
    import psycopg
    try:
        psycopg.connect(os.environ['EXITPULSE_DATABASE_URL'], connect_timeout=5).close()
    except psycopg.Error as error:
        sys.exit(f'連不上資料庫：{error}\n先執行 docker compose up -d --wait db，或設定 EXITPULSE_DATABASE_URL。')

    step(f'匯入 {start} 到 {end}（從臺北市資料大平臺下載，已匯入的月份會略過）', 'tools/import_od_range.py', start, end, '--jobs', str(args.jobs))
    step('匯入車站資訊（景點、出口、通車日期）', 'tools/station_info.py', '--import')
    step('驗證已匯入月份', 'tools/verify_od.py', start, end)
    print('\n完成。啟動方式見 README 的「本機執行」。')


if __name__ == '__main__':
    main()
