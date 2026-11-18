// 說明提示：標籤與數值的小型提示框
import { ChangeDetectionStrategy, Component, OnDestroy, input } from '@angular/core';

export type HintEntry = { label: string; value: string };

let openDetails: HTMLDetailsElement | null = null;

function onDocPointerDown(event: PointerEvent) {
  if (!openDetails) return;
  if (!openDetails.contains(event.target as Node)) {
    openDetails.open = false;
    openDetails = null;
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', onDocPointerDown, true);
}

@Component({
  selector: 'app-hint',
  template: `<details (keydown.escape)="close($event)" (toggle)="place($event)"><summary [attr.aria-label]="label()" [title]="label()"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9 9.5a3 2.5 0 016 0c0 2-2 2-3 3.5"/><path d="M12 17h.01"/></svg></summary><div class="hint-text" role="note"><strong>{{ label() }}</strong>@if (entries().length) { <dl>@for (entry of entries(); track entry.label) { <div><dt>{{ entry.label }}</dt><dd>{{ entry.value }}</dd></div> }</dl> } @else { <ng-content /> }</div></details>`,
  styleUrl: './hint.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.align-to-panel]': 'alignToPanel()' },
})
export class Hint implements OnDestroy {
  readonly label = input('查看說明');
  readonly entries = input<readonly HintEntry[]>([]);
  readonly alignToPanel = input(false);
  private ownDetails: HTMLDetailsElement | null = null;

  /** 說明泡泡用 fixed 定位：自動補償祖先 transform/translate 偏移，優先下方、放不下時翻上方並對準觸發鈕。 */
  place(event: Event) {
    const details = event.currentTarget as HTMLDetailsElement;
    this.ownDetails = details;
    if (!details.open) {
      if (openDetails === details) openDetails = null;
      return;
    }
    if (openDetails && openDetails !== details) openDetails.open = false;
    openDetails = details;

    const text = details.querySelector('.hint-text') as HTMLElement;
    const trigger = details.querySelector('summary')!.getBoundingClientRect();
    const margin = 8, gap = 10, width = Math.min(300, innerWidth - 2 * margin);
    text.style.width = `${width}px`;
    text.style.left = '0px';
    text.style.top = '0px';
    // 量測祖先 transform/translate 造成的 fixed 基準偏移
    const base = text.getBoundingClientRect();
    const height = text.offsetHeight;
    const targetLeft = Math.min(Math.max(margin, trigger.right - width), innerWidth - width - margin);
    const below = trigger.bottom + gap + height <= innerHeight - margin;
    const targetTop = below ? trigger.bottom + gap : Math.max(margin, trigger.top - gap - height);
    text.setAttribute('data-side', below ? 'bottom' : 'top');
    text.style.setProperty('--arrow-x', `${Math.round(Math.min(width - 18, Math.max(18, trigger.left + trigger.width / 2 - targetLeft)))}px`);
    text.style.left = `${targetLeft - base.left}px`;
    text.style.top = `${targetTop - base.top}px`;
  }

  close(event: Event) {
    const details = event.currentTarget as HTMLDetailsElement;
    details.open = false;
    if (openDetails === details) openDetails = null;
    event.stopPropagation();
  }

  ngOnDestroy() {
    if (openDetails && openDetails === this.ownDetails) openDetails = null;
  }
}
