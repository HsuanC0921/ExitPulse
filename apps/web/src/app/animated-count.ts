import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { formatDailyTrips } from './radar-model';
import { MotionPreference } from './motion-preference';

const integer = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 });
const formats = {
  integer: (value: number) => integer.format(value),
  decimal: (value: number) => decimal.format(value),
  daily: formatDailyTrips,
  percent: (value: number) => `${value.toFixed(1)}%`,
};

@Component({
  selector: 'app-animated-count',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span [class.reserve]="sample() !== null">{{ targetLabel() }}</span>
    @if (sampleLabel(); as label) { <span class="sample" aria-hidden="true">{{ label }}</span> }
  `,
  styleUrl: './animated-count.css',
})
export class AnimatedCount {
  readonly value = input.required<number | null>();
  readonly format = input<keyof typeof formats>('integer');
  readonly empty = input('—');
  readonly active = input(true);
  protected readonly sample = signal<number | null>(null);
  protected readonly targetLabel = computed(() => {
    const value = this.value();
    return value === null ? this.empty() : formats[this.format()](value);
  });
  protected readonly sampleLabel = computed(() => {
    const value = this.sample();
    return value === null ? null : formats[this.format()](value);
  });

  private displayed = 0;
  private previousFormat?: keyof typeof formats;
  private readonly motion = inject(MotionPreference);

  constructor() {
    effect(onCleanup => {
      const target = this.value(), format = this.format(), active = this.active();
      const from = this.previousFormat === format ? this.displayed : 0;
      this.previousFormat = format;
      if (target === null || !active || this.motion.reduced() || document.hidden || from === target) {
        this.displayed = active ? target ?? 0 : 0;
        this.sample.set(null);
        return;
      }

      this.displayed = from;
      this.sample.set(from);
      const started = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, Math.max(0, now - started) / 560);
        if (progress === 1 || this.motion.reduced() || document.hidden) {
          this.displayed = target;
          this.sample.set(null);
          return;
        }
        this.displayed = from + (target - from) * (1 - (1 - progress) ** 3);
        this.sample.set(this.displayed);
        frame = requestAnimationFrame(step);
      };
      let frame = requestAnimationFrame(step);
      onCleanup(() => cancelAnimationFrame(frame));
    });
  }
}
