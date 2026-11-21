// 首次查詢面板：輸入站名或站碼找車站，找不到時改搜地點。
import { readFold, writeFold } from './fold-preference';
import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { normalizeStationKey } from './station-match';

export interface FirstQueryStation {
  name: string;
  lines?: Array<{ code: string; line: string; color: string }>;
}

export interface FirstQueryPreset {
  label: string;
  detail: string;
  view?: 'pairs' | 'station' | 'network';
  station?: string;
  networkMetric?: 'entries' | 'net';
  days?: 'weekday' | 'workday' | 'weekend' | 'all';
  baseline: string;
  current: string;
  start: number;
  end: number;
  weekend: boolean;
  type: 'all' | 'increase' | 'decrease' | 'reversal';
  origin?: string;
  destination?: string;
}

const DEFAULT_PRESETS: FirstQueryPreset[] = [
  { label: '南港通勤翻倍', detail: '南港→展覽館 +107%', view: 'pairs', baseline: '2022-09', current: '2026-09', start: 7, end: 10, weekend: false, type: 'increase', origin: '南港', destination: '南港展覽館' },
  { label: '大巨蛋週末潮', detail: '國父紀念館 3.7 倍', view: 'station', station: '國父紀念館', days: 'weekend', baseline: '2022-09', current: '2026-09', start: 0, end: 24, weekend: true, type: 'all' },
  { label: '早尖峰潮汐吸吐', detail: '全線淨進出分布', view: 'network', networkMetric: 'net', days: 'workday', baseline: '2022-09', current: '2026-09', start: 8, end: 9, weekend: false, type: 'all' },
];

// 搜尋比對鍵：全形轉半形、「臺」統一為「台」、不分大小寫
const searchKey = normalizeStationKey;

@Component({
  selector: 'app-first-query',
  templateUrl: './first-query.html',
  styleUrl: './first-query.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FirstQuery {
  private readonly injector = inject(Injector);
  private readonly stationInput = viewChild<ElementRef<HTMLInputElement>>('stationInput');
  readonly stations = input<FirstQueryStation[]>([]);
  readonly latestMonth = input<string>('');
  readonly chooseStation = output<string>();
  readonly findPlace = output<string>();
  readonly comparePairs = output<void>();
  readonly choosePreset = output<FirstQueryPreset>();
  readonly presets = DEFAULT_PRESETS;
  readonly query = signal('');
  readonly activeIndex = signal(0);
  readonly collapsed = signal(readFold('panel.first-query'));
  toggleCollapsed() { this.collapsed.update(value => !value); writeFold('panel.first-query', this.collapsed()); }

  readonly matches = computed(() => {
    const query = searchKey(this.query());
    if (!query) return [];
    return this.stations()
      .filter(station => searchKey(station.name).includes(query)
        || station.lines?.some(line => searchKey(line.code).includes(query)))
      .slice(0, 6);
  });

  onInput(value: string) {
    this.query.set(value);
    this.activeIndex.set(0);
  }

  onKeydown(e: KeyboardEvent) {
    if (e.isComposing) return;
    const matches = this.matches();
    if (e.key === 'ArrowDown' && matches.length) {
      e.preventDefault();
      const next = (this.activeIndex() + 1) % matches.length;
      this.activeIndex.set(next);
      document.getElementById('fq-opt-' + next)?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'ArrowUp' && matches.length) {
      e.preventDefault();
      const next = (this.activeIndex() - 1 + matches.length) % matches.length;
      this.activeIndex.set(next);
      document.getElementById('fq-opt-' + next)?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Escape' && this.query()) {
      e.preventDefault();
      e.stopPropagation();
      this.query.set('');
      this.activeIndex.set(0);
    }
  }

  focusInput() {
    if (this.collapsed()) {
      this.collapsed.set(false);
      writeFold('panel.first-query', false);
    }
    afterNextRender(() => this.stationInput()?.nativeElement.focus({ preventScroll: true }), { injector: this.injector });
  }

  select(station: FirstQueryStation) {
    this.chooseStation.emit(station.name);
  }

  searchPlace() {
    this.findPlace.emit(this.query().trim());
  }

  // Enter 送出：有高亮或精準相符直接選站，無候選才當地點搜尋
  submit() {
    const matches = this.matches();
    const query = searchKey(this.query());
    if (matches.length) {
      const idx = Math.min(this.activeIndex(), matches.length - 1);
      const exact = idx === 0 ? matches.find(station => searchKey(station.name) === query
        || station.lines?.some(line => searchKey(line.code) === query)) : undefined;
      this.select(exact ?? matches[idx]);
      return;
    }
    if (query) this.searchPlace();
  }
}
