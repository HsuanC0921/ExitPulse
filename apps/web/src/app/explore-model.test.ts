import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amount, baselineIndex2017, change, classifyStationPersonality, computeStationMetrics, diff, exploreErrorMessage, growth, hourlySvgPoints, periodLabel, radialClockPoints, resolveAvailablePeriod, signed, sortNetwork, sortNetworkTable, sortRelationTable, sortRelations, stationRadius, summarizeByLine, maskUncoveredExits, matchingEvents, NETWORK_EVENTS, distanceBands, distanceKm, stationRole, unusualDays, type Relation } from './explore-model.ts';

const rel = (station: string, daily: number | null, compareDaily: number | null, share = 0): Relation => ({ station, daily, share, compareDaily, compareShare: 0 });

test('period labels read as Chinese month averages or a dated weekday', () => {
  assert.equal(periodLabel('2026-09', 'weekday'), '2026 年 9 月平日平均');
  assert.equal(periodLabel('2026-09-15', 'weekday'), '9/15（二）');
});

test('change and growth stay null when a side is missing or zero', () => {
  assert.equal(change(10, null), null);
  assert.equal(change(15, 10), 5);
  assert.equal(growth(5, 0), null);
  assert.equal(growth(15, 10), 50);
});

test('relations sort by daily trips, and by change magnitude with missing values last', () => {
  const rows = [rel('甲', 100, 50), rel('乙', 300, 290), rel('丙', 80, null), rel('丁', 10, 200)];
  assert.deepEqual(sortRelations(rows, 'daily').map(r => r.station), ['乙', '甲', '丙', '丁']);
  assert.deepEqual(sortRelations(rows, 'change').map(r => r.station), ['丁', '甲', '乙', '丙']);
});

test('network sort by growth ignores stations without a baseline', () => {
  const rows = [{ station: 'A', entries: 200, exits: 0, compareEntries: 100 }, { station: 'B', entries: 50, exits: 0, compareEntries: 0 }, { station: 'C', entries: 90, exits: 0, compareEntries: 100 }];
  assert.deepEqual(sortNetwork(rows, 'growth').map(r => r.station), ['A', 'C', 'B']);
});

test('station circles scale by area and hide empty stations', () => {
  assert.equal(stationRadius(0, 100), 0);
  assert.equal(stationRadius(100, 100), 22);
  const quarter = stationRadius(25, 100) - 3, full = stationRadius(100, 100) - 3;
  assert.ok(Math.abs(full / quarter - 2) < 1e-9);
});

test('signed uses a real minus sign', () => {
  assert.equal(signed(-1234), '−1,234');
  assert.equal(signed(5.25, 1), '+5.3');
  assert.equal(signed(null), '—');
});

test('amount speaks in 萬 above ten thousand', () => {
  assert.deepEqual(amount(2255497), { value: '226', unit: '萬人' });
  assert.deepEqual(amount(147035), { value: '14.7', unit: '萬人' });
  assert.deepEqual(amount(3512), { value: '3,512', unit: '人' });
  assert.deepEqual(amount(null), { value: '—', unit: '' });
});

test('diff names direction, size and percent, and refuses unknown baselines', () => {
  assert.deepEqual(diff(110, 100), { dir: 'up', pct: '+10.0%', words: '多 10 人' });
  assert.equal(diff(90, 100)!.dir, 'down');
  assert.equal(diff(100.2, 100)!.dir, 'flat');
  assert.equal(diff(5, 0), null);
  assert.equal(diff(null, 5), null);
});

test('sortNetwork keeps zero entries ahead of unrecorded null stations', () => {
  const rows = [
    { station: '未通車站', entries: null, exits: null },
    { station: '零運量站', entries: 0, exits: 0 },
    { station: '一般站', entries: 120, exits: 100 },
  ];
  assert.deepEqual(sortNetwork(rows, 'entries').map(r => r.station), ['一般站', '零運量站', '未通車站']);
});

