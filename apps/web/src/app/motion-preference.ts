import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { readFold, writeFold } from './fold-preference';

@Injectable({ providedIn: 'root' })
export class MotionPreference {
  private readonly media = matchMedia('(prefers-reduced-motion: reduce)');
  private readonly system = signal(this.media.matches);
  private readonly preference = signal(readFold('reduce-motion'));
  readonly enabled = this.preference.asReadonly();
  readonly reduced = computed(() => this.enabled() || this.system());

  constructor() {
    const update = (event: MediaQueryListEvent) => this.system.set(event.matches);
    this.media.addEventListener('change', update);
    inject(DestroyRef).onDestroy(() => this.media.removeEventListener('change', update));
  }

  set(enabled: boolean) {
    this.preference.set(enabled);
    writeFold('reduce-motion', enabled);
  }
}
