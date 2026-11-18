import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCsv } from './csv-export.ts';

test('說明列在前、空一行、再接資料表，並以 BOM 與 CRLF 輸出', () => {
  const text = buildCsv([['期間', '2026-09']], ['站', '人次'], [['南港', 12]]);
  assert.equal(text, '﻿# 期間,2026-09\r\n\r\n站,人次\r\n南港,12\r\n');
});

test('沒有說明列時不留空行', () => {
  assert.equal(buildCsv([], ['a'], [[1]]), '﻿a\r\n1\r\n');
});

test('數字與負數保持原樣，字串開頭的公式字元加單引號', () => {
  const text = buildCsv([], ['x'], [[-3.5], ['=SUM(A1)'], ['+1'], ['-abc'], ['@x'], ['-12']]);
  assert.deepEqual(text.split('\r\n').slice(1, 7), ['-3.5', "'=SUM(A1)", "'+1", "'-abc", "'@x", '-12']);
});

test('逗號、引號與換行會加引號跳脫，null 留白', () => {
  const text = buildCsv([], ['a', 'b'], [['x,y', 'say "hi"'], [null, 'l1\r\nl2']]);
  assert.equal(text, '﻿a,b\r\n"x,y","say ""hi"""\r\n,"l1\r\nl2"\r\n');
});
