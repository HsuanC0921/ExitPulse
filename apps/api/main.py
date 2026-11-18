"""ExitPulse API（FastAPI）。路由、參數驗證與錯誤對應都在這裡，分析交給 runner.py。

在專案根目錄啟動：uvicorn main:app --app-dir apps/api --host 127.0.0.1 --port 5011
"""
import json
import logging
from contextlib import asynccontextmanager
from datetime import date as Date
from typing import Annotated

import httpx
from fastapi import APIRouter, FastAPI, Query
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import AfterValidator

from places import PlaceSearch, TooMany, UpstreamLimited, local_matches
from runner import Busy, Runner, Unavailable

log = logging.getLogger('exitpulse.api')
runner, places = Runner(), PlaceSearch()
CHANGE_TYPES = ('all', 'increase', 'decrease', 'reversal')
DAY_TYPES = ('weekday', 'workday', 'weekend', 'all')
# 站名在入口去掉前後空白，「台北車站 」才不會被當成另一站
Name = Annotated[str, AfterValidator(str.strip)]


# 關閉時一併結束分析行程
@asynccontextmanager
async def lifespan(_):
    yield
    runner.close()


app = FastAPI(title='ExitPulse API', lifespan=lifespan, docs_url='/docs', redoc_url=None)
# 站對排行的回應約 240 KB，壓縮後可省下大部分傳輸量
app.add_middleware(GZipMiddleware, minimum_size=1024)
api = APIRouter(prefix='/api/v1')


# 錯誤回應統一為 {"error": 訊息}，前端直接顯示
def bad(message, status=400):
    return JSONResponse({'error': message}, status_code=status)


# 缺少或格式不對的參數一律回 400，沿用舊 API 的行為
@app.exception_handler(RequestValidationError)
async def invalid_request(_request, _error):
    return bad('請選擇有效的查詢條件。')


# 月份格式 YYYY-MM
def is_month(value):
    try:
        return len(value) == 7 and bool(Date.fromisoformat(value + '-01'))
    except ValueError:
        return False


# 日期格式 YYYY-MM-DD
def is_date(value):
    try:
        return len(value) == 10 and bool(Date.fromisoformat(value))
    except ValueError:
        return False


# 期間可以是整月或單日
def is_period(value):
    return is_month(value) or is_date(value)


# 站名長度限制 1 至 20 字
def is_name(value):
    return value is not None and bool(value.strip()) and len(value) <= 20


# 整數不帶小數點，讓快取鍵與命令列參數穩定
def number(value):
    return str(int(value)) if value == int(value) else str(value)


async def analyse(script, arguments):
    """把分析行程的結束碼對應成前端預期的 HTTP 回應。"""
    try:
        reply = await runner.run(script, arguments)
    except Busy:
        return bad('旅次查詢忙碌中，請稍後重試。', 429)
    except Unavailable:
        return bad('旅次資料暫時無法載入。', 504)
    code = reply['exitCode']
    if code == 0:
        return Response(reply['output'], media_type='application/json; charset=utf-8')
    log.warning('OD analysis failed (%s): %s', code, reply['error'])
    if code == 2:
        # 查詢的車站在所選期間沒有紀錄（例如尚未通車），訊息要講清楚，不要和時段無法比較混在一起
        if ': not in ' in reply['error']:
            return bad('這一站在所選期間沒有旅次紀錄，請改選其他月份或車站。', 422)
        return bad('這組資料的時段或涵蓋範圍無法比較，請改選其他條件。', 422)
    if code == 3:
        return bad('所選月份尚未匯入。', 404)
    if code == 4:
        return JSONResponse({'code': 'unrecorded_hours', 'error': '這個時段沒有旅次紀錄。'}, status_code=422)
    if code == 5:
        return Response(reply['output'], media_type='application/json; charset=utf-8', status_code=422)
    return bad('旅次資料暫時無法載入。', 503)


