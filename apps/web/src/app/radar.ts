// 兩站比較主元件：地圖、排行、站對詳情與單站、全線三種檢視的狀態都在這裡
import { ChangeDetectionStrategy, Component, ElementRef, Injector, OnDestroy, ViewEncapsulation, afterNextRender, afterRenderEffect, computed, effect, inject, linkedSignal, signal, untracked, viewChild } from '@angular/core';
import { autoRetry } from './auto-retry';
import { watchDeviceProfile } from './device-profile';
import { moveControls } from './control-motion';
import { MotionPreference } from './motion-preference';
import { drawRankLink, installRankLink, zoomScaled } from './rank-map-link';
import { readFold, writeFold } from './fold-preference';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MapLibreMap, ExpressionSpecification, StyleSpecification } from 'maplibre-gl';
import type { AllPaintProperties } from '@maplibre/maplibre-gl-style-spec';
import type { Feature, FeatureCollection } from 'geojson';
import { Explore, type ExploreLayer, type ExploreMode, type StationAvailability } from './explore';
import { MobileShell, type MobileAction, type MobilePage, type MobileSummary } from './mobile-shell';
import { TimePlayer } from './time-player';
import { Hint, type HintEntry } from './hint';
import { Brand } from './brand';
import { About } from './about';
import { PairDetail } from './pair-detail';
import { AnimatedCount } from './animated-count';
import { buildCsv, downloadCsv, exportBasis } from './csv-export';
import { FirstQuery, type FirstQueryPreset } from './first-query';
import { StationHistory } from './station-history';
import type { StationHistoryLine } from './station-history-model';
import { daylightAt } from './daylight';
import { change, type NetworkAnswer } from './explore-model';
import type { ElevatedFlow } from './radar-3d';
import { COLLECTION_LIMIT, cleanItem, decodeLink, encodeLink, loadCollection, mergeItems, newItem, parseExport, saveCollection, serializeExport, today, type CollectionItem, type CollectionKind, type StorageLike } from './collection';
import { FLOW_SAMPLES, SORTS, arrowCount, filterResults, formatDailyTrips, glue, lineWidth, readState, sortResults, sortValue, csvTable, writeState, type PairDayType, type Result, type SortKey, type ViewState } from './radar-model';

type Dataset = { baseline: string; current: string; days: number[]; hours: number[]; weekend: boolean; daysType?: PairDayType; minimum?: number; type?: string; commonStations: number; total?: number; truncated?: boolean; results: Result[] };
type Profile = { forward: (number | null)[]; reverse: (number | null)[] };
type PairProfile = { origin: string; destination: string; baseline: Profile; current: Profile };
type Stop = { properties: { name: string; lines: string; colors: string }; geometry: { coordinates: [number, number] } };
type Line = { code: string; name: string; color: string };
type Mode = 'volume' | 'direction' | 'time';
type MapPanel = 'station' | 'route' | 'rank' | 'tower' | 'legend';
type Stream = { key: string; label: string; daily: number; color: string; dashed: boolean; emphasis?: number; path: [number, number][] };
type Place = { name: string; area: string; address?: string; category?: string; lng: number; lat: number };
type Entrance = { code: string; name: string; label?: string; lng: number; lat: number; accessible: boolean;
  history?: { opened?: string; closed?: string; reopened?: string; source: string; closureSource?: string } | null };
type StationInfo = { retrieved: string; facilities: { label: string; area: string; value: string }[]; entrances: Entrance[];
  opening?: { date: string; source: string }; lines?: StationHistoryLine[]; addresses?: string[];
  story?: { summary: string; source: string; sourceLabel?: string } | null; nearby?: { name: string; distance: number; summary: string; lng?: number; lat?: number }[];
  youbike?: { name: string; distance: number; capacity: number; address?: string; lng?: number; lat?: number }[];
  hubs?: { name: string; officialName?: string; kind: string; distance: number; lng?: number; lat?: number; source?: string; sourceLabel?: string }[];
  districtPop?: { district: string; period: string; population: number; yoyPct?: number | null } | null;
  catchmentPop?: { districts: string[]; period: string; population: number; yoyPct?: number | null } | null;
  latestStats?: { month: string; period?: string; isDate?: boolean; dailyEntries: number; dailyExits: number; rank: number; totalStations: number; yoyPct?: number | null } };
type Point = [number, number];
/** 人流用中性色描邊，避免和路線識別色混在一起。 */
/** 流線是畫面的主角，用一個不與任何路線色重疊的靛紫色，不再是黑白。基準期維持中性灰，當成對照。 */
const FLOW = { light: '#292929', dark: '#ededeb' };

const LINES: Record<string, string> = { BL: '板南線', BR: '文湖線', G: '松山新店線', R: '淡水信義線', O: '中和新蘆線', Y: '環狀線' };
/** 明暗共用同一張底圖，深色只是把燈調暗，樣式不換。 */
const STYLE = 'https://tiles.openfreemap.org/styles/positron';
const LOCAL_MAP: StyleSpecification = {
  version: 8, sources: {}, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  layers: [{ id: 'local-background', type: 'background', paint: { 'background-color': '#e8e4da' } }],
};
const NB = ' ';
const BANDS: Record<string, string> = { '7-10': `早上${NB}7${NB}到${NB}10${NB}點`, '10-16': `白天${NB}10${NB}到${NB}16${NB}點`, '16-19': `傍晚${NB}16${NB}到${NB}19${NB}點`, '19-24': `晚上${NB}19${NB}點以後` };
const TYPES = { all: '全部變化', increase: '比例上升', decrease: '比例下降', reversal: '流向對調' };
/** 每個點通過整條線的時間相同，所以每秒經過某處的點數正比於每日人次。 */
const TRAVERSE_MS = 7000;
const OVERVIEW_PAIRS = 30;
const PAGE = 30;
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const FLAT_FLOW_LAYERS = ['od-ribbons', 'od-streams', 'od-streams-dashed', 'od-comets-flow', 'od-comets-muted', 'od-particles', 'od-pulse', 'od-flow-labels'];
const TOWER_PITCH = 66;
const PHONE_TOWER_PITCH = 50;
const WEBGL_RESTORE_TIMEOUT = 3000;
const LOW_PITCH = 82;
const STREET_ZOOM = 16.4;
const PHONE_STREET_PITCH = 76;
const PHONE_STREET_ZOOM = 15.8;
const MIN_TOWER_PITCH = 20;
/** 全線圓圈底色：淺底深藍、深底亮青，兩種底圖上都跟灰色路網分得開。圖層資料裡的灰色只是「未選取」的記號。 */
const DOT = { light: '#23282d', dark: '#f1f4f6' };
const dotColor = (dark: boolean) => ['case', ['==', ['get', 'color'], '#6f7b85'], dark ? DOT.dark : DOT.light, ['get', 'color']] as never;
/** 圓圈透明度 k（1 為預設，越小越淡），外環、淡填色與內圓一起縮放 */
const dotFill = (k: number) => ['case', ['==', ['get', 'inner'], 0], .14 * k, .06 * k] as never;
const NIGHT_STATION = { regular: '#a6b7c0', ranked: '#e7eef1', rim: '#35454e', rankInk: '#15232b' };
/** Positron 底圖幾乎全白，這組色票讓陸地、水域、公園與文字有足夠層次，長時間看也不刺眼。 */
const LIGHT_MAP = { land: '#e8e4da', water: '#b7d0da', park: '#d3dfc8', building: '#dcd7cb', label: '#5e5a51', halo: '#f4f1ea' };
/** 與淺色同一組層次，燈關掉的版本：陸地最暗，水域與公園保留色相，道路略亮於陸地。 */
const DARK_MAP = { land: '#111619', water: '#152633', park: '#17221e', building: '#1d252a', label: '#a2acb2', halo: '#0d1215', road: '#303b43', outline: '#252e34' };
type MapColorProperty = 'background-color' | 'fill-color' | 'fill-outline-color' | 'line-color' | 'text-color' | 'text-halo-color';
type MapColor = AllPaintProperties[MapColorProperty];
type MapPaint = { layer: string; property: MapColorProperty; day: MapColor; night: string };

function shadedPaint({ day, night }: MapPaint, shade: number): MapColor {
  if (shade === 0) return day;
  if (shade === 1) return night;
  const mix = (color: string): ExpressionSpecification => ['interpolate', ['linear'], shade, 0, color, 1, night];
  if (typeof day === 'string') return mix(day);
  // 逐個縮放級距上色，保留 Positron 隨縮放變化的道路顏色
  if (Array.isArray(day) && day[0] === 'interpolate' && Array.isArray(day[2]) && day[2][0] === 'zoom') {
    return day.map((value, i) => i >= 4 && i % 2 === 0 && typeof value === 'string'
      ? mix(value) : value) as ExpressionSpecification;
  }
  return shade >= .5 ? night : day;
}
const stored = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private mode: the choice lasts this visit only */ } };

@Component({
  selector: 'app-root', imports: [DecimalPipe, NgTemplateOutlet, Explore, MobileShell, TimePlayer, Hint, Brand, FirstQuery, StationHistory, About, PairDetail, AnimatedCount],
  encapsulation: ViewEncapsulation.None, templateUrl: './radar.html', styleUrls: ['./map-tools.css', './station-preview.css', './mobile-map.css', './radar.css', './hour-chart.css', './interface-motion.css'],
  changeDetection: ChangeDetectionStrategy.OnPush, host: {
    '[attr.data-theme]': 'theme()',
    '[attr.data-inset]': 'device().inset',
    '[attr.data-landscape]': 'device().landscape',
    '[attr.data-standalone]': 'device().standalone',
    '[attr.data-touch]': 'device().touch',
    '[attr.data-hover]': 'device().hover',
    '[attr.data-layout]': 'device().layout',
  },
})
export class Radar implements OnDestroy {
  readonly mapElement = viewChild.required<ElementRef<HTMLDivElement>>('map');
  readonly detailView = viewChild(PairDetail);
  readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('search');
  readonly placeMenu = viewChild.required<ElementRef<HTMLDetailsElement>>('placeMenu');
  readonly placeInput = viewChild.required<ElementRef<HTMLInputElement>>('placeInput');
  readonly lineList = Object.keys(LINES);
  readonly lineNames = LINES;
  readonly sorts = SORTS;
  readonly sortKeys = Object.keys(SORTS) as SortKey[];
  readonly scaleSamples = FLOW_SAMPLES.map(trips => ({ trips, width: lineWidth(trips), arrows: Array.from({ length: arrowCount(trips) }) }));
  readonly dailyTrips = formatDailyTrips;
  readonly linesOfStationFn = (s: string) => this.linesOfStation(s);
  readonly lineOfFn = (s: string) => this.lineOf(s);
  readonly stationCodeFn = (l: string, s: string) => this.stationCode(l, s);
  readonly data = signal<Dataset | null>(null);
  readonly selected = signal<Result | null>(null);
  readonly showResults = signal(false);
  readonly error = signal(false);
  readonly queryError = signal('');
  /** hours_mismatch 後 API 建議的可比較時段，只在它剛好是提供的時段之一時才記下。 */
  readonly suggestedBand = signal('');
  readonly loading = signal(false);
  readonly apiAvailable = signal(false);
  readonly months = signal<string[]>(['2022-09', '2026-09']);
  readonly baseline = signal('2022-09');
  readonly current = signal('2026-09');
  readonly hours = signal('7-10');
  readonly dayType = signal<PairDayType>('weekday');
  readonly weekend = computed(() => this.dayType() === 'weekend');
  readonly changeType = signal<keyof typeof TYPES>('all');
  readonly minimum = signal(20);
  readonly sortKey = signal<SortKey>('share');
  readonly sortReverse = signal(false);
  readonly query = signal('');
  readonly toolsOpen = signal(false);
  readonly lineFilter = signal('');
  readonly shown = signal(PAGE);
  readonly explore = viewChild(Explore);
  /** 同一份資料的三種看法：站對變化、單站往來、全線人次。 */
  readonly view = signal<'pairs' | ExploreMode>((['station', 'network'] as const).find(v => v === new URLSearchParams(location.search).get('v')) ?? 'pairs');
  readonly lineOrder = signal<Record<string, string[]> | null>(null);
  readonly stationCodes = signal<Record<string, Record<string, string>>>({});
  readonly availability = signal<StationAvailability | null>(null);
  stationCode(line: string, station: string) { return this.stationCodes()[line]?.[station === '大橋頭站' ? '大橋頭' : station] ?? line; }
  readonly pairStations = computed(() => [...new Set(Object.values(this.lineOrder() ?? {}).flat())].sort((a, b) => a.localeCompare(b, 'zh-TW')));
  readonly showFirstQuery = computed(() => this.freshVisit() && this.apiAvailable()
    && this.view() === 'pairs' && !this.showResults() && !this.selectedMapStation());
  private readonly firstQuery = viewChild(FirstQuery);
  /** 首屏卡片展開時它就是唯一入口；收起後才露出比較條件，免得同一個動作出現兩次。 */
  readonly firstQueryOpen = computed(() => this.showFirstQuery() && !this.firstQuery()?.collapsed());
  readonly firstQueryStations = computed(() => {
    const availability = this.availability();
    return this.pairStations().filter(name => !availability || availability[name]?.months.length).map(name => ({
      name,
      lines: this.linesOfStation(name).map(line => ({ code: this.stationCode(line.code, name), line: line.code, color: line.color })),
    }));
  });
  private readonly freshVisit = signal(!location.search);
  readonly pairReady = computed(() => {
    const stations = this.pairStations(), a = this.manualOrigin(), b = this.manualDestination();
    return a !== b && stations.includes(a) && stations.includes(b);
  });
  readonly manualOrigin = signal('');
  readonly manualDestination = signal('');
  readonly manualError = signal('');
  readonly manualLoading = signal(false);
  // 收藏只存在這台瀏覽器；localStorage 被封鎖時改用一個寫入必失敗的空殼，畫面照常運作
  private readonly store: StorageLike = (() => { try { return localStorage; } catch { return { getItem: () => null, setItem: () => { throw new Error('blocked'); } }; } })();
  readonly collection = signal<CollectionItem[]>(loadCollection(this.store));
  readonly collectionNotice = signal('');
  readonly collectionName = signal('');
  /** 從 #collection= 連結帶進來、等使用者確認的收藏 */
  readonly pendingImport = signal<CollectionItem[]>(decodeLink(location.hash));
  readonly renaming = signal<string | null>(null);
  /** 只在帶收藏連結進來時自動展開一次，之後開關交給使用者 */
  readonly openCollectionOnLoad = this.pendingImport().length > 0;
  readonly favPairs = computed(() => this.collection().flatMap(i => {
    const p = i.kind === 'pair' ? new URLSearchParams(i.query).get('p')?.split('>') : null;
    return p?.length === 2 ? [{ origin: p[0], destination: p[1] }] : [];
  }).filter((p, i, all) => all.findIndex(q => q.origin === p.origin && q.destination === p.destination) === i));
  readonly isFavPair = computed(() => {
    const s = this.selected();
    return !!s && this.favPairs().some(p => p.origin === s.origin && p.destination === s.destination);
  });
  readonly manualSuggestedMonths = computed<{ baseline: string; current: string } | null>(() => {
    if (!this.manualError()) return null;
    const avail = this.availability(), o = this.manualOrigin(), d = this.manualDestination();
    if (!avail || !o || !d) return null;
    const mo = avail[o]?.months ?? [], md = new Set(avail[d]?.months ?? []);
    const common = mo.filter(m => md.has(m)).sort();
    if (common.length < 2) return null;
    const baseline = common[0] === this.baseline() && common.length > 2 ? common[common.length - 2] : common[0];
    const current = common[common.length - 1];
    if (baseline === this.baseline() && current === this.current()) return null;
    return { baseline, current };
  });
  readonly showPlaces = signal(false);
  /** 全線圓圈透明度 0–80%，記在本機 */
  readonly dotTransparency = signal(((): number => { try { const v = Number(localStorage.getItem('exitpulse.dot')); return v >= 0 && v <= 80 ? v : 0; } catch { return 0; } })());
  setDotTransparency(value: string | number) {
    const percent = Math.min(80, Math.max(0, Math.round(Number(value) / 10) * 10));
    this.dotTransparency.set(percent);
    try { localStorage.setItem('exitpulse.dot', String(percent)); } catch { /* 無痕模式存不了就只在本次有效 */ }
    const map = this.map, k = 1 - percent / 100;
    if (!map?.getLayer('explore-circles')) return;
    map.setPaintProperty('explore-circles', 'circle-opacity', dotFill(k));
    map.setPaintProperty('explore-circles', 'circle-stroke-opacity', k);
    map.setPaintProperty('explore-inner', 'circle-opacity', .62 * k);
  }
  readonly showLegend = signal(true);
  readonly showMetro = signal(true);
  /** 立體建築：近距離時建築長出高度，並自動微傾地圖 */
  /** 立體模式：車站以階梯式大樓表示，高度對應人次。 */
  readonly tower3d = signal(false);
  readonly lowAngle = signal(false);
  readonly pairStreetStation = linkedSignal(() => this.selected()?.origin ?? null);
  private readonly mapPanelState = signal<Partial<Record<MapPanel, boolean>>>({});
  readonly stationPreviewFolded = computed(() => this.panelFolded('station', this.lowAngle() && this.phone()));
  panelFolded(panel: MapPanel, fallback = false) {
    const saved = stored('exitpulse.panel.' + panel);
    return this.mapPanelState()[panel] ?? (saved == null ? fallback : saved === 'closed');
  }
  toggleMapPanel(panel: MapPanel, folded: boolean) {
    this.mapPanelState.update(state => ({ ...state, [panel]: folded }));
    store('exitpulse.panel.' + panel, folded ? 'closed' : 'open');
  }
  private beforeLowAngle?: { center: Point; zoom: number; pitch: number };
  readonly towerPeak = signal<number | null>(null);
  /** 立體圖例的刻度：幾根和地圖同高的小尖刺，標出對應人次（高度取平方根，所以一定要有尺） */
  readonly towerScale = signal<{ label: string; px: number }[]>([]);
  private elevatedFlow?: ElevatedFlow;
  readonly showScale = signal(false);
  readonly showRoads = signal(true);
  readonly showNature = signal(true);
  readonly fullscreenSupported = typeof document !== 'undefined' && !!document.fullscreenEnabled && typeof document.documentElement?.requestFullscreen === 'function';
  readonly isFullscreen = signal(false);
  readonly mapFullscreen = signal(false);
  readonly mapOnly = signal(false);
  readonly mapOnlyButton = viewChild<ElementRef<HTMLButtonElement>>('mapOnlyButton');
  private readonly mobileShell = viewChild(MobileShell);

