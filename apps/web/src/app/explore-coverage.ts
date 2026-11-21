// 已匯入旅次資料範圍與缺漏明細檢視（獨立自成元件以簡化 Explore 樣板與樣式體積）。
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Hint, type HintEntry } from './hint';
import type { CatalogAnswer } from './explore-model';

@Component({
  selector: 'app-explore-coverage',
  imports: [DecimalPipe, Hint],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .coverage-summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-2); margin: 12px 0; }
    .coverage-summary div {
      padding: 8px 10px;
      border: 1px solid var(--hairline, var(--rule));
      border-radius: var(--r-m);
      background: var(--panel-2);
      box-shadow: 0 1px 2px rgb(0 0 0 / .04);
    }
    .coverage-summary small { display: block; color: var(--ink-2); font-size: var(--fs-xs); }
    .coverage-summary b { font-size: var(--fs-m); font-variant-numeric: tabular-nums; }
    .coverage-search { margin: 8px 0 4px; }
  `,
  template: `
    @if (loading()) { <p class="status" role="status">正在載入資料紀錄範圍…</p> }
    @else if (failure()) { <div class="query-failure" role="alert"><p>資料紀錄範圍暫時無法載入。</p><button type="button" class="retry" (click)="retry.emit()">重新載入</button></div> }
    @else if (catalog(); as cat) {
      <div class="block-head"><span class="head-title"><h2>資料紀錄</h2><app-hint label="資料紀錄" [alignToPanel]="true" [entries]="hintEntries()" /></span></div>
      <div class="coverage-summary">
        <div><small>已匯入月份</small><b>{{ cat.summary.months }} 個月</b></div>
        <div><small>有效天數</small><b>{{ cat.summary.days | number }} 天</b></div>
        <div><small>收錄車站</small><b>{{ cat.summary.stations }} 站</b></div>
        <div><small>區間缺漏日</small><b>{{ cat.summary.missingDays }} 天</b></div>
      </div>
      <div class="segmented inline small" role="group" aria-label="紀錄檢視">
        <button type="button" [attr.aria-pressed]="tab() === 'stations'" (click)="tabChange.emit('stations')">依車站</button>
        <button type="button" [attr.aria-pressed]="tab() === 'months'" (click)="tabChange.emit('months')">依月份</button>
      </div>
      @if (tab() === 'stations') {
        <label class="search coverage-search"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/></svg><input type="search" placeholder="搜尋站名" aria-label="搜尋車站紀錄" [value]="query()" (input)="queryChange.emit($any($event.target).value)"></label>
        <div class="table-wrap" tabindex="0" role="region" aria-label="各站資料年份紀錄表">
          <table class="data-table">
            <thead><tr><th scope="col">車站</th><th scope="col">正式通車日</th><th scope="col">最早旅次紀錄</th><th scope="col">最新紀錄</th><th scope="col" class="num">天數</th></tr></thead>
            <tbody>
              @for (s of stations(); track s.name) {
                <tr (click)="stationSelect.emit(s.name)">
                  <td><button type="button" class="link-cell" (click)="$event.stopPropagation(); stationSelect.emit(s.name)">{{ s.name }}</button></td>
                  <td>{{ s.officialOpening ?? '—' }}</td>
                  <td>{{ s.firstDate ?? '—' }}</td>
                  <td>{{ s.lastDate ?? '—' }}</td>
                  <td class="num">{{ s.days | number }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <div class="table-wrap" tabindex="0" role="region" aria-label="各月份資料完整度表">
          <table class="data-table">
            <thead><tr><th scope="col">月份</th><th scope="col" class="num">天數</th><th scope="col" class="num">站數</th><th scope="col" class="num">缺漏</th></tr></thead>
            <tbody>
              @for (m of months(); track m.month) {
                <tr (click)="monthSelect.emit(m.month)">
                  <td><button type="button" class="link-cell" (click)="$event.stopPropagation(); monthSelect.emit(m.month)">{{ m.month }}</button></td>
                  <td class="num">{{ m.days }}/{{ m.expectedDays }}</td>
                  <td class="num">{{ m.stationCount }}</td>
                  <td class="num">{{ m.missingDates.length }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    }
  `,
})
export class ExploreCoverage {
  readonly loading = input(false);
  readonly failure = input(false);
  readonly catalog = input<CatalogAnswer | null>(null);
  readonly tab = input<'stations' | 'months'>('stations');
  readonly query = input('');
  readonly stations = input<CatalogAnswer['stations']>([]);
  readonly months = input<CatalogAnswer['months']>([]);
  readonly hintEntries = input<readonly HintEntry[]>([]);

  readonly tabChange = output<'stations' | 'months'>();
  readonly queryChange = output<string>();
  readonly stationSelect = output<string>();
  readonly monthSelect = output<string>();
  readonly retry = output<void>();
}
