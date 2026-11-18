import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStationHistory } from './station-history-model.ts';

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
