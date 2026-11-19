// 手機版外殼：頂部導覽與地圖摘要
import { ChangeDetectionStrategy, Component, ElementRef, Injector, computed, inject, input, output, signal } from '@angular/core';
import { Brand } from './brand';
import { moveControls } from './control-motion';

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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  readonly page = input.required<MobilePage>();
  readonly view = input.required<RadarView>();
  readonly summary = input.required<MobileSummary>();
  readonly hideOverview = input(false);
  readonly focusedStation = input<string | null>(null);
  readonly stationFocus = output<string>();
  readonly action = output<MobileAction>();
  readonly viewChange = output<RadarView>();
  readonly barHidden = input(false);
  readonly barToggle = output<void>();
  readonly viewMenu = signal(false);
  readonly viewMenuOpened = output<void>();
  toggleViewMenu() {
    const next = !this.viewMenu();
    this.viewMenu.set(next);
    if (next) this.viewMenuOpened.emit();
  }
  readonly cardOpen = signal(((): boolean => { try { return localStorage.getItem('exitpulse.card') !== 'closed'; } catch { return true; } })());
  toggleCard() {
    const next = !this.cardOpen();
    moveControls(this.host, '.card-fold', this.injector);
    this.cardOpen.set(next);
    try { localStorage.setItem('exitpulse.card', next ? 'open' : 'closed'); } catch { /* 只在這次有效 */ }
  }
  readonly viewLabel = computed(() => ({ pairs: '兩站', station: '單站', network: '全線' })[this.view()]);
  pick(view: RadarView) { this.viewMenu.set(false); this.viewChange.emit(view); }
}
