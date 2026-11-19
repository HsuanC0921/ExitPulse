import { ChangeDetectionStrategy, Component, ElementRef, ViewEncapsulation, input, output, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Crowd } from './crowd';
import { Hint } from './hint';
import { AnimatedCount } from './animated-count';
import type { Result } from './radar-model';

export type PairDetailData = {
  baseline: string;
  current: string;
  days: number[];
  hours: number[];
  daysType?: 'weekday' | 'workday' | 'weekend';
  commonStations: number;
};

export type PairDetailStory = {
  headline: string;
  when: string;
  reversal: string;
  shareA: number;
  shareB: number;
  scale: number;
  origin: string;
  /** 排序依據是占比時，上方兩格改顯示占比；其餘維持每日人次 */
  shareUnit: string | null;
};

export type PairDetailChart = {
  hours: { h: number; a: number | null; b: number | null; selected: boolean; missing: boolean }[];
  peak: number;
  busiest: number;
  busiestDaily: number;
  offPeakTip: string;
};

export type PairDetailHourRow = {
  h: number;
  a: number | null;
  b: number | null;
  diff: number | null;
  pct: number | null;
  selected: boolean;
};

@Component({
  selector: 'app-pair-detail',
  imports: [DecimalPipe, Crowd, Hint, AnimatedCount],
  templateUrl: './pair-detail.html',
  styleUrl: './pair-detail.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class PairDetail {
  readonly panel = viewChild<ElementRef<HTMLElement>>('detailPanel');

  readonly item = input.required<Result>();
  readonly data = input.required<PairDetailData>();
  readonly story = input.required<PairDetailStory>();
  readonly verdict = input.required<string>();
  readonly cautions = input.required<string[]>();
  readonly detailOpen = input.required<boolean>();
  readonly detailWide = input.required<boolean>();
  readonly isFavPair = input.required<boolean>();
  readonly mapMessage = input.required<string>();
  readonly profile = input<{ baseline: { forward: (number | null)[] }; current: { forward: (number | null)[] } } | null>(null);
  readonly profileError = input.required<boolean>();
  readonly chart = input<PairDetailChart | null>(null);
  readonly hourTable = input.required<PairDetailHourRow[]>();
  readonly siblings = input.required<Result[]>();
  readonly reversePair = input<Result | null>(null);
  readonly linesOfStation = input.required<(name: string) => { code: string; color: string }[]>();
  readonly lineOf = input.required<(name: string) => { code: string; color: string } | undefined>();
  readonly stationCode = input.required<(line: string, name: string) => string>();
  readonly dailyTrips = input.required<(n: number) => string>();

  readonly toggleFav = output<void>();
  readonly toggleWide = output<void>();
  readonly toggleOpen = output<void>();
  readonly close = output<void>();
  readonly focusStation = output<string>();
  readonly choose = output<Result>();
  readonly saveCard = output<void>();
  readonly retryProfile = output<void>();

  focusPanel() {
    this.panel()?.nativeElement.focus({ preventScroll: true });
  }
}
