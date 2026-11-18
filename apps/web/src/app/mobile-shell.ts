// 手機版外殼：底部分頁與地圖摘要
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Brand } from './brand';

export type MobilePage = 'map' | 'list' | 'conditions' | 'detail';
export type RadarView = 'pairs' | 'station' | 'network';
export type MobileAction = 'map' | 'list' | 'back' | 'conditions' | 'detail' | 'find';
export type MobileSummary = {
  from: string;
  to?: string;
  caption: string;
  action: string;
  actionKind: 'list' | 'detail' | 'find';
  disabled: boolean;
  canEdit: boolean;
};

/** 手機的導覽與地圖摘要，分析狀態仍留在主元件。 */
@Component({
  selector: 'app-mobile-shell',
  imports: [Brand],
  templateUrl: './mobile-shell.html',
  styleUrl: './mobile-shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MobileShell {
  readonly page = input.required<MobilePage>();
  readonly view = input.required<RadarView>();
  readonly summary = input.required<MobileSummary>();
  readonly hideOverview = input(false);
  readonly focusedStation = input<string | null>(null);
  readonly stationFocus = output<string>();
  readonly action = output<MobileAction>();
  readonly viewChange = output<RadarView>();
}