# 單站、全網、矩陣共用的期間參數驗證與組裝
async def period_query(arguments, period, compare, days, start, end, script='query_od.py'):
    days = days or 'weekday'
    start, end = 0 if start is None else start, 24 if end is None else end
    if (not is_period(period) or (compare is not None and (not is_period(compare) or compare == period))
            or days not in DAY_TYPES or start < 0 or end > 24 or start >= end):
        return bad('請選擇有效的月份或日期、日期類型與時段。')
    arguments += ['--period', period, '--days', days, '--start', str(start), '--end', str(end)]
    if compare is not None:
        arguments += ['--compare', compare]
    return await analyse(script, arguments)


# 健康檢查，不在 /api/v1 底下
@app.get('/health')
def health():
    return {'status': 'ok'}


# 就緒檢查：讀得到 exitpulse_catalog 的月份目錄才算資料庫可用，否則回 503 讓反向代理暫停導流
@app.get('/ready')
async def ready():
    try:
        reply = await runner.run('od_postgres.py', [])
    except Busy:
        # 分析行程全滿代表正在服務查詢，不把忙碌當成故障
        return {'status': 'busy'}
    except Unavailable:
        return bad('資料庫尚未就緒。', 503)
    if reply['exitCode'] != 0:
        return bad('資料庫尚未就緒。', 503)
    return {'status': 'ready'}


# 目錄類查詢：已匯入月份、各站可用日期、查詢目錄
@api.get('/od/months')
async def months():
    return await analyse('od_postgres.py', [])


@api.get('/od/availability')
async def availability():
    return await analyse('od_postgres.py', ['availability'])


@api.get('/od/catalog')
async def catalog():
    return await analyse('od_postgres.py', ['catalog'])


# 車站資訊：站碼、通車日、景點、出口
@api.get('/od/station-info')
async def station_info(name: Name, period: str | None = None):
    if not is_name(name) or (period is not None and not is_period(period)):
        return bad('請選擇車站。')
    return await analyse('station_info.py', [name] if period is None else [name, period])


# 地點搜尋：轉送 Photon，限速並快取
@api.get('/map/places')
async def map_places(q: str):
    if not 2 <= len(q.strip()) <= 80:
        return bad('請輸入地名或地點名稱。')
    try:
        return await places.find(q)
    except TooMany:
        return Response(status_code=429)
    except UpstreamLimited:
        return local_matches(q) or bad('地點搜尋的來源暫時限流，請稍等一會兒再試，或直接輸入捷運站名。', 429)
    except (httpx.HTTPError, ValueError, KeyError) as error:
        log.warning('Place lookup unavailable: %s', type(error).__name__)
        return local_matches(q) or bad('地點搜尋暫時連線不穩，建議改直接輸入捷運站名。', 503)


# 站對排行，帶 origin 與 destination 時只查單一站對
@api.get('/od/radar')
async def radar(baseline: str, current: str, start: int, end: int, weekend: bool, minimum: float | None = None,
                type: str | None = None, origin: Name | None = None, destination: Name | None = None):
    floor, type = 20 if minimum is None else minimum, type or 'all'
    if (not is_month(baseline) or not is_month(current) or baseline == current or start < 0 or end > 24
            or start >= end or not 0 <= floor <= 10000 or type not in CHANGE_TYPES):
        return bad('請選擇不同月份、有效的進站時段與門檻。')
    arguments = [baseline, current, '--start', str(start), '--end', str(end), '--minimum', number(floor),
                 '--type', type, '--limit', '500']
    if origin is not None or destination is not None:
        if not is_name(origin) or not is_name(destination) or origin == destination:
            return bad('請選兩個不同的車站。')
        arguments += ['--direct', origin, destination]
    if weekend:
        arguments.append('--weekend')
    return flag_truncated(await analyse('analyze_od.py', arguments))


