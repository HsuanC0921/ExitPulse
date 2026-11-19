import { afterNextRender, ChangeDetectionStrategy, Component, ElementRef, Injector, OnDestroy, ViewEncapsulation, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { autoRetry } from './auto-retry';
import { DecimalPipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, shareReplay, switchMap, timer, type Observable, type Subscription } from 'rxjs';
import {
  DAY_LABELS, NETWORK_EVENTS, maskUncoveredExits, amount, baselineIndex2017, distanceBands, stationRole, unusualDays, change, classifyStationPersonality, computeStationMetrics, dayName, diff, exploreErrorMessage, growth, hourlySvgPoints, periodLabel, radialClockPoints, resolveAvailablePeriod, signed, sortNetwork, sortNetworkTable, sortRelationTable, sortRelations, stationRadius, summarizeByLine,
  type CalendarAnswer, type CatalogAnswer, type DayType, type LeadersAnswer, type MatrixAnswer, type NetworkAnswer, type NetworkSort, type NetworkTableColumn,
  type Relation, type RelationSort, type RelationTableColumn, type StationAnswer, type TableSortDir, type TrendAnswer,
} from './explore-model';
import { formatDailyTrips, lineWidth, glue } from './radar-model';
import { buildCsv, downloadCsv, exportBasis, type CsvCell } from './csv-export';
import { Hint, type HintEntry } from './hint';
import { MonthCalendar } from './month-calendar';
import { OdMatrix } from './od-matrix';
import { AnimatedCount } from './animated-count';
import { RankChart, type RankChartData } from './rank-chart';
import { MotionPreference } from './motion-preference';
import { revealRankRow } from './rank-scroll';

export type ExploreMode = 'station' | 'network';
export type StationLine = { code: string; name: string; color: string };
export type StationAvailability = Record<string, { months: string[]; firstDate: string | null }>;
type ExploreRequest = { url: string; params: Record<string, string> };
type ExploreAnswer = StationAnswer | NetworkAnswer;
/** 探索檢視目前要請地圖繪製的圖層狀態；由地圖模組負責將站名對應為座標。 */
export type ExploreLayer = {
  /** dashed = fewer trips than the comparison period. Colour is chosen by the map, never by the line. */
  arcs: { from: string; to: string; daily: number; dashed: boolean; emphasis: number }[];
  /** color = the station's line. hollow = fewer trips than the comparison period. */
  circles: { station: string; radius: number; color: string; label: string; count?: string; rank?: number; hollow: boolean }[];
  focus: string | null;
  /** Counterpart selected in the single-station view. */
  focusedRelation?: string | null;
};

const LINE_NAMES: Record<string, string> = { BL: '板南線', BR: '文湖線', G: '松山新店線', R: '淡水信義線', O: '中和新蘆線', Y: '環狀線' };
const BANDS = [['0-24', '全天'], ['7-10', '07–10'], ['10-16', '10–16'], ['16-19', '16–19'], ['17-20', '晚尖峰 17–20'], ['19-24', '19–24']] as const;
const PAGE = 30;
const MAP_ARCS = 25;
const MAP_RANKS = 10;

function monthDates(month: string): string[] {
  const [y, m] = month.split('-').map(Number), n = new Date(y, m, 0).getDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

function validPeriod(value: string): boolean {
  if (!/^\d{4}-\d{2}(?:-\d{2})?$/.test(value)) return false;
  const iso = value.length === 7 ? value + '-01' : value;
  const date = new Date(iso + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso;
}

function hourRangesText(hours: readonly number[] | undefined): string {
  if (!hours?.length) return '無紀錄';
  const ranges: { start: number; end: number }[] = [];
  for (const hour of hours) {
    const last = ranges[ranges.length - 1];
    if (last?.end === hour) last.end++;
    else ranges.push({ start: hour, end: hour + 1 });
  }
  return ranges.map(range => `${String(range.start).padStart(2, '0')}–${String(range.end).padStart(2, '0')}`).join('、') + ' 點';
}

@Component({
  selector: 'app-explore', imports: [DecimalPipe, Hint, MonthCalendar, OdMatrix, AnimatedCount, RankChart], templateUrl: './explore.html', styleUrls: ['./explore.css', './explore-wide.css', './rank-link.css'],
  changeDetection: ChangeDetectionStrategy.OnPush, encapsulation: ViewEncapsulation.None,
})
export class Explore implements OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  private readonly motion = inject(MotionPreference);
  private readonly rankPreview = signal<{ station: string; source: 'rank' | 'map' } | null>(null);
  readonly mode = input.required<ExploreMode>();
  readonly rankSelected = output<string>();
  readonly months = input.required<string[]>();
  readonly monthsReady = input.required<boolean>();
  readonly lineOrder = input.required<Record<string, string[]>>();
  readonly linesOf = input.required<(station: string) => StationLine[]>();
  readonly stationCodes = input.required<Record<string, Record<string, string>>>();
  readonly availability = input.required<StationAvailability | null>();
  readonly layer = output<ExploreLayer>();
  readonly openStation = output<string>();
  readonly openPair = output<{ origin: string; destination: string; period: string; weekend: boolean; hours: string }>();
  readonly showMap = output<void>();
  readonly switchMode = output<ExploreMode>();

  readonly lineCodes = Object.keys(LINE_NAMES);
  readonly lineNames = LINE_NAMES;
  readonly bands = BANDS;
  readonly dayLabels = DAY_LABELS;
  readonly dayTypes: DayType[] = ['weekday', 'workday', 'weekend', 'all'];
  readonly signed = signed;
  readonly dayName = dayName;
  readonly min = Math.min;
  readonly dualHourPoints = computed(() => {
    const a = this.stationAnswer();
    if (!a) return null;
    const peak = Math.max(1, ...a.hourly.entries.map(v => v ?? 0), ...a.hourly.exits.map(v => v ?? 0));
    return { entries: hourlySvgPoints(a.hourly.entries, peak), exits: hourlySvgPoints(a.hourly.exits, peak) };
  });

  // Query
  readonly station = signal('台北車站');
  readonly pickerLine = signal('R');
  readonly unit = signal<'month' | 'date'>('month');
  readonly month = signal('2026-09');
  readonly date = signal('2026-09-01');
  readonly days = signal<DayType>('weekday');
  readonly band = signal('0-24');
  readonly comparing = signal(false);
  readonly compareUnit = signal<'month' | 'date'>('month');
  readonly compareMonth = signal('2022-09');
  readonly compareDate = signal('2022-09-01');
  // View
  readonly direction = signal<'outbound' | 'inbound'>('outbound');
  readonly hints: Record<string, readonly HintEntry[]> = {
    personality: [{ label: '尖峰通勤傾向', value: '平日早晚尖峰（07–10、16–19）進站占全天比例，越高越偏向通勤站。' }],
    networkShare: [{ label: '計算方式', value: '這座車站進站人次占全臺北捷運當期總進站的比例，能看出它在整張路網中的規模占比。' }],
    recoveryIndex: [{ label: '基準指數', value: '以 2017 至 2019 年同月平均為 100，高於 100 代表已超越疫情前同期。' }],
    radialClock: [{ label: '環形指紋', value: '用 24 小時時鐘看作息，實線進站、虛線出站，內圈是 0、斷線無紀錄。' }],
    leaders: [{ label: '全線榜單', value: '依目前期間與時段排前 10 名，增減排行只看基準至少 200 人次／日的站。' }],
    matrix: [{ label: '車站互搭表', value: '橫列是起站、直欄是迄站，格子越深代表兩站直接搭車的人越多。' }],
    coverage: [{ label: '資料紀錄', value: '列出已匯入的年份、月份與缺漏日期，點任一列可直接跳到該站或該月。' }],
  };
  readonly hourSide = signal<'entries' | 'exits' | 'both' | 'clock'>('entries');
  readonly radialClock = computed(() => {
    const a = this.stationAnswer();
    if (!a) return null;
    return radialClockPoints(a.hourly.entries, a.hourly.exits);
  });
  readonly trendView = signal<'bars' | 'sameMonth' | 'line'>('bars');
  readonly relationSort = signal<RelationSort>('daily');
  readonly networkSort = signal<NetworkSort>('entries');
  readonly relationSortReverse = signal(false);
  readonly networkSortReverse = signal(false);
  readonly listCollapsed = signal(false);
  readonly focusOnly = signal(false);
  readonly listStyle = signal<'cards' | 'table' | 'lines'>('cards');
  readonly relTableCol = signal<RelationTableColumn>('daily');
  readonly netTableCol = signal<NetworkTableColumn>('entries');
  readonly tableDir = signal<TableSortDir>('desc');
  readonly focusedStation = signal<string | null>(null);
  readonly focusedRelation = signal<string | null>(null);
  readonly lineFilter = signal('');
  readonly query = signal('');
  readonly shown = signal(PAGE);
  /** Only one condition is edited at a time, so the panel stays short. */
  readonly editing = signal<'station' | 'time' | 'compare' | 'peer' | null>(null);
  readonly conditionsOpen = signal(false);
  readonly toolsOpen = signal(false);
  readonly hourTableOpen = signal(false);
  readonly wideView = signal(false);
  private wideOpener: HTMLElement | null = null;
  setWideView(open: boolean) {
    if (open) {
      this.wideOpener = document.activeElement as HTMLElement | null;
      this.wideView.set(true);
      requestAnimationFrame(() => document.querySelector<HTMLElement>('.wide-close')?.focus());
    } else {
      this.wideView.set(false);
      requestAnimationFrame(() => this.wideOpener?.focus());
    }
  }
  stationMissingLabel(station: string, targetPeriod: string | null = this.period()): string {
    const first = this.availability()?.[station]?.firstDate;
    if (!first || !targetPeriod) return '無紀錄';
    return (targetPeriod.length === 7 ? targetPeriod + '-31' < first : targetPeriod < first) ? '未通車' : '無紀錄';
  }
  readonly section = signal<'list' | 'hours' | 'days' | 'years' | 'matrix' | 'leaders' | 'coverage'>('list');
  // Answers
  readonly stationAnswer = signal<StationAnswer | null>(null);
  readonly networkAnswer = signal<NetworkAnswer | null>(null);
  readonly trend = signal<TrendAnswer | null>(null);
  readonly calendar = signal<CalendarAnswer | null>(null);
  readonly matrix = signal<MatrixAnswer | null>(null);
  readonly matrixLoading = signal(false);
  readonly matrixFailure = signal(false);
  readonly leaders = signal<LeadersAnswer | null>(null);
  readonly leadersLoading = signal(false);
  readonly leadersFailure = signal(false);
  readonly catalog = signal<CatalogAnswer | null>(null);
  readonly catalogLoading = signal(false);
  readonly catalogFailure = signal(false);
  readonly coverageTab = signal<'stations' | 'months'>('stations');
  readonly coverageQuery = signal('');
  readonly peerStation = signal<string | null>(null);
  readonly peerAnswer = signal<StationAnswer | null>(null);
  readonly peerLoading = signal(false);
  readonly loading = signal(false);
  readonly failure = signal('');
  /** 失敗原因是網路或伺服器暫時性問題（可自動重試），不是查詢條件本身有誤 */
  private readonly failureRetryable = signal(false);
  readonly calendarLoading = signal(false);
  readonly calendarFailure = signal(false);
  readonly trendLoading = signal(false);
  readonly trendFailure = signal(false);
  readonly playing = signal(false);
  readonly activeHour = computed(() => { const [a, b] = this.band().split('-').map(Number); return b - a === 1 ? a : null; });
  private playback?: ReturnType<typeof setInterval>;

  readonly period = computed(() => this.unit() === 'date' ? this.date() : this.month());
  private readonly profileKey = computed(() => this.mode() === 'station' ? this.period() + ':' + this.station() : this.period());
  private readonly profile = signal<{ key: string; entries: (number | null)[]; exits?: (number | null)[] } | null>(null);
  readonly timelineProfile = computed(() => {
    const profile = this.profile();
    if (this.unit() !== 'date' || profile?.key !== this.profileKey()) return [];
    return (this.direction() === 'inbound' ? profile.exits ?? profile.entries : profile.entries);
  });
  readonly timelineMeasure = computed(() => this.mode() === 'network' ? '全線進站' : this.direction() === 'outbound' ? '從本站出發' : '到本站');
  readonly comparePeriod = computed(() => !this.comparing() ? null : this.compareUnit() === 'date' ? this.compareDate() : this.compareMonth());
  readonly dateOptions = computed(() => this.datesForMonth(this.month()));
  readonly compareDateOptions = computed(() => this.datesForMonth(this.compareMonth()));
  readonly allStations = computed(() => [...new Set(Object.values(this.lineOrder()).flat())].sort((a, b) => a.localeCompare(b, 'zh-Hant')));
  readonly periodText = computed(() => this.describe(this.period()));
  readonly periodBaseText = computed(() => periodLabel(this.period(), this.days()));
  readonly periodDate = computed(() => periodLabel(this.date(), this.days()));
  readonly hoursText = computed(() => {
    const [start, end] = this.band().split('-');
    return this.band() === '0-24' ? '全天' : `${start.padStart(2, '0')}:00–${end.padStart(2, '0')}:00`;
  });
  readonly compareText = computed(() => {
    const c = this.comparePeriod();
    if (!c) return '';
    return c.length === 10 && c.slice(0, 4) !== this.period().slice(0, 4) ? c : periodLabel(c, this.days());
  });
  private readonly stationCoverage = computed(() => this.mode() === 'station' ? this.availability()?.[this.station()] : undefined);
  readonly availableMonths = computed(() => this.stationCoverage()?.months ?? this.months());
  readonly firstDate = computed(() => this.stationCoverage()?.firstDate ?? '');
  readonly availabilityNotice = signal('');
  readonly unavailable = computed(() => this.mode() === 'station' && this.stationUnavailable(this.station()));
  readonly unrecorded = signal(false);
  readonly mapMetric = signal<'volume' | 'change'>('volume');
  readonly isComparing = computed(() => !!this.comparePeriod());
  readonly sameAsCompare = computed(() => this.comparePeriod() === this.period());
  readonly sections = computed(() => this.mode() === 'station'
    ? [['list', '往來站'], ['hours', '時段'], ['days', '每天'], ['years', '歷年']] as const
    : [['list', '各站'], ['days', '每天'], ['years', '歷年'], ['matrix', '互搭表'], ['leaders', '榜單'], ['coverage', '紀錄']] as const);
  readonly activeSection = computed(() => {
    const s = this.section();
    if (this.mode() === 'network' && s === 'hours') return 'list';
    if (this.mode() === 'station' && (s === 'matrix' || s === 'leaders' || s === 'coverage')) return 'list';
    return s;
  });
  readonly sectionIndex = computed(() => this.sections().findIndex(([key]) => key === this.activeSection()));
  readonly tableRelations = computed(() => sortRelationTable(this.relations(), this.relTableCol(), this.tableDir()));
  readonly stationMetrics = computed(() => {
    const a = this.stationAnswer();
    if (!a || !a.present || this.exitGap()) return null;
    return computeStationMetrics(a.entries, a.exits, a.hourly.entries);
  });
  /** 匯入資料的目的站沒涵蓋這站，出站 0 不是真的沒人出站。舊版 API 沒有 exitCovered 時，退回用「有進站、出站與來源全 0」推論。 */
  readonly exitGap = computed(() => {
    const a = this.stationAnswer();
    if (!a || !a.present) return false;
    return a.exitCovered === false || (a.exitCovered === undefined && (a.entries ?? 0) > 0 && a.exits === 0 && a.inboundTotal === 0);
  });
  readonly stationPersonality = computed(() => {
    const a = this.stationAnswer();
    if (!a || !a.present || this.exitGap()) return null;
    return classifyStationPersonality(a.hourly.entries, a.hourly.exits);
  });
  /** 車站角色：用逐時進出、當月平日與週末每天人次、交會路線數推論，畫面上附依據。 */
  readonly stationRoleTag = computed(() => {
    const a = this.stationAnswer(), c = this.calendar();
    if (!a || !a.present) return null;
    const sum = (arr: (number | null)[], from: number, to: number) => arr.slice(from, to).reduce<number>((t, v) => t + (v ?? 0), 0);
    const daily = (off: boolean) => {
      const days = c && c.station === a.station ? c.dates.filter(d => d.entries != null && (d.weekend || d.holiday) === off && !(d.weekend && !d.holiday && d.note)) : [];
      return days.length ? days.reduce((t, d) => t + d.entries!, 0) / days.length : null;
    };
    return stationRole({
      amEntries: sum(a.hourly.entries, 7, 10), amExits: sum(a.hourly.exits, 7, 10),
      pmEntries: sum(a.hourly.entries, 17, 20), pmExits: sum(a.hourly.exits, 17, 20),
      weekdayDaily: daily(false), weekendDaily: daily(true), lines: this.stationLineCount().get(a.station) ?? this.linesOf()(a.station).length,
    });
  });
  private readonly coords = signal<Map<string, [number, number]>>(new Map());
  // 地圖站點資料含機場線、淡海輕軌等，交會線數比 linesOf 完整
  private readonly stationLineCount = signal<Map<string, number>>(new Map());
  /** 往來人次依兩站直線距離分短、中、長程。 */
  readonly distanceSummary = computed(() => {
    const a = this.stationAnswer(), coords = this.coords();
    if (!a || !a.present) return null;
    return distanceBands(coords.get(a.station) ?? null, this.direction() === 'outbound' ? a.outbound : a.inbound, s => coords.get(s) ?? null);
  });
  readonly networkBench = signal<{ total: number; compareTotal: number | null } | null>(null);
  private readonly networkBenchCache = new Map<string, { total: number; compareTotal: number | null }>();
  readonly stationBenchText = computed(() => {
    const a = this.stationAnswer(), b = this.networkBench();
    if (!a || !a.present || a.entries == null || !b || b.total <= 0) return '';
    const shareNow = ((a.entries / b.total) * 100).toFixed(1);
    if (a.compare && a.compareEntries != null && a.compareEntries > 0 && b.compareTotal != null && b.compareTotal > 0) {
      const stPct = ((a.entries - a.compareEntries) / a.compareEntries) * 100;
      const netPct = ((b.total - b.compareTotal) / b.compareTotal) * 100;
      const shareBefore = ((a.compareEntries / b.compareTotal) * 100).toFixed(1);
      const cmpWord = Math.abs(stPct - netPct) < 0.5 ? '接近全線同期' : stPct > netPct ? '快於全線同期' : '慢於全線同期';
      return `本站 ${signed(stPct, 1)}%，${cmpWord} ${signed(netPct, 1)}%（占全線進站 ${shareBefore}% → ${shareNow}%）`;
    }
    return `占全線當期進站 ${shareNow}%`;
  });
  readonly stationGuardrail = computed(() => {
    const a = this.stationAnswer();
    if (!a || !a.present) return '';
    const notes: string[] = [];
    const raw = (a.entries ?? 0) * a.period.days;
    if (a.entries != null && raw < 300) notes.push(`原始進站約 ${Math.round(raw)} 人次（小樣本波動較大）`);
    if (a.compare && a.compare.days !== a.period.days) notes.push(`兩期有效天數不同（${a.compare.days} 天對 ${a.period.days} 天）`);
    return notes.join('、');
  });
  readonly hourlyRows = computed(() => {
    const a = this.stationAnswer();
    if (!a) return [];
    return Array.from({ length: 24 }, (_, h) => {
      const entries = a.hourly.entries[h] ?? null;
      const exits = a.hourly.exits[h] ?? null;
      const cmp = a.hourly.compareEntries?.[h] ?? null;
      const delta = entries != null && cmp != null ? entries - cmp : null;
      const pct = delta != null && cmp != null && cmp > 0 ? (delta / cmp) * 100 : null;
      return { h, entries, exits, cmp, delta, pct };
    });
  });
  readonly periodDaysNote = computed(() => {
    const a = this.stationAnswer() ?? this.networkAnswer();
    if (!a) return '';
    const rawNow = 'station' in a && a.entries != null ? ` · 本期原始進站約 ${Math.round(a.entries * a.period.days).toLocaleString('zh-TW')} 人次` : '';
    const rawCmp = 'station' in a && a.compare && a.compareEntries != null ? ` · 對照原始進站約 ${Math.round(a.compareEntries * a.compare.days).toLocaleString('zh-TW')} 人次` : '';
    const cmp = a.compare ? ` · 對照 ${a.compare.days} 天` : '';
    const rec = a.period.recordedHours?.length ? ` · 紀錄時段 ${hourRangesText(a.period.recordedHours)}` : '';
    const off = a.events?.offDays?.length ? ` · 含國定假日 ${a.events.offDays.length} 天（${a.events.offDays.map(d => d.note?.split('/').pop()).slice(0, 2).join('、')}）` : '';
    const mk = a.events?.makeupDays?.length ? ` · 含補班日 ${a.events.makeupDays.length} 天` : '';
    return `有效 ${a.period.days} 天${cmp}${rawNow}${rawCmp}${rec}${off}${mk} · 單位為人次／日（人次不等於人數）`;
  });
  readonly sharedHourBands = computed(() => {
    const answer = this.stationAnswer() ?? this.networkAnswer();
    if (!answer?.compare) return [];
    if (!answer.period.recordedHours || !answer.compare.recordedHours) return [];
    const [start, end] = this.band().split('-').map(Number);
    const currentHours = new Set(answer.period.recordedHours);
    const compareHours = new Set(answer.compare.recordedHours);
    const shared: number[] = [];
    for (let hour = start; hour < end; hour++) {
      if (currentHours.has(hour) && compareHours.has(hour)) shared.push(hour);
    }
    const bands: { start: number; end: number }[] = [];
    for (const hour of shared) {
      const last = bands[bands.length - 1];
      if (last?.end === hour) last.end++;
      else bands.push({ start: hour, end: hour + 1 });
    }
    const requestedHours = end - start;
    return shared.length === requestedHours ? [] : bands;
  });
  readonly compareBasisText = computed(() => {
    const answer = this.stationAnswer() ?? this.networkAnswer();
    if (!answer?.compare) return '';
    if (!answer.period.recordedHours || !answer.compare.recordedHours) return '';
    const current = answer.period.recordedHours;
    const compare = answer.compare.recordedHours;
    const same = current.length === compare.length && current.every((hour, index) => hour === compare[index]);
    return same ? '' : `兩期實際有紀錄時段不同：${this.periodText()} ${hourRangesText(current)}，${this.compareText()} ${hourRangesText(compare)}`;
  });
  hourBandLabel(band: { start: number; end: number }) {
    const format = (hour: number) => `${String(hour).padStart(2, '0')}:00`;
    return `${format(band.start)}–${format(band.end)}`;
  }
  applyHourBand(band: { start: number; end: number }) {
    this.stopPlayback();
    this.band.set(`${band.start}-${band.end}`);
  }
  readonly eventSummary = computed(() => {
    const ev = (this.stationAnswer() ?? this.networkAnswer())?.events;
    if (!ev) return '';
    const tags: string[] = [];
    if (ev.offDays.length) tags.push(`含國定假日 ${ev.offDays.length} 天（${ev.offDays.map(d => `${+d.date.slice(5, 7)}/${+d.date.slice(8)} ${d.note?.split('/').pop() ?? ''}`).slice(0, 3).join('、')}${ev.offDays.length > 3 ? '等' : ''}）`);
    if (ev.makeupDays.length) tags.push(`含補班日 ${ev.makeupDays.length} 天（${ev.makeupDays.map(d => `${+d.date.slice(5, 7)}/${+d.date.slice(8)}`).slice(0, 2).join('、')}）`);
    return tags.join('、');
  });
  /** 事件註記拆成「標題」與「明細項目」，明細每一項不可從中間斷行，括號跟著頭尾兩項，避免括號孤立或詞被切開。 */
  readonly eventNotes = computed(() => {
    const ev = (this.stationAnswer() ?? this.networkAnswer())?.events;
    if (!ev) return [];
    const note = (lead: string, items: string[], more = '') => {
      const parts = items.map((item, i) => item + (i === items.length - 1 ? more : '、'));
      return { lead: lead + '：', items: parts };
    };
    // 「孔子誕辰紀念日/教師節」這類並列名稱只取通稱，避免斜線斷行
    const day = (d: { date: string; note?: string }, withNote: boolean) => `${+d.date.slice(5, 7)}/${+d.date.slice(8)}${withNote && d.note ? ' ' + d.note.split('/').pop() : ''}`;
    const out: { lead: string; items: string[] }[] = [];
    if (ev.offDays.length) out.push(note(`含國定假日 ${ev.offDays.length} 天`, ev.offDays.slice(0, 3).map(d => day(d, true)), ev.offDays.length > 3 ? '等' : ''));
    if (ev.makeupDays.length) out.push(note(`含補班日 ${ev.makeupDays.length} 天`, ev.makeupDays.slice(0, 2).map(d => day(d, false))));
    return out;
  });
  readonly recoveryIndex = computed(() => {
    const t = this.trend();
    if (!t) return null;
    return baselineIndex2017(t.months, this.month());
  });
  readonly matrixMax = computed(() => {
    const m = this.matrix();
    if (!m) return 1;
    let max = 1;
    for (let ri = 0; ri < m.cells.length; ri++) {
      for (let ci = 0; ci < m.cells[ri].length; ci++) {
        if (ri !== ci && m.cells[ri][ci] > max) max = m.cells[ri][ci];
      }
    }
    return max;
  });
  readonly tableNetworkRows = computed(() => sortNetworkTable(this.networkRows(), this.netTableCol(), this.tableDir()));
  readonly catalogStations = computed(() => {
    const c = this.catalog();
    if (!c) return [];
    const q = this.coverageQuery().trim().replace(/臺/g, '台');
    return q ? c.stations.filter(s => s.name.includes(q)) : c.stations;
  });
  readonly catalogMonths = computed(() => [...(this.catalog()?.months ?? [])].reverse());
  readonly peerSummary = computed(() => {
    const a = this.stationAnswer(), b = this.peerAnswer();
    if (!a || !b) return null;
    const peakHour = (arr: (number | null)[]) => {
      let best = -1, val = -1;
      arr.forEach((v, h) => { if (v != null && v > val) { val = v; best = h; } });
      return best >= 0 ? `${best} 點` : '—';
    };
    const peak = Math.max(1, ...a.hourly.entries.map(v => v ?? 0), ...b.hourly.entries.map(v => v ?? 0));
    return {
      aEntries: amount(a.entries), aExits: amount(a.exits), aPeak: peakHour(a.hourly.entries),
      bEntries: amount(b.entries), bExits: amount(b.exits), bPeak: peakHour(b.hourly.entries),
      eDiff: diff(a.entries, b.entries), xDiff: diff(a.exits, b.exits),
      aPoints: hourlySvgPoints(a.hourly.entries, peak),
      bPoints: hourlySvgPoints(b.hourly.entries, peak),
    };
  });

  /** One-tap baselines: the period just before, and the same period a year earlier (same weekday for a date). */
  readonly presets = computed(() => {
    const months = this.availableMonths();
    if (this.unit() === 'month') {
      const m = this.month(), i = months.indexOf(m), prev = i > 0 ? months[i - 1] : null;
      const yoy = `${+m.slice(0, 4) - 1}${m.slice(4)}`;
      const next = (a: string) => { const [y, n] = a.split('-').map(Number); return n === 12 ? `${y + 1}-01` : `${y}-${String(n + 1).padStart(2, '0')}`; };
      return { prev, prevLabel: prev && next(prev) === m ? '上個月' : '前一期', yoy: months.includes(yoy) ? yoy : null, yoyLabel: '去年同月' };
    }
    const back = (days: number) => {
      const d = new Date(this.date() + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - days);
      const s = d.toISOString().slice(0, 10);
      return months.includes(s.slice(0, 7)) && s >= this.firstDate() ? s : null;
    };
    return { prev: back(7), prevLabel: '上週同天', yoy: back(364), yoyLabel: '去年同週' };
  });
  readonly compareChoice = computed(() => {
    const c = this.comparePeriod(), p = this.presets();
    return !c ? 'none' : c === p.prev ? 'prev' : c === p.yoy ? 'yoy' : 'custom';
  });

  /** One request key per query, so a slower earlier answer never overwrites a newer one. */
  private readonly request = computed(() => {
    const [start, end] = this.band().split('-');
    const params: Record<string, string> = { period: this.period(), days: this.days(), start, end };
    const compare = this.comparePeriod();
    if (compare && compare !== this.period()) params['compare'] = compare;
    if (this.mode() === 'station') return { url: '/api/v1/od/station', params: { ...params, name: this.station() } };
    if (this.unit() === 'date') params['hourly'] = 'true';
    return { url: '/api/v1/od/network', params };
  });
  private activeRequest?: Subscription;
  private prefetched?: { key: string; query: Observable<ExploreAnswer>; subscription: Subscription };

  readonly relations = computed(() => {
    const a = this.stationAnswer();
    if (!a) return [];
    const rows = this.direction() === 'outbound' ? a.outbound : a.inbound;
    const q = this.query().trim().replace(/臺/g, '台'), line = this.lineFilter(), linesOf = this.linesOf();
    const sorted = sortRelations(rows.filter(r => (!q || r.station.includes(q)) && (!line || linesOf(r.station).some(l => l.code === line))), this.relationSort());
    return this.relationSortReverse() ? [...sorted].reverse() : sorted;
  });
  readonly visibleRelations = computed(() => {
    const rows = this.relations(), focused = this.focusedRelation();
    if (this.focusOnly() && focused) {
      const hit = rows.filter(r => r.station === focused);
      if (hit.length) return hit;
    }
    return rows.slice(0, this.shown());
  });
  readonly relationSwing = computed(() => Math.max(1, ...this.relations().map(r => Math.abs(change(r.daily, r.compareDaily) ?? 0))));
  readonly relationScale = computed(() => Math.max(1, ...this.relations().map(r => Math.max(r.daily ?? 0, r.compareDaily ?? 0))));

  readonly networkRows = computed(() => {
    const a = this.networkAnswer();
    if (!a) return [];
    const q = this.query().trim().replace(/臺/g, '台'), line = this.lineFilter(), linesOf = this.linesOf();
    const sorted = sortNetwork(a.stations.filter(r => (!q || r.station.includes(q)) && (!line || linesOf(r.station).some(l => l.code === line))), this.networkSort());
    return this.networkSortReverse() ? [...sorted].reverse() : sorted;
  });
  readonly networkSwing = computed(() => Math.max(1, ...this.networkRows().map(r => Math.abs(change(r.entries, r.compareEntries) ?? 0))));
  readonly networkScale = computed(() => Math.max(1, ...this.networkRows().map(r => Math.max(r.entries ?? 0, r.compareEntries ?? 0))));
  private readonly rankedRows = computed(() => this.mode() === 'station'
    ? (this.listStyle() === 'table' ? this.tableRelations() : this.relations())
    : (this.listStyle() === 'table' ? this.tableNetworkRows() : this.networkRows()));
  readonly selectedRank = computed(() => this.rankedRows().find(row => row.station === this.focusedStation())?.station ?? null);
  readonly previewedRank = computed(() => this.rankedRows().find(row => row.station === this.rankPreview()?.station)?.station ?? null);
  readonly linkedRank = computed(() => this.previewedRank() ?? this.selectedRank());
  readonly rankArc = computed(() => {
    if (this.mode() !== 'station') return null;
    const other = this.relations().find(row => row.station === this.linkedRank());
    if (!other) return null;
    const value = this.stationAnswer()?.compare && this.mapMetric() === 'change'
      ? change(other.daily, other.compareDaily) : other.daily;
    if (!value) return null;
    const station = this.station(), outbound = this.direction() === 'outbound';
    return { from: outbound ? station : other.station, to: outbound ? other.station : station, dashed: value < 0 };
  });
  private readonly rankChartScale = computed(() => this.mode() === 'station' ? this.relationScale()
    : Math.max(1, ...this.networkRows().map(row => Math.max(row.entries ?? 0, row.exits ?? 0, row.compareEntries ?? 0))));
  readonly rankChart = computed<RankChartData | null>(() => {
    const rows = this.rankedRows();
    const row = rows.find(row => row.station === this.linkedRank()) ?? rows[0];
    if (!row) return null;
    const compare = this.mode() === 'station' ? this.stationAnswer()?.compare : this.networkAnswer()?.compare;
    const bars = 'daily' in row
      ? [{ label: '本期', value: row.daily }, ...(compare ? [{ label: '對照', value: row.compareDaily ?? null }] : [])]
      : [{ label: '進站', value: row.entries }, { label: '出站', value: row.exits, empty: row.exitCovered === false ? '資料不足' : '無紀錄' },
        ...(compare ? [{ label: '對照進站', value: row.compareEntries ?? null }] : [])];
    return { station: row.station, bars, scale: this.rankChartScale() };
  });
  readonly lineSummaries = computed(() => {
    const a = this.networkAnswer(), openings = this.catalog()?.lineOpenings;
    if (!a || !openings) return [];
    return summarizeByLine(a.stations, station => this.linesOf()(station)
      .map(({ code }) => ({ code, opened: openings[code]?.[station] })), this.lineNames, a.period.spec, a.compare?.spec ?? null);
  });
  readonly lineSummaryMax = computed(() => Math.max(1, ...this.lineSummaries().map(l => Math.max(l.entries ?? 0, l.compareEntries ?? 0))));

  readonly hourChart = computed(() => {
    const a = this.stationAnswer();
    if (!a) return null;
    const side = this.hourSide();
    if (side === 'both') {
      const peak = Math.max(1, ...a.hourly.entries.map(v => v ?? 0), ...a.hourly.exits.map(v => v ?? 0));
      const busiest = a.hourly.entries.reduce<number>((best, v, h) => (v ?? -1) > (a.hourly.entries[best] ?? -1) ? h : best, 0);
      return {
        bars: [],
        both: { entries: hourlySvgPoints(a.hourly.entries, peak), exits: hourlySvgPoints(a.hourly.exits, peak) },
        busiest, busiestValue: a.hourly.entries[busiest],
      };
    }
    const key = side === 'exits' ? 'exits' : 'entries';
    const now = a.hourly[key], before = key === 'entries' ? a.hourly.compareEntries : a.hourly.compareExits;
    const peak = Math.max(1, ...now.map(v => v ?? 0), ...(before ?? []).map(v => v ?? 0));
    const [from, to] = this.band().split('-').map(Number);
    const busiest = now.reduce<number>((best, v, h) => (v ?? -1) > (now[best] ?? -1) ? h : best, 0);
    return {
      bars: now.map((v, h) => ({ h, now: v == null ? null : v / peak, before: before?.[h] == null ? null : before[h]! / peak, picked: to - from < 24 && h >= from && h < to })),
      both: null,
      busiest, busiestValue: now[busiest],
    };
  });

  readonly calendarChart = computed(() => {
    const c = this.calendar();
    if (!c) return null;
    const known = c.dates.filter((d): d is typeof d & { entries: number } => d.entries != null);
    const peak = Math.max(1, ...known.map(d => d.entries));
    const marks = unusualDays(c.dates);
    const notes = c.dates
      .filter(d => d.note)
      .map(d => `${+d.date.slice(5, 7)}/${+d.date.slice(8)} ${d.note}`)
      .join('、');
    return {
      peak, notes, surges: marks.filter(m => m.mark === 'surge').length,
      dates: c.dates.map((d, i) => ({
        ...d,
        column: i === 0 ? (new Date(d.date + 'T00:00:00Z').getUTCDay() + 6) % 7 + 1 : null,
        day: +d.date.slice(8),
        height: d.entries == null ? null : d.entries / peak,
        off: d.weekend || d.holiday,
        low: marks[i].mark === 'low',
        surge: marks[i].mark === 'surge',
        ratio: marks[i].ratio,
      })),
    };
  });

  readonly trendChart = computed(() => {
    const t = this.trend();
    if (!t) return null;
    const known = t.months.filter(m => m.entries != null);
    const peak = Math.max(1, ...known.map(m => m.entries!));
    const openings = this.catalog()?.lineOpenings ?? {};
    const station = this.mode() === 'station' ? this.station() : null;
    const milestoneMap = new Map<string, string[]>();
    if (station) {
      for (const [code, dates] of Object.entries(openings)) {
        const opened = dates?.[station]?.slice(0, 7);
        if (opened) milestoneMap.set(opened, [...(milestoneMap.get(opened) ?? []), code]);
      }
    }
    const labelMap = new Map([...milestoneMap].map(([month, codes]) => [month, [codes.join(' / ') + ' 線通車']]));
    const eventMonths = new Set<string>();
    for (const e of NETWORK_EVENTS) {
      const month = e.date.slice(0, 7);
      eventMonths.add(month);
      labelMap.set(month, [...(labelMap.get(month) ?? []), e.label]);
    }
    const months = t.months.map((m, i) => {
      const labels = labelMap.get(m.month);
      return {
        ...m,
        height: m.entries == null ? null : m.entries / peak,
        year: i === 0 || m.month.slice(0, 4) !== t.months[i - 1].month.slice(0, 4),
        milestone: labels ? labels.join('、') : null,
        mark: milestoneMap.has(m.month) ? '通車' : eventMonths.has(m.month) ? '事件' : null,
      };
    });
    const milestones = [...labelMap.entries()]
      .filter(([month]) => t.months.some(m => m.month === month))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, labels]) => ({ month, label: labels.join('、') }));
    const markers = milestones.map(ms => ({ ...ms, x: (t.months.findIndex(m => m.month === ms.month) / Math.max(1, t.months.length - 1) * 240).toFixed(1) }));
    const targetMm = this.month().slice(5);
    const sameMonthRows = months.filter(m => m.month.endsWith('-' + targetMm) && m.entries != null);
    const samePeak = Math.max(1, ...sameMonthRows.map(m => m.entries!));
    const sameMonth = sameMonthRows.map(m => ({ ...m, height: m.entries! / samePeak }));
    const linePoints = hourlySvgPoints(t.months.map(m => m.entries), peak);
    const baseRows = t.months.filter(m => m.month.endsWith('-' + targetMm) && m.month.slice(0, 4) <= '2019' && m.entries != null);
    const base = baseRows.length ? baseRows.reduce((s, m) => s + m.entries!, 0) / baseRows.length : null;
    const baseY = base != null && peak > 0 ? (60 - 3 - (base / peak) * 54).toFixed(1) : null;
    return { peak, months, milestones, markers, targetMm: +targetMm, sameMonth, linePoints, baseY, firstMonth: t.months[0]?.month ?? '', lastMonth: t.months[t.months.length - 1]?.month ?? '' };
  });

  readonly basisExpanded = signal(false);
  /** The two or so numbers that answer "how busy, and how different". */
  readonly stats = computed(() => {
    const stat = (label: string, now: number | null, before: number | null | undefined) => {
      const top = Math.max(now ?? 0, before ?? 0) || 1;
      const unit = amount(now).unit;
      const value = now === null ? null : now / (unit === '萬人' ? 1e4 : 1);
      const format = unit === '萬人' && Math.abs(now ?? 0) < 1e6 ? 'decimal' as const : 'integer' as const;
      return { label, value, unit, format, diff: this.comparePeriod() ? diff(now, before) : null, wNow: (now ?? 0) / top, wBefore: (before ?? 0) / top };
    };
    const period = (this.stationAnswer() ?? this.networkAnswer())?.period;
    if (!period) return [];
    const one = period.kind === 'month' ? '每天' : period.hours[1] - period.hours[0] === 1 ? '該小時' : '當天';
    if (this.mode() === 'station') {
      const a = this.stationAnswer();
      return a && a.present ? [stat(one + '進站', a.entries, a.compareEntries), stat(one + '出站', this.exitGap() ? null : a.exits, this.exitGap() || a.compareExitCovered === false ? null : a.compareExits)] : [];
    }
    const a = this.networkAnswer();
    return a ? [stat(`全線${one}進站`, a.total, a.compareTotal)] : [];
  });
  /** With a comparison: the counterpart (or station) that gained most and the one that lost most. */
  readonly movers = computed(() => {
    if (!this.comparePeriod()) return null;
    const rows = this.mode() === 'station'
      ? (this.stationAnswer()?.[this.direction()] ?? []).map(r => ({ station: r.station, d: change(r.daily, r.compareDaily) }))
      : (this.networkAnswer()?.stations ?? []).map(r => ({ station: r.station, d: change(r.entries, r.compareEntries) }));
    const known = rows.filter((r): r is { station: string; d: number } => r.d != null && r.d !== 0);
    if (!known.length) return null;
    const up = known.reduce((a, b) => b.d > a.d ? b : a), down = known.reduce((a, b) => b.d < a.d ? b : a);
    const say = (r: { station: string; d: number }) => ({ station: r.station, text: `${r.d > 0 ? '多' : '少'} ${amount(Math.abs(r.d)).value} ${amount(Math.abs(r.d)).unit}` });
    return { up: up.d > 0 ? say(up) : null, down: down.d < 0 ? say(down) : null };
  });
  readonly abs = Math.abs;

  readonly glue = glue;
  readonly headline = computed(() => glue(this.rawHeadline()));
  private readonly rawHeadline = computed(() => {
    const c = this.compareText();
    const frequency = this.unit() === 'date' ? '當天' : '平均每天';
    if (this.mode() === 'network') {
      const a = this.networkAnswer();
      if (!a) return '';
      const g = growth(a.total, a.compareTotal);
      return `全線${frequency}約 ${Math.round(a.total).toLocaleString('zh-TW')} 人次進站` + (c && g != null ? `，比${c}${g >= 0 ? '多' : '少'} ${Math.abs(g).toFixed(1)}%。` : '。');
    }
    const a = this.stationAnswer();
    if (!a) return '';
    if (!a.present) return `還查不到${a.station}這段期間的旅次，這站當時可能還沒通車。`;
    const g = growth(a.entries, a.compareEntries);
    const partial = this.unit() === 'month' && this.firstDate().slice(0, 7) === a.period.spec && this.firstDate().slice(8) > '01'
      ? `（通車當月，僅含 ${+this.firstDate().slice(8)} 日起部分天數）` : '';
    const head = `${a.station}${frequency}約 ${Math.round(a.entries ?? 0).toLocaleString('zh-TW')} 人進站、${Math.round(a.exits ?? 0).toLocaleString('zh-TW')} 人出站${partial}`;
    if (!c) return head + '。';
    if (a.comparePresent === false) return `${head}。${c} 這站還沒有旅次紀錄。`;
    return `${head}，進站比${c}${(g ?? 0) >= 0 ? '多' : '少'} ${Math.abs(g ?? 0).toFixed(1)}%。`;
  });

  private readonly http = inject(HttpClient);

  constructor() {
    autoRetry(() => !!this.failure() && this.failureRetryable() && !this.loading(), () => this.retry());
    autoRetry(() => this.calendarFailure(), () => this.retryCalendar());
    autoRetry(() => this.trendFailure(), () => this.retryTrend());
    autoRetry(() => this.matrixFailure(), () => this.retryMatrix());
    autoRetry(() => this.leadersFailure(), () => this.retryLeaders());
    autoRetry(() => this.catalogFailure(), () => this.retryCatalog());
    this.restore();
    // 只供距離分布與車站角色使用，載入失敗時這兩塊不顯示
    fetch('metro/stations.geojson').then(r => r.json()).then((g: { features: { properties: { name: string; lines: string }; geometry: { coordinates: [number, number] } }[] }) => {
      this.coords.set(new Map(g.features.map(f => [f.properties.name, f.geometry.coordinates])));
      this.stationLineCount.set(new Map(g.features.map(f => [f.properties.name, f.properties.lines.split(',').length])));
    }).catch(() => undefined);
    effect(() => {
      const station = this.station(), order = this.lineOrder();
      const code = this.lineCodes.find(line => order[line].includes(station));
      if (code) this.pickerLine.set(code);
    });
    effect(() => {
      const months = this.availableMonths(), firstDate = this.firstDate(), station = this.station();
      const period = this.period(), cmpSpec = this.comparePeriod();
      if (!this.monthsReady() && !this.stationCoverage()) return;
      untracked(() => {
        const notices: string[] = [];
        const primary = resolveAvailablePeriod(period, months, firstDate, station, false);
        if (primary.notice) {
          this.stopPlayback();
          this.month.set(primary.period.slice(0, 7));
          if (primary.period.length === 10) this.date.set(primary.period);
          else if (this.date().slice(0, 7) !== primary.period) this.date.set(this.datesForMonth(primary.period)[0] ?? primary.period + '-01');
          if (primary.dayType && this.days() !== 'all' && this.days() !== primary.dayType) this.days.set(primary.dayType);
          notices.push(primary.notice);
        }
        if (cmpSpec) {
          const cmp = resolveAvailablePeriod(cmpSpec, months, firstDate, station, true);
          if (cmp.notice) {
            let target = cmp.period;
            if (target === this.period()) {
              const alt = months.find(m => m !== this.month());
              if (alt) {
                target = cmpSpec.length === 10 ? (firstDate && firstDate.startsWith(alt) ? firstDate : `${alt}-01`) : alt;
                notices.push(`對照期 ${cmpSpec} ${station}尚未通車，已切換到 ${target}`);
              } else {
                this.setCompare(null);
                notices.push(`對照期 ${cmpSpec} ${station}尚未通車，已取消對照`);
                target = '';
              }
            } else {
              notices.push(cmp.notice);
            }
            if (target) {
              this.compareMonth.set(target.slice(0, 7));
              if (target.length === 10) this.compareDate.set(target);
              else if (this.compareDate().slice(0, 7) !== target) this.compareDate.set(this.datesForMonth(target)[0] ?? target + '-01');
            }
          }
        } else if (!months.includes(this.compareMonth())) {
          const alternate = months.find(m => m !== this.month());
          if (alternate) this.setCompareMonth(alternate);
        }
        if (notices.length) this.availabilityNotice.set(notices.join('。'));
      });
    });
    effect(onCleanup => {
      const r = this.request(), months = this.availableMonths(), pending = this.availability() == null && this.mode() === 'station';
      if (!pending && !this.unavailable() && !this.sameAsCompare() && months.includes(r.params['period'].slice(0, 7))
          && (r.params['period'].length !== 10 || r.params['period'] >= this.firstDate())
          && (!r.params['compare'] || (months.includes(r.params['compare'].slice(0, 7))
            && (r.params['compare'].length !== 10 || r.params['compare'] >= this.firstDate())))) {
        untracked(() => this.load(r));
        onCleanup(() => this.activeRequest?.unsubscribe());
      } else {
        this.clearPrefetch();
        this.loading.set(false);
      }
    });
    effect(() => {
      if (this.activeSection() !== 'days' && this.unit() !== 'date' && this.mode() !== 'station') return;
      const station = this.mode() === 'station' ? this.station() : '', month = this.month();
      if ((!station || this.availability()) && !this.unavailable() && this.availableMonths().includes(month)) void this.loadSide(station, month);
    });
    effect(() => {
      if (this.activeSection() === 'years' && !this.unavailable()) {
        const station = this.mode() === 'station' ? this.station() : '';
        void this.loadTrend(station, this.days());
      }
    });
    effect(() => {
      const section = this.activeSection();
      const lineTotals = this.mode() === 'network' && section === 'list' && this.listStyle() === 'lines';
      if ((section === 'coverage' || section === 'years' || lineTotals) && !this.catalog() && !this.catalogLoading() && !this.catalogFailure()) {
        void this.loadCatalog();
      }
    });
    effect(() => {
      if (this.activeSection() !== 'matrix') return;
      const [start, end] = this.band().split('-');
      void this.loadMatrix({ period: this.period(), days: this.days(), start, end, limit: '12' });
    });
    effect(() => {
      if (this.activeSection() !== 'leaders' || this.sameAsCompare()) return;
      const [start, end] = this.band().split('-');
      const params: Record<string, string> = { period: this.period(), days: this.days(), start, end, limit: '10' };
      const cmp = this.comparePeriod();
      if (cmp) params['compare'] = cmp;
      void this.loadLeaders(params);
    });
    effect(() => {
      const peer = this.peerStation();
      if (this.mode() !== 'station' || !peer || peer === this.station()) {
        this.peerAnswer.set(null);
        return;
      }
      const [start, end] = this.band().split('-');
      const params: Record<string, string> = { name: peer, period: this.period(), days: this.days(), start, end };
      void this.loadPeer(params);
    });
    effect(() => this.layer.emit(this.mapLayer()));
    // Comparing is about differences, so the lists switch to "biggest change first" and back.
    effect(() => { const c = this.isComparing(); untracked(() => { this.relationSort.set(c ? 'change' : 'daily'); this.networkSort.set(c ? 'change' : 'entries'); }); });
    effect(() => { if (this.mode()) history.replaceState(null, '', this.url()); });
  }

  // ----- Query plumbing -----
  private requestKey(r: ExploreRequest) {
    return r.url + '?' + new URLSearchParams(r.params).toString();
  }

  private clearPrefetch() {
    this.prefetched?.subscription.unsubscribe();
    this.prefetched = undefined;
  }

  private prefetchNext(r: ExploreRequest) {
    if (!this.playing() || document.hidden || this.requestKey(r) !== this.requestKey(this.request())) return;
    const start = Number(r.params['end']);
    if (r.params['period'].length !== 10 || start >= 24 || start - Number(r.params['start']) !== 1) return;
    const next = { url: r.url, params: { ...r.params, start: String(start), end: String(start + 1) } };
    this.clearPrefetch();
    const query = this.http.get<ExploreAnswer>(next.url, { params: next.params }).pipe(shareReplay({ bufferSize: 1, refCount: true }));
    const key = this.requestKey(next);
    let failed = false;
    const subscription = query.subscribe({ error: () => {
      failed = true;
      if (this.prefetched?.query === query) this.clearPrefetch();
    } });
    if (!failed) this.prefetched = { key, query, subscription };
  }

  private load(r: ExploreRequest, retried = false) {
    this.activeRequest?.unsubscribe();
    ++this.benchSerial;
    this.networkBench.set(null);
    this.loading.set(true); this.failure.set(''); this.failureRetryable.set(false); this.unrecorded.set(false); this.shown.set(PAGE);
    const prefetched = this.prefetched?.key === this.requestKey(r) ? this.prefetched : undefined;
    if (prefetched) this.prefetched = undefined;
    else this.clearPrefetch();
    const query = prefetched?.query ?? this.http.get<ExploreAnswer>(r.url, { params: r.params });
    const hourly = Number(r.params['end']) - Number(r.params['start']) === 1;
    const previous = this.stationAnswer() ?? this.networkAnswer();
    if (previous && ('station' in previous) !== r.url.endsWith('station')) {
      this.stationAnswer.set(null); this.networkAnswer.set(null);
    }
    this.activeRequest = (hourly && !prefetched ? timer(90).pipe(switchMap(() => query)) : query).subscribe({
      next: answer => {
        this.stationAnswer.set('station' in answer ? answer : null);
        this.networkAnswer.set('stations' in answer ? { ...answer, stations: maskUncoveredExits(answer.stations) } : null);
        if (answer.period.kind === 'date') {
          const profile = 'station' in answer ? { key: answer.period.spec + ':' + answer.station, ...answer.hourly }
            : answer.hourly ? { key: answer.period.spec, entries: answer.hourly } : null;
          if (profile) this.profile.set(profile);
        }
        if ('station' in answer && answer.present) {
          void this.loadNetworkBench(r.params).then(() => this.prefetchNext(r));
        } else {
          if ('stations' in answer) this.networkBench.set({ total: answer.total, compareTotal: answer.compareTotal });
          this.prefetchNext(r);
        }
        this.loading.set(false);
      },
      error: (error: unknown) => {
        if (error instanceof HttpErrorResponse && error.error?.code === 'unrecorded_hours') {
          this.unrecorded.set(true);
          this.stationAnswer.set(null); this.networkAnswer.set(null);
        } else if (error instanceof HttpErrorResponse && (error.status === 429 || error.status === 502 || error.status === 503 || error.status === 504 || error.status === 0) && !retried) {
          const isRate = error.status === 429;
          this.failure.set(isRate ? '查詢太頻繁，2 秒後自動重試' : '資料服務重啟中，3 秒後自動重試');
          this.loading.set(false);
          this.activeRequest = timer(isRate ? 2000 : 3000).subscribe(() => this.load(r, true));
          return;
        } else {
          const retryable = !(error instanceof HttpErrorResponse) || error.status === 0 || error.status === 429 || error.status >= 500;
          this.failureRetryable.set(retryable);
          this.failure.set(retryable ? '資料服務暫時連不上，網頁會自動重試，也可以直接按重新查詢' : exploreErrorMessage((error as HttpErrorResponse).status, (error as HttpErrorResponse).error?.error));
          this.stationAnswer.set(null); this.networkAnswer.set(null);
        }
        this.loading.set(false);
      },
    });
    prefetched?.subscription.unsubscribe();
  }

  private benchSerial = 0;
  private async loadNetworkBench(params: Record<string, string>) {
    const id = ++this.benchSerial;
    const key = [params['period'], params['compare'] ?? '', params['days'], params['start'], params['end']].join('|');
    const hit = this.networkBenchCache.get(key);
    if (hit) { if (id === this.benchSerial) this.networkBench.set(hit); return; }
    const netParams: Record<string, string> = { period: params['period'], days: params['days'], start: params['start'], end: params['end'] };
    if (params['compare']) netParams['compare'] = params['compare'];
    try {
      const n = await firstValueFrom(this.http.get<NetworkAnswer>('/api/v1/od/network', { params: netParams }));
      const val = { total: n.total, compareTotal: n.compareTotal };
      this.networkBenchCache.set(key, val);
      if (id === this.benchSerial) this.networkBench.set(val);
    } catch {
      await new Promise(resolve => setTimeout(resolve, 2500));
      if (id !== this.benchSerial) return;
      try {
        const n = await firstValueFrom(this.http.get<NetworkAnswer>('/api/v1/od/network', { params: netParams }));
        const val = { total: n.total, compareTotal: n.compareTotal };
        this.networkBenchCache.set(key, val);
        if (id === this.benchSerial) this.networkBench.set(val);
      } catch { /* secondary benchmark unavailable after retry */ }
    }
  }

  private sideSerial = 0;
  private async loadSide(station: string, month: string) {
    const id = ++this.sideSerial;
    this.calendarLoading.set(true); this.calendarFailure.set(false);
    this.calendar.set(null);
    try {
      const params: Record<string, string> = { month };
      if (station) params['name'] = station;
      const c = await firstValueFrom(this.http.get<CalendarAnswer>('/api/v1/od/calendar', { params }));
      if (id === this.sideSerial) this.calendar.set(c);
    } catch { if (id === this.sideSerial) { this.calendar.set(null); this.calendarFailure.set(true); } }
    finally { if (id === this.sideSerial) this.calendarLoading.set(false); }
  }

  private trendSerial = 0;
  private async loadTrend(station: string, days: DayType) {
    const id = ++this.trendSerial;
    this.trendLoading.set(true); this.trendFailure.set(false);
    this.trend.set(null);
    try {
      const params: Record<string, string> = { days };
      if (station) params['name'] = station;
      const t = await firstValueFrom(this.http.get<TrendAnswer>('/api/v1/od/trend', { params }));
      if (id === this.trendSerial) this.trend.set(t);
    } catch { if (id === this.trendSerial) { this.trend.set(null); this.trendFailure.set(true); } }
    finally { if (id === this.trendSerial) this.trendLoading.set(false); }
  }

  private catalogSerial = 0;
  private async loadCatalog() {
    const id = ++this.catalogSerial;
    this.catalogLoading.set(true); this.catalogFailure.set(false);
    try {
      const c = await firstValueFrom(this.http.get<CatalogAnswer>('/api/v1/od/catalog'));
      if (id === this.catalogSerial) this.catalog.set(c);
    } catch { if (id === this.catalogSerial) this.catalogFailure.set(true); }
    finally { if (id === this.catalogSerial) this.catalogLoading.set(false); }
  }

  private matrixSerial = 0;
  private async loadMatrix(params: Record<string, string>) {
    const id = ++this.matrixSerial;
    this.matrixLoading.set(true); this.matrixFailure.set(false);
    try {
      const m = await firstValueFrom(this.http.get<MatrixAnswer>('/api/v1/od/matrix', { params }));
      if (id === this.matrixSerial) this.matrix.set(m);
    } catch { if (id === this.matrixSerial) { this.matrix.set(null); this.matrixFailure.set(true); } }
    finally { if (id === this.matrixSerial) this.matrixLoading.set(false); }
  }

  private leadersSerial = 0;
  private async loadLeaders(params: Record<string, string>) {
    const id = ++this.leadersSerial;
    this.leadersLoading.set(true); this.leadersFailure.set(false);
    try {
      const l = await firstValueFrom(this.http.get<LeadersAnswer>('/api/v1/od/leaders', { params }));
      if (id === this.leadersSerial) this.leaders.set(l);
    } catch { if (id === this.leadersSerial) { this.leaders.set(null); this.leadersFailure.set(true); } }
    finally { if (id === this.leadersSerial) this.leadersLoading.set(false); }
  }

  private peerSerial = 0;
  private async loadPeer(params: Record<string, string>) {
    const id = ++this.peerSerial;
    this.peerLoading.set(true);
    try {
      const a = await firstValueFrom(this.http.get<StationAnswer>('/api/v1/od/station', { params }));
      if (id === this.peerSerial) this.peerAnswer.set(a);
    } catch { if (id === this.peerSerial) this.peerAnswer.set(null); }
    finally { if (id === this.peerSerial) this.peerLoading.set(false); }
  }

  private describe(spec: string) { return periodLabel(spec, this.days()) + (this.band() !== '0-24' ? ` ${this.band().replace('-', '–')} 點` : ''); }

  // ----- Actions -----
  stationCode(line: string, station: string) { return this.stationCodes()[line]?.[station] ?? line; }
  stationUnavailable(station: string) {
    const availability = this.availability();
    return !!availability && Object.keys(availability).length > 0 && !availability[station]?.months.length;
  }
  private datesForMonth(month: string) { return monthDates(month).filter(date => date >= this.firstDate()); }
  private moveToAvailableMonth(months: readonly string[]) {
    const current = this.month();
    const value = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5));
    const nearest = months.reduce((best, m) => Math.abs(value(m) - value(current)) < Math.abs(value(best) - value(current)) ? m : best, months[0]);
    if (!nearest) return;
    this.stopPlayback();
    const day = Math.min(Number(this.date().slice(8)), monthDates(nearest).length);
    this.month.set(nearest);
    this.date.set(`${nearest}-${String(day).padStart(2, '0')}`);
    this.availabilityNotice.set(`此站 ${nearest} 才有紀錄，已切換`);
  }
  retry() { void this.load(this.request()); }
  retryCalendar() { void this.loadSide(this.mode() === 'station' ? this.station() : '', this.month()); }
  retryTrend() { void this.loadTrend(this.mode() === 'station' ? this.station() : '', this.days()); }
  retryCatalog() { void this.loadCatalog(); }
  retryMatrix() { const [start, end] = this.band().split('-'); void this.loadMatrix({ period: this.period(), days: this.days(), start, end, limit: '12' }); }
  retryLeaders() {
    const [start, end] = this.band().split('-');
    const params: Record<string, string> = { period: this.period(), days: this.days(), start, end, limit: '10' };
    const cmp = this.comparePeriod();
    if (cmp) params['compare'] = cmp;
    void this.loadLeaders(params);
  }
  sortRelationCol(col: RelationTableColumn) {
    if (this.relTableCol() === col) this.tableDir.set(this.tableDir() === 'desc' ? 'asc' : 'desc');
    else { this.relTableCol.set(col); this.tableDir.set(col === 'station' ? 'asc' : 'desc'); }
  }
  sortNetworkCol(col: NetworkTableColumn) {
    if (this.netTableCol() === col) this.tableDir.set(this.tableDir() === 'desc' ? 'asc' : 'desc');
    else { this.netTableCol.set(col); this.tableDir.set(col === 'station' ? 'asc' : 'desc'); }
  }
  focusTableStation(name: string) {
    this.rankPreview.set(null);
    if (this.mode() === 'station') {
      this.selectRelation(name);
      return;
    }
    this.focusedStation.set(name);
    this.rankSelected.emit(name);
  }
  previewRank(name: string | null, source: 'rank' | 'map', event?: PointerEvent | FocusEvent) {
    if (event instanceof PointerEvent && event.pointerType !== 'mouse') return;
    if (name && event instanceof FocusEvent && !(event.target instanceof HTMLElement && event.target.matches(':focus-visible'))) return;
    if (name && this.rankedRows().some(row => row.station === name)) {
      const previous = this.rankPreview();
      if (previous?.station !== name || previous.source !== source) this.rankPreview.set({ station: name, source });
    } else if (this.rankPreview()?.source === source) this.rankPreview.set(null);
  }

  selectRankFromMap(name: string): boolean {
    const exists = this.rankedRows().some(row => row.station === name);
    if (!exists) return false;
    this.focusTableStation(name);
    this.revealLinkedRank();
    return true;
  }

  revealLinkedRank() {
    const name = this.selectedRank();
    if (!name || this.activeSection() !== 'list' || this.listStyle() === 'lines' || this.listCollapsed()) return;
    const index = this.rankedRows().findIndex(row => row.station === name);
    if (index >= this.shown()) this.shown.set(Math.ceil((index + 1) / PAGE) * PAGE);
    afterNextRender(() => requestAnimationFrame(() => {
      const row = Array.from(this.host.querySelectorAll<HTMLElement>('[data-rank-station]')).find(el => el.dataset['rankStation'] === name);
      if (!row?.getClientRects().length || this.selectedRank() !== name) return;
      revealRankRow(row, this.motion.reduced());
    }), { injector: this.injector });
  }
  /** Keeps the selected station as the origin and focuses the chosen OD counterpart. */
  focusRelation(name: string | null) {
    this.rankPreview.set(null);
    this.focusedRelation.set(name);
    this.focusedStation.set(name);
    this.peerStation.set(name && name !== this.station() ? name : null);
  }
  selectRelation(name: string) { this.focusRelation(name); this.rankSelected.emit(name); }
  swapPeer() {
    const peer = this.peerStation();
    if (!peer) return;
    const prev = this.station();
    this.station.set(peer);
    this.peerStation.set(prev);
    this.focusedStation.set(prev);
    this.focusedRelation.set(prev);
  }
  /** 收藏面板用的預設名稱 */
  saveName() {
    return `${this.mode() === 'station' ? this.station() : '全網'} · ${this.unit() === 'date' ? this.periodDate() : this.periodBaseText()} ${this.hoursText()}`;
  }
  openFromCoverageStation(name: string) {
    if (this.mode() === 'station') { this.pickStation(name); this.section.set('list'); }
    else this.openStation.emit(name);
  }
  openFromCoverageMonth(month: string) {
    this.pickMonth(month);
    this.section.set('list');
  }
  setUnit(unit: 'month' | 'date') {
    this.stopPlayback();
    if (unit === 'month' && this.activeHour() != null) this.band.set('0-24');
    if (unit === 'date' && (this.date().slice(0, 7) !== this.month() || this.date() < this.firstDate())) {
      this.date.set(this.datesForMonth(this.month())[0]);
    }
    this.unit.set(unit);
  }
  /** The neighbouring date, only when its month has data. */
  private neighbour(step: number) {
    const d = new Date(this.date() + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + step);
    const s = d.toISOString().slice(0, 10);
    return this.availableMonths().includes(s.slice(0, 7)) && s >= this.firstDate() ? s : null;
  }
  readonly prevDate = computed(() => this.unit() === 'date' ? this.neighbour(-1) : null);
  readonly nextDate = computed(() => this.unit() === 'date' ? this.neighbour(1) : null);
  step(spec: string | null) { this.stopPlayback(); if (spec) { this.month.set(spec.slice(0, 7)); this.date.set(spec); } }
  /** The calendar's name for the chosen day, such as 國慶日 or 補行上班. */
  readonly dateNote = computed(() => this.calendar()?.dates.find(d => d.date === this.date())?.note ?? '');

  toggle(part: 'station' | 'time' | 'compare' | 'peer') { this.editing.set(this.editing() === part ? null : part); }
  setCompare(spec: string | null) {
    if (spec == null) { this.comparing.set(false); if (this.editing() === 'compare') this.editing.set(null); return; }
    this.comparing.set(true); this.compareUnit.set(spec.length === 10 ? 'date' : 'month'); this.compareMonth.set(spec.slice(0, 7));
    if (spec.length === 10) this.compareDate.set(spec);
    if (this.editing() === 'compare') this.editing.set(null);
  }
  customCompare() { this.comparing.set(true); this.compareUnit.set(this.unit()); this.editing.set('compare'); }
  pickStation(name: string) {
    if (this.stationUnavailable(name)) return;
    if (name !== this.station()) this.focusRelation(null);
    this.station.set(name); this.query.set(''); this.lineFilter.set('');
    this.availabilityNotice.set('');
    if (this.editing() === 'station') this.editing.set(null);
  }
  pickDate(date: string) { this.stopPlayback(); this.unit.set('date'); this.date.set(date); }
  pickMonth(month: string) { this.setUnit('month'); this.month.set(month); this.date.set(this.datesForMonth(month)[0]); }
  setMonth(month: string) { this.availabilityNotice.set(''); this.month.set(month); if (this.date().slice(0, 7) !== month) this.date.set(month + '-01'); }
  setCompareMonth(month: string) { this.compareMonth.set(month); if (this.compareDate().slice(0, 7) !== month) this.compareDate.set(this.datesForMonth(month)[0]); }
  setLine(code: string) { this.lineFilter.set(this.lineFilter() === code ? '' : code); this.shown.set(PAGE); }
  more() { this.shown.set(this.shown() + PAGE); }
  startHourly() { this.setUnit('date'); this.band.set('7-8'); this.editing.set(null); }
  setHour(hour: number) { this.stopPlayback(); this.unit.set('date'); this.band.set(`${hour}-${hour + 1}`); }
  showWholeDay() { this.stopPlayback(); this.band.set('0-24'); }
  togglePlayback() {
    if (this.playing()) { this.stopPlayback(); return; }
    if (this.motion.reduced()) return;
    if (this.unit() !== 'date') this.startHourly();
    if (this.activeHour() == null || this.activeHour() === 23) this.band.set('0-1');
    this.playing.set(true);
    this.playback = setInterval(() => {
      if (document.hidden) { this.stopPlayback(); return; }
      if (this.loading()) return;
      const hour = this.activeHour() ?? 0;
      if (hour === 23) { this.stopPlayback(); return; }
      this.band.set(`${hour + 1}-${hour + 2}`);
    }, 1600);
  }
  stopPlayback() { if (this.playback != null) clearInterval(this.playback); this.playback = undefined; this.playing.set(false); this.clearPrefetch(); }
  ngOnDestroy() { this.stopPlayback(); this.activeRequest?.unsubscribe(); }
  /** Swap the two periods so the earlier one is the baseline, or simply look from the other side. */
  swap() {
    const [u, m, d] = [this.unit(), this.month(), this.date()];
    this.unit.set(this.compareUnit()); this.month.set(this.compareMonth()); this.date.set(this.compareDate());
    this.compareUnit.set(u); this.compareMonth.set(m); this.compareDate.set(d);
  }

  share(r: Relation) { return r.share == null ? '—' : r.share.toFixed(1) + '%'; }
  delta = change;
  growthOf = growth;

  exportCsv(scope: 'list' | 'hourly' | 'trend' = 'list') {
    if (scope !== 'trend' && (this.loading() || this.failure() || this.unrecorded() || this.sameAsCompare())) return;
    const ans = this.stationAnswer() ?? this.networkAnswer();
    const cmp = !!this.comparePeriod();
    const formatHours = (hours: number[] | undefined) => hours?.length
      ? hours.map(hour => `${String(hour).padStart(2, '0')}:00`).join(' ')
      : hours ? '無紀錄' : '';
    const coverage = [...this.months()].sort();
    const reportName = scope === 'hourly' ? '單站 24 小時逐時旅次'
      : scope === 'trend' ? '歷年月均進站趨勢'
      : this.mode() === 'station' ? '單站往來旅次排行' : '全線各站進出站統計';
    const meta: Array<[string, CsvCell]> = [
      ['報表項目', reportName],
      ['查詢車站', this.mode() === 'station' ? this.station() : '全線各站'],
      ['查詢期間', scope === 'trend' ? (coverage.length ? `${coverage[0]} 至 ${coverage[coverage.length - 1]}` : '') : this.period()],
      ['對照期間', scope === 'trend' ? '' : (this.comparePeriod() ?? '')],
      ['日別口徑', this.dayLabels[this.days()] + (this.days() === 'workday' ? '（排除國定假日並納入補班日）' : '')],
      ['統計單位', scope === 'trend' ? '月度日均人次' : this.unit() === 'date' ? '單日實際人次' : '有效日平均人次'],
      ['資料範圍', scope === 'hourly' ? '全日 24 小時逐時明細' : scope === 'trend' ? '全匯入月份' : '依畫面所選時段'],
      ['畫面所選時段', scope === 'trend' ? '00:00–24:00' : this.hoursText()],
      ['本期有效天數', scope === 'trend' ? '' : (ans?.period.days ?? '')],
      ['對照期有效天數', scope === 'trend' ? '' : (ans?.compare?.days ?? '')],
      ['畫面時段有紀錄小時', scope === 'trend' ? '' : formatHours(ans?.period.recordedHours)],
      ['對照時段有紀錄小時', scope === 'trend' ? '' : formatHours(ans?.compare?.recordedHours)],
      ['路線／搜尋篩選', `${this.lineFilter() || '全部路線'} / ${this.query().trim() || '全部車站'}`],
      ...exportBasis(),
      ['查詢連結', new URL(this.url(), location.href).href],
    ];
    let head: string[], rows: CsvCell[][];
    if (scope === 'hourly') {
      const a = this.stationAnswer();
      if (!a) return;
      const [selStart, selEnd] = this.band().split('-').map(Number);
      head = ['進站小時', '時段', '屬於畫面所選時段', '日均進站', '日均出站', '淨流量（進－出）', ...(cmp ? ['對照日均進站', '對照日均出站', '進站增減', '進站成長率（%）'] : [])];
      rows = Array.from({ length: 24 }, (_, h) => {
        const ent = a.hourly.entries[h] ?? null;
        const ex = a.hourly.exits[h] ?? null;
        const net = ent != null && ex != null ? Math.round((ent - ex) * 10) / 10 : null;
        const cEnt = a.hourly.compareEntries?.[h] ?? null;
        const cEx = a.hourly.compareExits?.[h] ?? null;
        const d = change(ent, cEnt);
        const g = growth(ent, cEnt);
        const inBand = h >= selStart && h < selEnd ? '是' : '否';
        return [h, `${String(h).padStart(2, '0')}:00-${String(h + 1).padStart(2, '0')}:00`, inBand, ent, ex, net,
          ...(cmp ? [cEnt, cEx, d != null ? Math.round(d * 10) / 10 : null, g != null ? Math.round(g * 10) / 10 : null] : [])];
      });
    } else if (scope === 'trend') {
      const t = this.trend();
      if (!t) return;
      const byMonth = new Map(t.months.map(m => [m.month, m]));
      const baseByMm = new Map<string, number>();
      for (const mm of Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'))) {
        const base = t.months.filter(m => m.month.endsWith('-' + mm) && m.month.slice(0, 4) <= '2019' && m.entries != null);
        if (base.length) baseByMm.set(mm, base.reduce((s, m) => s + m.entries!, 0) / base.length);
      }
      head = ['月份', '有效天數', '日均進站', '日均出站', '淨流量（進－出）', '年增率（%）', '相對 2017–2019 同月基準指數'];
      rows = t.months.map(m => {
        const prevYear = `${+m.month.slice(0, 4) - 1}${m.month.slice(4)}`;
        const prev = byMonth.get(prevYear)?.entries ?? null;
        const yoy = growth(m.entries, prev);
        const base = baseByMm.get(m.month.slice(5)) ?? null;
        const idx = m.entries != null && base != null && base > 0 ? Math.round((m.entries / base) * 1000) / 10 : null;
        const net = m.entries != null && m.exits != null ? Math.round((m.entries - m.exits) * 10) / 10 : null;
        return [m.month, m.days, m.entries, m.exits, net, yoy != null ? Math.round(yoy * 10) / 10 : null, idx];
      });
    } else if (this.mode() === 'station') {
      const dirLabel = this.direction() === 'outbound' ? '本站出發' : '往本站';
      head = ['車站', '方向', '日均人次', '占比（%）', ...(cmp ? ['對照日均人次', '對照占比（%）', '日均增減', '成長率（%）'] : [])];
      rows = this.relations().map(r => {
        const d = change(r.daily, r.compareDaily);
        const g = growth(r.daily, r.compareDaily);
        return [r.station, dirLabel, r.daily, r.share, ...(cmp ? [r.compareDaily, r.compareShare, d != null ? Math.round(d * 10) / 10 : null, g != null ? Math.round(g * 10) / 10 : null] : [])];
      });
    } else {
      head = ['車站', '日均進站', '日均出站', '淨流量（進－出）', ...(cmp ? ['對照日均進站', '對照日均出站', '進站增減', '進站成長率（%）'] : [])];
      rows = this.networkRows().map(r => {
        const net = r.entries != null && r.exits != null ? Math.round((r.entries - r.exits) * 10) / 10 : null;
        const d = change(r.entries, r.compareEntries);
        const g = growth(r.entries, r.compareEntries);
        return [r.station, r.entries, r.exits, net, ...(cmp ? [r.compareEntries, r.compareExits, d != null ? Math.round(d * 10) / 10 : null, g != null ? Math.round(g * 10) / 10 : null] : [])];
      });
    }
    const name = this.mode() === 'station' ? `${this.station()}-${scope === 'list' ? this.direction() : scope}` : `network-${scope}`;
    const suffix = scope === 'trend' ? 'trend' : `${this.period()}${this.comparePeriod() ? '-vs-' + this.comparePeriod() : ''}`;
    downloadCsv(`exitpulse-${name}-${suffix}.csv`, buildCsv(meta, head, rows));
  }

  // ----- Map -----
  private mapLayer(): ExploreLayer {
    const linesOf = this.linesOf(), muted = '#8f8a7f';
    const color = (s: string) => linesOf(s)[0]?.color ?? muted;
    if (this.mode() === 'station') {
      const a = this.stationAnswer();
      if (!a) return { arcs: [], circles: [], focus: this.station() };
      const out = this.direction() === 'outbound', cmp = !!a.compare, changeView = cmp && this.mapMetric() === 'change';
      const allRows = this.relations().map(r => ({ ...r, value: changeView ? change(r.daily, r.compareDaily) : r.daily }))
        .filter(r => r.value != null && r.value !== 0).sort((x, y) => Math.abs(y.value!) - Math.abs(x.value!));
      const focused = allRows.find(row => row.station === this.focusedRelation());
      const rows = allRows.slice(0, MAP_ARCS);
      if (focused && !rows.includes(focused)) rows.push(focused);
      const peak = Math.abs(allRows[0]?.value ?? 1);
      const label = (value: number) => (changeView && value > 0 ? '+' : '') + formatDailyTrips(value);
      const circleRows = rows.slice(0, MAP_RANKS);
      if (focused && !circleRows.includes(focused)) circleRows.push(focused);
      const focusAmount = out
        ? (changeView ? change(a.entries, a.compareEntries) : a.entries)
        : (changeView ? change(a.exits, a.compareExits) : a.exits);
      return {
        arcs: rows.map((r, i) => ({ from: out ? a.station : r.station, to: out ? r.station : a.station, daily: Math.abs(r.value!),
          dashed: changeView && r.value! < 0,
          emphasis: i < 3 ? .58 + Math.abs(r.value!) / peak * .42 : .22 + Math.abs(r.value!) / peak * .3 })),
        circles: [{ station: a.station, radius: 11, color: color(a.station), label: a.station,
          count: focusAmount == null ? undefined : label(focusAmount), hollow: false },
          ...circleRows.map(r => ({ station: r.station,
            radius: 9 + Math.min(4, lineWidth(Math.abs(r.value!)) / 3), color: color(r.station),
            label: r.station, rank: allRows.indexOf(r) + 1, count: label(r.value!), hollow: false }))],
        focus: a.station,
        focusedRelation: this.focusedRelation(),
      };
    }
    const a = this.networkAnswer();
    if (!a) return { arcs: [], circles: [], focus: null };
    // Hourly frames share one size scale: 30,000 entries always maps to a 22px circle.
    const rows = this.networkRows(), largest = this.activeHour() != null ? 30000 : Math.max(...a.stations.map(r => r.entries ?? 0));
    const cmp = !!a.compare, top = new Set(sortNetwork(rows, this.networkSort()).slice(0, 10).map(r => r.station)), focus = this.focusedStation();
    return {
      arcs: [],
      circles: rows.map(r => ({ station: r.station, radius: stationRadius(r.entries, largest),
        color: focus === r.station ? color(r.station) : '#6f7b85', label: top.has(r.station) || focus === r.station ? r.station : '',
        hollow: cmp && (change(r.entries, r.compareEntries) ?? 0) < 0 })),
      focus: focus && rows.some(r => r.station === focus) ? focus : null,
    };
  }

  // ----- Address bar -----
  private url() {
    const p = new URLSearchParams({ v: this.mode(), pe: this.period(), d: this.days(), h: this.band() });
    if (this.mode() === 'station') {
      p.set('st', this.station());
      p.set('dir', this.direction());
      const peer = this.focusedRelation();
      if (peer) p.set('peer', peer);
    }
    if (this.lineFilter()) p.set('ln', this.lineFilter());
    if (this.query().trim()) p.set('q', this.query().trim());
    const c = this.comparePeriod();
    if (c) p.set('cp', c);
    return '?' + p.toString();
  }

  private restore() {
    const p = new URLSearchParams(location.search);
    if (p.get('v') !== 'station' && p.get('v') !== 'network') return;
    const period = p.get('pe') ?? '', compare = p.get('cp') ?? '';
    if (validPeriod(period)) { this.unit.set(period.length === 10 ? 'date' : 'month'); this.month.set(period.slice(0, 7)); if (period.length === 10) this.date.set(period); }
    if (validPeriod(compare)) { this.comparing.set(true); this.compareUnit.set(compare.length === 10 ? 'date' : 'month'); this.compareMonth.set(compare.slice(0, 7)); if (compare.length === 10) this.compareDate.set(compare); }
    const days = p.get('d');
    if (days === 'weekday' || days === 'workday' || days === 'weekend' || days === 'all') this.days.set(days);
    const band = p.get('h');
    const hours = /^(\d{1,2})-(\d{1,2})$/.exec(band ?? '');
    if (hours && +hours[1] < +hours[2] && +hours[2] <= 24) this.band.set(`${+hours[1]}-${+hours[2]}`);
    const station = p.get('st')?.trim();
    if (station && station.length <= 20) this.station.set(station);
    const peer = p.get('peer')?.trim();
    this.focusRelation(p.get('v') === 'station' && peer && peer.length <= 20 && peer !== this.station() ? peer : null);
    const line = p.get('ln');
    if (line && this.lineCodes.includes(line)) this.lineFilter.set(line);
    const query = p.get('q');
    if (query && query.length <= 60) this.query.set(query);
    if (p.get('dir') === 'inbound') this.direction.set('inbound');
  }
}
