import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, input, linkedSignal, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import type { DayType, MatrixAnswer, Period } from './explore-model';

type CoveredMatrix = MatrixAnswer & { missingOrigins?: string[]; missingDestinations?: string[] };
type GroupPeriod = { period: Period; daily: number | null; missingOrigins: string[]; missingDestinations: string[] };
type GroupFlow = { current: GroupPeriod; compare: GroupPeriod | null };

// 全線熱門站車站互搭表：點站名看單站，點格子看站對
@Component({
  selector: 'app-od-matrix', imports: [DecimalPipe], templateUrl: './od-matrix.html', styleUrl: './od-matrix.css',
  changeDetection: ChangeDetectionStrategy.OnPush, encapsulation: ViewEncapsulation.None,
})
export class OdMatrix {
  readonly matrix = input.required<CoveredMatrix>();
  readonly max = input.required<number>();
  readonly days = input<DayType>('weekday');
  readonly compare = input<string | null>(null);
  readonly station = output<string>();
  readonly pair = output<{ origin: string; destination: string }>();
  readonly missingOrigins = computed(() => new Set(this.matrix().missingOrigins));
  readonly missingDestinations = computed(() => new Set(this.matrix().missingDestinations));
  readonly origins = linkedSignal(() => { this.matrix(); return [] as string[]; });
  readonly destinations = linkedSignal(() => { this.matrix(); return [] as string[]; });
  readonly groupOpen = signal(false);
  readonly submitted = signal(false);
  readonly group = httpResource<GroupFlow>(() => {
    const origins = this.origins(), destinations = this.destinations();
    if (!this.submitted() || !origins.length || !destinations.length) return undefined;
    const period = this.matrix().period;
    const params = new URLSearchParams({ period: period.spec, days: this.days(), start: String(period.hours[0]), end: String(period.hours[1]) });
    if (this.compare()) params.set('compare', this.compare()!);
    for (const station of origins) params.append('origin', station);
    for (const station of destinations) params.append('destination', station);
    return '/api/v1/od/group-flow?' + params.toString();
  });

  setIncluded(group: 'origins' | 'destinations', station: string, included: boolean) {
    this.submitted.set(false);
    this[group].update(names => included ? [...names, station] : names.filter(name => name !== station));
  }

  queryGroup() {
    if (this.submitted()) this.group.reload();
    this.submitted.set(true);
  }
}