# 結果超過回傳上限時標記 truncated，讓前端提示只顯示前 500 筆
def flag_truncated(reply):
    if reply.status_code != 200:
        return reply
    try:
        body = json.loads(reply.body)
        body['truncated'] = body.get('total', 0) > len(body.get('results', []))
    except (ValueError, AttributeError, TypeError):
        return reply
    return Response(json.dumps(body, ensure_ascii=False), media_type='application/json; charset=utf-8')


# 單一站對的兩期比較
@api.get('/od/pair')
async def pair(baseline: str, current: str, origin: Name, destination: Name, weekend: bool):
    if not is_month(baseline) or not is_month(current) or not is_name(origin) or not is_name(destination) or origin == destination:
        return bad('請選擇有效的月份與兩個不同車站。')
    arguments = [baseline, current, '--pair', origin, destination]
    if weekend:
        arguments.append('--weekend')
    return await analyse('analyze_od.py', arguments)


# 單站往來
@api.get('/od/station')
async def station(name: Name, period: str, compare: str | None = None, days: str | None = None,
                  start: int | None = None, end: int | None = None):
    if not is_name(name):
        return bad('請選擇車站。')
    return await period_query(['station', name, '--limit', '200'], period, compare, days, start, end)


# 全網進站量，hourly 為逐時
@api.get('/od/network')
async def network(period: str, compare: str | None = None, days: str | None = None, start: int | None = None,
                  end: int | None = None, hourly: bool | None = None):
    return await period_query(['network', '--hourly'] if hourly else ['network'], period, compare, days, start, end)


# 起訖矩陣
@api.get('/od/matrix')
async def matrix(period: str, days: str | None = None, start: int | None = None, end: int | None = None,
                 limit: int | None = None):
    if limit is not None and not 2 <= limit <= 20:
        return bad('請選擇有效的站數。')
    return await period_query(['matrix', '--limit', str(limit or 12)], period, None, days, start, end)


@api.get('/od/group-flow')
async def group_flow(origin: Annotated[list[Name], Query(min_length=1, max_length=128)],
                     destination: Annotated[list[Name], Query(min_length=1, max_length=128)],
                     period: str, compare: str | None = None, days: str | None = None,
                     start: int | None = None, end: int | None = None):
    if not all(map(is_name, origin + destination)):
        return bad('請選擇有效的起站與訖站群組。')
    arguments = ['group-flow', *(f'--origin={name}' for name in sorted(set(origin))),
                 *(f'--destination={name}' for name in sorted(set(destination)))]
    return await period_query(arguments, period, compare, days, start, end)


# 榜單：最忙的站與站對，帶 compare 時另有成長與衰退最多的站
@api.get('/od/leaders')
async def leaders(period: str, compare: str | None = None, days: str | None = None, start: int | None = None,
                  end: int | None = None, limit: int | None = None):
    if limit is not None and not 1 <= limit <= 20:
        return bad('請選擇有效的筆數。')
    return await period_query(['--limit', str(limit or 10)], period, compare, days, start, end, 'leaders.py')


# 跨月趨勢
@api.get('/od/trend')
async def trend(name: Name | None = None, days: str | None = None):
    days = days or 'weekday'
    if (name is not None and not is_name(name)) or days not in DAY_TYPES:
        return bad('請選擇有效的車站與日期類型。')
    return await analyse('query_od.py', ['trend'] + ([name] if name else []) + ['--days', days])


# 單月行事曆
@api.get('/od/calendar')
async def calendar(month: str, name: Name | None = None):
    if not is_month(month) or (name is not None and not is_name(name)):
        return bad('請選擇有效的月份。')
    return await analyse('query_od.py', ['calendar', month] + ([name] if name else []))


# 兩站在某一天的逐時人次
@api.get('/od/relation-hours')
async def relation_hours(origin: Name, destination: Name, date: str):
    if not is_name(origin) or not is_name(destination) or origin == destination or not is_date(date):
        return bad('請選擇有效日期與兩個不同車站。')
    return await analyse('query_od.py', ['relation-hours', origin, destination, date])


app.include_router(api)
