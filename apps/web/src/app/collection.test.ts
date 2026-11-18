import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLLECTION_KEY, COLLECTION_LIMIT, cleanItem, decodeLink, encodeLink, loadCollection, mergeItems, newItem, parseExport, saveCollection, serializeExport, type CollectionItem } from './collection.ts';

const memory = (seed: Record<string, string> = {}) => {
  const data = new Map(Object.entries(seed));
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};
const item = (query: string, kind: CollectionItem['kind'] = 'station', name = query): CollectionItem =>
  ({ id: query.replace(/\W/g, '') || 'x', kind, name, query, savedAt: '2026-11-19' });

test('only same-site query strings are accepted, so a crafted file cannot redirect the page', () => {
  for (const query of ['https://evil.example/?v=station', '//evil.example', '/admin?v=1', 'javascript:alert(1)', '?a=1#x', '?a b', '?' + 'a'.repeat(601), '']) {
    assert.equal(cleanItem({ kind: 'station', name: 'x', query }), null, query);
  }
  assert.ok(cleanItem({ kind: 'network', name: 'x', query: '?v=network&pe=2026-09' }));
});

test('kinds, names, ids and dates are normalised', () => {
  assert.equal(cleanItem({ kind: 'admin', query: '?a=1' }), null);
  assert.equal(cleanItem(null), null);
  assert.equal(cleanItem('?a=1'), null);
  const long = cleanItem({ kind: 'pair', name: '  很長\n\n的名字 '.repeat(20), query: '?p=a%3Eb', id: '<img onerror=x>', savedAt: 'yesterday' })!;
  assert.equal(long.name.length, 60);
  assert.ok(!long.name.includes('\n'));
  assert.match(long.id, /^[\w-]+$/);
  assert.equal(long.savedAt, '');
  assert.equal(cleanItem({ kind: 'pair', name: '   ', query: '?p=a%3Eb' })!.name, '未命名收藏');
  assert.equal(cleanItem({ mode: 'station', name: 'old', query: '?v=station' })!.kind, 'station');
});

test('merge skips duplicates, re-ids clashes, puts new first and reports what fell off', () => {
  const a = item('?a=1'), b = item('?b=1');
  const r = mergeItems([a], [item('?a=1'), { ...b, id: a.id }, b]);
  assert.equal(r.added, 1);
  assert.deepEqual(r.items.map(i => i.query), ['?b=1', '?a=1']);
  assert.notEqual(r.items[0].id, a.id);
  assert.equal(mergeItems([item('?a=1', 'station')], [item('?a=1', 'network')]).added, 1);
  const many = Array.from({ length: COLLECTION_LIMIT }, (_, i) => item(`?n=${i}`));
  const full = mergeItems(many, [item('?new=1'), item('?new=2')]);
  assert.equal(full.items.length, COLLECTION_LIMIT);
  assert.equal(full.dropped, 2);
  assert.equal(full.items[0].query, '?new=1');
});

test('export files round-trip and old explore arrays still import', () => {
  const items = [item('?v=station&st=%E8%A5%BF%E9%96%80', 'station', '西門')];
  assert.deepEqual(parseExport(serializeExport(items)), items);
  assert.equal(parseExport(JSON.stringify([{ id: 'a', name: '舊', query: '?v=network', mode: 'network', savedAt: '2026-01-01' }]))[0].kind, 'network');
});

test('broken, foreign or empty files give a readable message', () => {
  assert.throws(() => parseExport('{oops'), /不是這裡匯出/);
  assert.throws(() => parseExport('{"app":"Other","items":[]}'), /不是這裡匯出/);
  assert.throws(() => parseExport('{"app":"ExitPulse","items":"x"}'), /不是這裡匯出/);
  assert.throws(() => parseExport('{"app":"ExitPulse","items":[{"kind":"station","query":"https://x"}]}'), /沒有收藏/);
  assert.throws(() => parseExport('null'), /不是這裡匯出/);
});

test('collection links survive Chinese names and reject tampering', () => {
  const items = [item('?p=%E5%8F%B0%E5%8C%97%E8%BB%8A%E7%AB%99%3E%E8%A5%BF%E9%96%80', 'pair', '台北車站 → 西門 😀')];
  const link = encodeLink(items);
  assert.match(link, /^#collection=[\w-]+$/);
  const back = decodeLink(link);
  assert.equal(back[0].name, '台北車站 → 西門 😀');
  assert.equal(back[0].query, items[0].query);
  for (const bad of ['#collection=!!!', '#collection=', '#other=abc', '#collection=' + btoa('{"x":1}'), '#collection=' + btoa('[["station","x","https://evil"]]')]) {
    assert.deepEqual(decodeLink(bad), [], bad);
  }
});

test('first load migrates old saved views and starred pairs, keeping the old keys', () => {
  const store = memory({
    'exitpulse.saved.v1': JSON.stringify([{ id: 'v1', name: '西門平日', query: '?v=station&st=%E8%A5%BF%E9%96%80', mode: 'station', savedAt: '2026-10-01' }]),
    'exitpulse.favPairs.v1': JSON.stringify([{ origin: '台北車站', destination: '西門' }, { origin: 'A', destination: 'A' }, 'junk']),
  });
  const items = loadCollection(store);
  assert.deepEqual(items.map(i => i.kind).sort(), ['pair', 'station']);
  const pair = items.find(i => i.kind === 'pair')!;
  assert.equal(new URLSearchParams(pair.query).get('p'), '台北車站>西門');
  assert.ok(store.data.has('exitpulse.saved.v1'));
});

test('corrupt storage loads as empty and an existing collection wins over old keys', () => {
  assert.deepEqual(loadCollection(memory({ [COLLECTION_KEY]: '{broken', 'exitpulse.saved.v1': 'nope' })), []);
  assert.deepEqual(loadCollection(memory({ [COLLECTION_KEY]: '[]', 'exitpulse.favPairs.v1': '[{"origin":"A","destination":"B"}]' })), []);
  const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } };
  assert.deepEqual(loadCollection(throwing), []);
  assert.equal(saveCollection(throwing, [item('?a=1')]), false);
  const ok = memory();
  assert.equal(saveCollection(ok, [item('?a=1')]), true);
  assert.equal(loadCollection(ok)[0].query, '?a=1');
});

test('newItem stamps today and refuses bad queries', () => {
  assert.match(newItem('pair', 'x', '?p=a%3Eb')!.savedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(newItem('pair', 'x', 'p=a'), null);
});
