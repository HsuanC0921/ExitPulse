// 時間軸：當日 24 小時人次分布、選時段與播放控制
import { readFold, writeFold } from './fold-preference';
import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Hint } from './hint';
import { AnimatedCount } from './animated-count';
import { MotionPreference } from './motion-preference';
import { daylightAt, formatSolarTime, solarTimes, timeRange } from './daylight';

type RelationHour = { hour: number; forward: number | null; reverse: number | null };

@Component({
  selector: 'app-time-player',
  imports: [DecimalPipe, Hint, AnimatedCount],
  templateUrl: './time-player.html',
  styleUrl: './time-player.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimePlayer {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  readonly motion = inject(MotionPreference);
  readonly date = input.required<string>();
  readonly station = input('');
  readonly counterpart = input<string | null>(null);
  readonly daily = input.required<boolean>();
  readonly hour = input<number | null>(null);
  readonly band = input.required<string>();
  readonly playing = input(false);
  readonly busy = input(false);
  readonly failure = input('');
  readonly quickHours = [
    { label: '早尖峰', hour: 8 },
    { label: '午間', hour: 13 },
    { label: '晚尖峰', hour: 18 },
    { label: '夜間', hour: 22 },
  ] as const;
  readonly unrecorded = input(false);
  readonly previous = input(false);
  readonly next = input(false);
  readonly profile = input<(number | null)[]>([]);
  readonly measure = input('');
  readonly compact = input(false);
  readonly expanded = linkedSignal(() => !this.compact() || !readFold('panel.timeline-compact', true));
  readonly folded = signal(readFold('panel.timeline'));
  setFolded(folded: boolean) {
    if (this.compact()) {
      this.expanded.set(!folded);
      writeFold('panel.timeline-compact', folded);
    } else {
      this.folded.set(folded);
      writeFold('panel.timeline', folded);
    }
    afterNextRender(() => {
      this.host.querySelector<HTMLButtonElement>('.compact-time, .fold, .player-heading .icon')?.focus({ preventScroll: true });
    }, { injector: this.injector });
  }
  readonly hourChange = output<number>();
  readonly play = output<void>();
  readonly wholeDay = output<void>();
  readonly start = output<void>();
  readonly edit = output<void>();
  readonly retry = output<void>();
  readonly step = output<number>();
  readonly clearRelation = output<void>();
  readonly stationInfo = output<void>();
  readonly relationProfile = httpResource<{ byHour: RelationHour[] }>(() => {
    const destination = this.counterpart();
    return destination && this.daily() ? {
      url: '/api/v1/od/relation-hours', params: { origin: this.station(), destination, date: this.date() },
    } : undefined;
  });
  readonly relationHours = computed(() => this.relationProfile.hasValue() ? this.relationProfile.value().byHour : []);
  readonly relationPeak = computed(() => Math.max(1, ...this.relationHours().flatMap(({ forward, reverse }) => [forward ?? 0, reverse ?? 0])));
  readonly relationCounts = computed(() => {
    const hour = this.hour(), rows = this.relationHours();
    if (hour != null) return rows[hour] ?? null;
    // 全天或時段區間（如 7-10）都加總區間內每個小時
    const match = /^(\d+)-(\d+)$/.exec(this.band());
    const [from, to] = match ? [Number(match[1]), Number(match[2])] : [0, 24];
    const span = rows.filter(row => row.hour >= from && row.hour < to);
    if (!span.some(row => row.forward != null || row.reverse != null)) return null;
    return span.reduce((total, row) => ({ forward: total.forward + (row.forward ?? 0), reverse: total.reverse + (row.reverse ?? 0) }), { forward: 0, reverse: 0 });
  });
  readonly daylight = computed(() => daylightAt(this.hour(), this.date()));
  readonly guide = computed(() => {
    const { sunrise, sunset } = solarTimes(this.date());
    return [
      { label: '日出／日落', value: `約 ${formatSolarTime(sunrise)}／${formatSolarTime(sunset)}（臺北）` },
      { label: '選小時', value: '左右拖曳下方長條，或按方向鍵' },
      { label: '時段', value: '按進站時間統計' },
      { label: '全天', value: '合計整天人次' },
    ];
  });
  readonly range = computed(() => timeRange(this.band()));
  readonly peak = computed(() => Math.max(1, ...this.profile().map(value => value ?? 0)));
  readonly busiest = computed(() => {
    const profile = this.profile();
    const maximum = Math.max(0, ...profile.map(value => value ?? 0));
    if (!maximum) return null;
    const hour = profile.indexOf(maximum);
    const tied = profile.filter(value => value === maximum).length > 1;
    return { hour, range: timeRange(`${hour}-${hour + 1}`), count: maximum, tied };
  });
  readonly trips = computed(() => {
    const hour = this.hour(), profile = this.profile();
    if (!profile.some(value => value != null)) return null;
    return hour == null
      ? (this.band() === '0-24' ? profile.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null)
      : profile[hour];
  });
  readonly spokenTime = computed(() => {
    const light = this.daylight(), range = this.range(), count = this.trips();
    const label = light ? `${light.label} ${range}` : `${range}，拖曳選擇小時`;
    if (this.counterpart()) {
      const pair = this.relationCounts();
      return pair?.forward != null && pair.reverse != null ? `${label}，去程 ${pair.forward} 人次，回程 ${pair.reverse} 人次` : label;
    }
    return label + (count == null ? '' : `，${this.measure()} ${count.toLocaleString('zh-TW')} 人次`);
  });

  selectFromOverview(hour: number) {
    // 全天檢視時拉桿本來就在 0，瀏覽器的原生 input 事件可能不會觸發
    if (this.hour() == null) this.hourChange.emit(hour);
  }
}
