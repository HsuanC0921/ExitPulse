import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrowCount, filterResults, formatDailyTrips, glue, lineWidth, readState, sortResults, csvTable, writeState, type Result, type ViewState } from './radar-model.ts';
import { daylightAt, solarTimes } from './daylight.ts';

const row = (origin: string, destination: string, baselineDaily: number, currentDaily: number, deltaSharePp: number): Result => ({
  origin, destination, baselineTrips: 0, currentTrips: 0, baselineOriginTotal: 1, currentOriginTotal: 1, baselineDaily, currentDaily, deltaSharePp,
  growth: baselineDaily ? currentDaily / baselineDaily - 1 : null, reverseBaseline: 0, reverseCurrent: 0, directionBaseline: null, directionCurrent: null, reversal: false, score: 0,
});
const rows = [row('西門', '台北車站', 295, 682, 3.1), row('雙連', '台北車站', 205, 334, 3.2), row('中山國中', '西湖', 304, 258, -2.6), row('新站', '南港', 0, 40, 1)];

test('share sort uses the shown value, largest magnitude first', () => {
  assert.deepEqual(sortResults(rows, 'share').map(r => r.deltaSharePp), [3.2, 3.1, -2.6, 1]);
});

test('daily sort ranks absolute change in trips', () => {
  assert.deepEqual(sortResults(rows, 'daily').map(r => r.origin), ['西門', '雙連', '中山國中', '新站']);
});

test('growth sort puts pairs with no baseline first', () => {
  assert.equal(sortResults(rows, 'growth')[0].origin, '新站');
});

test('volume sort is by current trips, not magnitude of change', () => {
  assert.deepEqual(sortResults(rows, 'volume').map(r => r.currentDaily), [682, 334, 258, 40]);
});

test('filter matches either station, treats 臺 as 台, and by line', () => {
  const lines = (s: string) => s === '西湖' ? ['BR'] : ['R'];
  assert.equal(filterResults(rows, '臺北', '', lines).length, 2);
  assert.deepEqual(filterResults(rows, '', 'BR', lines).map(r => r.destination), ['西湖']);
  assert.equal(filterResults(rows, ' ', '', lines).length, 4);
});

test('every flow is a stream of arrows and busier flows are denser', () => {
  assert.deepEqual([0, 100, 771, 1594, 3000, 10000, 30000, 1e6].map(arrowCount), [0, 4, 6, 8, 10, 12, 14, 14]);
});

test('line width distinguishes busy flows on the same scale', () => {
  assert.equal(lineWidth(0), 0);
  assert.ok(lineWidth(1594) > lineWidth(771));
  assert.ok(lineWidth(30000) > lineWidth(10000) + 3);
});

test('a small daily average is distinguishable from zero', () => {
  assert.deepEqual([0, .045, .45, 1.6, 1594.4].map(formatDailyTrips), ['0', '<0.1', '0.5', '1.6', '1,594']);
});

test('Taipei evenings move with the season and midnight remains dark', () => {
  const summer = '2026-06-21', winter = '2025-12-21';
  assert.ok(solarTimes(summer).sunset - solarTimes(winter).sunset > 90);
  assert.equal(daylightAt(12, winter)?.label, '白天');
  assert.equal(daylightAt(17, winter)?.label, '傍晚');
  assert.equal(daylightAt(17, summer)?.label, '白天');
  assert.equal(daylightAt(23, summer)?.label, '夜間');
});

test('glue keeps a figure with its unit', () => {
  assert.equal(glue('每天 796 人增加到 1,162 人，多了 46%。'), '每天 796 人增加到 1,162 人，多了 46%。');
});

test('csv table keeps a missing growth rate null and carries the denominators', () => {
  const { head, rows: table } = csvTable([rows[3], { ...rows[0], origin: '甲,乙' }]);
  assert.deepEqual(head.slice(0, 8), ['起站', '迄站', '基準每日人次', '比較每日人次', '比例變化（百分點）', '成長率（%）', '方向反轉', '基準原始人次']);
  assert.deepEqual(table[0].slice(0, 7), ['新站', '南港', 0, 40, 1, null, '']);
  assert.equal(table[1][0], '甲,乙');
  assert.equal(table[0].length, head.length);
});

test('url state round-trips and rejects values the UI cannot show', () => {
  const defaults: ViewState = { baseline: '2022-09', current: '2026-09', hours: '7-10', weekend: false, type: 'all', minimum: 20, sort: 'share', q: '', line: '', pair: '' };
  const state: ViewState = { ...defaults, hours: '16-19', weekend: true, sort: 'volume', q: '台北', line: 'BR', pair: '雙連>台北車站' };
  assert.deepEqual(readState(writeState(state), defaults), state);
  assert.deepEqual(readState('?h=3-4&m=7&s=bogus&l=Z&b=x', defaults), defaults);
  for (const p of ['a>b>c', '>b', 'a>', 'a>a', '>', '台'.repeat(21) + '>b']) assert.equal(readState('?p=' + encodeURIComponent(p), defaults).pair, defaults.pair, p);
  assert.equal(readState('?p=' + encodeURIComponent('台北車站>西門'), defaults).pair, '台北車站>西門');
  const wdDefaults: ViewState = { ...defaults, days: 'weekday' };
  const wdState: ViewState = { ...wdDefaults, days: 'workday', weekend: false };
  assert.deepEqual(readState(writeState(wdState), wdDefaults), wdState);
  assert.equal(readState('?w=1', wdDefaults).days, 'weekend');
});
