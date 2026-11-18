/** 車站與全線檢視用的純函式工具；獨立拆出以便 node --test 不必載入 Angular 即可執行。 */

export type DayType = 'weekday' | 'workday' | 'weekend' | 'all';
export type Period = { spec: string; kind: 'month' | 'date'; days: number; hours: [number, number]; recordedHours?: number[] };
export type Relation = { station: string; daily: number | null; share: number | null; compareDaily?: number | null; compareShare?: number | null };
export type DayEvents = { offDays: { date: string; note: string }[]; makeupDays: { date: string; note: string }[] };
export type MatrixAnswer = { period: Period; stations: string[]; cells: number[][] };
export type LeadersAnswer = {
  period: Period;
  compare: Period | null;
  busiestStations: { station: string; entries: number; exits: number }[];
  busiestPairs: { origin: string; destination: string; daily: number }[];
  risingStations: { station: string; baseline: number; current: number; delta: number; growthPct: number }[] | null;
  fallingStations: { station: string; baseline: number; current: number; delta: number; growthPct: number }[] | null;
};
export type StationAnswer = {
  station: string; period: Period; compare: Period | null; present: boolean; comparePresent?: boolean;
  entries: number | null; exits: number | null; compareEntries?: number | null; compareExits?: number | null;
  /** 後端確認這站在該時段有當目的站的紀錄；false 時出站是 0 只代表資料沒涵蓋 */
  exitCovered?: boolean; compareExitCovered?: boolean;
  events?: DayEvents;
  hourly: { entries: (number | null)[]; exits: (number | null)[]; compareEntries?: (number | null)[]; compareExits?: (number | null)[] };
  outbound: Relation[]; outboundTotal: number; inbound: Relation[]; inboundTotal: number;
};
export type NetworkRow = { station: string; entries: number | null; exits: number | null; compareEntries?: number | null; compareExits?: number | null; exitCovered?: boolean; compareExitCovered?: boolean };

/** 出站沒有涵蓋的站，把出站改成 null，畫面就會顯示「—」而不是誤導的 0。 */
export function maskUncoveredExits(rows: readonly NetworkRow[]): NetworkRow[] {
  return rows.map(r => r.exitCovered === false || r.compareExitCovered === false
    ? { ...r, exits: r.exitCovered === false ? null : r.exits, compareExits: r.compareExitCovered === false ? null : r.compareExits } : r);
}
export type NetworkAnswer = { period: Period; compare: Period | null; total: number; compareTotal: number | null; events?: DayEvents; stations: NetworkRow[]; hourly?: (number | null)[] };
export type TrendAnswer = { station: string | null; days: DayType; months: { month: string; days: number; entries: number | null; exits: number | null }[] };
export type CalendarAnswer = { month: string; station: string | null; dates: { date: string; weekend: boolean; holiday: boolean; note: string | null; entries: number | null; exits: number | null }[] };
export type RelationSort = 'daily' | 'share' | 'change' | 'growth';
export type NetworkSort = 'entries' | 'exits' | 'change' | 'growth';
export type TableSortDir = 'asc' | 'desc';
export type RelationTableColumn = 'station' | RelationSort;
export type NetworkTableColumn = 'station' | NetworkSort | 'net';
export type CatalogMonth = { month: string; days: number; expectedDays: number; missingDates: string[]; stationCount: number };
export type CatalogStation = { name: string; officialOpening?: string | null; firstDate: string | null; lastDate: string | null; days: number; months: number };
export type LineOpenings = Record<string, Record<string, string>>;
export type CatalogAnswer = {
  summary: { months: number; days: number; missingDays: number; stations: number; range: string[] };
  months: CatalogMonth[];
  stations: CatalogStation[];
  lineOpenings: LineOpenings;
};

export const DAY_LABELS: Record<DayType, string> = { weekday: '平日', workday: '純工作日', weekend: '週末', all: '每天' };
const WEEKDAYS = '日一二三四五六';

