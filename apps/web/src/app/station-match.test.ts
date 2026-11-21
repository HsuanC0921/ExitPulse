import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStationKey, resolveStationInput } from './station-match.ts';

const STATIONS = ['南港', '南港軟體園區', '南港展覽館', '台北車站', '台北小巨蛋', '西門', '市政府', '淡水'];
const CODES: Record<string, Record<string, string>> = {
  BL: { '台北車站': 'BL12', '西門': 'BL11', '市政府': 'BL18', '南港': 'BL22', '南港展覽館': 'BL23' },
  R: { '台北車站': 'R10', '淡水': 'R28' },
  G: { '西門': 'G12', '台北小巨蛋': 'G17' },
  BR: { '南港軟體園區': 'BR23', '南港展覽館': 'BR24' },
};

test('normalizeStationKey folds full-width, casing, spaces, and 臺/台', () => {
  assert.equal(normalizeStationKey('  臺北車站 '), '台北車站');
  assert.equal(normalizeStationKey('ＢＬ１２'), 'bl12');
});

test('resolveStationInput returns exact station name immediately even when prefix matches others', () => {
  const res = resolveStationInput('南港', STATIONS, CODES);
  assert.equal(res.match, '南港');
  assert.deepEqual(res.candidates, ['南港']);
});

test('resolveStationInput matches exact station code case-insensitively and with 臺/台 normalization', () => {
  assert.equal(resolveStationInput('bl12', STATIONS, CODES).match, '台北車站');
  assert.equal(resolveStationInput('R10', STATIONS, CODES).match, '台北車站');
  assert.equal(resolveStationInput('臺北小巨蛋', STATIONS, CODES).match, '台北小巨蛋');
});

test('resolveStationInput resolves unique partial prefix or substring without guessing among multiple matches', () => {
  const unique = resolveStationInput('台北車', STATIONS, CODES);
  assert.equal(unique.match, '台北車站');
  assert.deepEqual(unique.candidates, ['台北車站']);

  const multi = resolveStationInput('台北', STATIONS, CODES);
  assert.equal(multi.match, null);
  assert.deepEqual(multi.candidates, ['台北車站', '台北小巨蛋']);
});

test('resolveStationInput ranks prefix matches before inner substring matches and handles missing input', () => {
  const res = resolveStationInput('展覽館', STATIONS, CODES);
  assert.equal(res.match, '南港展覽館');

  const partialCode = resolveStationInput('BL2', STATIONS, CODES);
  assert.equal(partialCode.match, null);
  assert.deepEqual(partialCode.candidates, ['南港', '南港展覽館']);

  const none = resolveStationInput('不存在的站', STATIONS, CODES);
  assert.equal(none.match, null);
  assert.deepEqual(none.candidates, []);

  assert.deepEqual(resolveStationInput('   ', STATIONS, CODES), { match: null, candidates: [] });
});