test('table sorters compute net flow and always place nulls last', () => {
  const rows = [
    { station: '缺站', entries: null, exits: null },
    { station: '進多', entries: 500, exits: 200 },
    { station: '出多', entries: 100, exits: 350 },
  ];
  assert.deepEqual(sortNetworkTable(rows, 'net', 'desc').map(r => r.station), ['進多', '出多', '缺站']);
  assert.deepEqual(sortNetworkTable(rows, 'net', 'asc').map(r => r.station), ['出多', '進多', '缺站']);
  const rels = [
    { station: '無站', daily: null, share: null },
    { station: '少站', daily: 20, share: 5 },
    { station: '多站', daily: 80, share: 20 },
  ];
  assert.deepEqual(sortRelationTable(rels, 'daily', 'asc').map(r => r.station), ['少站', '多站', '無站']);
});

test('resolveAvailablePeriod explains pre-opening redirect for 新北產業園區 2017-01', () => {
  const months = ['2020-01', '2020-02', '2026-09'];
  const primary = resolveAvailablePeriod('2017-01', months, '2020-01-19', '新北產業園區', false);
  assert.equal(primary.period, '2020-01');
  assert.equal(primary.notice, '新北產業園區在 2017-01 無旅次紀錄，已切換到最早旅次紀錄 2020-01');

  const cmp = resolveAvailablePeriod('2017-01', months, '2020-01-19', '新北產業園區', true);
  assert.equal(cmp.period, '2020-01');
  assert.equal(cmp.notice, '對照期 2017-01 新北產業園區無旅次紀錄，已切換到最早旅次紀錄 2020-01');

  const earlyDate = resolveAvailablePeriod('2020-01-02', months, '2020-01-19', '新北產業園區', false);
  assert.equal(earlyDate.period, '2020-01-19');
  assert.equal(earlyDate.dayType, 'weekend');
  assert.equal(earlyDate.notice, '新北產業園區在 2020-01-02 無旅次紀錄，已切換到最早旅次紀錄 2020-01-19');
});

test('computeStationMetrics and classifyStationPersonality identify peak share and commuter profile', () => {
  const morningHome = Array.from({ length: 24 }, (_, h) => (h >= 7 && h < 10 ? 150 : 25));
  const morningExits = Array.from({ length: 24 }, (_, h) => (h >= 17 && h < 20 ? 150 : 25));
  const m = computeStationMetrics(825, 825, morningHome);
  assert.equal(m.peakHour, 7);
  assert.ok(m.peakSharePct! > 15);
  assert.equal(m.ioRatio, 1);
  assert.match(classifyStationPersonality(morningHome, morningExits)?.tag ?? '', /^尖峰通勤傾向 \d+%$/);
});

test('baselineIndex2017 computes recovery index against 2017-2019 same-month average', () => {
  const series = [
    { month: '2017-09', entries: 90 },
    { month: '2018-09', entries: 100 },
    { month: '2019-09', entries: 110 },
    { month: '2026-09', entries: 120 },
  ];
  assert.deepEqual(baselineIndex2017(series, '2026-09'), { index: 120, baseYears: 3 });
  assert.equal(baselineIndex2017([{ month: '2020-09', entries: 50 }, { month: '2026-09', entries: 80 }], '2026-09'), null);
});

test('hourlySvgPoints skips nulls and scales within bounds', () => {
  const pts = hourlySvgPoints([0, null, 100], 100, 200, 60);
  assert.equal(pts, '0.0,57.0 200.0,3.0');
});

const lineMemberships = (dates: Record<string, Record<string, string>>) => (station: string) =>
  Object.entries(dates).flatMap(([code, members]) => members[station] ? [{ code, opened: members[station] }] : []);

test('summarizeByLine aggregates station entries per metro line and ranks busiest first', () => {
  const rows = [
    { station: '台北車站', entries: 100, exits: 100, compareEntries: 80, compareExits: 80 },
    { station: '市政府', entries: 50, exits: 50, compareEntries: 40, compareExits: 40 },
    { station: '空站', entries: null, exits: null },
  ];
  const openings = { BL: { 台北車站: '1999-12-24', 市政府: '1999-12-24', 空站: '1999-12-24' },
    R: { 台北車站: '1997-12-25' } };
  const res = summarizeByLine(rows, lineMemberships(openings), { BL: '板南線', R: '淡水信義線' }, '2026-09', '2025-09');
  assert.equal(res.length, 2);
  assert.equal(res[0].code, 'BL');
  assert.equal(res[0].entries, 150);
  assert.equal(res[0].compareEntries, 120);
  assert.equal(res[1].code, 'R');
  assert.equal(res[1].entries, 100);
});

