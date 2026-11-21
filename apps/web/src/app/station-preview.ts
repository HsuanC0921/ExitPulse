// 地圖點選車站後的浮動資訊卡：旅次快照、周邊設施/景點/YouBike 與各年代出入口清單。
import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, input, linkedSignal, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { AnimatedCount } from './animated-count';
import { StationHistory } from './station-history';
import type { StationHistoryLine } from './station-history-model';

export interface PreviewLine {
  code: string;
  name: string;
  color: string;
}

export interface Entrance {
  code: string;
  name: string;
  label?: string;
  lng: number;
  lat: number;
  accessible: boolean;
  history?: { opened?: string; closed?: string; reopened?: string; source: string; closureSource?: string } | null;
}

export interface StationInfo {
  retrieved: string;
  facilities: { label: string; area: string; value: string }[];
  entrances: Entrance[];
  opening?: { date: string; source: string };
  lines?: StationHistoryLine[];
  addresses?: string[];
  story?: { summary: string; source: string; sourceLabel?: string } | null;
  nearby?: { name: string; distance: number; summary: string; lng?: number; lat?: number }[];
  youbike?: { name: string; distance: number; capacity: number; address?: string; lng?: number; lat?: number }[];
  hubs?: { name: string; officialName?: string; kind: string; distance: number; lng?: number; lat?: number; source?: string; sourceLabel?: string }[];
  districtPop?: { district: string; period: string; population: number; yoyPct?: number | null } | null;
  catchmentPop?: { districts: string[]; period: string; population: number; yoyPct?: number | null } | null;
  latestStats?: {
    month: string;
    period?: string;
    isDate?: boolean;
    dailyEntries: number;
    dailyExits: number;
    rank: number;
    totalStations: number;
    yoyPct?: number | null;
  };
}

export interface StationSnapshot {
  periodLabel: string;
  entries: number;
  exits: number | null;
  rank: number | null;
  totalStations: number | null;
  diffPct: number | null;
  diffLabel: string;
}

@Component({
  selector: 'section[app-station-preview]',
  imports: [DecimalPipe, AnimatedCount, StationHistory],
  templateUrl: './station-preview.html',
  styleUrl: './station-preview.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'station-preview',
    '[class.preview-compact]': 'folded()',
    '[attr.inert]': 'mapOnly() ? "" : null',
    '[attr.aria-label]': '"地圖所選車站"',
  },
})
export class StationPreview {
  readonly station = input.required<string>();
  readonly folded = input(false);
  readonly mapOnly = input(false);
  readonly lines = input.required<PreviewLine[]>();
  readonly stationCodeFn = input.required<(line: string, station: string) => string>();
  readonly info = input<StationInfo | null>(null);
  readonly infoStatus = input<'idle' | 'loading' | 'failed'>('idle');
  readonly snapshot = input<StationSnapshot | null>(null);
  readonly availableMonths = input<string[]>([]);
  readonly entranceCurrent = input.required<string>();
  readonly entranceBaseline = input<string | null | undefined>(undefined);
  readonly entrancePeriod = input.required<string>();
  readonly entrancesAtPeriod = input<Entrance[]>([]);
  readonly showEntrances = input(false);
  readonly compareEntrances = input(false);
  readonly activeEntrance = input<Entrance | null>(null);
  readonly showRankLink = input(false);
  readonly hasData = input(false);

  readonly toggleFold = output<void>();
  readonly close = output<void>();
  readonly openHistory = output<string>();
  readonly focusPoi = output<{ name: string; category: string; lng?: number; lat?: number }>();
  readonly toggleEntrances = output<boolean>();
  readonly compareEntrancesChange = output<boolean>();
  readonly locateEntrance = output<Entrance>();
  readonly rankLink = output<void>();
  readonly viewStation = output<void>();

  readonly nearbyTab = linkedSignal<'hubs' | 'nearby' | 'youbike'>(() => {
    const info = this.info();
    if (info?.hubs?.length) return 'hubs';
    if (info?.nearby?.length) return 'nearby';
    if (info?.youbike?.length) return 'youbike';
    return 'hubs';
  });

  readonly hubSources = computed(() => {
    const seen = new Map<string, string>();
    for (const hub of this.info()?.hubs ?? []) {
      const label = hub.sourceLabel?.trim();
      const url = hub.source?.trim();
      if (label && !seen.has(label)) seen.set(label, url || '');
    }
    return [...seen.entries()].map(([label, url]) => ({ label, url }));
  });

  readonly youbikeSummary = computed(() => {
    const list = this.info()?.youbike ?? [];
    return { count: list.length, totalDocks: list.reduce((sum, s) => sum + (s.capacity || 0), 0) };
  });

  readonly snapshotBalance = computed(() => {
    const s = this.snapshot();
    if (!s || s.exits == null || s.entries + s.exits <= 0) return null;
    const total = s.entries + s.exits;
    const entryPct = Math.round(s.entries / total * 100);
    const exitPct = 100 - entryPct;
    const label = entryPct - exitPct >= 4 ? '偏淨流出' : exitPct - entryPct >= 4 ? '偏淨流入' : '進出均衡';
    return { entryPct, exitPct, label };
  });

  readonly cleanNote = computed(() => {
    const raw = this.info()?.story?.summary?.trim();
    if (!raw) return '';
    return raw
      .replace(/[^。]*屬於[^。]*通車。/g, '')
      .replace(/\d+\s*年\s*\d+\s*月平均每天約[^。]*排第\s*\d+。/g, '')
      .replace(/現況資料顯示共有[^。]*。/g, '')
      .replace(/站外(?:當時已確認啟用|共有)的?[^。]*捷運出入口[^。]*。/g, '')
      .trim();
  });

  readonly hasEntranceHistory = computed(() => this.entrancesAtPeriod().some(e => !!e.history));
  readonly accessibleExitCount = computed(() => this.entrancesAtPeriod().filter(e => e.accessible).length);

  walkMinutes(meters: number) {
    return Math.max(1, Math.round(meters / 80));
  }

  shortExitName(station: string, name: string): string {
    const stripped = name.replace(new RegExp(`^${station}站?`), '').trim();
    if (!stripped) return name;
    if (/^[A-Za-z0-9]+$/.test(stripped)) return `出口 ${stripped}`;
    return stripped.replace(/^出口\s*/, '出口 ');
  }

  facilityLines(value: string): string[] {
    return value.split(/\n|(?=\d+\.)/).map(s => s.trim()).filter(Boolean);
  }

  entranceEvents(exit: Entrance) {
    const history = exit.history;
    if (!history) return [];
    return [
      ...(history.opened ? [{ date: history.opened, label: '啟用', source: history.source }] : []),
      ...(history.closed ? [{ date: history.closed, label: '暫停開放', source: history.closureSource ?? history.source }] : []),
      ...(history.reopened ? [{ date: history.reopened, label: '重新開放', source: history.source }] : []),
    ];
  }
}
