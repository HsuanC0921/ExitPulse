import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStationHistory, openingTenure } from './station-history-model.ts';

test('station history only includes dated milestones with a source and sorts them chronologically', () => {
  const events = buildStationHistory(
    { date: '1999-12-24', source: '/opening' },
    [
      { code: 'G', name: '松山新店線', stationCode: 'G12', opened: '2014-11-15', source: '/transfer' },
      { code: 'R', name: '淡水信義線', stationCode: 'R10', opened: '1997-03-28' },
      { code: 'BL', name: '板南線', stationCode: 'BL12', opened: '1999-12-24', source: '/same-opening' },
    ],
    [{ name: '科技大樓2號出口', code: '2', history: { opened: '2026-06-08', source: '/exit' } }],
  );

  assert.deepEqual(events.map(event => [event.date, event.kind]), [
    ['1999-12-24', 'opening'],
    ['2014-11-15', 'transfer'],
    ['2026-06-08', 'entrance'],
  ]);
  assert.deepEqual(events.map(event => event.source), ['/opening', '/transfer', '/exit']);
});

test('closed and reopened entrances use the source attached to each dated event', () => {
  const events = buildStationHistory(null, [], [{
    name: '中山1號出口', code: '1',
    history: { closed: '2023-02-20', reopened: '2025-05-31', source: '/reopen', closureSource: '/closure' },
  }]);

  assert.deepEqual(events.map(event => [event.title, event.source]), [
    ['1 號出口封閉', '/closure'],
    ['1 號出口重開', '/reopen'],
  ]);
});

test('openingTenure calculates operating years and enriches post-opening milestones when stationName is provided', () => {
  assert.deepEqual(openingTenure('1999-12-24', 2026), { year: 1999, years: 27 });
  assert.equal(openingTenure(null), null);

  const domeEvents = buildStationHistory({ date: '1999-12-24', source: '/opening' }, [], [], '國父紀念館');
  assert.ok(domeEvents.some(e => e.kind === 'milestone' && e.date === '2023-12-02' && e.title.includes('大巨蛋')));
  assert.ok(domeEvents.some(e => e.kind === 'milestone' && e.date === '2023-07-01'));

  const newerEvents = buildStationHistory({ date: '2022-01-01', source: '/opening' }, [], [], '新測試站');
  assert.ok(!newerEvents.some(e => e.date === '2021-05-19'), 'pre-opening network milestones must be excluded');
});
