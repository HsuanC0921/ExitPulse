// 兩站比較的純函式：排序、線寬與箭頭數、匯出列、網址參數解析
export type Result = {
  origin: string; destination: string; baselineTrips: number; currentTrips: number; baselineOriginTotal: number; currentOriginTotal: number;
  baselineDaily: number; currentDaily: number; deltaSharePp: number; growth: number | null; reverseBaseline: number; reverseCurrent: number;
  directionBaseline: number | null; directionCurrent: number | null; reversal: boolean; score: number;
};
export type SortKey = 'share' | 'daily' | 'growth' | 'volume';

export const SORTS: Record<SortKey, { label: string; unit: string }> = {
  share: { label: '比例變化', unit: '百分點' },
  daily: { label: '人次增減', unit: '人次／日' },
  growth: { label: '成長率', unit: '%' },
  volume: { label: '目前人次', unit: '人次／日' },
};

export function sortValue(r: Result, key: SortKey): number {
  switch (key) {
    case 'share': return r.deltaSharePp;
    case 'daily': return r.currentDaily - r.baselineDaily;
    case 'growth': return r.growth == null ? Infinity : r.growth * 100;
    case 'volume': return r.currentDaily;
  }
}

/** 變化最大的排前面（不分正負），相同時依站名排，讓順序穩定。 */
export function sortResults(results: readonly Result[], key: SortKey): Result[] {
  const weight = (r: Result) => key === 'volume' ? sortValue(r, key) : Math.abs(sortValue(r, key));
  return [...results].sort((a, b) => weight(b) - weight(a) || a.origin.localeCompare(b.origin) || a.destination.localeCompare(b.destination));
}

export function filterResults(results: readonly Result[], query: string, line: string, linesOf: (station: string) => readonly string[]): Result[] {
  const q = query.trim().replace(/臺/g, '台');
  return results.filter(r =>
    (!q || r.origin.replace(/臺/g, '台').includes(q) || r.destination.replace(/臺/g, '台').includes(q)) &&
    (!line || linesOf(r.origin).includes(line) || linesOf(r.destination).includes(line)));
}

/** 共用同一把刻度，讓高人次的線在不同時段與月份之間仍分得出差異。 */
export function lineWidth(trips: number): number {
  return trips > 0 ? 0.9 + 11.1 * Math.log1p(trips / 500) / Math.log(21) : 0;
}

export const FLOW_SAMPLES = [100, 500, 1000, 3000, 10000, 30000];

/** 人流是一串箭頭而不是單一箭頭：最少 4 個，每高一個人次級距加 2 個。 */
export function arrowCount(trips: number): number {
  return trips <= 0 ? 0 : 4 + 2 * FLOW_SAMPLES.slice(1).filter(sample => trips >= sample).length;
}

const smallCounts = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 });
const counts = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });

export function formatDailyTrips(value: number): string {
  if (value > 0 && value < .1) return '<0.1';
  return (value < 10 ? smallCounts : counts).format(value);
}

/** 讓數字與後面的單位黏在一起，避免一行結尾只剩孤零零的數字。 */
export function glue(text: string): string {
  return text.replace(/([\d%]) (?=[^\d])/g, '$1 ');
}

/** 可直接匯入試算表的列；沒有基準期的兩站沒有成長率，該欄留白而不是填 0。 */
/** 匯出用的表頭與資料列，數字保持數值，沒有資料的欄位為 null。 */
export function csvTable(results: readonly Result[]): { head: string[]; rows: Array<Array<string | number | null>> } {
  const head = ['起站', '迄站', '基準每日人次', '比較每日人次', '比例變化（百分點）', '成長率（%）', '方向反轉',
    '基準原始人次', '比較原始人次', '基準起站總人次', '比較起站總人次', '基準方向指數', '比較方向指數'];
  const round = (v: number, digits: number) => Number(v.toFixed(digits));
  const rows = results.map(r => [r.origin, r.destination, round(r.baselineDaily, 1), round(r.currentDaily, 1), round(r.deltaSharePp, 2),
    r.growth == null ? null : round(r.growth * 100, 1), r.reversal ? '是' : '',
    r.baselineTrips, r.currentTrips, r.baselineOriginTotal, r.currentOriginTotal,
    r.directionBaseline == null ? null : round(r.directionBaseline, 3), r.directionCurrent == null ? null : round(r.directionCurrent, 3)]);
  return { head, rows };
}

export type ViewState = { baseline: string; current: string; hours: string; weekend: boolean; type: string; minimum: number; sort: SortKey; q: string; line: string; pair: string };
const HOURS = ['7-10', '10-16', '16-19', '19-24'], TYPE_KEYS = ['all', 'increase', 'decrease', 'reversal'], MINIMUMS = [10, 20, 50, 100];

/** 只讀取介面真的能顯示的值，其他一律退回預設值。 */
export function readState(search: string, defaults: ViewState): ViewState {
  const p = new URLSearchParams(search), month = /^\d{4}-\d{2}$/;
  const pick = <T>(value: T | null, ok: (v: T) => boolean, fallback: T) => value != null && ok(value) ? value : fallback;
  return {
    baseline: pick(p.get('b'), v => month.test(v), defaults.baseline),
    current: pick(p.get('c'), v => month.test(v), defaults.current),
    hours: pick(p.get('h'), v => HOURS.includes(v), defaults.hours),
    weekend: p.has('w') ? p.get('w') === '1' : defaults.weekend,
    type: pick(p.get('t'), v => TYPE_KEYS.includes(v), defaults.type),
    minimum: pick(Number(p.get('m')), v => MINIMUMS.includes(v), defaults.minimum),
    sort: pick(p.get('s') as SortKey | null, v => v in SORTS, defaults.sort),
    q: (p.get('q') ?? defaults.q).slice(0, 20),
    line: pick(p.get('l'), v => ['BL', 'BR', 'G', 'R', 'O', 'Y'].includes(v), defaults.line),
    // 剛好兩個不同站名，各 1–20 字；「a>b>c」「>b」「a>a」都退回預設
    pair: pick(p.get('p'), v => /^[^>]{1,20}>[^>]{1,20}$/.test(v) && v.split('>')[0] !== v.split('>')[1], defaults.pair),
  };
}

export function writeState(s: ViewState): string {
  const p = new URLSearchParams({ b: s.baseline, c: s.current, h: s.hours, w: s.weekend ? '1' : '0', t: s.type, m: String(s.minimum), s: s.sort });
  if (s.q) p.set('q', s.q);
  if (s.line) p.set('l', s.line);
  if (s.pair) p.set('p', s.pair);
  return '?' + p.toString();
}