  toggleMapOnly() {
    const next = !this.mapOnly();
    if (next) {
      this.closeMenus();
      this.mobileShell()?.viewMenu.set(false);
    }
    this.mapOnly.set(next);
    this.mapOnlyButton()?.nativeElement.focus({ preventScroll: true });
  }
  readonly toolsCollapsed = signal(((): boolean => { try { return localStorage.getItem('exitpulse.tools') === 'closed'; } catch { return false; } })());
  toggleTools() {
    const next = !this.toolsCollapsed();
    if (next) this.closeMenus();
    this.toolsCollapsed.set(next);
    try { localStorage.setItem('exitpulse.tools', next ? 'closed' : 'open'); } catch { /* 不能存就只在這次有效 */ }
  }
  readonly barHidden = signal(((): boolean => { try { return localStorage.getItem('exitpulse.bar') === 'closed'; } catch { return false; } })());
  toggleBar() {
    const next = !this.barHidden();
    this.moveMapControls('.bar-handle, .map-tools, .map-only-toggle');
    this.barHidden.set(next);
    try { localStorage.setItem('exitpulse.bar', next ? 'closed' : 'open'); } catch { /* 不能存就只在這次有效 */ }
  }
  private moveMapControls(selector: string) {
    const workspace = this.mapElement().nativeElement.closest('.workspace');
    if (workspace) moveControls(workspace, selector, this.injector);
  }
  readonly mapMoving = signal(false);
  readonly openMenu = signal<'place' | 'collection' | 'layers' | null>(null);
  setMenu(name: 'place' | 'collection' | 'layers', open: boolean) {
    if (open) this.openMenu.set(name); else if (this.openMenu() === name) this.openMenu.set(null);
  }
  closeMenus(restoreFocus = false) {
    for (const el of this.placeMenu().nativeElement.closest('.map-tools')?.querySelectorAll<HTMLDetailsElement>(':scope > details[open]') ?? []) {
      el.open = false;
      if (restoreFocus) el.querySelector('summary')?.focus();
    }
    this.openMenu.set(null);
  }
  readonly device = watchDeviceProfile();
  readonly phone = computed(() => this.device().layout === 'compact');
  readonly isIosSafari = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
  readonly installPrompt = signal<{ prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> } | null>(null);
  private readonly onFullscreenChange = () => {
    const active = !!document.fullscreenElement;
    this.isFullscreen.set(active);
    if (!active && this.fullscreenSupported) this.mapFullscreen.set(false);
  };
  private readonly onBeforeInstall = (e: Event) => {
    e.preventDefault();
    this.installPrompt.set(e as unknown as { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> });
  };
  private readonly onAppInstalled = () => this.installPrompt.set(null);
  readonly placeQuery = signal('');
  readonly places = signal<Place[]>([]);
  readonly placeBusy = signal(false);
  readonly placeMessage = signal('');
  readonly nearestPlace = signal<{ place: Place; station: string; distance: number; nearby: { station: string; distance: number }[] } | null>(null);
  readonly geoBusy = signal(false);
  readonly selectedMapStation = signal<string | null>(null);
  readonly stationInfo = signal<StationInfo | null>(null);
  readonly stationInfoStatus = signal<'idle' | 'loading' | 'failed'>('idle');
  readonly showEntrances = signal(false);
  readonly compareEntrances = signal(false);
  private readonly selectedEntrance = signal<Entrance | null>(null);
  readonly activeEntrance = computed(() => this.entrancesAtPeriod().find(exit => exit === this.selectedEntrance()) ?? null);
  readonly entranceCurrent = computed(() => {
    const explorer = this.explore();
    return this.view() === 'pairs' ? this.data()?.current ?? this.current() : explorer?.period() ?? this.current();
  });
  readonly entranceBaseline = computed(() => this.view() === 'pairs' ? this.data()?.baseline : this.explore()?.comparePeriod());
  readonly entrancePeriod = computed(() => (this.compareEntrances() ? this.entranceBaseline() : null) || this.entranceCurrent());
  readonly entrancesAtPeriod = computed(() => {
    const info = this.stationInfo(), period = this.entrancePeriod();
    const at = (date: string) => date.slice(0, period.length);
    if (!info || (info.opening && period < at(info.opening.date))) return [];
    return info.entrances.filter(({ history }) => {
      if (history?.opened && period < at(history.opened)) return false;
      return !(history?.closed && history.reopened && period > at(history.closed) && period < at(history.reopened))
        && !(period.length === 10 && history?.closed && period === history.closed);
    });
  });
  readonly hubSources = computed(() => {
    const seen = new Map<string, string>();
    for (const hub of this.stationInfo()?.hubs ?? []) {
      const label = hub.sourceLabel?.trim();
      const url = hub.source?.trim();
      if (label && !seen.has(label)) seen.set(label, url || '');
    }
    return [...seen.entries()].map(([label, url]) => ({ label, url }));
  });
  private stationInfoRequest = 0;
  /** 使用者正在看的月份或日期，車站資訊卡要對應這個期間。 */
  readonly stationPeriod = computed(() => this.view() === 'pairs' ? this.current() : this.explore()?.period());
  private entrancePins = new Map<Entrance, maplibregl.Marker>();
  private scaleControl?: maplibregl.ScaleControl;
  private ml?: typeof import('maplibre-gl');
  private r3d?: typeof import('./radar-3d');
  private mountingMap = false;
  readonly exploreLayer = signal<ExploreLayer | null>(null);
  readonly stationArcLimit = signal<5 | 10 | 0>(10);
  readonly rankedStations = computed(() => this.exploreLayer()?.circles.filter(station => station.rank != null) ?? []);
  readonly linesOfFn = (station: string) => this.linesOfStation(station);
  private lastFocus: string | undefined;
  /** 手機分成地圖、清單、條件與詳情四個畫面，共用同一份查詢狀態。 */
  readonly mobilePage = signal<MobilePage>('map');
  private returnFocus?: HTMLElement;
  readonly theme = signal<'light' | 'dark'>(stored('exitpulse.theme') === 'dark' ? 'dark' : 'light');
  readonly paused = signal(stored('exitpulse.paused') === '1');
  readonly notice = signal('');
  readonly profileError = signal(false);
  /** 使用者正在拖曳或縮放地圖時為真，面板會淡出讓出視野 */
  readonly mapActive = signal(false);
  /** 手機上流動模式列預設收起，只留圖例，把畫面還給地圖 */
  readonly flowFolded = signal(stored('exitpulse.flow') === 'closed' || (stored('exitpulse.flow') == null && innerWidth <= 720));
  toggleFlowFold() {
    this.moveMapControls('.flow-fold');
    this.flowFolded.update(value => !value);
    store('exitpulse.flow', this.flowFolded() ? 'closed' : 'open');
  }
  private hero?: maplibregl.Marker;
  /** 游標停在排行某一列時，地圖上只突顯那一組兩站 */
  private hoveredKey = '';
  private hoverFrame = 0;
  readonly mode = signal<Mode>('volume');
  readonly panelOpen = signal(!readFold('panel.analysis'));
  togglePanelOpen() {
    this.panelOpen.update(open => !open);
    writeFold('panel.analysis', !this.panelOpen());
  }
  readonly conditionsOpen = signal(!!location.search);
  readonly detailOpen = signal(!readFold('panel.detail'));
  toggleDetailOpen() {
    this.detailOpen.update(open => !open);
    writeFold('panel.detail', !this.detailOpen());
  }
  readonly detailWide = signal(false);
  readonly panelWide = signal(false);
  readonly isPanelWide = this.panelWide.asReadonly();
  readonly mapMessage = signal('');
  /** 底圖狀態：loading 是第一次載入，ready 是載完，failed 是重試後仍有圖磚載不到。busy 是載完之後又在補圖磚。 */
  readonly basemap = signal<'loading' | 'ready' | 'failed'>('loading');
  readonly basemapBusy = signal(false);
  readonly timePhase = signal<'baseline' | 'current'>('baseline');
  private readonly pairTowerTotals = httpResource<NetworkAnswer>(() => {
    const data = this.data();
    if (!this.tower3d() || this.view() !== 'pairs' || !this.selected() || !data) return undefined;
    const params: Record<string, string> = {
      period: data.current,
      days: this.datasetDayType(data),
      start: String(data.hours[0]),
      end: String(data.hours[1]),
    };
    if (this.mode() === 'time') params['compare'] = data.baseline;
    return { url: '/api/v1/od/network', params };
  });
  private readonly updateTowers = effect(() => {
    this.pairTowerTotals.status();
    this.timePhase();
    untracked(() => this.drawTowers());
  });
  readonly streams = signal<Stream[]>([]);
  readonly profile = signal<PairProfile | null>(null);

  private datasetDayType(d: Dataset): PairDayType { return d.daysType ?? (d.weekend ? 'weekend' : 'weekday'); }
  private dayTypeLabel(dt: PairDayType, long = false) {
    return dt === 'workday' ? '純工作日' : dt === 'weekend' ? '週末' : (long ? '週一至週五' : '平日');
  }
  private dayTypeParams(dt: PairDayType): Record<string, string | boolean> {
    return dt === 'workday' ? { days: 'workday' } : { weekend: dt === 'weekend' };
  }

  readonly summary = computed(() => [
    `${this.baseline()} → ${this.current()}`, `${this.dayTypeLabel(this.dayType())}${BANDS[this.hours()]}`, TYPES[this.changeType()], `每日${NB}${this.minimum()}${NB}人次以上`,
  ]);
  readonly results = computed(() => {
    const list = sortResults(filterResults(this.data()?.results ?? [], this.query(), this.lineFilter(), s => this.linesOf(s)), this.sortKey());
    return this.sortReverse() ? [...list].reverse() : list;
  });
  readonly visible = computed(() => this.results().slice(0, this.shown()));
  readonly flowHint = computed<HintEntry[]>(() => {
    const d = this.data(), r = this.selected();
    if (!d) return [
      { label: '線條寬度', value: '越粗代表每日搭車人次越多' },
      { label: '箭頭方向', value: '表示從起站出發前往迄站的流向' },
    ];
    if (this.mode() === 'direction') return [
      { label: '去程與回程', value: r ? `${r.origin} → ${r.destination} 與反向對比` : '比較雙向各自的人次規模' },
      { label: '資料月份', value: d.current },
      { label: '互動方式', value: '點地圖弧線或左方排行可鎖定兩站細節' },
    ];
    return [
      { label: '較早月份' + (this.mode() === 'volume' ? ' · 虛線' : ''), value: d.baseline },
      { label: '較晚月份' + (this.mode() === 'volume' ? ' · 實線' : ''), value: d.current },
      { label: '線寬', value: '越粗代表每日人次越多' },
      { label: '箭頭', value: r ? '從起站出發前往迄站的旅次方向' : '旅次方向，點選任一組可看兩站分析' },
    ];
  });
  readonly mobileSummary = computed<MobileSummary>(() => {
    if (this.view() !== 'pairs') return {
      from: this.view() === 'station' ? this.explore()?.station() ?? '單站關係' : '全線車站',
      caption: this.explore()?.periodText() ?? '', action: this.view() === 'station' ? '看往來站與人次' : '看各站進出人次',
      actionKind: 'list', disabled: false, canEdit: false,
    };
    const r = this.selected();
    return r ? {
      from: r.origin, to: r.destination, caption: `每日 ${formatDailyTrips(r.baselineDaily)} → ${formatDailyTrips(r.currentDaily)} 人次`,
      action: '看兩站分析', actionKind: 'detail', disabled: false, canEdit: false,
    } : {
      from: this.baseline(), to: this.current(), caption: `${this.dayTypeLabel(this.dayType(), true)} · ${BANDS[this.hours()]}`,
      action: this.loading() ? '正在比較…' : this.showResults() ? `查看 ${this.results().length} 組兩站` : '找出往來變化',
      actionKind: this.showResults() ? 'list' : 'find', disabled: this.loading() || !this.data(), canEdit: true,
    };
  });

  readonly story = computed(() => {
    const r = this.selected(), d = this.data();
    if (!r || !d) return null;
    const day = this.dayTypeLabel(this.datasetDayType(d));
    const band = BANDS[`${d.hours[0]}-${d.hours[1]}`] ?? `${d.hours[0]} 到 ${d.hours[1]} 點`;
    const fmt = (n: number) => n.toLocaleString('zh-TW');
    const ratio = r.baselineDaily > 0 ? r.currentDaily / r.baselineDaily : null;
    let change: string;
    if (ratio == null) change = r.currentDaily > 0 ? `從 0 增至每天 ${formatDailyTrips(r.currentDaily)} 人次` : '兩期皆為 0 人次';
    else if (ratio >= 1.95) change = `每日人次約為原本的 ${ratio.toFixed(1)} 倍`;
    else if (ratio >= 1.05) change = `每日人次增加約 ${Math.round((ratio - 1) * 100)}%`;
    else if (ratio <= 0.95) change = `每日人次減少約 ${Math.round((1 - ratio) * 100)}%`;
    else change = '每日人次大致持平';
    const shareA = r.baselineTrips / r.baselineOriginTotal * 100, shareB = r.currentTrips / r.currentOriginTotal * 100;
    // 大標先回答「為什麼排在這裡」，用的量和左側排行的排序依據相同
    const key = this.sortKey();
    if (key === 'share') change = `出發占比 ${shareA.toFixed(1)}% → ${shareB.toFixed(1)}%`;
    else if (key === 'daily') { const diff = r.currentDaily - r.baselineDaily; change = Math.abs(diff) < 0.5 ? '每日人次大致持平' : `每天${diff > 0 ? '多' : '少'} ${formatDailyTrips(Math.abs(diff))} 人次`; }
    else if (key === 'volume') change = `現在每天約 ${formatDailyTrips(r.currentDaily)} 人次`;
    const originA = r.baselineOriginTotal / d.days[0], originB = r.currentOriginTotal / d.days[1];
    const originChange = originB / originA - 1;
    const flow = (index: number | null) => (index ?? 0) > 0 ? `${r.origin}往${r.destination}` : `${r.destination}往${r.origin}`;
    return {
      when: `${day}${band}`,
      headline: glue(change),
      origin: glue(`${r.origin}出發的總人次每天 ${fmt(Math.round(originA))} → ${fmt(Math.round(originB))} 人，${Math.abs(originChange) < .05 ? '大致持平' : `${originChange > 0 ? '多了' : '少了'} ${Math.round(Math.abs(originChange) * 100)}%`}。`),
      shareA, shareB, scale: Math.max(shareA, shareB) * 1.15 || 1,
      shareUnit: key === 'share' ? `占${r.origin}出發量` : null,
      reversal: r.reversal ? glue(`兩站之間的主要方向反過來了。${d.baseline} 是${flow(r.directionBaseline)}的人比較多，${d.current} 變成${flow(r.directionCurrent)}比較多。`) : '',
    };
  });

  readonly siblings = computed(() => {
    const r = this.selected();
    if (!r) return [];
    return sortResults((this.data()?.results ?? []).filter(x => x.origin === r.origin && x !== r), 'share').slice(0, 4);
  });

  readonly reversePair = computed(() => {
    const r = this.selected();
    return r ? this.data()?.results.find(x => x.origin === r.destination && x.destination === r.origin) ?? null : null;
  });

  readonly focusedFlow = computed(() => {
    if (this.view() !== 'station' || this.selectedMapStation()) return null;
    const ex = this.explore();
    const target = ex?.focusedRelation();
    if (!ex || !target) return null;
    const row = ex.relations().find(r => r.station === target);
    if (!row) return null;
    const outbound = ex.direction() === 'outbound';
    const origin = outbound ? ex.station() : row.station;
    const destination = outbound ? row.station : ex.station();
    const diff = change(row.daily, row.compareDaily);
    const growthPct = diff !== null && row.compareDaily && row.compareDaily > 0 ? Math.round(diff / row.compareDaily * 100) : null;
    return {
      origin, destination, other: row.station, outbound,
      daily: row.daily, share: row.share,
      compareDaily: row.compareDaily, diff, growthPct,
      period: ex.period(), days: ex.days() === 'workday' ? 'workday' as PairDayType : ex.days() === 'weekend' ? 'weekend' as PairDayType : 'weekday' as PairDayType, weekend: ex.days() === 'weekend', hours: ex.band(),
      hasCompare: ex.isComparing(),
    };
  });

  private readonly viewState = computed<ViewState>(() => {
    const r = this.selected();
    return { baseline: this.baseline(), current: this.current(), hours: this.hours(), weekend: this.weekend(), days: this.dayType(), type: this.changeType(), minimum: this.minimum(),
      sort: this.sortKey(), q: this.query(), line: this.lineFilter(), pair: r ? `${r.origin}>${r.destination}` : '' };
  });

  /** 所選方向每個期間的 24 根長條，沒有紀錄的小時（null）留空，不畫成 0。 */
  readonly chart = computed(() => {
    const p = this.profile(), d = this.data();
    if (!p || !d) return null;
    const peak = Math.max(1, ...[...p.baseline.forward, ...p.current.forward].map(v => v ?? 0));
    const bar = (v: number | null) => v == null ? null : Math.max(v / peak * 100, v > 0 ? 2 : 0);
    const [from, to] = d.hours;
    const busiest = p.current.forward.reduce<number>((best, v, h) => (v ?? -1) > (p.current.forward[best] ?? -1) ? h : best, 0);
    const busiestVal = p.current.forward[busiest] ?? 0;
    let offPeakTip = '';
    if (busiestVal > 0) {
      const neighbors = [busiest - 1, busiest + 1]
        .filter(h => h >= 6 && h <= 22 && (p.current.forward[h] ?? null) != null)
        .map(h => ({ h, v: p.current.forward[h]! }))
        .sort((a, b) => a.v - b.v);
      const alt = neighbors[0];
      if (alt) {
        const dropPct = Math.round((1 - alt.v / busiestVal) * 100);
        if (dropPct >= 20) offPeakTip = `改在 ${alt.h} 點出發可避開最擠時段，人潮少約 ${dropPct}%。`;
      }
    }
    return {
      hours: Array.from({ length: 24 }, (_, h) => ({ h, a: bar(p.baseline.forward[h]), b: bar(p.current.forward[h]), selected: h >= from && h < to, missing: p.current.forward[h] == null })),
      peak: Math.round(peak), busiest, busiestDaily: Math.round(busiestVal), offPeakTip,
    };
  });

