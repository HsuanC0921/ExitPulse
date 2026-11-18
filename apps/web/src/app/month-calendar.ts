import { ChangeDetectionStrategy, Component, ViewEncapsulation, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import type { Explore } from './explore';
import { dayName } from './explore-model';

export type CalendarChart = NonNullable<ReturnType<Explore['calendarChart']>>;

// 單站「每日進站」月曆：點日期切到逐時
@Component({
  selector: 'app-month-calendar', imports: [DecimalPipe], templateUrl: './month-calendar.html', styleUrl: './month-calendar.css',
  changeDetection: ChangeDetectionStrategy.OnPush, encapsulation: ViewEncapsulation.None,
})
export class MonthCalendar {
  readonly chart = input.required<CalendarChart>();
  readonly month = input.required<string>();
  readonly firstDate = input.required<string>();
  readonly wideView = input(false);
  readonly selected = input<string | null>(null);
  readonly pick = output<string>();
  readonly dayName = dayName;
}