test('line summaries retain compare-only stations and distinguish missing periods from zero', () => {
  const rows = [
    { station: '板橋', entries: null, exits: null, compareEntries: 8 },
    { station: '西門', entries: 0, exits: 0, compareEntries: null },
    { station: '市政府', entries: null, exits: null, compareEntries: 2 },
  ];
  const dates = { BL: { 板橋: '2006-05-31', 西門: '1999-12-24' }, G: { 市政府: '2014-11-15' } };
  const [blue, green] = summarizeByLine(rows, lineMemberships(dates), {}, '2026-09', '2025-09');
  assert.deepEqual([blue.entries, blue.compareEntries, blue.stationCount], [0, 8, 2]);
  assert.deepEqual([green.entries, green.compareEntries, green.stationCount, green.unopened], [null, 2, 1, false]);
});

test('transfer station entries only join lines already open in the queried period', () => {
  const rows = [{ station: '板橋', entries: 30, exits: 0, compareEntries: 10 }];
  const dates = { BL: { 板橋: '2006-05-31' }, Y: { 板橋: '2020-01-31' } };
  const [, yellow] = summarizeByLine(rows, lineMemberships(dates), {}, '2020-01-30', '2020-01-31');
  assert.deepEqual([yellow.entries, yellow.compareEntries, yellow.unopened, yellow.compareUnopened], [null, 10, true, false]);
  const [, openingMonth] = summarizeByLine(rows, lineMemberships(dates), {}, '2020-01', '2019-12');
  assert.deepEqual([openingMonth.entries, openingMonth.compareEntries, openingMonth.unopened, openingMonth.partial, openingMonth.compareUnopened],
    [null, null, false, true, true]);
});

test('exploreErrorMessage prefers server error string and falls back cleanly', () => {
  assert.equal(exploreErrorMessage(422, '這一站在所選期間沒有旅次紀錄，請改選其他月份或車站。'), '這一站在所選期間沒有旅次紀錄，請改選其他月份或車站。');
  assert.equal(exploreErrorMessage(422, '   '), '這個時段無法比較');
  assert.equal(exploreErrorMessage(422, null), '這個時段無法比較');
  assert.equal(exploreErrorMessage(500, undefined), '旅次查詢失敗');
});

test('radialClockPoints separates null unrecorded hours from real zero', () => {
  assert.equal(radialClockPoints(Array(24).fill(null), Array(24).fill(null)), null);
  const allZero = radialClockPoints(Array(24).fill(0), Array(24).fill(0), 100, 100, 20, 80)!;
  assert.equal(allZero.peak, 0);
  assert.equal(allZero.missingHours.length, 0);
  assert.equal(allZero.entriesPaths.length, 1);

  const entries: (number | null)[] = Array(24).fill(0);
  const exits: (number | null)[] = Array(24).fill(0);
  entries[0] = 100;
  exits[6] = 50;
  entries[3] = null;
  const withNull = radialClockPoints(entries, exits, 100, 100, 20, 80)!;
  assert.equal(withNull.peak, 100);
  assert.deepEqual(withNull.missingHours.map(m => m.h), [3]);
  assert.equal(withNull.entriesPaths.length, 1);
  assert.equal(withNull.entriesPaths[0].includes('100.0,20.0'), true);
  assert.notEqual(withNull.entriesPaths[0], allZero.entriesPaths[0]);
});

test('unusualDays compares each day with its own day type and skips small samples and makeup days', () => {
  const day = (date: string, entries: number | null, weekend = false, holiday = false, note: string | null = null) => ({ date, weekend, holiday, note, entries });
  const marks = unusualDays([
    day('2026-09-01', 100), day('2026-09-02', 100), day('2026-09-03', 100), day('2026-09-04', 145), day('2026-09-07', 79),
    day('2026-09-08', null), day('2026-09-05', 500, true), day('2026-09-06', 50, true), day('2026-09-12', 300, true, false, '補行上班'),
  ]);
  assert.deepEqual(marks.map(m => m.mark), [null, null, null, 'surge', 'low', null, null, null, null]);
  assert.equal(marks[5].ratio, null);
  assert.deepEqual(unusualDays([day('2026-09-01', 100), day('2026-09-02', 999)]).map(m => m.mark), [null, null]);
  assert.deepEqual(unusualDays([]), []);
});

