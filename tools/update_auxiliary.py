"""非 OD 外部資料穩定自動更新：年度假日曆、車站/出口/設施/景點資訊與 OSM 路網防呆檢查。"""
import argparse
import json
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))

import od_postgres

# 臺北市政府資料大平臺 / 政府資料開放平臺（中華民國政府行政機關辦公日曆表 CSV/JSON 鏡像可透過環境變數覆寫）
HOLIDAY_URL_TEMPLATE = 'https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/{year}.json'


def update_holiday(year: int) -> bool:
    target = ROOT / 'tools' / 'holidays' / f'{year}.json'
    if target.exists():
        return False
    url = HOLIDAY_URL_TEMPLATE.format(year=year)
    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            raw = json.loads(resp.read().decode('utf-8-sig'))
    except Exception as error:
        print(f'提示：暫時無法取得 {year} 年假日曆（{error}）。')
        return False

    if not isinstance(raw, list) or len(raw) < 365:
        raise RuntimeError(f'{year} 年假日曆筆數不足 365 天（實際 {len(raw) if isinstance(raw, list) else 0}），拒絕寫入。')

    converted = []
    for row in raw:
        date_str = str(row.get('date', ''))
        if len(date_str) == 8 and date_str.isdigit():
            iso = f'{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}'
        else:
            iso = date_str
        converted.append({
            'date': iso,
            'isHoliday': bool(row.get('isHoliday')),
            'description': str(row.get('description') or ''),
        })
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(converted, ensure_ascii=False, indent=2), encoding='utf-8')
    tmp.replace(target)
    print(f'已寫入 {year} 年假日曆（{len(converted)} 天）：{target}')
    return True


def update_station_info():
    """執行 station_info.py --import，但先檢查原有資料量，避免外部來源空表洗白資料。"""
    with od_postgres.database() as db:
        before = db.execute('SELECT COUNT(*) FROM exitpulse_reference.station_info').fetchone()[0] if od_postgres.table_exists(db, 'exitpulse_reference.station_info') else 0
    res = subprocess.run([sys.executable, '-u', 'tools/station_info.py', '--import'], cwd=ROOT, text=True)
    if res.returncode != 0:
        raise RuntimeError(f'station_info 匯入失敗（結束碼 {res.returncode}）')
    with od_postgres.database() as db:
        after = db.execute('SELECT COUNT(*) FROM exitpulse_reference.station_info').fetchone()[0]
    if before > 0 and after < int(before * 0.85):
        raise RuntimeError(f'station_info 匯入後筆數異常下降（{before} -> {after}），請立即人工檢查！')
    print(f'車站資訊更新完成（{before} -> {after} 站）。')


def update_district_population():
    """從內政部戶政司 ODRP014 抓取最近一期與去年同月雙北行政區人口數，寫入 data/district-pop.json。"""
    from collections import defaultdict
    from datetime import date

    def fetch_month(ym: str) -> dict[str, int]:
        totals: dict[str, int] = defaultdict(int)
        page = 1
        while True:
            url = f'https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014/{ym}?page={page}'
            req = urllib.request.Request(url, headers={'User-Agent': 'ExitPulse/1.0'})
            with urllib.request.urlopen(req, timeout=20) as resp:
                body = json.loads(resp.read().decode('utf-8'))
            rows = body.get('responseData') or []
            if not rows:
                break
            for row in rows:
                site = str(row.get('site_id') or '').replace('台', '臺')
                if not (site.startswith('臺北市') or site.startswith('新北市') or site.startswith('桃園市')):
                    continue
                totals[site] += int(row.get('people_total') or 0)
            if page >= int(body.get('totalPage') or 1):
                break
            page += 1
        return dict(totals)

    today = date.today()
    cur_ym = ''
    cur_data: dict[str, int] = {}
    for back in range(1, 6):
        y, m = today.year, today.month - back
        while m <= 0:
            y -= 1
            m += 12
        cand = f'{y - 1911:03d}{m:02d}'
        try:
            got = fetch_month(cand)
            if got:
                cur_ym, cur_data = cand, got
                break
        except Exception:
            continue
    if not cur_data:
        print('提示：暫時無法取得內政部行政區人口統計。')
        return
    prev_ym = f'{int(cur_ym[:3]) - 1:03d}{cur_ym[3:]}'
    prev_data = {}
    try:
        prev_data = fetch_month(prev_ym)
    except Exception:
        pass
    out = {}
    for dist, pop in cur_data.items():
        prev = prev_data.get(dist)
        yoy = round((pop / prev - 1) * 100, 1) if prev else None
        out[dist] = {'period': cur_ym, 'population': pop, 'yoyPct': yoy}
    dest = ROOT / 'data' / 'district-pop.json'
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf-8')
    tmp.replace(dest)
    print(f'已更新 {len(out)} 個行政區人口資料（期別 {cur_ym}）。')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--year', type=int, default=2027, help='檢查並嘗試抓取指定年份假日曆')
    parser.add_argument('--skip-station-info', action='store_true', help='略過車站資訊更新')
    parser.add_argument('--skip-population', action='store_true', help='略過內政部行政區人口更新')
    args = parser.parse_args()

    changed = update_holiday(args.year)
    if changed:
        subprocess.run([sys.executable, '-u', 'tools/build_ref.py'], cwd=ROOT, check=True)
    if not args.skip_population:
        try:
            update_district_population()
        except Exception as error:
            print(f'警告：行政區人口更新失敗（{error}），沿用既有快取。')
    if not args.skip_station_info:
        update_station_info()


if __name__ == '__main__':
    main()
