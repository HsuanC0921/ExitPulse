import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export type RankChartData = {
  station: string;
  bars: { label: string; value: number | null; empty?: string }[];
  scale: number;
};

@Component({
  selector: 'app-rank-chart',
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './rank-chart.html',
  styleUrl: './rank-chart.css',
})
export class RankChart {
  readonly data = input.required<RankChartData>();
  readonly state = input<'default' | 'preview' | 'selected'>('default');
  readonly canDrillDown = input(false);
  readonly openStation = output<string>();
}