test('stationRole explains itself and refuses thin data', () => {
  const base = { amEntries: 1000, amExits: 400, pmEntries: 300, pmExits: 900, weekdayDaily: 10000, weekendDaily: 6000, lines: 1 };
  const home = stationRole(base)!;
  assert.equal(home.role, '通勤住宅');
  assert.match(home.reasons[0], /2\.5 倍/);
  assert.match(home.reasons[1], /60%/);
  assert.equal(stationRole({ ...base, amEntries: 400, amExits: 1000, pmEntries: 900, pmExits: 300 })!.role, '就業學區');
  assert.equal(stationRole({ ...base, amEntries: 500, amExits: 500, pmEntries: 500, pmExits: 500, weekendDaily: 9000 })!.role, '休閒商圈');
  assert.equal(stationRole({ ...base, lines: 3 })!.role, '轉乘樞紐');
  assert.equal(stationRole({ ...base, amEntries: 500, amExits: 500, pmEntries: 500, pmExits: 500, weekendDaily: null })!.role, '混合');
  assert.equal(stationRole({ ...base, amExits: 0 }), null);
  assert.equal(stationRole({ ...base, amEntries: 1300, amExits: 1000, pmEntries: 1000, pmExits: 1300 })!.role, '通勤住宅');
});

test('distanceBands splits riders by straight-line distance and counts unknowns apart', () => {
  const coords: Record<string, [number, number]> = { A: [121.5, 25.0], near: [121.51, 25.0], mid: [121.55, 25.0], far: [121.6, 25.05] };
  const r = distanceBands(coords['A'], [rel('near', 100, null), rel('mid', 300, null), rel('far', 600, null), rel('ghost', 50, null), rel('A', null, null)], s => coords[s] ?? null)!;
  assert.deepEqual(r.bands.map(b => b.daily), [100, 300, 600]);
  assert.deepEqual(r.bands.map(b => Math.round(b.share)), [10, 30, 60]);
  assert.equal(r.unknown, 2);
  assert.ok(r.averageKm > 5 && r.averageKm < 10);
  assert.equal(distanceBands(null, [], () => null), null);
  assert.equal(distanceBands(coords['A'], [rel('ghost', 5, null)], () => null), null);
  assert.ok(Math.abs(distanceKm([121.5, 25], [121.5, 25.027]) - 3) < 0.01);
});

test('maskUncoveredExits blanks only the side whose exits the data never covered', () => {
  const rows = [
    { station: '幸福', entries: 2410, exits: 0, exitCovered: false, compareEntries: 2000, compareExits: 50, compareExitCovered: true },
    { station: '台北車站', entries: 100, exits: 90, exitCovered: true },
    { station: '舊版', entries: 5, exits: 0 },
  ];
  const [a, b, c] = maskUncoveredExits(rows);
  assert.deepEqual([a.exits, a.compareExits], [null, 50]);
  assert.equal(b, rows[1]);
  assert.equal(c, rows[2]);
});

test('matchingEvents matches month or day and filters station-specific milestones', () => {
  assert.ok(NETWORK_EVENTS.length >= 6);
  const domeEvents = matchingEvents('2024-12', '國父紀念館').map(e => e.label);
  assert.equal(domeEvents.includes('臺北大巨蛋首場大型演唱會'), true);
  assert.equal(domeEvents.includes('環狀線全線復駛'), true);

  const ximenEvents = matchingEvents('2024-12', '西門').map(e => e.label);
  assert.equal(ximenEvents.includes('臺北大巨蛋首場大型演唱會'), false);
  assert.equal(ximenEvents.includes('環狀線全線復駛'), true);

  const exactDay = matchingEvents('2023-12-02', '國父紀念館');
  assert.equal(exactDay.length, 1);
  assert.match(exactDay[0].label, /大巨蛋/);
});
