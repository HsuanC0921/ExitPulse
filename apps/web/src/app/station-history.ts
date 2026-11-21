// 車站沿革元件：把通車、路線與出口事件排成時間軸，點選日期可切換查詢期間。
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { buildStationHistory, openingTenure, type StationHistoryExit, type StationHistoryLine } from './station-history-model';

@Component({
  selector: 'app-station-history',
  templateUrl: './station-history.html',
  styleUrl: './station-history.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StationHistory {
  readonly stationName = input<string>('');
  readonly opening = input<{ date: string; source: string } | null>(null);
  readonly lines = input<StationHistoryLine[]>([]);
  readonly entrances = input<StationHistoryExit[]>([]);
  readonly selectedPeriod = input<string | null>(null);
  readonly availableMonths = input<string[]>([]);
  readonly periodChange = output<string>();
  readonly tenure = computed(() => openingTenure(this.opening()?.date));
  readonly events = computed(() => buildStationHistory(this.opening(), this.lines(), this.entrances(), this.stationName() || undefined));

  // 點選事件日期，通知上層改查該期間
  inspect(date: string): void {
    this.periodChange.emit(date);
  }
}
