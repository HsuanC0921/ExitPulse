// 品牌標誌：站牌式圖示與名稱
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-brand',
  host: { '[class.compact]': 'compact()' },
  template: `
    <img class="mark" src="radar-icon.svg" alt="" width="40" height="40">
    <span class="lockup">
      <span class="wordmark">Exit<span class="pulse">Pulse</span></span>
      <span class="tagline">捷運旅次變化雷達</span>
    </span>
  `,
  styleUrl: './brand.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Brand {
  /** 收合成小膠囊時只留圖示與名稱 */
  readonly compact = input(false);
}
