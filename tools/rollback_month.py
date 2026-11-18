"""從目錄表撤下指定月份（預設保留該月 schema 供除錯，可視需要加上 --drop-schema）。"""
import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))

import od_postgres


def rollback(month: str, drop_schema: bool = False) -> bool:
    try:
        schema = od_postgres.month_schema(month)
    except ValueError:
        raise ValueError(f'月份格式不正確：{month}（應為 YYYY-MM）') from None
    with od_postgres.database() as db:
        existed = od_postgres.month_exists(db, month)
        if not existed:
            print(f'目錄表中沒有 {month}，無需回滾。')
            return False
        db.execute(f'DELETE FROM {od_postgres.CATALOG} WHERE month = %s', (month,))
        if drop_schema:
            db.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        db.commit()
    print(f'已從目錄表撤下 {month}' + ('並刪除對應 schema。' if drop_schema else '（已保留 schema 供查核）。'))
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('month', help='要撤下的月份，格式 YYYY-MM')
    parser.add_argument('--drop-schema', action='store_true', help='同時刪除該月的 PostgreSQL schema')
    args = parser.parse_args()
    rollback(args.month, drop_schema=args.drop_schema)


if __name__ == '__main__':
    main()
