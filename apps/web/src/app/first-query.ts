// 首次查詢面板：輸入站名或站碼找車站，找不到時改搜地點。
import { readFold, writeFold } from './fold-preference';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

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
const searchKey = (value: string) => value.trim().normalize('NFKC').replaceAll('臺', '台').toLowerCase();

@Component({
  selector: 'app-first-query',
  templateUrl: './first-query.html',
  styleUrl: './first-query.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FirstQuery {
  readonly stations = input<FirstQueryStation[]>([]);
  readonly latestMonth = input<string>('');
  readonly chooseStation = output<string>();
  readonly findPlace = output<string>();
  readonly comparePairs = output<void>();
  readonly choosePreset = output<FirstQueryPreset>();
  readonly presets = DEFAULT_PRESETS;
  readonly query = signal('');
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

  select(station: FirstQueryStation) {
    this.chooseStation.emit(station.name);
  }

  searchPlace() {
    this.findPlace.emit(this.query().trim());
  }

  // Enter 送出：完全相符或唯一候選直接選站，無候選才當地點搜尋
  submit() {
    const matches = this.matches();
    const query = searchKey(this.query());
    const exact = matches.find(station => searchKey(station.name) === query
      || station.lines?.some(line => searchKey(line.code) === query));
    if (exact || matches.length === 1) this.select(exact ?? matches[0]);
    else if (query && !matches.length) this.searchPlace();
  }
}