  /** 一句話分清「人變多」與「占比變大」：把這一對拿去和同一起站的全部出發量比較。 */
  readonly verdict = computed(() => {
    const r = this.selected(), d = this.data();
    if (!r || !d || r.growth == null || !r.baselineOriginTotal || !r.baselineTrips) return '';
    const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v * 100))}%`;
    const originGrowth = (r.currentOriginTotal / d.days[1]) / (r.baselineOriginTotal / d.days[0]) - 1;
    const base = r.baselineTrips / r.baselineOriginTotal * 100, cur = r.currentTrips / r.currentOriginTotal * 100;
    const gap = r.growth - originGrowth;
    const side = Math.abs(gap) < .02 ? '與整體相當' : gap > 0 ? '快於整體' : '慢於整體';
    return `同期${r.origin}出發總量 ${pct(originGrowth)}，這一對 ${pct(r.growth)}，${side}。占${r.origin}出發量的 ${base.toFixed(1)}% → ${cur.toFixed(1)}%。`;
  });

  /** 這一對的百分比需要小心解讀的原因，直接由資料推得。 */
  readonly cautions = computed(() => {
    const r = this.selected(), d = this.data();
    if (!r || !d) return [];
    const out: string[] = [];
    if (Math.min(r.baselineTrips, r.currentTrips) < 300) out.push(`原始人次只有 ${Math.min(r.baselineTrips, r.currentTrips).toLocaleString('zh-TW')}，百分比容易被少數旅次拉動。`);
    const p = this.profile();
    if (p) {
      const gaps = (label: string, f: (number | null)[]) => {
        const miss = Array.from({ length: Math.max(0, d.hours[1] - d.hours[0]) }, (_, i) => d.hours[0] + i).filter(h => f[h] == null);
        if (miss.length) out.push(`${label}的 ${miss.length === 1 ? `${miss[0]} 時` : `${miss[0]}–${miss[miss.length - 1] + 1} 時`}無旅次紀錄，數字只含有紀錄的小時。`);
      };
      gaps('基準期', p.baseline.forward);
      gaps('目前期', p.current.forward);
    }
    if (d.days[0] !== d.days[1]) out.push(`兩期有效天數不同（${d.days[0]} 天對 ${d.days[1]} 天），已用每日平均比較。`);
    return out;
  });

  /** 同樣的 24 小時以數字呈現，方便精確讀值。 */
  readonly hourTable = computed(() => {
    const p = this.profile(), d = this.data();
    if (!p || !d) return [];
    return Array.from({ length: 24 }, (_, h) => {
      const a = p.baseline.forward[h], b = p.current.forward[h];
      const diff = a != null && b != null ? b - a : null;
      return { h, a, b, diff, pct: diff != null && a ? diff / a : null, selected: h >= d.hours[0] && h < d.hours[1] };
    });
  });

  private readonly http = inject(HttpClient);
  private readonly injector = inject(Injector);
  private map?: MapLibreMap;
  private stops = new Map<string, Point>();
  private stationLines = new Map<string, Line[]>();
  private frame?: number;
  private particleElapsed = 0;
  private profileRequest = 0;
  /** 只要還有資料來源在載入，isStyleLoaded() 就會是 false，所以改在這裡自行追蹤是否就緒。 */
  private layersReady = false;
  retryBasemap: () => void = () => undefined;
  private displayedStreams: Stream[] = [];
  private ribbonMoving = false;
  private ribbonFrame = 0;
  private basemapPaint: MapPaint[] = [];
  private mapLighting?: number;
  private pendingFly = false;
  private remountNotBefore = 0;
  private savedMapCamera?: { center: Point; zoom: number; pitch: number; bearing: number };
  private mapGuard?: ReturnType<typeof setInterval>;
  readonly motion = inject(MotionPreference);
  get reducedMotion() { return this.motion.reduced(); }

  constructor() {
    autoRetry(() => this.error(), () => this.retryInitialLoad());
    autoRetry(() => this.profileError(), () => this.retryProfile());
    // 收藏連結讀進 pendingImport 後就把 # 拿掉，重新整理不會再問一次
    if (location.hash.startsWith('#collection=')) history.replaceState(null, '', location.pathname + location.search);
    afterRenderEffect({ read: () => {
      this.theme();
      const host = this.mapElement().nativeElement.closest('app-root');
      if (host) {
        const color = getComputedStyle(host).getPropertyValue('--band').trim();
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
      }
    } });
    afterNextRender(() => {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;visibility:hidden;width:50px;height:50px;overflow:scroll';
      document.body.append(probe);
      document.documentElement.style.setProperty('--sb', `${probe.offsetWidth - probe.clientWidth}px`);
      probe.remove();
      void this.initialize();
    });
    afterRenderEffect({ read: onCleanup => {
      const workspace = this.mapElement().nativeElement.closest<HTMLElement>('.workspace');
      this.view();
      this.mobilePage();
      this.explore();
      this.focusedFlow();
      this.selectedMapStation();
      this.showFirstQuery();
      if (!workspace || !this.phone()) return;
      const docks = Array.from(workspace.querySelectorAll(
        '.mobile-overview, .panel-body app-first-query, app-time-player, .flow-preview, .station-preview',
      ));
      const overview = workspace.querySelector<HTMLElement>('.mobile-overview');
      const positionControls = () => {
        const { bottom } = workspace.getBoundingClientRect();
        const timeline = workspace.querySelector('app-time-player')?.getBoundingClientRect();
        const timelineLift = timeline?.height && timeline.bottom > bottom - 96 ? bottom - timeline.top : 0;
        let lift = 0;
        for (const dock of docks) {
          const rect = dock.getBoundingClientRect();
          if (!rect.height) continue;
          if (dock.matches('.flow-preview') && timelineLift) {
            lift = Math.max(lift, timelineLift + rect.height + 24);
          } else if (rect.bottom > bottom - 96) {
            lift = Math.max(lift, bottom - rect.top + 12);
          }
        }
        const overviewHeight = `${overview?.offsetHeight ?? 0}px`;
        if (workspace.style.getPropertyValue('--overview-height') !== overviewHeight) {
          workspace.style.setProperty('--overview-height', overviewHeight);
        }
        const offset = lift ? Math.ceil(lift) + 'px' : '';
        if (workspace.style.getPropertyValue('--nav-dock') !== offset) workspace.style.setProperty('--nav-dock', offset);
        const timelineOffset = timelineLift ? Math.ceil(timelineLift) + 'px' : '';
        if (workspace.style.getPropertyValue('--timeline-dock') !== timelineOffset) workspace.style.setProperty('--timeline-dock', timelineOffset);
      };
      const observer = new ResizeObserver(positionControls);
      observer.observe(workspace);
      docks.forEach(dock => observer.observe(dock));
      onCleanup(() => observer.disconnect());
    } });
    effect(() => {
      this.mapElement();
      untracked(() => this.ensureMapMounted());
    });
    this.mapGuard = setInterval(() => this.ensureMapMounted(), 1500);
    // 網址列隨時保存目前畫面，重新整理或分享連結都能還原
    let lastPeriod: string | undefined;
    effect(() => {
      const period = this.stationPeriod();
      untracked(() => { const name = this.selectedMapStation(); if (name && period !== lastPeriod) this.loadStationInfo(name, false); lastPeriod = period; });
    });
    effect(() => { const s = this.viewState(); if (this.view() === 'pairs' && this.showResults()) history.replaceState(null, '', writeState(s)); });
    effect(() => {
      const exits = this.showEntrances() ? this.entrancesAtPeriod() : [];
      this.drawEntrances(exits);
      untracked(() => this.drawTowers());
    });
    effect(() => {
      const active = this.activeEntrance();
      for (const [exit, pin] of this.entrancePins) pin.getElement().setAttribute('aria-pressed', String(exit === active));
    });
    effect(() => {
      const shade = this.lighting();
      const playing = this.explore()?.playing() ?? false;
      this.applyMapLighting(shade, playing);
    });
    effect(() => this.syncRankLink());
    effect(() => {
      const reduced = this.motion.reduced();
      document.documentElement.toggleAttribute('data-reduced-motion', reduced);
      untracked(() => {
        if (reduced) {
          this.explore()?.stopPlayback();
          this.map?.stop();
          for (const animation of document.getAnimations()) {
            if (animation.id === 'control-position') animation.cancel();
          }
        }
        this.redraw(false);
      });
    });
    addEventListener('keydown', this.onKey);
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    addEventListener('beforeinstallprompt', this.onBeforeInstall);
    addEventListener('appinstalled', this.onAppInstalled);
  }

  private readonly onKey = (e: KeyboardEvent) => {
    if (document.querySelector('dialog[open]')) return; // 對話框開著時，鍵盤交給對話框
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
    if (e.key === 'Escape' && this.mapFullscreen()) {
      if (!document.fullscreenElement) { e.preventDefault(); void this.toggleMapFullscreen(); }
      return;
    }
    if (e.key === 'Escape' && this.mapOnly()) { e.preventDefault(); this.toggleMapOnly(); return; }
    if (e.key === 'Escape' && this.openMenu()) { e.preventDefault(); this.closeMenus(true); return; }
    if (e.key === 'Escape' && this.detailWide()) { e.preventDefault(); this.detailWide.set(false); return; }
    if (e.key === 'Escape' && this.selectedMapStation()) { e.preventDefault(); this.closeStationPreview(); return; }
    if (e.key === 'Escape' && this.selected()) { e.preventDefault(); this.closeDetail(); return; }
    if (e.key === 'Escape' && this.phone() && this.mobilePage() === 'conditions') { this.showResults() ? this.showMobileList() : this.showMobileMap(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '[' && !this.phone()) { e.preventDefault(); this.togglePanelOpen(); return; }
    if (this.view() !== 'pairs') return;
    if (e.key === '/' && this.view() === 'pairs' && this.showResults()) { e.preventDefault(); this.panelOpen.set(true); this.toolsOpen.set(true); setTimeout(() => this.searchInput()?.nativeElement.focus()); return; }
    if ((e.key === 'j' || e.key === 'k') && this.results().length) {
      const list = this.results(), at = list.indexOf(this.selected()!);
      const next = list[Math.min(list.length - 1, Math.max(0, at + (e.key === 'j' ? 1 : -1)))];
      if (list.indexOf(next) >= this.shown()) this.shown.set(this.shown() + PAGE);
      this.choose(next);
    }
  };

  togglePause() {
    this.paused.set(!this.paused()); store('exitpulse.paused', this.paused() ? '1' : '0');
    this.redraw(false);
  }

  exportCsv() {
    const d = this.data()!;
    const dt = this.datasetDayType(d);
    const dayDesc = dt === 'workday' ? '純工作日（依行事曆排除國定假日並納入補班日）' : dt === 'weekend' ? '週末' : '平日（週一至週五，不扣國定假日）';
    const meta: Array<[string, string | number]> = [
      ...exportBasis(),
      ['功能', '兩站比較'], ['基準期間', d.baseline], ['比較期間', d.current], ['日型', dayDesc],
      ['進站時段', `${d.hours[0]}–${d.hours[1]} 時`], ['基準有效天數', d.days[0]], ['比較有效天數', d.days[1]],
      ['變化類型', TYPES[this.changeType()]], ['每日至少人次', this.minimum()], ['納入比較的站數', d.commonStations],
      ['統計說明', '占比為起站出發的可比較旅次中前往該站的比例，比例變化以百分點表示'], ['查詢連結', location.href],
    ];
    downloadCsv(`exitpulse-${d.baseline}-${d.current}-${dt}-${this.hours()}.csv`, (({ head, rows }) => buildCsv(meta, head, rows))(csvTable(this.results())));
  }

  /** 把目前選取的兩站畫成一張 1200×630 的結論卡並下載，方便貼到訊息或簡報。 */
  async saveCard() {
    const r = this.selected(), d = this.data(), s = this.story();
    if (!r || !d || !s) return;
    const font = getComputedStyle(document.body).getPropertyValue('--ui-font').trim();
    await Promise.allSettled([
      document.fonts.load(`800 40px ${font}`, `ExitPulse　捷運旅次變化雷達 ${r.origin} → ${r.destination} 0123456789,.−+`),
      document.fonts.load(`700 40px ${font}`, s.headline),
      document.fonts.load(`400 40px ${font}`, `${s.when} · 納入比較 0123456789 站 · 兩期各有效天數與每日人次 資料：臺北市資料大平臺 臺北捷運每日分時各站 OD 流量統計`),
    ]);
    const scale = 2, W = 1200, H = 630, canvas = document.createElement('canvas');
    canvas.width = W * scale; canvas.height = H * scale;
    const g = canvas.getContext('2d');
    if (!g) { this.say('這個瀏覽器無法產生圖片'); return; }
    g.scale(scale, scale);
    const ink = '#1d2125', muted = '#5e5a51', paper = '#f4f1ea';
    const text = (value: string, x: number, y: number, size: number, weight: number, color = ink, align: CanvasTextAlign = 'left') => {
      g.font = `${weight} ${size}px ${font}`; g.fillStyle = color; g.textAlign = align;
      // 長站名或長句不會超出右緣，過長時整行等比壓縮
      if (align === 'left') g.fillText(value, x, y, W - 64 - x); else g.fillText(value, x, y);
    };
    g.fillStyle = paper; g.fillRect(0, 0, W, H);
    const from = this.lineOf(r.origin)?.color ?? ink, to = this.lineOf(r.destination)?.color ?? ink;
    g.fillStyle = from; g.fillRect(0, 0, W / 2, 14); g.fillStyle = to; g.fillRect(W / 2, 0, W / 2, 14);
    text('ExitPulse　捷運旅次變化雷達', 64, 84, 26, 800);
    text(`${r.origin}  →  ${r.destination}`, 64, 192, 68, 800);
    text(s.headline, 64, 262, 40, 700);
    const figure = (x: number, label: string, daily: number, color: string) => {
      text(label, x, 348, 26, 400, muted);
      text(formatDailyTrips(daily), x, 456, 112, 800, color);
      text('每日人次', x, 516, 26, 400, muted);
    };
    figure(64, d.baseline, r.baselineDaily, muted);
    text('→', 560, 440, 64, 400, muted, 'center');
    figure(640, d.current, r.currentDaily, ink);
    g.fillStyle = ink; g.fillRect(64, 546, W - 128, 2);
    const days = d.days[0] === d.days[1] ? `兩期各 ${d.days[0]} 天` : `有效天數 ${d.days[0]} 與 ${d.days[1]} 天`;
    text(`${s.when} · 納入比較 ${d.commonStations} 站 · ${days}`, 64, 580, 22, 400, muted);
    text('資料：臺北市資料大平臺 臺北捷運每日分時各站 OD 流量統計', 64, 610, 18, 400, muted);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) { this.say('圖片產生失敗，請再試一次'); return; }
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: url, download: `exitpulse-${r.origin}-${r.destination}-${d.baseline}-${d.current}.png` }).click();
    URL.revokeObjectURL(url);
    this.say('已存成圖片');
  }

  hoverPair(r: Result | null) {
    const key = r ? `${r.origin}>${r.destination}` : '';
    if (key === this.hoveredKey || this.selected() || this.view() !== 'pairs') return;
    this.hoveredKey = key;
    cancelAnimationFrame(this.hoverFrame);
    this.hoverFrame = requestAnimationFrame(() => { if (!this.selected()) this.redraw(false); });
  }

  async copyLink() {
    try { await navigator.clipboard.writeText(location.href); this.say('已複製這個畫面的連結'); }
    catch { this.say('瀏覽器不允許複製，請直接複製網址列'); }
  }

  private say(text: string) { this.notice.set(text); setTimeout(() => { if (this.notice() === text) this.notice.set(''); }, 2400); }

  focusStation(station: string) {
    this.panelOpen.set(true); this.setQuery(station);
    // 手機一次只顯示一個畫面，詳情收起後清單才會出現
    if (this.phone()) this.closeDetail();
    this.redraw(true);
  }

  /** 月份清單就緒後套用分享連結，再重跑連結描述的比較。 */
  private async restore() {
    if (!location.search && this.view() === 'pairs') this.redraw(true);
    if (!location.search || this.view() !== 'pairs') return;
    const s = readState(location.search, this.viewState());
    // 沒有 API 時只有內建的預設比較，連結帶來的條件無法套用
    if (this.apiAvailable() && this.months().includes(s.baseline) && this.months().includes(s.current)) {
      this.baseline.set(s.baseline); this.current.set(s.current); this.hours.set(s.hours);
      this.dayType.set(s.days ?? (s.weekend ? 'weekend' : 'weekday'));
      this.changeType.set(s.type as keyof typeof TYPES); this.minimum.set(s.minimum);
    } else if (this.apiAvailable() && (s.baseline || s.current)) {
      this.notice.set(`連結指定的月份已無資料，改顯示 ${this.baseline()} 與 ${this.current()}`);
    }
    await this.find();
    if (this.view() !== 'pairs') return;
    this.sortKey.set(s.sort); this.query.set(s.q); this.lineFilter.set(s.line);
    const pair = s.pair && this.data()?.results.find(r => `${r.origin}>${r.destination}` === s.pair);
    if (pair) this.choose(pair, false);
    else if (s.pair && this.apiAvailable()) {
      const [origin, destination] = s.pair.split('>');
      await this.findPair(origin, destination, false);
    } else this.redraw(true);
  }

  lineOf(station: string) { return this.stationLines.get(station)?.[0]; }
  linesOfStation(station: string) { return this.stationLines.get(station) ?? []; }
  private linesOf(station: string) { return this.linesOfStation(station).map(l => l.code); }
  value(r: Result) { return sortValue(r, this.sortKey()); }
  display(r: Result) {
    const key = this.sortKey(), v = sortValue(r, key);
    if (key === 'volume') return Math.round(v).toLocaleString('zh-TW');
    if (!Number.isFinite(v)) return '新增';
    const digits = key === 'share' ? 1 : 0;
    return (v >= 0 ? '+' : '−') + Math.abs(v).toLocaleString('zh-TW', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  private async initialize() {
    try {
      const [dataResponse, stopsResponse, orderResponse] = await Promise.all([fetch('od/default.json'), fetch('metro/stations.geojson'), fetch('metro/line-order.json')]);
      if (!dataResponse.ok || !stopsResponse.ok || !orderResponse.ok) throw new Error('load failed');
      this.lineOrder.set(await orderResponse.json());
      void fetch('metro/station-codes.json').then(r => r.json()).then(codes => this.stationCodes.set(codes)).catch(() => undefined);
      void firstValueFrom(this.http.get<StationAvailability>('/api/v1/od/availability'))
        .then(result => this.availability.set(result)).catch(() => this.availability.set({}));
      const data: Dataset = await dataResponse.json();
      const stops: { features: Stop[] } = await stopsResponse.json();
      for (const stop of stops.features) {
        this.stops.set(stop.properties.name, stop.geometry.coordinates);
        const codes = stop.properties.lines.split(','), colors = stop.properties.colors.split(',');
        const lines = codes.map((code, i) => ({ code, name: LINES[code], color: colors[i] })).filter(l => l.name);
        if (lines.length) this.stationLines.set(stop.properties.name, lines);
      }
      // OD 檔案把這個站名寫成尾端帶「站」
      for (const store of [this.stops, this.stationLines] as Map<string, unknown>[]) if (store.has('大橋頭')) store.set('大橋頭站', store.get('大橋頭'));
      this.data.set(data);
      void firstValueFrom(this.http.get<string[]>('/api/v1/od/months')).then(months => {
        if (months.length) { this.months.set(months); this.apiAvailable.set(true); }
      }).catch(() => undefined).finally(() => void this.restore());
      this.mountMap();
    } catch { this.error.set(true); }
  }

  private ensureMapMounted() {
    if (!this.data() || document.hidden) return;
    const container = this.mapElement()?.nativeElement;
    if (!container) return;
    if (!this.mountingMap && Date.now() >= this.remountNotBefore &&
        (!this.map || this.map.getContainer() !== container || !container.querySelector('canvas.maplibregl-canvas'))) {
      void this.mountMap();
    }
  }

  private async mountMap() {
    if (this.mountingMap) return;
    this.mountingMap = true;
    try {
      const [mod, r3d] = await Promise.all([import('maplibre-gl'), import('./radar-3d')]);
      if (!this.ml) {
        mod.setWorkerUrl(new URL('workers/maplibre-gl-worker.mjs', document.baseURI).href);
        this.ml = mod;
      }
      const maplibregl = this.ml;
      this.r3d ??= r3d;
      const container = this.mapElement()?.nativeElement;
      if (!container) return;
      if (this.map) {
        const previous = this.map;
        this.savedMapCamera = { center: previous.getCenter().toArray() as Point,
          zoom: previous.getZoom(), pitch: previous.getPitch(), bearing: previous.getBearing() };
        this.pendingFly = false;
        this.stop();
        ++this.ribbonFrame;
        this.map = undefined;
        try { previous.remove(); } catch {}
      }
      const camera = this.savedMapCamera;
      this.hero = undefined;
      this.scaleControl = undefined;
      this.entrancePins.clear();
      this.elevatedFlow = undefined;
      this.ribbonMoving = false;
      this.mapActive.set(false);
      this.layersReady = false;
      this.mapLighting = undefined;
      this.basemapBusy.set(false);
      this.basemap.set('loading');
      const on3d = this.tower3d();
      const map = new maplibregl.Map({
        container, style: LOCAL_MAP,
        center: camera?.center ?? [121.53, 25.05], zoom: camera?.zoom ?? 10.6,
        pitch: camera?.pitch ?? (on3d ? (this.lowAngle() ? this.streetPitch() : this.towerPitch()) : 0),
        bearing: camera?.bearing ?? (on3d ? -14 : 0),
        minZoom: 9.5, maxZoom: 18, maxPitch: on3d ? LOW_PITCH : 0, minPitch: on3d ? MIN_TOWER_PITCH : 0,
        maxBounds: [[120.65, 24.2], [122.45, 25.7]], attributionControl: false,
        dragPan: { linearity: .25, maxSpeed: 950, deceleration: 4000 },
        locale: { 'NavigationControl.ZoomIn': '放大地圖', 'NavigationControl.ZoomOut': '縮小地圖', 'NavigationControl.ResetBearing': '朝向正北' },
      });
      this.map = map;
      this.savedMapCamera = undefined;
      this.remountNotBefore = 0;
      map.getCanvas().setAttribute('aria-label', '捷運人流地圖，方向鍵平移，加減鍵縮放');
      this.elevatedFlow = new r3d.ElevatedFlow(map);
      map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
      map.on('zoom', () => { if (this.entrancePins.size) this.spreadEntrances(); });
      map.on('zoomend', () => {
        if (this.tower3d()) { this.drawTowers(); this.drawElevatedStreams(); }
      });
      map.on('pitchend', () => this.lowAngle.set(map.getPitch() >= this.streetPitch() - 1));
      map.on('style.load', () => {
        if (!map.getLayer('focus-scrim')) {
          this.addLayers();
        } else {
          // A restored style retains the ordinary layers but drops custom render callbacks.
          this.elevatedFlow?.installLayer();
          this.layersReady = true;
          this.redraw(false);
        }
      });
      this.watchBasemap(map);
      const stationLayers = ['metro-hit', 'od-stops', 'od-ranks', 'od-count-labels', 'explore-circles'];
      const flowLayers = ['od-ribbons', 'od-streams', 'od-streams-dashed'];
      const holdRibbonWidth = () => {
        if (!this.layersReady || this.ribbonMoving) return;
        this.ribbonMoving = true;
        ++this.ribbonFrame;
        map.setPaintProperty('od-ribbons', 'fill-opacity', 0);
        map.setPaintProperty('od-streams', 'line-width', ['get', 'width']);
      };
      map.on('dragstart', () => this.mapActive.set(true));
      map.on('dragend', () => this.mapActive.set(false));
      map.on('zoomstart', holdRibbonWidth);
      map.on('pitchstart', holdRibbonWidth);
      map.on('move', () => map.getContainer().toggleAttribute('data-tilted', Math.abs(map.getBearing()) > 1 || map.getPitch() > 1));
      map.on('moveend', () => {
        if (!this.ribbonMoving) return;
        this.ribbonMoving = false;
        void this.drawRibbons();
      });
      // 手指在拖、縮放地圖時，底部的卡片先退成半透明，露出被擋住的地圖
      let settle = 0;
      map.on('movestart', () => { clearTimeout(settle); this.mapMoving.set(true); });
      map.on('moveend', () => { settle = window.setTimeout(() => this.mapMoving.set(false), 450); });
      map.on('click', stationLayers, e => {
        const name = e.features?.[0]?.properties?.['name'];
        if (name && this.linesOfStation(name).length) this.pickStationOnMap(name);
      });
      map.on('mouseenter', stationLayers, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mousemove', stationLayers, e => {
        if (!this.device().hover || map.isMoving()) return;
        const name = e.features?.[0]?.properties?.['name'];
        this.explore()?.previewRank(typeof name === 'string' ? name : null, 'map');
      });
      map.on('mouseleave', stationLayers, () => { map.getCanvas().style.cursor = ''; this.explore()?.previewRank(null, 'map'); });
      map.on('click', e => {
        if (!this.layersReady) return;
        if (map.queryRenderedFeatures(e.point, { layers: stationLayers }).length) return;
        const key = this.elevatedFlow?.hit(e.point)
          ?? map.queryRenderedFeatures(e.point, { layers: flowLayers })[0]?.properties?.['key'];
        if (!key) {
          if (this.placeMenu()?.nativeElement.open) {
            this.locatePlace({
              name: '地圖選定位置',
              area: `${e.lngLat.lat.toFixed(4)}, ${e.lngLat.lng.toFixed(4)}`,
              category: '圖面點選',
              lng: e.lngLat.lng,
              lat: e.lngLat.lat,
            });
          } else if (this.selectedMapStation()) this.closeStationPreview();
          return;
        }
        if (this.view() === 'station') {
          const explorer = this.explore();
          const other = typeof key === 'string' ? key.split('>').find(name => name !== explorer?.station()) : undefined;
          if (other && explorer) {
            if (explorer.focusedRelation() === other) explorer.focusRelation(null);
            else explorer.selectRankFromMap(other);
          }
          return;
        }
        const hit = this.results().find(r => `${r.origin}>${r.destination}` === key);
        if (hit) this.choose(hit);
      });
      map.on('mouseenter', flowLayers, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', flowLayers, () => { map.getCanvas().style.cursor = ''; });
    } catch (error) {
      console.warn('Unable to start the map renderer', error);
      try { this.map?.remove(); } catch {}
      this.map = undefined;
      this.basemap.set('failed');
      this.remountNotBefore = Date.now() + 5000;
      this.retryBasemap = () => { this.remountNotBefore = 0; this.ensureMapMounted(); };
    } finally {
      this.mountingMap = false;
    }
  }

  retryInitialLoad() {
    this.error.set(false);
    void this.initialize();
  }

  private watchBasemap(map: MapLibreMap) {
    const sourceID = 'openmaptiles';
    type Coordinate = { z: number; x: number; y: number };
    type SourceEvent = { sourceId?: string; tile?: { tileID: { canonical: Coordinate } } };
    const failedTiles = new Map<string, Coordinate>();
    const tileKey = ({ z, x, y }: Coordinate) => `${z}/${x}/${y}`;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let busy: ReturnType<typeof setTimeout> | undefined;
    let contextTimer: ReturnType<typeof setTimeout> | undefined;
    let contextLostAt = 0;
    let attempts = 0, sourceFailed = false, hasTile = false, contextLost = false, disposed = false;
    let fetching: AbortController | undefined;
    const schedule = () => {
      if (retry !== undefined || disposed || contextLost) return;
      retry = setTimeout(() => { retry = undefined; void recover(); }, Math.min(30000, 1000 * 2 ** Math.min(attempts, 5)));
    };
    const confirmFailure = () => {
      this.basemap.set('failed');
      this.basemapBusy.set(false);
      schedule();
    };
    const startTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        timeout = undefined;
        if (!hasTile || sourceFailed || failedTiles.size) confirmFailure();
      }, 12000);
    };
    const recover = async () => {
      if (disposed || contextLost || fetching) return;
      attempts++;
      const source = map.getSource<maplibregl.VectorTileSource>(sourceID);
      if (source && this.layersReady && attempts < 2) {
        if ((sourceFailed || !hasTile) && source.url) {
          sourceFailed = false;
          source.setUrl(source.url);
        } else {
          map.refreshTiles(sourceID, failedTiles.size ? [...failedTiles.values()] : undefined);
        }
        map.triggerRepaint();
        startTimeout();
        return;
      }
      hasTile = false;
      fetching = new AbortController();
      try {
        const response = await fetch(STYLE, { signal: AbortSignal.any([fetching.signal, AbortSignal.timeout(9000)]) });
        if (!response.ok) throw new Error(`Basemap style HTTP ${response.status}`);
        const style: StyleSpecification = await response.json();
        if (!style.sources?.[sourceID]) throw new Error('Basemap style has no vector source');
        if (disposed || contextLost) return;
        this.stop();
        this.layersReady = false;
        this.mapLighting = undefined;
        failedTiles.clear();
        sourceFailed = false;
        map.setStyle(style, { diff: false });
        startTimeout();
      } catch {
        if (!disposed && !contextLost) {
          if (!this.layersReady || !map.getLayer('metro-network')) map.setStyle(LOCAL_MAP, { diff: false });
          confirmFailure();
        }
      } finally {
        fetching = undefined;
      }
    };
    this.retryBasemap = () => {
      if (contextLost) {
        rebuildIfLost();
        return;
      }
      clearTimeout(retry); retry = undefined;
      attempts = 0;
      void recover();
    };
    map.on('error', event => {
      if (contextLost) return;
      const { sourceId, tile } = event as SourceEvent;
      if (!sourceId && !map.getSource(sourceID)) {
        confirmFailure();
        return;
      }
      if (sourceId !== sourceID) return;
      if (tile) failedTiles.set(tileKey(tile.tileID.canonical), tile.tileID.canonical);
      else sourceFailed = true;
      if (!hasTile) confirmFailure();
      else schedule();
    });
    map.on('sourcedata', event => {
      if (contextLost) return;
      const { sourceId, tile } = event as SourceEvent;
      if (sourceId !== sourceID) return;
      if (event.sourceDataType === 'metadata') sourceFailed = false;
      if (!tile) return;
      failedTiles.delete(tileKey(tile.tileID.canonical));
      hasTile = true;
    });
    map.on('dataloading', event => {
      if (this.basemap() !== 'ready' || (event as SourceEvent).sourceId !== sourceID || busy !== undefined) return;
      busy = setTimeout(() => this.basemapBusy.set(true), 700);
    });
    map.on('render', () => {
      if (contextLost || !hasTile || sourceFailed || !map.getSource(sourceID) || !map.isSourceLoaded(sourceID)) return;
      clearTimeout(busy); busy = undefined;
      this.basemapBusy.set(false);
      if (failedTiles.size) return;
      clearTimeout(timeout); timeout = undefined;
      clearTimeout(retry); retry = undefined;
      attempts = 0;
      this.basemap.set('ready');
    });
    const rebuildIfLost = () => {
      if (disposed || !contextLost || document.hidden || this.map !== map) return;
      if (Date.now() - contextLostAt < WEBGL_RESTORE_TIMEOUT) return;
      // A new map may need to fetch its module worker, even if the old map had loaded one.
      if (!navigator.onLine) {
        confirmFailure();
        return;
      }
      void this.mountMap();
    };
    map.on('webglcontextlost', () => {
      if (contextLost) return;
      contextLost = true;
      contextLostAt = Date.now();
      hasTile = false;
      this.stop();
      fetching?.abort();
      clearTimeout(retry); retry = undefined;
      clearTimeout(timeout); timeout = undefined;
      clearTimeout(busy); busy = undefined;
      this.basemapBusy.set(false);
      this.basemap.set('loading');
      contextTimer = setTimeout(rebuildIfLost, WEBGL_RESTORE_TIMEOUT);
    });
    map.on('webglcontextrestored', () => {
      clearTimeout(contextTimer);
      contextLost = false;
      this.layersReady = false;
      this.mapLighting = undefined;
      failedTiles.clear();
      sourceFailed = false;
      startTimeout();
      schedule();
    });
    const checkHealth = () => {
      if (disposed || document.hidden || fetching) return;
      if (contextLost) { rebuildIfLost(); return; }
      if (!this.layersReady && map.isStyleLoaded() && !map.getLayer('focus-scrim')) this.addLayers();
      const src = map.getSource<maplibregl.VectorTileSource>(sourceID);
      if (!src || this.basemap() !== 'ready' || failedTiles.size || sourceFailed) {
        if (timeout === undefined) schedule();
        return;
      }
      if (map.loaded() && map.isSourceLoaded(sourceID)) {
        const probeLayers = ['water', 'landcover', 'landuse', 'building', 'transportation', 'park'].filter(id => !!map.getLayer(id));
        if (!probeLayers.length || (map.querySourceFeatures(sourceID).length === 0 && map.queryRenderedFeatures(undefined, { layers: probeLayers }).length === 0)) {
          hasTile = false;
          schedule();
        }
      }
    };
    const wake = () => {
      if (disposed || document.hidden) return;
      if (contextLost) { rebuildIfLost(); return; }
      map.resize();
      map.triggerRepaint();
      if (this.layersReady) this.redraw(false);
      setTimeout(checkHealth, 250);
    };
    const online = () => { wake(); if (this.basemap() !== 'ready' || failedTiles.size || !map.getSource(sourceID)) this.retryBasemap(); };
    const watchdog = setInterval(checkHealth, 4000);
    addEventListener('online', online);
    addEventListener('focus', wake);
    addEventListener('pageshow', wake);
    document.addEventListener('visibilitychange', wake);
    map.once('remove', () => {
      disposed = true;
      fetching?.abort();
      clearTimeout(retry); clearTimeout(timeout); clearTimeout(busy); clearTimeout(contextTimer);
      clearInterval(watchdog);
      removeEventListener('online', online);
      removeEventListener('focus', wake);
      removeEventListener('pageshow', wake);
      document.removeEventListener('visibilitychange', wake);
    });
    void recover();
  }

  private addLayers() {
    const map = this.map!, dark = this.theme() === 'dark';
    const ink = dark ? '#eef1f2' : '#1d2125', halo = dark ? '#15191c' : LIGHT_MAP.halo;
    if (map.getSource('openmaptiles')) {
      map.addLayer({
        id: 'extra-places', type: 'symbol', source: 'openmaptiles', 'source-layer': 'poi', minzoom: 12,
        filter: ['all', ['has', 'name'], ['in', ['get', 'class'], ['literal', ['park', 'hospital', 'college', 'town_hall', 'library', 'art_gallery', 'attraction', 'stadium', 'zoo']]]],
        layout: { visibility: this.showPlaces() ? 'visible' : 'none', 'text-field': ['coalesce', ['get', 'name:zh-Hant'], ['get', 'name:zh'], ['get', 'name']],
          'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-max-width': 12, 'text-padding': 8, 'symbol-sort-key': ['coalesce', ['get', 'rank'], 30] },
        paint: { 'text-color': LIGHT_MAP.label, 'text-halo-color': LIGHT_MAP.halo, 'text-halo-width': 1.2 },
      });
    }
    // 底圖標籤改成繁體中文優先，避免每個地名都「拼音＋中文」雙行堆在一起
    for (const layer of map.getStyle().layers) {
      if (layer.type !== 'symbol') continue;
      const field = map.getLayoutProperty(layer.id, 'text-field');
      if (field != null && JSON.stringify(field).includes('name')) {
        map.setLayoutProperty(layer.id, 'text-field', ['coalesce', ['get', 'name:zh-Hant'], ['get', 'name:zh'], ['get', 'name']]);
      }
    }
    this.basemapPaint = this.readBasemapPaint(map);
    this.mapLighting = undefined;
    if (map.getSource('openmaptiles')) {
      map.addLayer({
        id: 'buildings-3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 14.5,
        layout: { visibility: this.tower3d() ? 'visible' : 'none' },
        paint: {
          'fill-extrusion-color': dark ? DARK_MAP.building : LIGHT_MAP.building,
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14.5, 0, 15.5, ['coalesce', ['get', 'render_height'], 6]],
          'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 14.5, 0, 15.5, ['coalesce', ['get', 'render_min_height'], 0]],
          'fill-extrusion-opacity': .82, 'fill-extrusion-vertical-gradient': true,
        },
      });
    }
    // 聚焦罩：選了站對或單站時把底圖退到背景，讓人流成為畫面主角
    map.addLayer({ id: 'focus-scrim', type: 'background', paint: { 'background-color': LIGHT_MAP.land, 'background-opacity': 0, 'background-opacity-transition': { duration: 450 } } });
    map.addSource('metro-network', { type: 'geojson', data: 'metro/lines.geojson' });
    const netFilter: ExpressionSpecification = ['in', ['get', 'lineId'], ['literal', this.lineList]];
    const netLayout = { 'line-cap': 'round', 'line-join': 'round' } as const;
    map.addLayer({ id: 'metro-network-casing', type: 'line', source: 'metro-network', filter: netFilter, layout: netLayout,
      paint: { 'line-color': dark ? '#0f1316' : '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3.8, 14, 8, 17, 13], 'line-opacity': dark ? .9 : .95 } });
    map.addLayer({ id: 'metro-network', type: 'line', source: 'metro-network', filter: netFilter, layout: netLayout,
      paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 4.8, 17, 8], 'line-opacity': dark ? .9 : .9 } });
    map.addLayer({ id: 'metro-network-core', type: 'line', source: 'metro-network', filter: netFilter, layout: netLayout,
      paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 12.5, 0, 13.5, .8, 15.5, 1.4, 17, 2], 'line-opacity': dark ? .3 : .5 } });
    map.addSource('metro-stops', { type: 'geojson', data: 'metro/stations.geojson' });
    const metroOnly: ExpressionSpecification = ['any', ...this.lineList.map(code => ['in', code, ['split', ['get', 'lines'], ',']] as ExpressionSpecification)];
    map.addLayer({ id: 'metro-stops', type: 'circle', source: 'metro-stops', minzoom: 9.5, filter: metroOnly, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9.5, 3.5, 13, 5.5], 'circle-color': dark ? NIGHT_STATION.regular : halo, 'circle-stroke-color': dark ? NIGHT_STATION.rim : '#707a82', 'circle-stroke-width': 1.4 } });
    map.addLayer({ id: 'metro-hit', type: 'circle', source: 'metro-stops', minzoom: 9.5, filter: metroOnly, paint: { 'circle-radius': 18, 'circle-opacity': 0 } });
    map.addSource('od-ribbons', { type: 'geojson', data: EMPTY });
    map.addLayer({ id: 'od-ribbons', type: 'fill', source: 'od-ribbons', layout: { 'fill-sort-key': ['get', 'opacity'] },
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'opacity'], 'fill-opacity-transition': { duration: 0 } } });
    map.addSource('od-streams', { type: 'geojson', data: EMPTY });
    map.addLayer({ id: 'od-streams-dashed', type: 'line', source: 'od-streams', filter: ['==', ['get', 'dashed'], true], layout: { 'line-cap': 'butt', 'line-sort-key': ['get', 'opacity'] }, paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': ['get', 'opacity'], 'line-dasharray': [1.5, 1.2] } });
    map.addLayer({ id: 'od-streams', type: 'line', source: 'od-streams', filter: ['==', ['get', 'dashed'], false], layout: { 'line-cap': 'round', 'line-sort-key': ['get', 'opacity'] }, paint: { 'line-color': ['get', 'color'], 'line-width': ['max', 0.8, ['*', ['get', 'width'], .24]], 'line-width-transition': { duration: 0 }, 'line-opacity': ['get', 'opacity'] } });
    map.addSource('explore-circles', { type: 'geojson', data: EMPTY });
    map.addLayer({ id: 'explore-circles', type: 'circle', source: 'explore-circles', layout: { 'circle-sort-key': ['-', 0, ['get', 'radius']] }, paint: { 'circle-radius': zoomScaled(['get', 'radius']), 'circle-color': dotColor(dark), 'circle-opacity': dotFill(1 - this.dotTransparency() / 100), 'circle-stroke-color': dotColor(dark), 'circle-stroke-opacity': 1 - this.dotTransparency() / 100, 'circle-stroke-width': 2.2 } });
    // 比較模式：外環是本期、實心內圓是對照期，增減一眼看出（內圓比外環大就是減少）
    map.addLayer({ id: 'explore-inner', type: 'circle', source: 'explore-circles', filter: ['>', ['get', 'inner'], 0], layout: { 'circle-sort-key': ['-', 0, ['get', 'radius']] }, paint: { 'circle-radius': zoomScaled(['get', 'inner']), 'circle-color': dotColor(dark), 'circle-opacity': .62 * (1 - this.dotTransparency() / 100) } });
    map.addLayer({ id: 'explore-labels', type: 'symbol', source: 'explore-circles', filter: ['!=', ['get', 'label'], ''], layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-padding': 4, 'symbol-sort-key': ['-', 0, ['get', 'radius']],
      // 字一律放在圓的正下方，間距跟著圓一起放大，避開圓與選取環
      'text-variable-anchor': ['top'], 'text-radial-offset': zoomScaled(['get', 'radius'], 11, 13) }, paint: { 'text-color': ink, 'text-halo-color': halo, 'text-halo-width': 2 } });
    // 流向：箭頭沿弧線前進，身後拖一條很細的淡出尾巴。箭頭維持站牌風格的描邊白色，不做發光或模糊。
    map.addSource('od-comets', { type: 'geojson', data: EMPTY, lineMetrics: true });
    for (const kind of ['muted', 'flow']) {
      map.addLayer({ id: `od-comets-${kind}`, type: 'line', source: 'od-comets', filter: ['==', ['get', 'kind'], kind], layout: { 'line-cap': 'round' },
        paint: { 'line-width': ['get', 'w'], 'line-opacity': ['get', 'opacity'], 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,1)'] } });
    }
    map.addSource('od-particles', { type: 'geojson', data: EMPTY });
    const arrow = document.createElement('canvas');
    arrow.width = arrow.height = 24;
    const brush = arrow.getContext('2d')!;
    brush.beginPath();
    brush.moveTo(7, 5); brush.lineTo(16, 12); brush.lineTo(7, 19);
    brush.lineCap = 'round'; brush.lineJoin = 'round';
    brush.strokeStyle = '#22262a'; brush.lineWidth = 5; brush.stroke();
    brush.strokeStyle = '#fff'; brush.lineWidth = 2.7; brush.stroke();
    map.addImage('od-direction', brush.getImageData(0, 0, 24, 24));
    map.addLayer({ id: 'od-particles', type: 'symbol', source: 'od-particles',
      layout: { 'icon-image': 'od-direction', 'icon-size': .7, 'icon-rotate': ['get', 'bearing'], 'icon-rotation-alignment': 'map', 'icon-padding': 2 },
      paint: { 'icon-opacity': ['get', 'opacity'] } });
    this.paintComets();
    map.addSource('od-pulse', { type: 'geojson', data: EMPTY });
    map.addLayer({ id: 'od-pulse', type: 'circle', source: 'od-pulse',
      paint: { 'circle-radius': ['get', 'r'], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': ['get', 'color'],
        'circle-stroke-width': ['get', 'w'], 'circle-stroke-opacity': ['get', 'o'], 'circle-radius-transition': { duration: 0 } } });
    map.addSource('od-stops', { type: 'geojson', data: EMPTY });
    map.addLayer({ id: 'od-stops', type: 'circle', source: 'od-stops', paint: { 'circle-radius': zoomScaled(['coalesce', ['get', 'radius'], 7]), 'circle-color': dark ? NIGHT_STATION.ranked : halo, 'circle-stroke-width': ['case', ['==', ['get', 'active'], true], 5, ['>', ['coalesce', ['get', 'radius'], 7], 5], 3.5, 2.5], 'circle-stroke-color': ['get', 'color'] } });
    const labelPaint = { 'text-color': ink, 'text-halo-color': halo, 'text-halo-width': 2 };
    map.addLayer({ id: 'od-labels', type: 'symbol', source: 'od-stops',
      filter: ['==', ['coalesce', ['get', 'count'], ''], ''],
      layout: { 'text-field': ['coalesce', ['get', 'label'], ['get', 'name']], 'text-font': ['Noto Sans Bold'],
        'text-size': 15, 'text-variable-anchor': ['top'], 'text-radial-offset': zoomScaled(['coalesce', ['get', 'radius'], 7], 8, 13) }, paint: labelPaint });
    // 每條流向線旁直接寫期別與人次，不必回頭對照圖例
    map.addSource('od-flow-labels', { type: 'geojson', data: EMPTY });
    map.addLayer({ id: 'od-flow-labels', type: 'symbol', source: 'od-flow-labels',
      layout: { 'text-field': ['get', 'text'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-padding': 4,
        'text-variable-anchor': ['bottom', 'top', 'left', 'right'], 'text-radial-offset': .9 }, paint: labelPaint });
    map.addLayer({ id: 'od-count-labels', type: 'symbol', source: 'od-stops', filter: ['!=', ['coalesce', ['get', 'count'], ''], ''],
      layout: { 'text-field': ['format', ['get', 'name'], { 'font-scale': .93 }, '\n', {}, ['get', 'count'], { 'font-scale': 1.03 }],
        'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
        'text-radial-offset': zoomScaled(['coalesce', ['get', 'radius'], 7], 8, 13), 'text-justify': 'auto', 'text-padding': 3,
        'symbol-sort-key': ['coalesce', ['get', 'rank'], 99] }, paint: labelPaint });
    map.addLayer({ id: 'od-ranks', type: 'symbol', source: 'od-stops', filter: ['>', ['coalesce', ['get', 'rank'], 0], 0],
      layout: { 'text-field': ['to-string', ['get', 'rank']], 'text-font': ['Noto Sans Bold'], 'text-size': 11,
        'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': dark ? NIGHT_STATION.rankInk : ink } });
    map.addSource('place-result', { type: 'geojson', data: EMPTY });
    map.addSource('picked-station', { type: 'geojson', data: EMPTY });
    map.addLayer({ id: 'picked-station', type: 'circle', source: 'picked-station',
      paint: { 'circle-radius': 15, 'circle-opacity': 0, 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 3 } });
    map.addLayer({ id: 'place-link', type: 'line', source: 'place-result', filter: ['==', '$type', 'LineString'],
      paint: { 'line-color': '#7251ab', 'line-width': 2, 'line-dasharray': [2, 2] } });
    map.addLayer({ id: 'place-points', type: 'circle', source: 'place-result', filter: ['==', '$type', 'Point'],
      paint: { 'circle-radius': 6.5, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    installRankLink(map);
    this.syncRankLink();
    this.elevatedFlow?.installLayer();
    this.layersReady = true;
    this.sync3DVisibility();
    this.applyMapOptions();
    this.applyMapLighting(this.lighting(), false);
    this.drawEntrances(this.showEntrances() ? this.entrancesAtPeriod() : []);
    const fly = this.pendingFly; this.pendingFly = false;
    this.redraw(fly);
  }

  toggleTower3d() {
    const map = this.map;
    this.tower3d.update(on => !on);
    if (!map) return;
    const on = this.tower3d();
    map.stop();
    if (on) {
      map.setMaxPitch(LOW_PITCH);
      map.setMinPitch(MIN_TOWER_PITCH);
    } else {
      map.setMinPitch(0);
      this.lowAngle.set(false);
      map.once('moveend', () => { if (!this.tower3d()) map.setMaxPitch(0); });
    }
    this.drawTowers();
    this.drawElevatedStreams();
    const bearing = on ? -14 : 0;
    const pair = this.phone() && this.view() === 'pairs' ? this.selected() : null;
    const from = pair && this.stops.get(pair.origin), to = pair && this.stops.get(pair.destination);
    const fit = from && to && this.ml ? map.cameraForBounds(new this.ml.LngLatBounds(from, from).extend(to), { bearing, padding: this.padding(), maxZoom: 14.5 }) : undefined;
    const overview = on ? undefined : this.beforeLowAngle;
    this.beforeLowAngle = undefined;
    map.easeTo({ ...fit, ...overview, pitch: on ? this.towerPitch() : 0, bearing, duration: this.reducedMotion ? 0 : 760 });
    this.sync3DVisibility();
  }

  toggleLowAngle() {
    const map = this.map;
    if (!map || !this.tower3d()) return;
    const wasLow = this.lowAngle();
    map.stop();
    if (wasLow) {
      const previous = this.beforeLowAngle;
      this.beforeLowAngle = undefined;
      this.lowAngle.set(false);
      map.easeTo({ pitch: this.towerPitch(), ...previous, duration: this.reducedMotion ? 0 : 650 });
      return;
    }
    this.beforeLowAngle = { center: map.getCenter().toArray(), zoom: map.getZoom(), pitch: map.getPitch() };
    this.lowAngle.set(true);
    if (this.phone() && stored('exitpulse.flow') == null) this.flowFolded.set(true);
    this.focusLowAngle();
  }

  /** 手機畫面窄長，傾角太大會讓上半部整片是空的天空，浪費地圖空間 */
  private towerPitch() {
    return this.phone() ? PHONE_TOWER_PITCH : TOWER_PITCH;
  }

  private streetPitch() {
    return this.phone() ? PHONE_STREET_PITCH : LOW_PITCH;
  }

  focusPairStreetStation(station: string) {
    if (!this.lowAngle()) return;
    this.map?.stop();
    this.lowAngle.set(true);
    this.pairStreetStation.set(station);
    this.focusLowAngle();
  }

  private focusLowAngle() {
    const map = this.map;
    if (!map) return;
    const pair = this.selected();
    const explore = this.explore();
    const station = this.selectedMapStation() ?? (this.view() === 'pairs' ? this.pairStreetStation()
      : this.view() === 'station' ? explore?.focusedRelation() ?? explore?.station()
      : this.exploreLayer()?.focus);
    if (pair && station && (station === pair.origin || station === pair.destination)) this.pairStreetStation.set(station);
    const at = station ? this.stops.get(station) : undefined;
    const panel = this.panelOpen() ? document.querySelector('.panel')?.getBoundingClientRect() : undefined;
    const mobile = this.phone();
    const offset: Point = mobile ? [0, Math.round(map.getCanvas().clientHeight * .055)] : [Math.round((panel?.right ?? 0) / 2), 0];
    const zoom = mobile ? PHONE_STREET_ZOOM : Math.max(STREET_ZOOM, map.getZoom());
    this.drawTowers();
    map.easeTo({ center: at ?? map.getCenter(), zoom, pitch: this.streetPitch(), offset,
      duration: this.reducedMotion ? 0 : 780 });
  }

  private sync3DVisibility() {
    const map = this.map;
    if (!map || !this.layersReady) return;
    const lifted = this.tower3d();
    this.elevatedFlow?.show(lifted);
    const layers = [
      ['buildings-3d', lifted], ['explore-circles', !lifted], ['explore-inner', !lifted],
      ...FLAT_FLOW_LAYERS.map(id => [id, !lifted] as const),
    ] as const;
    for (const [id, visible] of layers) {
      const layout = visible ? 'visible' : 'none';
      if (map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== layout) map.setLayoutProperty(id, 'visibility', layout);
    }
  }

  private towerAmounts(): [string, number | null][] {
    const explore = this.explore();
    if (this.view() === 'network') return explore?.networkRows().map(row => [row.station, row.entries]) ?? [];
    if (this.view() === 'station') {
      const station = explore?.stationAnswer();
      if (!explore || !station) return [];
      const changes = !!station.compare && explore.mapMetric() === 'change';
      const relations = new Map(explore.relations().map(row => [row.station, changes ? change(row.daily, row.compareDaily) : row.daily]));
      return this.visibleStationCircles()
        .filter(circle => circle.station !== station.station)
        .map(circle => [circle.station, relations.get(circle.station) ?? null]);
    }
    const selected = this.selected();
    if (!selected || !this.pairTowerTotals.hasValue()) return [];
    const baseline = this.mode() === 'time' && this.timePhase() === 'baseline';
    return this.pairTowerTotals.value().stations
      .filter(row => row.station === selected.origin || row.station === selected.destination)
      .map(row => [row.station, baseline ? row.compareEntries ?? null : row.entries]);
  }

  private drawTowers() {
    const map = this.map;
    if (!map || !this.layersReady) return;
    const entranceStation = this.entrancePins.size ? this.selectedMapStation() : null;
    const amounts = this.tower3d() ? this.towerAmounts() : [];
    let peak = Math.max(0, ...amounts.map(([, n]) => Math.abs(n ?? 0)));
    if (this.view() === 'pairs' && this.mode() === 'time' && this.pairTowerTotals.hasValue()) {
      const names = new Set(amounts.map(([name]) => name));
      for (const row of this.pairTowerTotals.value().stations) {
        if (names.has(row.station)) peak = Math.max(peak, row.entries ?? 0, row.compareEntries ?? 0);
      }
    }
    const hourly = this.view() !== 'pairs' && this.explore()?.activeHour() != null;
    // 逐時播放用固定滿刻度，各小時的尖刺才能互相比較。
    const full = hourly ? (this.view() === 'network' ? 40000 : 4000) : 4 * (this.r3d?.columnTick(peak) ?? 1);
    this.towerPeak.set(peak > 0 ? Math.round(peak) : null);
    const spikePx = (value: number) => Math.max(3, Math.min(1.4, Math.sqrt(value / full)) * (this.r3d?.SPIKE_MAX_PX ?? 100));
    const ticks: { label: string; px: number; value: number }[] = [];
    for (const value of [500000, 200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000, 500]) {
      const px = spikePx(value);
      if (!peak || value > peak || px > 100 || px < 10 || ticks.length >= 3) continue;
      if (ticks.length && value > ticks[ticks.length - 1].value / 2.4) continue;
      ticks.push({ label: value >= 10000 ? `${value / 10000} 萬` : value >= 1000 ? `${value / 1000} 千` : String(value), px: Math.round(px), value });
    }
    this.towerScale.set(this.tower3d() ? ticks.map(({ label, px }) => ({ label, px })) : []);
    const dark = this.lighting() >= .5, ink = FLOW[dark ? 'dark' : 'light'], down = dark ? '#ff7a85' : '#b4232f';
    this.elevatedFlow?.setSpikes(amounts.flatMap(([name, amount]) => {
      const at = this.stops.get(name);
      return at && amount && name !== entranceStation
        ? [{ at, height: Math.max(3, Math.min(1.4, Math.sqrt(Math.abs(amount) / full)) * (this.r3d?.SPIKE_MAX_PX ?? 100)), color: amount < 0 ? down : ink }] : [];
    }));
  }

  private drawElevatedStreams() {
    this.elevatedFlow?.update(this.tower3d() ? this.displayedStreams : [], this.lighting() >= .5);
  }

  toggleMapOption(option: 'places' | 'legend' | 'metro' | 'scale' | 'roads' | 'nature') {
    const setting = { places: this.showPlaces, legend: this.showLegend, metro: this.showMetro, scale: this.showScale, roads: this.showRoads, nature: this.showNature }[option];
    setting.update(enabled => !enabled);
    this.applyMapOptions();
  }

  resetMap() {
    this.map?.easeTo({ center: [121.53, 25.05], zoom: 10.6, bearing: 0,
      duration: this.reducedMotion ? 0 : 400 });
  }

  async searchPlaces() {
    const q = this.placeQuery().trim();
    if (q.length < 2 || this.placeBusy()) return;
    this.placeBusy.set(true); this.placeMessage.set(''); this.places.set([]);
    this.clearPlace();
    try {
      const places = await firstValueFrom(this.http.get<Place[]>('/api/v1/map/places', { params: { q } }));
      this.places.set(places);
      if (!places.length) this.placeMessage.set('找不到地點，試試完整名稱或加上區名。');
      else this.showPlaceCandidates(places);
    } catch (error) {
      if (error instanceof HttpErrorResponse) {
        if (error.status === 429) this.placeMessage.set('搜尋太快，請稍候幾秒再試。');
        else if (typeof error.error?.error === 'string' && error.error.error) this.placeMessage.set(error.error.error);
        else this.placeMessage.set('地點暫時查不到，建議改直接輸入捷運站名。');
      } else {
        this.placeMessage.set('地點暫時查不到，建議改直接輸入捷運站名。');
      }
    } finally {
      this.placeBusy.set(false);
      const latest = this.placeQuery().trim();
      if (latest.length >= 2 && latest !== q) void this.searchPlaces();
    }
  }

  private showPlaceCandidates(places: Place[]) {
    const map = this.map, source = map?.getSource('place-result') as GeoJSONSource | undefined;
    if (!map || !source || !places.length) return;
    source.setData({
      type: 'FeatureCollection',
      features: places.map(p => ({
        type: 'Feature',
        properties: { color: '#7251ab', title: p.name },
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      })),
    });
    if (places.length === 1) {
      this.locatePlace(places[0]);
      return;
    }
    const bounds = new this.ml!.LngLatBounds([places[0].lng, places[0].lat], [places[0].lng, places[0].lat]);
    for (const p of places.slice(1)) bounds.extend([p.lng, p.lat]);
    map.fitBounds(bounds, { padding: this.padding(), maxZoom: 15, bearing: map.getBearing(), duration: this.reducedMotion ? 0 : 600 });
  }

  locateMe() {
    if (this.geoBusy()) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      this.placeMenu().nativeElement.open = true;
      this.placeMessage.set('目前瀏覽器不支援定位，請改用上方搜尋。');
      return;
    }
    this.geoBusy.set(true);
    this.placeMenu().nativeElement.open = true;
    this.placeMessage.set('正在取得目前位置…');
    navigator.geolocation.getCurrentPosition(
      pos => {
        this.geoBusy.set(false);
        this.placeMessage.set('');
        this.locatePlace({
          name: '我的目前位置',
          area: `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`,
          category: '即時定位',
          lng: pos.coords.longitude,
          lat: pos.coords.latitude,
        });
      },
      () => {
        this.geoBusy.set(false);
        this.placeMessage.set('無法取得定位，請確認權限或直接點地圖任一處。');
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  }

  locatePlace(place: Place) {
    const map = this.map, ml = this.ml, source = map?.getSource('place-result') as GeoJSONSource | undefined;
    if (!map || !ml || !source) { this.placeMessage.set('地圖還在載入，請稍後再試。'); return; }
    const from = new ml.LngLat(place.lng, place.lat);
    const avail = this.availability();
    const candidates: { station: string; point: Point; distance: number }[] = [];
    for (const [name, point] of this.stops) {
      const lines = this.linesOfStation(name);
      if (!lines.length || name === '大橋頭站') continue;
      if (avail && !(avail[name]?.months?.length)) continue;
      candidates.push({ station: name, point, distance: from.distanceTo(new ml.LngLat(...point)) });
    }
    if (!candidates.length) {
      for (const [name, point] of this.stops) {
        const lines = this.linesOfStation(name);
        if (!lines.length || name === '大橋頭站') continue;
        candidates.push({ station: name, point, distance: from.distanceTo(new ml.LngLat(...point)) });
      }
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const top = candidates[0];
    if (!top) return;
    const origin: Point = [place.lng, place.lat], lineColor = this.lineOf(top.station)!.color;
    const nearby = candidates.slice(0, 3).map(c => ({ station: c.station, distance: Math.round(c.distance) }));
    this.nearestPlace.set({ place, station: top.station, distance: Math.round(top.distance), nearby });
    source.setData({ type: 'FeatureCollection', features: [
      { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [origin, top.point] } },
      { type: 'Feature', properties: { color: '#7251ab' }, geometry: { type: 'Point', coordinates: origin } },
      { type: 'Feature', properties: { color: lineColor }, geometry: { type: 'Point', coordinates: top.point } },
    ] });
    const bounds = new ml.LngLatBounds(origin, origin).extend(top.point);
    map.fitBounds(bounds, { padding: this.padding(), maxZoom: 15, bearing: map.getBearing(), duration: this.reducedMotion ? 0 : 650 });
  }

  usePlaceAs(role: 'origin' | 'destination', station: string) {
    if (this.view() !== 'pairs') this.setView('pairs');
    this.panelOpen.set(true);
    this.conditionsOpen.set(true);
    if (role === 'origin') {
      this.manualOrigin.set(station);
      if (this.manualDestination() === station) this.manualDestination.set('');
    } else {
      this.manualDestination.set(station);
      if (this.manualOrigin() === station) this.manualOrigin.set('');
    }
    if (this.manualOrigin() && this.manualDestination() && this.manualOrigin() !== this.manualDestination()) {
      void this.findPair();
    }
  }

  clearPlace() {
    this.nearestPlace.set(null);
    (this.map?.getSource('place-result') as GeoJSONSource | undefined)?.setData(EMPTY);
  }

  focusStationPoi(name: string, category: string, lng?: number, lat?: number) {
    if (lng != null && lat != null) {
      this.locatePlace({
        name,
        area: this.selectedMapStation() ?? '',
        category,
        lng,
        lat,
      });
      return;
    }
    this.openPlaceSearch(name);
  }

  openPlaceSearch(query: string) {
    this.showMobileMap();
    this.clearPlace();
    this.placeQuery.set(query);
    this.places.set([]);
    this.placeMessage.set('');
    this.placeMenu().nativeElement.open = true;
    afterNextRender(() => this.placeInput().nativeElement.focus(), { injector: this.injector });
    if (query.length >= 2) void this.searchPlaces();
  }

  /** 載入所看期間的站區介紹與出口，不只是最新月份。 */
  private loadStationInfo(name: string | null, reveal = true) {
    const request = ++this.stationInfoRequest;
    this.stationInfo.set(null);
    this.stationInfoStatus.set(name ? 'loading' : 'idle');
    if (!name) return;
    const period = this.stationPeriod();
    void firstValueFrom(this.http.get<StationInfo | null>('/api/v1/od/station-info', { params: period ? { name, period } : { name } })).then(info => {
      if (request !== this.stationInfoRequest) return;
      this.stationInfo.set(info); this.stationInfoStatus.set('idle');
      // 看單站就是為了看出口，所以直接顯示並把地圖對準該站
      if (reveal && !this.lowAngle() && info?.entrances?.length) this.toggleEntrances(true);
    }).catch(() => {
      if (request === this.stationInfoRequest) this.stationInfoStatus.set('failed');
    });
  }

  private pickStationOnMap(name: string) {
    const explorer = this.explore();
    if (this.selectedMapStation() === name) {
      this.closeStationPreview();
      return;
    }
    const linked = explorer?.selectRankFromMap(name) ?? false;
    this.selectMapStation(name, linked);
  }

  closeStationPreview() {
    const explorer = this.explore();
    if (explorer?.selectedRank() === this.selectedMapStation()) explorer?.focusRelation(null);
    this.selectMapStation(null);
  }

  selectMapStation(name: string | null, keepCamera = false) {
    this.selectedMapStation.set(name);
    this.showEntrances.set(false);
    this.compareEntrances.set(false);
    this.selectedEntrance.set(null);
    // 車站資訊卡會占掉地圖空間，等它畫好後重新取景，讓站對不被遮住
    if (name && this.selected()) { this.detailOpen.set(false); setTimeout(() => this.redraw(!keepCamera && !this.lowAngle())); }
    this.loadStationInfo(name, !keepCamera && !this.lowAngle());
    const source = this.map?.getSource('picked-station') as GeoJSONSource | undefined;
    const coordinates = name && this.stops.get(name);
    source?.setData(coordinates && name ? { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { color: this.lineOf(name)!.color }, geometry: { type: 'Point', coordinates } },
    ] } : EMPTY);
  }

  locateEntrance(exit: Entrance) {
    this.clearPlace();
    this.selectedEntrance.set(exit);
    const map = this.map;
    if (!map) return;
    map.easeTo({ center: [exit.lng, exit.lat], zoom: Math.max(map.getZoom(), 15), padding: this.padding(),
      duration: this.reducedMotion ? 0 : 500 });
  }

  toggleEntrances(show: boolean) {
    if (show === this.showEntrances()) return;
    this.showEntrances.set(show);
    if (!show) { this.selectedEntrance.set(null); return; }
    const map = this.map, point = this.stops.get(this.selectedMapStation() ?? '');
    if (!map || !this.ml || !point || !this.entrancesAtPeriod().length) return;
    // 把車站與所有出口框在沒有被卡片遮住的地圖範圍內
    const bounds = new this.ml.LngLatBounds(point, point);
    for (const exit of this.entrancesAtPeriod()) bounds.extend([exit.lng, exit.lat]);
    map.fitBounds(bounds, { padding: this.padding(), maxZoom: 17.4, bearing: map.getBearing(), duration: this.reducedMotion ? 0 : 700 });
  }

  readonly hasEntranceHistory = computed(() => this.entrancesAtPeriod().some(e => !!e.history));
  readonly accessibleExitCount = computed(() => this.entrancesAtPeriod().filter(e => e.accessible).length);

  shortExitName(station: string, name: string): string {
    const stripped = name.replace(new RegExp(`^${station}站?`), '').trim();
    if (!stripped) return name;
    if (/^[A-Za-z0-9]+$/.test(stripped)) return `出口 ${stripped}`;
    return stripped.replace(/^出口\s*/, '出口 ');
  }

  facilityLines(value: string): string[] {
    return value.split(/\n|(?=\d+\.)/).map(s => s.trim()).filter(Boolean);
  }

  readonly stationCleanNote = computed(() => {
    const raw = this.stationInfo()?.story?.summary?.trim();
    if (!raw) return '';
    return raw
      .replace(/[^。]*屬於[^。]*通車。/g, '')
      .replace(/\d+\s*年\s*\d+\s*月平均每天約[^。]*排第\s*\d+。/g, '')
      .replace(/現況資料顯示共有[^。]*。/g, '')
      .replace(/站外(?:當時已確認啟用|共有)的?[^。]*捷運出入口[^。]*。/g, '')
      .trim();
  });

  readonly stationSnapshot = computed(() => {
    const station = this.selectedMapStation(), info = this.stationInfo();
    if (!station || !info) return null;
    const stats = info.latestStats;
    const explorer = this.explore();
    if (this.view() === 'station' && explorer && explorer.station() === station) {
      const ans = explorer.stationAnswer();
      if (ans && ans.entries != null) {
        const periodLabel = (explorer.unit() === 'date' ? explorer.periodDate() : explorer.periodBaseText()) + ' · ' + explorer.hoursText();
        const diffPct = ans.compare && ans.compareEntries ? Math.round((ans.entries / ans.compareEntries - 1) * 1000) / 10 : stats?.yoyPct ?? null;
        const diffLabel = ans.compare && ans.compareEntries ? '較對照期' : '較去年同月';
        const exitUncovered = ans.exitCovered === false || (ans.exitCovered === undefined && ans.entries > 0 && (ans.exits ?? 0) === 0 && (ans.inboundTotal ?? 0) === 0);
        return {
          periodLabel,
          entries: Math.round(ans.entries),
          exits: exitUncovered || ans.exits == null ? null : Math.round(ans.exits),
          rank: stats?.rank ?? null,
          totalStations: stats?.totalStations ?? null,
          diffPct,
          diffLabel,
        };
      }
    }
    if (this.view() === 'network' && explorer) {
      const row = explorer.networkRows().find(r => r.station === station);
      if (row && row.entries != null) {
        const ranked = [...explorer.networkRows()].filter(r => r.entries != null).sort((a, b) => (b.entries ?? 0) - (a.entries ?? 0));
        const rank = ranked.findIndex(r => r.station === station) + 1;
        const periodLabel = (explorer.unit() === 'date' ? explorer.periodDate() : explorer.periodBaseText()) + ' · ' + explorer.hoursText();
        const diffPct = row.compareEntries ? Math.round((row.entries / row.compareEntries - 1) * 1000) / 10 : stats?.yoyPct ?? null;
        return {
          periodLabel,
          entries: Math.round(row.entries),
          exits: row.exitCovered === false || row.exits == null ? null : Math.round(row.exits),
          rank: rank > 0 ? rank : stats?.rank ?? null,
          totalStations: ranked.length || stats?.totalStations || null,
          diffPct,
          diffLabel: row.compareEntries ? '較對照期' : '較去年同月',
        };
      }
    }
    if (!stats) return null;
    return {
      periodLabel: stats.isDate && stats.period ? `${stats.period} 單日` : `${stats.month} 日均`,
      entries: stats.dailyEntries,
      exits: stats.dailyExits,
      rank: stats.rank,
      totalStations: stats.totalStations,
      diffPct: stats.yoyPct ?? null,
      diffLabel: '較去年同月',
    };
  });

  entranceEvents(exit: Entrance) {
    const history = exit.history;
    if (!history) return [];
    return [
      ...(history.opened ? [{ date: history.opened, label: '啟用', source: history.source }] : []),
      ...(history.closed ? [{ date: history.closed, label: '暫停開放', source: history.closureSource ?? history.source }] : []),
      ...(history.reopened ? [{ date: history.reopened, label: '重新開放', source: history.source }] : []),
    ];
  }

  /** 出口圖釘放在車站旁，不壓在站圈或站名上：在螢幕座標中逐個往外推到不重疊為止。 */
  private spreadEntrances() {
    const map = this.map, name = this.selectedMapStation(), center = name ? this.stops.get(name) : undefined;
    if (!map || !center) return;
    const c = map.project(center);
    const clear = [[c.x - 26, c.y - 26, c.x + 26, c.y + 26], [c.x - 70, c.y + 6, c.x + 70, c.y + 44]];
    const hits = (x: number, y: number) => clear.some(([l, top, r, b]) => x + 15 > l && x - 15 < r && y > top && y - 32 < b);
    for (const [exit, pin] of this.entrancePins) {
      const p = map.project([exit.lng, exit.lat]);
      let dx = p.x - c.x, dy = p.y - c.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) { dx = 0; dy = -1; } else { dx /= len; dy /= len; }
      let push = 0;
      while (push < 90 && hits(p.x + dx * push, p.y + dy * push)) push += 6;
      pin.setOffset([dx * push, dy * push]);
    }
  }

  private drawEntrances(exits: Entrance[]) {
    if (!this.map) return;
    for (const [exit, pin] of this.entrancePins) {
      if (!exits.includes(exit)) { pin.remove(); this.entrancePins.delete(exit); }
    }
    for (const exit of exits) {
      if (this.entrancePins.has(exit)) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'entrance-pin';
      button.classList.toggle('documented', !!exit.history);
      button.setAttribute('aria-label', exit.name);
      button.setAttribute('aria-pressed', 'false');
      button.append(document.createTextNode(exit.label || exit.code || '出口'));
      button.addEventListener('click', event => { event.stopPropagation(); this.selectedEntrance.set(exit); });
      this.entrancePins.set(exit, new this.ml!.Marker({ element: button, anchor: 'bottom' })
        .setLngLat([exit.lng, exit.lat]).addTo(this.map));
    }
    this.spreadEntrances();
  }

  private applyMapOptions() {
    const map = this.map;
    if (!map || !this.layersReady) return;
    if (map.getLayer('extra-places')) map.setLayoutProperty('extra-places', 'visibility', this.showPlaces() ? 'visible' : 'none');
    if (this.showScale() && !this.scaleControl && this.ml) {
      const ctrl = new this.ml.ScaleControl({ maxWidth: 120, unit: 'metric' });
      this.scaleControl = ctrl;
      map.addControl(ctrl, 'bottom-right');
    } else if (!this.showScale() && this.scaleControl) {
      map.removeControl(this.scaleControl);
      this.scaleControl = undefined;
    }
    for (const layer of ['metro-network-casing', 'metro-network', 'metro-network-core', 'metro-stops', 'metro-hit']) {
      map.setLayoutProperty(layer, 'visibility', this.showMetro() ? 'visible' : 'none');
    }
    const style = map.getStyle();
    if (style?.layers) {
      for (const layer of style.layers) {
        if (layer.id === 'buildings-3d' || layer.id === 'extra-places') continue;
        const src = 'source-layer' in layer ? String(layer['source-layer'] ?? '') : '';
        if (src === 'transportation' || src === 'transportation_name' || src === 'building') {
          map.setLayoutProperty(layer.id, 'visibility', this.showRoads() ? 'visible' : 'none');
        } else if (src === 'water' || src === 'waterway' || src === 'park' || src === 'landcover' || src === 'landuse') {
          map.setLayoutProperty(layer.id, 'visibility', this.showNature() ? 'visible' : 'none');
        }
      }
    }
  }

  private lighting() {
    const explore = this.view() !== 'pairs' ? this.explore() : undefined;
    const shade = explore ? daylightAt(explore.activeHour(), explore.date())?.shade ?? 0 : 0;
    return this.theme() === 'dark' ? .84 + shade * .16 : shade * .86;
  }

  /** 在加入 ExitPulse 自己的資料圖層前，先記下 Positron 白天的配色。 */
  private readBasemapPaint(map: MapLibreMap) {
    const paint: MapPaint[] = [];
    for (const layer of map.getStyle().layers) {
      const src = 'source-layer' in layer ? layer['source-layer'] : '';
      const add = (property: MapColorProperty, night: string, day = map.getPaintProperty(layer.id, property)) => {
        paint.push({ layer: layer.id, property, day, night });
      };
      if (layer.type === 'background') add('background-color', DARK_MAP.land, LIGHT_MAP.land);
      else if (layer.type === 'fill' && src === 'water') add('fill-color', DARK_MAP.water, LIGHT_MAP.water);
      else if (layer.type === 'fill' && (src === 'park' || /wood|grass|park/.test(layer.id))) add('fill-color', DARK_MAP.park, LIGHT_MAP.park);
      else if (layer.type === 'fill' && src === 'building') {
        add('fill-color', DARK_MAP.building, LIGHT_MAP.building);
        add('fill-outline-color', DARK_MAP.outline);
      }
      else if (layer.type === 'fill' && src === 'landuse') add('fill-color', DARK_MAP.building);
      else if (layer.type === 'fill' && (src === 'aeroway' || src === 'transportation')) add('fill-color', DARK_MAP.road);
      else if (layer.type === 'line' && (src === 'aeroway' || src === 'transportation')) add('line-color', DARK_MAP.road);
      else if (layer.type === 'symbol' && map.getLayoutProperty(layer.id, 'text-field') != null) {
        add('text-color', DARK_MAP.label, LIGHT_MAP.label);
        add('text-halo-color', DARK_MAP.halo, LIGHT_MAP.halo);
      }
    }
    return paint;
  }

  /** 聚焦罩的顏色跟著底圖陸地色，透明度依目前是否有選取的人流決定。 */
  private syncScrim() {
    const map = this.map;
    if (!map || !this.layersReady || !map.getLayer('focus-scrim')) return;
    const land = map.getStyle().layers.find(layer => layer.type === 'background' && layer.id !== 'focus-scrim');
    const color = land ? map.getPaintProperty(land.id, 'background-color') : undefined;
    if (color) map.setPaintProperty('focus-scrim', 'background-color', color);
    const focus = this.view() === 'pairs' ? !!this.selected() : this.view() === 'station';
    map.setPaintProperty('focus-scrim', 'background-opacity', focus ? .58 : 0);
  }

  private applyMapLighting(shade: number, playing: boolean, themeChanged = false) {
    const map = this.map;
    if (!map || !this.layersReady || shade === this.mapLighting) return;
    this.mapLighting = shade;
    const dark = shade >= .5, duration = this.reducedMotion ? 0 : themeChanged ? 320 : playing ? 260 : 0;
    for (const paint of this.basemapPaint) {
      const text = paint.property.startsWith('text-');
      map.setPaintProperty(paint.layer, `${paint.property}-transition`, { duration: text ? 0 : duration });
      map.setPaintProperty(paint.layer, paint.property, shadedPaint(paint, text ? Number(dark) : shade));
    }
    const halo = dark ? DARK_MAP.halo : LIGHT_MAP.halo, ink = dark ? '#eef1f2' : '#1d2125';
    for (const layer of ['explore-labels', 'od-labels', 'od-count-labels', 'od-flow-labels']) {
      map.setPaintProperty(layer, 'text-color-transition', { duration: 0 });
      map.setPaintProperty(layer, 'text-halo-color-transition', { duration: 0 });
      map.setPaintProperty(layer, 'text-color', ink);
      map.setPaintProperty(layer, 'text-halo-color', halo);
    }
    map.setPaintProperty('od-ranks', 'text-color', dark ? NIGHT_STATION.rankInk : ink);
    map.setPaintProperty('metro-stops', 'circle-color', dark ? NIGHT_STATION.regular : halo);
    this.syncMetroNetworkPaint(shade);
    map.setPaintProperty('metro-stops', 'circle-stroke-color', dark ? NIGHT_STATION.rim : '#8d969c');
    map.setPaintProperty('od-stops', 'circle-color', dark ? NIGHT_STATION.ranked : halo);
    map.setPaintProperty('explore-circles', 'circle-color', dotColor(dark));
    map.setPaintProperty('explore-circles', 'circle-stroke-color', dotColor(dark));
    map.setPaintProperty('explore-inner', 'circle-color', dotColor(dark));
    if (map.getLayer('buildings-3d')) map.setPaintProperty('buildings-3d', 'fill-extrusion-color', dark ? DARK_MAP.building : LIGHT_MAP.building);
    map.setPaintProperty('focus-scrim', 'background-color-transition', { duration });
    this.syncScrim();
  }

  readonly conditionsChanged = computed(() => {
    const d = this.data();
    return !!d && (d.baseline !== this.baseline() || d.current !== this.current() || d.hours.join('-') !== this.hours()
      || this.datasetDayType(d) !== this.dayType() || (d.minimum ?? 20) !== this.minimum() || (d.type ?? 'all') !== this.changeType());
  });

  filtersChanged() { this.queryError.set(''); if (this.selected()) this.closeDetail(); }

  setSort(key: SortKey) { this.sortKey.set(key); this.shown.set(PAGE); this.redraw(false); }
  setQuery(text: string) { this.query.set(text); this.shown.set(PAGE); this.redraw(false); }
  setLine(code: string) { this.lineFilter.set(this.lineFilter() === code ? '' : code); this.shown.set(PAGE); this.redraw(false); }

  async find() {
    if (this.loading()) return;
    if (this.baseline() === this.current()) { this.queryError.set('基準與比較請選不同月份。'); return; }
    this.queryError.set(''); this.suggestedBand.set(''); this.closeDetail();
    this.query.set(''); this.lineFilter.set(''); this.shown.set(PAGE);
    if (!this.apiAvailable()) { this.showResults.set(true); this.conditionsOpen.set(false); this.mobilePage.set('list'); this.redraw(true); return; }
    this.loading.set(true);
    const [start, end] = this.hours().split('-');
    try {
      const params = { baseline: this.baseline(), current: this.current(), start, end, ...this.dayTypeParams(this.dayType()), minimum: this.minimum(), type: this.changeType() };
      this.data.set(await this.getRadar(params));
      this.showResults.set(true);
      if (this.view() === 'pairs') {
        this.conditionsOpen.set(false);
        this.mobilePage.set('list');
        this.redraw(true);
      }
    } catch (error) {
      const e = error instanceof HttpErrorResponse ? error : null;
      const sug: number[] | null = e?.status === 422 && e.error?.code === 'hours_mismatch' ? e.error.suggested : null;
      if (sug && `${sug[0]}-${sug[1]}` in BANDS) this.suggestedBand.set(`${sug[0]}-${sug[1]}`);
      this.queryError.set(e?.status === 422 && e.error?.error ? e.error.error + (sug && !this.suggestedBand() ? `可比較的時段是 ${sug[0]}–${sug[1]} 時。` : '')
        : e && [0, 502, 503, 504].includes(e.status) ? '資料服務暫時沒有回應，請稍後再試。' : '比較失敗，請再試一次。');
    } finally { this.loading.set(false); }
  }

  /** 首屏的一鍵範例：套用條件、跑比較，有指定站對時直接打開該站對。 */
  async applyPreset(p: FirstQueryPreset) {
    this.baseline.set(p.baseline); this.current.set(p.current); this.hours.set(`${p.start}-${p.end}`);
    this.dayType.set(p.weekend ? 'weekend' : 'weekday'); this.changeType.set(p.type);
    await this.find();
    if (p.origin && p.destination) await this.findPair(p.origin, p.destination);
  }

  bandLabel(key: string) { return BANDS[key] ?? key; }
  useSuggestedBand() { const b = this.suggestedBand(); if (b) { this.hours.set(b); void this.find(); } }

  /** API 可能正在重啟或暫時限流，先自動重試一次，讓使用者不必看到錯誤。 */
  private async getRadar(params: Record<string, string | number | boolean>): Promise<Dataset> {
    try { return await firstValueFrom(this.http.get<Dataset>('/api/v1/od/radar', { params })); }
    catch (error) {
      if (!(error instanceof HttpErrorResponse) || ![0, 429, 502, 503, 504].includes(error.status)) throw error;
      const isRate = error.status === 429;
      this.queryError.set(isRate ? '查詢太頻繁，2 秒後自動重試…' : '資料服務重啟中，3 秒後自動重試…');
      await new Promise(r => setTimeout(r, isRate ? 2000 : 3000));
      this.queryError.set('');
      return firstValueFrom(this.http.get<Dataset>('/api/v1/od/radar', { params }));
    }
  }

  async findPair(origin = this.manualOrigin(), destination = this.manualDestination(), moveFocus = true) {
    if (!this.apiAvailable() || this.manualLoading() || !origin || !destination || origin === destination) return;
    this.manualError.set('');
    this.manualLoading.set(true);
    try {
      if (!this.showResults() || this.conditionsChanged()) await this.find();
      const d = this.data();
      if (!d || !this.showResults()) {
        this.manualError.set('請先確認上方月份與條件可正常查詢。');
        return;
      }
      const params = { baseline: d.baseline, current: d.current, start: d.hours[0], end: d.hours[1], ...this.dayTypeParams(this.datasetDayType(d)),
        minimum: this.minimum(), origin, destination };
      const direct = await this.getRadar(params);
      if (this.data() !== d || this.view() !== 'pairs') return;
      if (direct.results[0]) this.choose(direct.results[0], moveFocus);
      else this.manualError.set('這兩站在所選時段無法比較。');
    } catch (error) {
      this.manualError.set(error instanceof HttpErrorResponse && error.status === 422
        ? '這兩站在所選月份無法比較。' : '兩站查詢失敗，請再試一次。');
    } finally {
      this.manualLoading.set(false);
    }
  }

  choose(result: Result, moveFocus = true) {
    if (document.activeElement instanceof HTMLElement && !this.selected()) this.returnFocus = document.activeElement;
    this.particleElapsed = 0;
    this.selected.set(result); this.detailOpen.set(moveFocus || !readFold('panel.detail'));
    this.mobilePage.set('detail');
    if (moveFocus) {
      afterNextRender(() => this.detailView()?.focusPanel(), { injector: this.injector });
    }
    this.redraw(true);
    void this.loadProfile(result);
  }

  private async loadProfile(result: Result) {
    const request = ++this.profileRequest, d = this.data()!;
    this.profile.set(null);
    this.profileError.set(false);
    if (!this.apiAvailable()) return;
    try {
      const params = { baseline: d.baseline, current: d.current, origin: result.origin, destination: result.destination, ...this.dayTypeParams(this.datasetDayType(d)) };
      const profile = await firstValueFrom(this.http.get<PairProfile>('/api/v1/od/pair', { params }));
      if (request === this.profileRequest) this.profile.set(profile);
    } catch {
      if (request === this.profileRequest) this.profileError.set(true);
    }
  }

  retryProfile() {
    const item = this.selected();
    if (item) void this.loadProfile(item);
  }

  togglePanelWide() {
    this.panelOpen.set(true);
    this.panelWide.update(v => !v);
    // 左右兩個放大檢視互斥，避免兩張大面板疊在地圖上
    if (this.panelWide()) this.detailWide.set(false);
  }

  toggleFavPair() {
    const s = this.selected();
    if (!s) return;
    const key = `${s.origin}>${s.destination}`;
    if (this.isFavPair()) this.commitCollection(this.collection().filter(i => !(i.kind === 'pair' && new URLSearchParams(i.query).get('p') === key)), '已取消收藏');
    else this.addToCollection();
  }

  /** 目前畫面的收藏內容：站對頁存整組比較條件，探索頁存它同步在網址上的條件。 */
  private currentEntry(): { kind: CollectionKind; name: string; query: string } {
    const view = this.view();
    if (view !== 'pairs') return { kind: view, name: this.explore()?.saveName() ?? '', query: location.search };
    const s = this.selected();
    return { kind: 'pair', name: s ? `${s.origin} → ${s.destination}` : `站對比較 ${this.baseline()} → ${this.current()}`, query: writeState(this.viewState()) };
  }

  addToCollection() {
    const entry = this.currentEntry();
    const item = newItem(entry.kind, this.collectionName().trim() || entry.name, entry.query);
    if (!item) { this.collectionNotice.set('這個畫面還沒有可收藏的條件'); return; }
    const merged = mergeItems(this.collection(), [item]);
    if (!merged.added) { this.collectionNotice.set('這組已經收藏過了'); return; }
    if (merged.dropped) { this.collectionNotice.set(`收藏最多 ${COLLECTION_LIMIT} 筆，先刪掉幾筆再加`); return; }
    this.collectionName.set('');
    this.commitCollection(merged.items, '已加入收藏');
    void navigator.storage?.persist?.().catch(() => {});
  }

  removeFromCollection(id: string) { this.commitCollection(this.collection().filter(i => i.id !== id), ''); }

  startRename(id: string) {
    this.renaming.set(this.renaming() === id ? null : id);
    setTimeout(() => document.querySelector<HTMLInputElement>('.collection-rename')?.select());
  }

  renameCollectionItem(id: string, name: string) {
    const items = this.collection().map(i => i.id === id ? cleanItem({ ...i, name }) ?? i : i);
    this.commitCollection(items, '');
  }

  openCollectionItem(item: CollectionItem) {
    if (item.query === location.search) return;
    location.assign(location.pathname + item.query);
  }

  exportCollection() {
    const url = URL.createObjectURL(new Blob([serializeExport(this.collection())], { type: 'application/json;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `exitpulse-收藏-${today()}.json`; a.click();
    URL.revokeObjectURL(url);
    this.collectionNotice.set('已下載收藏檔');
  }

  async importCollectionFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    let text: string;
    // 收藏檔只有幾 KB，太大的檔案不讀，免得卡住分頁
    try { if (file.size > 512_000) throw new Error('too big'); text = await file.text(); }
    catch { this.collectionNotice.set('檔案打不開，換一個試試'); return; }
    try { this.importItems(parseExport(text)); }
    catch (e) { this.collectionNotice.set((e as Error).message); }
  }

  importItems(items: CollectionItem[]) {
    this.pendingImport.set([]);
    const merged = mergeItems(this.collection(), items);
    if (!merged.added) { this.collectionNotice.set('裡面的項目都已經有了'); return; }
    if (merged.dropped) { this.collectionNotice.set(`收藏最多 ${COLLECTION_LIMIT} 筆，這次會多出 ${merged.dropped} 筆，先刪掉一些再匯入`); return; }
    this.commitCollection(merged.items, `多收了 ${merged.added} 筆`);
  }

  async copyCollectionLinks() {
    const base = location.origin + location.pathname;
    const items = this.collection();
    const text = [...items.map(i => `${i.name}：${base}${i.query}`), `一次全部匯入：${base}${encodeLink(items)}`].join('\n');
    try { await navigator.clipboard.writeText(text); this.collectionNotice.set('已複製到剪貼簿'); }
    catch { this.collectionNotice.set('複製不了，請改用存成檔案'); }
  }

  private commitCollection(items: CollectionItem[], message: string) {
    this.collection.set(items);
    this.collectionNotice.set(saveCollection(this.store, items) ? message : '這個瀏覽器不讓網頁存資料（可能是無痕模式），關掉分頁就會消失，請先存成檔案');
  }

  async useSuggestedPairMonths() {
    const s = this.manualSuggestedMonths();
    if (!s) return;
    this.baseline.set(s.baseline);
    this.current.set(s.current);
    await this.find();
    await this.findPair();
  }

  setMode(mode: Mode) {
    if (mode === this.mode()) return;
    this.particleElapsed = 0;
    this.mode.set(mode);
    this.redraw(false);
  }

  showMonth(index: number) {
    this.particleElapsed = index * TRAVERSE_MS;
    this.paused.set(true);
    store('exitpulse.paused', '1');
    this.redraw(false);
  }

  setTheme(theme: 'light' | 'dark') {
    if (theme === this.theme()) return;
    this.theme.set(theme); store('exitpulse.theme', theme);
    this.applyMapLighting(this.lighting(), false, true);
    this.redraw(false);
  }

  closeDetail() {
    this.detailWide.set(false);
    this.selected.set(null); this.profile.set(null); this.profileRequest++;
    this.mobilePage.set('list');
    const target = this.returnFocus;
    this.returnFocus = undefined;
    if (target?.isConnected) afterNextRender(() => target.focus({ preventScroll: true }), { injector: this.injector });
    this.redraw(true);
  }

  private stop() { if (this.frame != null) cancelAnimationFrame(this.frame); this.frame = undefined; }

  /** 從 a 到 b 的弧線，彎向由行進方向決定，所以 A→B 與 B→A 會分開。 */
  private arc(a: Point, b: Point, bend: number): Point[] {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    return Array.from({ length: 49 }, (_, i) => {
      const t = i / 48, lift = bend * Math.sin(Math.PI * t);
      return [a[0] + dx * t - dy * lift, a[1] + dy * t + dx * lift] as Point;
    });
  }

  private padding() {
    const narrow = innerWidth <= 720, mid = innerWidth <= 960;
    const overview = document.querySelector(this.view() === 'pairs' ? '.mobile-overview' : 'app-time-player')?.getBoundingClientRect();
    const bottom = overview && overview.height ? innerHeight - overview.top + 12 : 160;
    const panel = document.querySelector('.panel')?.getBoundingClientRect();
    const left = this.panelOpen() || (mid && this.detailOpen() && this.selected()) ? (mid ? 370 : Math.round((panel?.right ?? 380) + 40)) : 32;
    // 浮在地圖上的卡片（站對詳情、車站資訊卡）會從取景範圍中扣掉它們的實際寬度
    const card = document.querySelector<HTMLElement>('.station-preview');
    const cardEdge = card?.offsetParent ? innerWidth - card.getBoundingClientRect().left + 56 : 0;
    const right = Math.min(Math.max(!mid && this.detailOpen() && this.selected() ? (innerWidth <= 1100 ? 370 : 460) : 48, cardEdge), Math.max(48, innerWidth - left - 240));
    const side = this.tower3d() && this.view() === 'pairs' ? 60 : 24;
    return narrow ? { top: 120, bottom: Math.min(bottom, innerHeight * .48), left: side, right: side }
      : { top: 68, bottom: this.view() === 'pairs' ? 112 : 48, left, right };
  }

  toggleConditions() {
    this.conditionsOpen.set(!this.conditionsOpen());
    if (this.phone()) { this.mobilePage.set('conditions'); this.conditionsOpen.set(true); }
  }
  showMobileList() {
    this.explore()?.stopPlayback();
    this.panelOpen.set(true);
    this.mobilePage.set('list');
    this.conditionsOpen.set(false);
    this.explore()?.revealLinkedRank();
  }
  showLinkedRanking() {
    const explorer = this.explore();
    if (!explorer) return;
    explorer.section.set('list');
    explorer.listCollapsed.set(false);
    if (explorer.listStyle() === 'lines') explorer.listStyle.set('cards');
    this.showMobileList();
  }
  onRankSelected(station: string) {
    const previous = this.selectedMapStation();
    if (previous && previous !== station) this.selectMapStation(null);
  }
  showMobileMap() {
    this.mobilePage.set('map');
    requestAnimationFrame(() => this.redraw(!this.explore()?.selectedRank()));
  }
  editMobileConditions() {
    this.explore()?.stopPlayback();
    this.panelOpen.set(true);
    this.conditionsOpen.set(true);
    this.explore()?.conditionsOpen.set(true);
    this.mobilePage.set('conditions');
  }
  startHourly() { this.explore()?.startHourly(); this.showMobileMap(); }
  editHourlyDate() { this.explore()?.setUnit('date'); this.showMobileList(); this.explore()?.editing.set('time'); }
  mobileAction(action: MobileAction) {
    switch (action) {
      case 'map': this.showMobileMap(); break;
      case 'list': this.showMobileList(); break;
      case 'conditions': this.editMobileConditions(); break;
      case 'detail': this.mobilePage.set('detail'); break;
      case 'find': void this.find(); break;
      case 'back':
        if (this.mobilePage() === 'detail') this.closeDetail();
        else if (this.showResults()) this.showMobileList();
        else this.showMobileMap();
    }
  }

  setView(view: 'pairs' | ExploreMode) {
    this.freshVisit.set(false);
    this.explore()?.stopPlayback();
    this.showMobileList();
    if (view === this.view()) return;
    this.explore()?.focusRelation(null);
    this.closeDetail(); this.view.set(view); this.exploreLayer.set(null); this.lastFocus = undefined;
    this.showMobileList();
    if (view === 'pairs') history.replaceState(null, '', this.showResults() ? writeState(this.viewState()) : location.pathname);
    this.redraw(true);
  }

  /** 從全線地圖或清單進入單站往來。 */
  openStation(name: string, options?: { hourly?: boolean; month?: string }) {
    this.setView('station');
    if (options?.hourly) this.showMobileMap();
    afterNextRender(() => {
      const explorer = this.explore();
      if (!explorer || this.view() !== 'station') return;
      explorer.pickStation(name);
      if (options?.hourly || options?.month) {
        explorer.setCompare(null);
        explorer.showWholeDay();
      }
      if (options?.hourly) {
        const month = this.availability()?.[name]?.months.at(-1) ?? this.months().at(-1);
        if (month) explorer.pickMonth(month);
        explorer.setUnit('date');
        explorer.direction.set('outbound');
      } else if (options?.month) explorer.pickMonth(options.month);
    }, { injector: this.injector });
  }

  openStationHistory(name: string, date: string) {
    this.selectMapStation(null);
    this.openStation(name, { month: date.slice(0, 7) });
  }

  /** 從矩陣的一格進入該站對的兩期比較。 */
  openPair(origin: string, destination: string, ctx?: { period?: string; days?: PairDayType; weekend?: boolean; hours?: string }) {
    this.setView('pairs');
    // 帶著矩陣當下的條件，讓站對頁回答被點的那一格，而不是站對頁殘留的預設值
    if (ctx?.period) {
      const month = ctx.period.slice(0, 7);
      this.current.set(month);
      if (this.baseline() === month) this.baseline.set(`${+month.slice(0, 4) - 1}${month.slice(4)}`);
    }
    if (ctx?.days) this.dayType.set(ctx.days);
    else if (ctx?.weekend != null) this.dayType.set(ctx.weekend ? 'weekend' : 'weekday');
    if (ctx?.hours && ctx.hours in BANDS) this.hours.set(ctx.hours);
    this.manualOrigin.set(origin); this.manualDestination.set(destination);
    queueMicrotask(() => void this.findPair(origin, destination));
  }

  onExploreLayer(layer: ExploreLayer) {
    // 每個對象只取景一次，而且要等有內容可顯示之後
    const key = this.view() === 'network' ? 'network' : layer.focus ?? 'network';
    const fly = layer.arcs.length + layer.circles.length > 0 && key !== this.lastFocus;
    if (fly) this.lastFocus = key;
    this.exploreLayer.set(layer);
    this.redraw(fly);
  }

  private syncRankLink() {
    const explorer = this.explore();
    const station = explorer?.linkedRank() ?? null;
    const flow = explorer?.rankArc();
    const from = flow && this.stops.get(flow.from), to = flow && this.stops.get(flow.to);
    const ink = FLOW[this.lighting() >= .5 ? 'dark' : 'light'];
    drawRankLink(this.map, station, station ? this.stops.get(station) : undefined, ink,
      station !== null && station === explorer?.selectedRank(), from && to ? this.arc(from, to, -.14) : undefined, flow?.dashed,
      this.exploreLayer()?.circles.find(c => c.station === station)?.radius);
  }

  fitRankedStations() {
    const focus = this.exploreLayer()?.focus;
    if (focus) this.fitExploreStations([focus, ...this.rankedStations().map(station => station.station)]);
  }

  private visibleStationCircles() {
    const layer = this.exploreLayer(), limit = this.stationArcLimit();
    if (!layer) return [];
    const counterpart = layer.focusedRelation;
    return layer.circles.filter(c => !c.rank || !limit || c.rank <= limit || c.station === counterpart);
  }

  setStationArcLimit(limit: 5 | 10 | 0) {
    this.stationArcLimit.set(limit);
    this.drawExplore(false);
    const focus = this.exploreLayer()?.focus;
    if (focus) this.fitExploreStations(this.visibleStationCircles().map(c => c.station));
  }

  private fitExploreStations(names: string[]) {
    const points = names.flatMap(name => {
      const point = this.stops.get(name);
      return point ? [point] : [];
    });
    if (!points.length || !this.map || !this.ml) return;
    const bounds = new this.ml.LngLatBounds(points[0], points[0]);
    for (const point of points) bounds.extend(point);
    this.map.fitBounds(bounds, { padding: this.padding(), maxZoom: 13.5, bearing: this.map.getBearing(), duration: this.reducedMotion ? 0 : 1100 });
  }

  private redraw(fly: boolean) {
    const map = this.map, d = this.data(), selected = this.selected();
    this.stop();
    this.syncScrim();
    if (this.view() !== 'pairs' || !selected) this.showHero(null);
    if (this.view() !== 'pairs') { this.drawFlowLabels([]); this.drawExplore(fly); return; }
    let streams: Stream[] = [], stops: [Point, string, string][] = [];
    this.mapMessage.set('');
    if (d && selected) {
      const a = this.stops.get(selected.origin), b = this.stops.get(selected.destination);
      if (!a || !b) this.mapMessage.set('這組兩站還沒有對應到地圖座標。');
      else {
        const originColor = this.lineOf(selected.origin)?.color ?? '#1d2125';
        const destColor = this.lineOf(selected.destination)?.color ?? '#5a636b';
        const muted = this.theme() === 'dark' ? '#a6a6a2' : '#60605c';
        const flow = FLOW[this.theme()], reverse = muted;
        const key = `${selected.origin}>${selected.destination}`;
        const reverseDaily = selected.reverseCurrent / d.days[1];
        streams = this.mode() === 'volume' ? [
          { key, label: d.baseline, daily: selected.baselineDaily, color: muted, dashed: true, path: this.arc(a, b, .16) },
          { key, label: d.current, daily: selected.currentDaily, color: flow, dashed: false, path: this.arc(a, b, -.16) },
        ] : this.mode() === 'direction' ? [
          { key, label: `${selected.origin} → ${selected.destination}`, daily: selected.currentDaily, color: flow, dashed: false, path: this.arc(a, b, -.16) },
          { key, label: `${selected.destination} → ${selected.origin}`, daily: reverseDaily, color: reverse, dashed: false, path: this.arc(b, a, -.16) },
        ] : [
          { key, label: d.baseline, daily: selected.baselineDaily, color: muted, dashed: false, path: this.arc(a, b, -.14) },
          { key, label: d.current, daily: selected.currentDaily, color: flow, dashed: false, path: this.arc(a, b, -.14) },
        ];
        stops = [[a, selected.origin, originColor], [b, selected.destination, destColor]];
      }
    } else if (d && (this.showResults() || this.showFirstQuery())) {
      // 首屏還沒查詢時，先用內建的預設比較把人流畫在地圖上當背景，一進來就有畫面
      const ambient = !this.showResults();
      for (const r of (ambient ? d.results : this.results()).slice(0, OVERVIEW_PAIRS)) {
        const a = this.stops.get(r.origin), b = this.stops.get(r.destination);
        const key = `${r.origin}>${r.destination}`;
        const emphasis = this.hoveredKey ? (key === this.hoveredKey ? 1 : .2) : ambient ? .5 : undefined;
        if (a && b) streams.push({ key, label: '', daily: r.currentDaily, color: FLOW[this.theme()], dashed: false, emphasis, path: this.arc(a, b, -.14) });
      }
    }
    this.streams.set(selected ? streams : []);
    if (!map || !this.layersReady) { this.pendingFly ||= fly; return; }
    const time = this.mode() === 'time' && selected != null && streams.length === 2;
    if (!time) this.drawStreams(streams);
    this.drawFlowLabels(time ? [] : streams);
    (map.getSource('od-stops') as GeoJSONSource).setData({ type: 'FeatureCollection', features: stops.map(([coordinates, name, color]) => ({ type: 'Feature', properties: { name, color }, geometry: { type: 'Point', coordinates } })) });
    (map.getSource('explore-circles') as GeoJSONSource).setData(EMPTY);
    this.drawTowers();
    if (fly && this.lowAngle()) this.focusLowAngle();
    else if (fly && streams.length && this.ml) {
      const bounds = new this.ml.LngLatBounds(streams[0].path[0], streams[0].path[0]);
      for (const s of streams) { bounds.extend(s.path[0]); bounds.extend(s.path[s.path.length - 1]); }
      map.fitBounds(bounds, { padding: this.padding(), maxZoom: 14.5, bearing: map.getBearing(), duration: this.reducedMotion ? 0 : 1100 });
    }
    // 首屏的背景人流也讓箭頭動起來，一打開就有「正在流動」的感覺
    this.animate(streams, time, selected != null || (!this.showResults() && this.showFirstQuery()));
    const hovered = !selected && this.hoveredKey ? this.results().find(r => `${r.origin}>${r.destination}` === this.hoveredKey) : undefined;
    const preview = hovered ? streams.find(stream => stream.key === this.hoveredKey) : undefined;
    this.showHero(selected && streams.length ? streams[streams.length > 1 ? 1 : 0].path[24] : preview?.path[24] ?? null, selected ?? hovered);
  }

  /** 在人流弧線頂端放一顆數字標籤，一眼看出這組兩站變了多少。 */
  private showHero(at: Point | null, result?: Result | null) {
    if (!at || !result || !this.map || !this.ml) {
      this.hero?.remove();
      this.hero = undefined;
      return;
    }
    const growth = result.baselineDaily > 0 ? (result.currentDaily / result.baselineDaily - 1) * 100 : null;
    const value = growth == null ? '新增' : `${growth >= 0 ? '+' : '−'}${Math.round(Math.abs(growth))}%`;
    const counts = `每日 ${formatDailyTrips(result.baselineDaily)} → ${formatDailyTrips(result.currentDaily)}`;
    if (!this.hero) {
      const chip = document.createElement('div');
      chip.className = 'pair-chip';
      chip.setAttribute('aria-hidden', 'true');
      chip.append(document.createElement('strong'), document.createElement('span'));
      this.hero = new this.ml.Marker({ element: chip, anchor: 'center', offset: [0, 40] }).setLngLat(at).addTo(this.map);
    } else {
      const { lng, lat } = this.hero.getLngLat();
      if (lng !== at[0] || lat !== at[1]) this.hero.setLngLat(at);
    }
    const [valueLabel, countsLabel] = this.hero.getElement().children;
    if (valueLabel.textContent !== value) valueLabel.textContent = value;
    if (countsLabel.textContent !== counts) countsLabel.textContent = counts;
  }

  private drawExplore(fly: boolean) {
    const map = this.map, layer = this.exploreLayer();
    if (!map || !this.layersReady) { this.pendingFly ||= fly; return; }
    const at = (name: string) => this.stops.get(name);
    const dark = this.lighting() >= .5, streams: Stream[] = [], flow = FLOW[dark ? 'dark' : 'light'];
    const counterpart = layer?.focusedRelation;
    const selected = layer?.arcs.some(arc => arc.from === counterpart || arc.to === counterpart) ? counterpart : null;
    const limit = this.stationArcLimit();
    const visibleArcs = (layer?.arcs ?? []).filter((a, i) => !limit || i < limit || a.from === selected || a.to === selected);
    for (const a of visibleArcs) {
      const from = at(a.from), to = at(a.to);
      const emphasis = selected ? (a.from === selected || a.to === selected ? 1 : .14) : a.emphasis;
      if (from && to) streams.push({ key: `${a.from}>${a.to}`, label: '', daily: a.daily,
        color: flow, dashed: a.dashed, emphasis, path: this.arc(from, to, -.14) });
    }
    const station = this.view() === 'station';
    const circles = station ? this.visibleStationCircles() : (layer?.circles ?? []);
    const point = (c: ExploreLayer['circles'][number]) => { const p = at(c.station); return p ? [{ type: 'Feature' as const, properties: { name: c.station, label: c.label, count: c.count ?? '', rank: c.rank ?? 0, color: c.color, radius: c.radius, inner: c.innerRadius ?? 0, hollow: c.hollow, active: c.station === selected }, geometry: { type: 'Point' as const, coordinates: p } }] : []; };
    this.drawStreams(streams);
    (map.getSource('od-stops') as GeoJSONSource).setData({ type: 'FeatureCollection', features: station ? circles.flatMap(point) : [] });
    (map.getSource('explore-circles') as GeoJSONSource).setData({ type: 'FeatureCollection', features: station ? [] : circles.filter(c => c.radius > 0).flatMap(point) });
    this.drawTowers();
    if (fly && !this.explore()?.selectedRank()) {
      if (this.lowAngle()) this.focusLowAngle();
      else this.fitExploreStations(circles.map(circle => circle.station));
    }
    this.animate(streams, false);
  }

  /** 路線外框、主色與細中心軌道線同步隨明暗與流向退讓，兼顧辨識度而不搶流向主色。 */
  private networkOpacity(shade = this.lighting()) {
    return (shade >= .5 ? .9 : .9) * (this.displayedStreams.length ? .38 : 1);
  }

  private syncMetroNetworkPaint(shade = this.lighting()) {
    const map = this.map;
    if (!map) return;
    const dark = shade >= .5, factor = this.displayedStreams.length ? .38 : 1;
    map.setPaintProperty('metro-network-casing', 'line-color', dark ? '#0f1316' : '#ffffff');
    map.setPaintProperty('metro-network-casing', 'line-opacity', (dark ? .9 : .95) * factor);
    map.setPaintProperty('metro-network', 'line-opacity', this.networkOpacity(shade));
    map.setPaintProperty('metro-network-core', 'line-opacity', (dark ? .3 : .5) * factor);
  }

  private drawFlowLabels(streams: Stream[]) {
    const source = this.map?.getSource('od-flow-labels') as GeoJSONSource | undefined;
    // 數字卡蓋在最後一條線的正中間，那條線的標籤改放在四分之一處
    source?.setData({ type: 'FeatureCollection', features: streams.filter(s => s.label).map((s, i, all) => ({
      type: 'Feature', properties: { text: `${s.label}・每日 ${Math.round(s.daily).toLocaleString('zh-TW')}` },
      geometry: { type: 'Point', coordinates: s.path[i === all.length - 1 && all.length > 1 ? 12 : 24] },
    })) });
  }

  private drawStreams(streams: Stream[]) {
    this.displayedStreams = streams.filter(stream => stream.daily > 0);
    if (this.tower3d()) this.drawElevatedStreams();
    this.syncMetroNetworkPaint();
    if (!this.ribbonMoving) void this.drawRibbons();
    (this.map!.getSource('od-streams') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: this.displayedStreams.map(s => ({
        type: 'Feature', properties: { key: s.key, color: s.color, dashed: s.dashed, width: lineWidth(s.daily), opacity: (s.emphasis ?? (s.dashed ? .72 : .9)) * (this.theme() === 'dark' ? .62 : .85) },
        geometry: { type: 'LineString', coordinates: s.path },
      })),
    });
  }

  private async drawRibbons() {
    const map = this.map!, source = map.getSource('od-ribbons') as GeoJSONSource;
    const frame = ++this.ribbonFrame;
    await source.setData({ type: 'FeatureCollection', features: this.displayedStreams.filter(stream => !stream.dashed).map(stream => {
      const points = stream.path.map(point => map.project(point));
      const width = Math.max(5, lineWidth(stream.daily));
      const sides = [-1, 1].map(side => points.map(({ x, y }, i) => {
        const before = points[Math.max(0, i - 1)], after = points[Math.min(i + 1, points.length - 1)];
        const dx = after.x - before.x, dy = after.y - before.y;
        const taper = Math.sin(Math.PI * i / (points.length - 1)) ** .65;
        const normal = side * width * taper / (2 * (Math.hypot(dx, dy) || 1));
        return map.unproject([x - dy * normal, y + dx * normal]).toArray();
      }));
      const outline = [...sides[0], ...sides[1].reverse(), sides[0][0]];
      return { type: 'Feature', properties: { key: stream.key, color: stream.color, opacity: (stream.emphasis ?? .85) * (this.theme() === 'dark' ? .55 : .8) },
        geometry: { type: 'Polygon', coordinates: [outline] } };
    }) });
    if (frame !== this.ribbonFrame || this.ribbonMoving || !map.getLayer('od-ribbons')) return;
    const reveal = () => {
      if (frame !== this.ribbonFrame || this.ribbonMoving || !map.getLayer('od-ribbons')) return;
      map.setPaintProperty('od-ribbons', 'fill-opacity', ['get', 'opacity']);
      map.setPaintProperty('od-streams', 'line-width', ['max', 0.8, ['*', ['get', 'width'], .24]]);
    };
    if (map.getPaintProperty('od-ribbons', 'fill-opacity') === 0) {
      // 前一個多邊形是用舊縮放級距投影的，等新的畫好之後再從原生線條切換回來（原生線寬本來就是像素）
      const afterRender = () => {
        if (frame === this.ribbonFrame && !map.isSourceLoaded('od-ribbons')) return;
        map.off('render', afterRender);
        reveal();
      };
      map.on('render', afterRender);
    }
  }

  /** 彗星尾巴的漸層顏色跟主題走：深色地圖是發亮的白，淺色地圖是墨色。 */
  private paintComets() {
    const map = this.map;
    if (!map || !map.getLayer('od-comets-flow')) return;
    const dark = this.theme() === 'dark';
    const rgb = { flow: dark ? '237,237,235' : '41,41,41', muted: dark ? '166,166,162' : '96,96,92' };
    for (const kind of ['flow', 'muted'] as const) {
      map.setPaintProperty(`od-comets-${kind}`, 'line-gradient', ['interpolate', ['linear'], ['line-progress'], 0, `rgba(${rgb[kind]},0)`, 1, `rgba(${rgb[kind]},.85)`]);
    }
  }

  private animate(streams: Stream[], time: boolean, moving = true) {
    const source = this.map!.getSource('od-particles') as GeoJSONSource;
    const comets = this.map!.getSource('od-comets') as GeoJSONSource;
    const pulse = this.map!.getSource('od-pulse') as GeoJSONSource;
    if (!streams.length) { source.setData(EMPTY); comets.setData(EMPTY); pulse.setData(EMPTY); return; }
    this.paintComets();
    const counts = streams.map(s => arrowCount(s.daily));
    const position = (path: Point[], t: number) => {
      const x = t * (path.length - 1), i = Math.min(Math.floor(x), path.length - 2), f = x - i;
      const [lon, lat] = path[i], [nextLon, nextLat] = path[i + 1];
      const east = nextLon - lon, north = nextLat - lat;
      return {
        at: [lon + east * f, lat + north * f],
        bearing: Math.atan2(-north, east * Math.cos(lat * Math.PI / 180)) * 180 / Math.PI,
      };
    };
    const all = streams.map((_, i) => i);
    let displayedMonth: number | undefined;
    const render = (elapsed: number) => {
      const features: Feature[] = [];
      let active = all;
      if (time) {
        const month = Math.floor(elapsed / TRAVERSE_MS) % 2;
        if (month !== displayedMonth) {
          displayedMonth = month;
          this.drawStreams([streams[month]]);
          this.timePhase.set(month === 0 ? 'baseline' : 'current');
        }
        active = [month];
      }
      if (this.tower3d()) {
        if (!this.reducedMotion) this.elevatedFlow?.advance(elapsed);
        return;
      }
      const tails: Feature[] = [], landings: Feature[] = [];
      const ease = (x: number) => .5 - Math.cos(Math.PI * x) / 2;
      for (const i of active) {
        const s = streams[i], count = counts[i];
        const offset = (i * 0.37) % 1;
        const kind = s.color === FLOW.light || s.color === FLOW.dark ? 'flow' : 'muted';
        const width = (kind === 'flow' ? 1.6 : 1.1) + Math.min(1.4, lineWidth(s.daily) * .04);
        const base = s.emphasis != null && s.emphasis <= .54 ? s.emphasis : 1;
        for (let k = 0; k < count; k++) {
          const raw = (elapsed / TRAVERSE_MS + offset + k / count) % 1;
          // 出站慢、中段快、進站慢，像真的列車；頭尾淡入淡出，不會憑空冒出來
          const head = .1 + .8 * ease(raw), tail = Math.max(.03, head - .14);
          const fade = base * Math.min(1, raw / .07, (1 - raw) / .07);
          const coordinates = Array.from({ length: 14 }, (_, n) => position(s.path, tail + (head - tail) * n / 13).at);
          tails.push({ type: 'Feature', properties: { kind, w: width, opacity: fade }, geometry: { type: 'LineString', coordinates } });
          features.push({ type: 'Feature', properties: { bearing: position(s.path, head).bearing, opacity: fade }, geometry: { type: 'Point', coordinates: coordinates[13] } });
          // 到站瞬間，終點綻開一圈漣漪
          if (raw > .9 && !this.reducedMotion) landings.push({ type: 'Feature', properties: { phase: (raw - .9) / .1, color: s.color }, geometry: { type: 'Point', coordinates: s.path[s.path.length - 1] } });
        }
      }
      source.setData({ type: 'FeatureCollection', features });
      comets.setData({ type: 'FeatureCollection', features: tails });
      // 每條流從起站向外呼吸：每 1.5 秒一圈，擴大並淡出
      const departures = this.reducedMotion ? [] : active.flatMap(i => [0, .5].map(lag => {
        const phase = (elapsed / 1800 + i * .3 + lag) % 1, width = lineWidth(streams[i].daily);
        return { type: 'Feature' as const, properties: { r: 7 + phase * (14 + width * 2.2), w: 2.2 * (1 - phase) + .6, o: .75 * (1 - phase) ** 1.5, color: streams[i].color },
          geometry: { type: 'Point' as const, coordinates: streams[i].path[0] } };
      }));
      const arrivals = landings.map(f => { const phase = f.properties!['phase'] as number; return { ...f, properties: { r: 5 + phase * 20, w: 2.6 * (1 - phase) + .4, o: .9 * (1 - phase) ** 1.2, color: f.properties!['color'] } }; });
      pulse.setData({ type: 'FeatureCollection', features: [...departures, ...arrivals] });
    };
    render(this.particleElapsed);
    if (!moving || this.reducedMotion || this.paused()) return;
    let previous = performance.now(), rendered = this.particleElapsed;
    const loop = (now: number) => {
      if (!document.hidden && (!this.phone() || this.mobilePage() === 'map')) {
        this.particleElapsed += Math.min(now - previous, 50);
        if (this.particleElapsed - rendered >= (this.map?.isMoving() ? 50 : 32)) {
          render(this.particleElapsed);
          rendered = this.particleElapsed;
        }
      }
      previous = now;
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  async toggleMapFullscreen() {
    const next = !this.mapFullscreen();
    if (next) this.closeMenus();
    this.mapFullscreen.set(next);
    if (this.fullscreenSupported) {
      try {
        if (next && !document.fullscreenElement) await document.documentElement.requestFullscreen();
        else if (!next && document.fullscreenElement) await document.exitFullscreen();
      } catch { /* fallback to CSS fullscreen */ }
    }
    setTimeout(() => this.map?.resize(), 60);
  }

  readonly installHelp = signal(false);
  installFromBanner() {
    if (this.installPrompt()) { void this.installApp(); return; }
    this.installHelp.set(true);
    this.layerOpenHint();
  }
  layerOpenHint() {
    const el = this.placeMenu().nativeElement.closest('.map-tools')?.querySelector<HTMLDetailsElement>('.layer-menu');
    if (el) {
      if (this.toolsCollapsed()) this.toggleTools();
      el.open = true;
      afterNextRender(() => {
        const install = el.querySelector<HTMLButtonElement>('.pwa-install-btn');
        install?.scrollIntoView({ block: 'nearest' });
        install?.focus({ preventScroll: true });
      }, { injector: this.injector });
    }
    this.dismissInstallBanner();
  }
  readonly installBannerClosed = signal(((): boolean => { try { return localStorage.getItem('exitpulse.install') === 'no'; } catch { return false; } })());
  /** 按「稍後」後，提示條改成告訴使用者之後去哪裡補裝，幾秒後收掉。 */
  readonly installLater = signal(false);
  dismissInstallBanner(later = false) {
    this.installBannerClosed.set(true);
    if (later) { this.installLater.set(true); setTimeout(() => this.installLater.set(false), 6000); }
    try { localStorage.setItem('exitpulse.install', 'no'); } catch { /* 只在這次有效 */ }
  }
  /** 有系統安裝視窗就直接叫出，沒有（iPhone 等）就展開手動步驟。 */
  async installAction() {
    if (this.installPrompt()) await this.installApp(); else this.installHelp.set(!this.installHelp());
  }
  async installApp() {
    const ev = this.installPrompt();
    if (!ev) return;
    await ev.prompt();
    const res = await ev.userChoice.catch(() => ({ outcome: 'dismissed' }));
    if (res.outcome === 'accepted') this.installPrompt.set(null);
  }

  ngOnDestroy() { removeEventListener('keydown', this.onKey); document.removeEventListener('fullscreenchange', this.onFullscreenChange); removeEventListener('beforeinstallprompt', this.onBeforeInstall); removeEventListener('appinstalled', this.onAppInstalled); clearInterval(this.mapGuard); this.stop(); this.map?.remove(); }
}