/** 2026-09 → 2026 年 9 月平日平均, 2026-09-15 → 9/15（二）. */
export function periodLabel(spec: string, days: DayType): string {
  if (spec.length === 10) {
    const d = new Date(spec + 'T00:00:00');
    return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`;
  }
  return `${spec.slice(0, 4)} 年 ${+spec.slice(5)} 月${DAY_LABELS[days]}平均`;
}

export function dayName(iso: string): string {
  return WEEKDAYS[new Date(iso + 'T00:00:00').getDay()];
}

/** Change between periods; null when either side has no station (not open), never a fake zero. */
export function change(now: number | null | undefined, before: number | null | undefined): number | null {
  return now == null || before == null ? null : now - before;
}

/** Growth in percent; null when the earlier value is missing or zero, so "new" stays distinct from "+0%". */
export function growth(now: number | null | undefined, before: number | null | undefined): number | null {
  return now == null || before == null || before === 0 ? null : (now / before - 1) * 100;
}

function rank(value: number | null, descending = true): number {
  return value == null ? -Infinity : descending ? value : -value;
}

export function sortRelations(rows: readonly Relation[], key: RelationSort): Relation[] {
  const value = (r: Relation) => key === 'daily' ? r.daily : key === 'share' ? r.share
    : key === 'change' ? Math.abs(change(r.daily, r.compareDaily) ?? NaN) : Math.abs(growth(r.daily, r.compareDaily) ?? NaN);
  return [...rows].sort((a, b) => rank(nan(value(b))) - rank(nan(value(a))) || a.station.localeCompare(b.station));
}

export function sortNetwork(rows: readonly NetworkRow[], key: NetworkSort): NetworkRow[] {
  const value = (r: NetworkRow) => key === 'entries' ? r.entries : key === 'exits' ? r.exits
    : key === 'change' ? Math.abs(change(r.entries, r.compareEntries) ?? NaN) : Math.abs(growth(r.entries, r.compareEntries) ?? NaN);
  return [...rows].sort((a, b) => rank(nan(value(b))) - rank(nan(value(a))) || a.station.localeCompare(b.station));
}

function compareNullable(a: number | null, b: number | null, dir: TableSortDir): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return dir === 'desc' ? b - a : a - b;
}

export function sortRelationTable(rows: readonly Relation[], col: RelationTableColumn, dir: TableSortDir): Relation[] {
  if (col === 'station') return [...rows].sort((a, b) => (dir === 'asc' ? 1 : -1) * a.station.localeCompare(b.station, 'zh-Hant'));
  const val = (r: Relation) => col === 'daily' ? r.daily : col === 'share' ? r.share
    : col === 'change' ? change(r.daily, r.compareDaily) : growth(r.daily, r.compareDaily);
  return [...rows].sort((a, b) => compareNullable(nan(val(a)), nan(val(b)), dir) || a.station.localeCompare(b.station, 'zh-Hant'));
}

export function sortNetworkTable(rows: readonly NetworkRow[], col: NetworkTableColumn, dir: TableSortDir): NetworkRow[] {
  if (col === 'station') return [...rows].sort((a, b) => (dir === 'asc' ? 1 : -1) * a.station.localeCompare(b.station, 'zh-Hant'));
  const val = (r: NetworkRow) => col === 'entries' ? r.entries : col === 'exits' ? r.exits
    : col === 'net' ? (r.entries == null || r.exits == null ? null : r.entries - r.exits)
    : col === 'change' ? change(r.entries, r.compareEntries) : growth(r.entries, r.compareEntries);
  return [...rows].sort((a, b) => compareNullable(nan(val(a)), nan(val(b)), dir) || a.station.localeCompare(b.station, 'zh-Hant'));
}

export function resolveAvailablePeriod(
  spec: string,
  months: readonly string[],
  firstDate: string,
  station: string,
  isCompare = false,
): { period: string; notice: string | null; dayType?: DayType } {
  if (!months.length) return { period: spec, notice: null };
  const isDate = spec.length === 10;
  const month = spec.slice(0, 7);
  const earliestMonth = months[0];
  if (!months.includes(month)) {
    const targetMonth = month < earliestMonth ? earliestMonth : months[months.length - 1];
    const target = isDate ? (firstDate && firstDate.startsWith(targetMonth) ? firstDate : `${targetMonth}-01`) : targetMonth;
    const prefix = isCompare ? `對照期 ${spec} ` : '';
    const who = isCompare ? `${station}無旅次紀錄` : `${station}在 ${spec} 無旅次紀錄`;
    const dow = target.length === 10 ? new Date(target + 'T00:00:00Z').getUTCDay() : -1;
    const dayType: DayType | undefined = dow >= 0 ? (dow === 0 || dow === 6 ? 'weekend' : 'weekday') : undefined;
    return { period: target, notice: `${prefix}${who}，已切換到最早旅次紀錄 ${target}`, dayType };
  }
  if (isDate && firstDate && spec < firstDate) {
    const prefix = isCompare ? `對照期 ${spec} ` : '';
    const who = isCompare ? `${station}無旅次紀錄` : `${station}在 ${spec} 無旅次紀錄`;
    const dow = new Date(firstDate + 'T00:00:00Z').getUTCDay();
    const dayType: DayType = dow === 0 || dow === 6 ? 'weekend' : 'weekday';
    return { period: firstDate, notice: `${prefix}${who}，已切換到最早旅次紀錄 ${firstDate}`, dayType };
  }
  return { period: spec, notice: null };
}

export type StationMetrics = {
  peakHour: number | null;
  peakSharePct: number | null;
  ioRatio: number | null;
  netFlow: number | null;
};

export function computeStationMetrics(
  entries: number | null,
  exits: number | null,
  hourlyEntries: readonly (number | null)[],
): StationMetrics {
  const known = hourlyEntries.map((v, h) => ({ h, v })).filter((x): x is { h: number; v: number } => x.v != null);
  const sum = known.reduce((acc, x) => acc + x.v, 0);
  const peak = known.length ? known.reduce((a, b) => (b.v > a.v ? b : a)) : null;
  return {
    peakHour: peak ? peak.h : null,
    peakSharePct: peak && sum > 0 ? Math.round((peak.v / sum) * 1000) / 10 : null,
    ioRatio: entries != null && exits != null && exits > 0 ? Math.round((entries / exits) * 100) / 100 : null,
    netFlow: entries != null && exits != null ? Math.round(entries - exits) : null,
  };
}

export type StationPersonality = { tag: string; note: string };

export function classifyStationPersonality(
  hourlyEntries: readonly (number | null)[],
  hourlyExits: readonly (number | null)[],
): StationPersonality | null {
  const sumRange = (arr: readonly (number | null)[], from: number, to: number) =>
    arr.slice(from, to).reduce<number>((acc, v) => acc + (v ?? 0), 0);
  const totalIn = sumRange(hourlyEntries, 0, 24);
  const totalOut = sumRange(hourlyExits, 0, 24);
  if (totalIn <= 0 || totalOut <= 0) return null;
  const morningIn = sumRange(hourlyEntries, 7, 10) / totalIn;
  const eveningIn = sumRange(hourlyEntries, 17, 20) / totalIn;
  const nightIn = sumRange(hourlyEntries, 19, 24) / totalIn;
  const morningOut = sumRange(hourlyExits, 7, 10) / totalOut;
  const commuterShare = Math.min(95, Math.max(15, Math.round((morningIn + eveningIn) * 100)));
  const trait = morningIn - eveningIn >= 0.08 ? '早高峰較顯著、晚間平緩'
    : eveningIn - morningIn >= 0.08 || morningOut >= 0.27 ? '白天吸納人潮、傍晚集中返程'
    : nightIn >= 0.24 ? '晚間 19 點後仍維持高人流'
    : '早晚與日間分布較平均';
  return { tag: `尖峰通勤傾向 ${commuterShare}%`, note: `${trait}，其餘 ${100 - commuterShare}% 分散於日間與離峰` };
}

export function baselineIndex2017(
  months: readonly { month: string; entries: number | null }[],
  targetMonth: string,
): { index: number; baseYears: number } | null {
  const mm = targetMonth.slice(4, 7);
  const current = months.find(m => m.month === targetMonth)?.entries;
  if (current == null) return null;
  const base = months.filter(m => m.entries != null && m.month.endsWith(mm) && m.month >= '2017-01' && m.month <= '2019-12');
  if (!base.length) return null;
  const avg = base.reduce((acc, m) => acc + m.entries!, 0) / base.length;
  if (avg <= 0) return null;
  return { index: Math.round((current / avg) * 1000) / 10, baseYears: base.length };
}

export function hourlySvgPoints(series: readonly (number | null)[], peak: number, width = 240, height = 64): string {
  if (peak <= 0 || series.length < 2) return '';
  return series
    .map((v, i) => {
      if (v == null) return null;
      const x = ((i / (series.length - 1)) * width).toFixed(1);
      const y = (height - (v / peak) * (height - 6) - 3).toFixed(1);
      return `${x},${y}`;
    })
    .filter((p): p is string => p !== null)
    .join(' ');
}

function nan(v: number | null): number | null { return v == null || Number.isNaN(v) ? null : v; }

/** Circle radius on the map by area, so a station with 4x the riders looks 4x as large, not 16x. */
export function stationRadius(daily: number | null, largest: number): number {
  if (!daily || daily <= 0 || largest <= 0) return 0;
  return 3 + 19 * Math.sqrt(daily / largest);
}

/** Signed figure with a real minus sign and thousands separators. */
export function signed(v: number | null, digits = 0): string {
  if (v == null) return '—';
  const text = Math.abs(v).toLocaleString('zh-TW', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return (v > 0 ? '+' : v < 0 ? '−' : '±') + text;
}

/** A count read the way people say it: 225.5 萬人, 3,512 人. */
export function amount(n: number | null | undefined): { value: string; unit: string } {
  if (n == null) return { value: '—', unit: '' };
  const v = Math.abs(n);
  if (v >= 1e4) return { value: (n / 1e4).toFixed(v >= 1e6 ? 0 : 1).replace(/\.0$/, ''), unit: '萬人' };
  return { value: Math.round(n).toLocaleString('zh-TW'), unit: '人' };
}

/** How now differs from before, in words and percent; null when either side is unknown or before is 0. */
export function diff(now: number | null | undefined, before: number | null | undefined) {
  if (now == null || before == null || before === 0) return null;
  const d = now - before, g = d / before * 100, a = amount(Math.abs(d));
  const dir: 'up' | 'down' | 'flat' = Math.abs(g) < .5 ? 'flat' : d > 0 ? 'up' : 'down';
  return { dir, pct: (g >= 0 ? '+' : '−') + Math.abs(g).toFixed(1) + '%', words: dir === 'flat' ? '幾乎一樣' : `${d > 0 ? '多' : '少'} ${a.value} ${a.unit}` };
}

export interface LineSummary {
  code: string;
  name: string;
  stationCount: number;
  entries: number | null;
  compareEntries: number | null;
  share: number | null;
  unopened: boolean;
  compareUnopened: boolean;
  partial: boolean;
  comparePartial: boolean;
}

/** Sum both periods independently and count the union of contributing stations. */
export function summarizeByLine(
  stations: readonly NetworkRow[],
  linesOf: (station: string) => readonly { code: string; opened?: string }[],
  lineNames: Record<string, string>,
  current?: string,
  compare?: string | null,
): LineSummary[] {
  function coverage(opened: string | undefined, period: string | null | undefined) {
    if (!period) return 'open';
    if (!opened) return 'unknown';
    if (opened.slice(0, period.length) > period) return 'unopened';
    return period.length === 7 && opened > period + '-01' ? 'partial' : 'open';
  }
  const lines = new Map<string, Omit<LineSummary, 'share'>>();
  for (const row of stations) {
    for (const { code, opened } of linesOf(row.station)) {
      const line = lines.get(code) ?? { code, name: lineNames[code] ?? code, stationCount: 0,
        entries: null, compareEntries: null, unopened: !!current, compareUnopened: !!compare, partial: false, comparePartial: false };
      const now = coverage(opened, current), before = coverage(opened, compare);
      const entries = now === 'open' ? row.entries : null;
      const compareEntries = before === 'open' ? row.compareEntries : null;
      if (entries != null) line.entries = (line.entries ?? 0) + entries;
      if (compareEntries != null) line.compareEntries = (line.compareEntries ?? 0) + compareEntries;
      if (entries != null || compareEntries != null) line.stationCount++;
      line.unopened &&= now === 'unopened';
      line.compareUnopened &&= before === 'unopened';
      line.partial ||= now === 'partial';
      line.comparePartial ||= before === 'partial';
      lines.set(code, line);
    }
  }
  const summaries = [...lines.values()];
  const complete = summaries.every(line => !line.partial);
  const total = summaries.reduce((sum, line) => sum + (line.entries ?? 0), 0);
  return summaries.map(line => ({ ...line, share: !complete || line.entries == null || !total ? null : line.entries / total * 100 }))
    .sort((a, b) => (b.entries ?? -1) - (a.entries ?? -1) || (b.compareEntries ?? -1) - (a.compareEntries ?? -1)
      || a.code.localeCompare(b.code));
}

/** 探索查詢失敗時優先顯示後端回傳的具體中文訊息，無字串時再退回預設提示。 */
export function exploreErrorMessage(status: number, bodyError?: unknown): string {
  if (typeof bodyError === 'string' && bodyError.trim()) return bodyError.trim();
  return status === 422 ? '這個時段無法比較' : '旅次查詢失敗';
}

/** 計算單站 24 小時環形指紋（00 點在正上方順時針繞行）；真實 0 畫於內圈刻度，null 斷線並標示無紀錄時段。 */
export function radialClockPoints(
  entries: (number | null)[],
  exits: (number | null)[],
  cx = 100,
  cy = 100,
  innerR = 26,
  outerR = 84,
): {
  entriesPaths: string[];
  exitsPaths: string[];
  missingHours: { h: number; x1: string; y1: string; x2: string; y2: string }[];
  peak: number;
} | null {
  const nonNull = [...entries, ...exits].filter((v): v is number => v != null);
  if (!nonNull.length) return null;
  const peak = Math.max(0, ...nonNull);
  const scale = Math.max(1, peak);
  const pt = (h: number, r: number) => {
    const a = (h / 24) * Math.PI * 2 - Math.PI / 2;
    return `${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`;
  };
  const buildPaths = (series: (number | null)[]) => {
    const segs: string[][] = [];
    let cur: string[] = [];
    for (let h = 0; h < 24; h++) {
      const v = series[h];
      if (v == null) {
        if (cur.length) { segs.push(cur); cur = []; }
      } else {
        cur.push(pt(h, innerR + (v / scale) * (outerR - innerR)));
      }
    }
    if (cur.length) segs.push(cur);
    if (segs.length === 1 && segs[0].length === 24) segs[0].push(segs[0][0]);
    else if (segs.length > 1 && series[0] != null && series[23] != null) {
      const tail = segs.pop()!;
      segs[0] = [...tail, ...segs[0]];
    }
    return segs.map(s => (s.length === 1 ? `M${s[0]} L${s[0]}` : 'M' + s.join(' L')));
  };
  const missingHours: { h: number; x1: string; y1: string; x2: string; y2: string }[] = [];
  for (let h = 0; h < 24; h++) {
    if (entries[h] == null || exits[h] == null) {
      const a = (h / 24) * Math.PI * 2 - Math.PI / 2;
      missingHours.push({
        h,
        x1: (cx + Math.cos(a) * innerR).toFixed(1),
        y1: (cy + Math.sin(a) * innerR).toFixed(1),
        x2: (cx + Math.cos(a) * outerR).toFixed(1),
        y2: (cy + Math.sin(a) * outerR).toFixed(1),
      });
    }
  }
  return { entriesPaths: buildPaths(entries), exitsPaths: buildPaths(exits), missingHours, peak };
}

/** 影響全網人流的重大事件，標在歷年走勢上；只列日期確定、影響全線的事件。 */
export const NETWORK_EVENTS: readonly { date: string; label: string }[] = [
  { date: '2020-01-31', label: '環狀線通車' },
  { date: '2021-05-19', label: '全國三級警戒' },
  { date: '2023-07-01', label: 'TPASS 1200 月票上路' },
];

// 爆量與偏少都跟「同類型日」的中位數比：平日比平日，週末與國定假日比週末與國定假日
export const SURGE_RATIO = 1.45;
export const LOW_RATIO = 0.8;
const MIN_SAMPLE = 4;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

type CalendarDay = { date: string; weekend: boolean; holiday: boolean; note: string | null; entries: number | null };

/** 每天標爆量（surge）、偏少（low）或不標。同類型日少於 4 天時不判斷，補班日不參與。 */
export function unusualDays(dates: readonly CalendarDay[]): { mark: 'surge' | 'low' | null; ratio: number | null }[] {
  const off = (d: CalendarDay) => d.weekend || d.holiday;
  const makeup = (d: CalendarDay) => d.weekend && !d.holiday && !!d.note;
  const medianOf = (isOff: boolean) => {
    const pool = dates.filter(d => d.entries != null && !makeup(d) && off(d) === isOff).map(d => d.entries!);
    return pool.length >= MIN_SAMPLE ? median(pool) : null;
  };
  const med = { workday: medianOf(false), off: medianOf(true) };
  return dates.map(d => {
    const m = off(d) ? med.off : med.workday;
    if (d.entries == null || makeup(d) || !m) return { mark: null, ratio: null };
    const ratio = d.entries / m;
    return { mark: ratio >= SURGE_RATIO ? 'surge' : ratio < LOW_RATIO ? 'low' : null, ratio };
  });
}

export type StationRole = { role: '通勤住宅' | '就業學區' | '休閒商圈' | '轉乘樞紐' | '混合'; reasons: string[] };

// 門檻：早上進站多於出站 1.3 倍、傍晚反過來也 1.3 倍，才算住宅型，反之就業或學區型；
// 週末每天人次達平日 9 成以上算休閒商圈型（逛街、出遊）；3 條路線以上交會算轉乘樞紐
const IO_RATIO = 1.3, WEEKEND_RATIO = 0.9, HUB_LINES = 3;

/** 推論車站角色並附上白話依據。早晚尖峰任一邊沒有人次時回 null。 */
export function stationRole(x: { amEntries: number; amExits: number; pmEntries: number; pmExits: number; weekdayDaily: number | null; weekendDaily: number | null; lines: number }): StationRole | null {
  if (x.amEntries <= 0 || x.amExits <= 0 || x.pmEntries <= 0 || x.pmExits <= 0) return null;
  const am = x.amEntries / x.amExits, pm = x.pmExits / x.pmEntries;
  const wk = x.weekdayDaily && x.weekendDaily != null ? x.weekendDaily / x.weekdayDaily : null;
  const times = (v: number) => v.toFixed(1) + ' 倍';
  const reasons: string[] = [];
  let role: StationRole['role'] = '混合';
  if (x.lines >= HUB_LINES) { role = '轉乘樞紐'; reasons.push(`${x.lines} 條路線在這裡交會`); }
  if (am >= IO_RATIO && pm >= IO_RATIO) {
    if (role === '混合') role = '通勤住宅';
    reasons.push(`早上 7–10 點進站是出站的 ${times(am)}，傍晚 17–20 點出站是進站的 ${times(pm)}`);
  } else if (1 / am >= IO_RATIO && 1 / pm >= IO_RATIO) {
    if (role === '混合') role = '就業學區';
    reasons.push(`早上 7–10 點出站是進站的 ${times(1 / am)}，傍晚 17–20 點進站是出站的 ${times(1 / pm)}`);
  }
  if (wk != null && wk >= WEEKEND_RATIO) {
    if (role === '混合') role = '休閒商圈';
    reasons.push(`週末每天人次是平日的 ${Math.round(wk * 100)}%`);
  } else if (wk != null) reasons.push(`週末每天人次只有平日的 ${Math.round(wk * 100)}%`);
  if (role === '混合') reasons.unshift('早晚進出站差不多，看不出單一用途');
  return { role, reasons };
}

const EARTH_KM = 6371;
export function distanceKm([lng1, lat1]: readonly [number, number], [lng2, lat2]: readonly [number, number]): number {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(a));
}

export const DISTANCE_BANDS = [
  { label: '短程', note: '3 公里內', max: 3 },
  { label: '中程', note: '3–8 公里', max: 8 },
  { label: '長程', note: '8 公里以上', max: Infinity },
] as const;

/** 往來人次依兩站直線距離分段；缺座標或人次的站另計，不算進占比。 */
export function distanceBands(origin: readonly [number, number] | null, rows: readonly Relation[], coordOf: (station: string) => readonly [number, number] | null) {
  if (!origin) return null;
  const bands = DISTANCE_BANDS.map(b => ({ ...b, daily: 0, stations: 0, share: 0 }));
  let total = 0, weighted = 0, unknown = 0;
  for (const r of rows) {
    const c = coordOf(r.station);
    if (!c || r.daily == null || r.daily <= 0) { unknown++; continue; }
    const km = distanceKm(origin, c), band = bands.find(b => km <= b.max)!;
    band.daily += r.daily; band.stations++; total += r.daily; weighted += r.daily * km;
  }
  if (!total) return null;
  for (const b of bands) b.share = b.daily / total * 100;
  return { bands, averageKm: weighted / total, unknown };
}
