import { afterNextRender, type Injector } from '@angular/core';
import { MotionPreference } from './motion-preference';

/** Keep the same control under the eye when its surrounding panel reflows. */
export function moveControls(host: Element, selector: string, injector: Injector) {
  const motion = injector.get(MotionPreference);
  if (motion.reduced()) return;
  const controls = Array.from(host.querySelectorAll<HTMLElement>(selector))
    .filter(control => control.getClientRects().length > 0)
    .map(control => ({ control, before: control.getBoundingClientRect() }));
  afterNextRender({
    mixedReadWrite: () => {
      for (const { control } of controls) {
        control.getAnimations().filter(animation => animation.id === 'control-position').forEach(animation => animation.cancel());
      }
      if (motion.reduced()) return;
      const moves = controls.filter(({ control }) => control.isConnected && control.getClientRects().length > 0)
        .map(({ control, before }) => {
          const after = control.getBoundingClientRect();
          return { control, x: before.left - after.left + (before.width - after.width) / 2, y: before.top - after.top };
        });
      for (const { control, x, y } of moves) {
        if (Math.abs(x) < 1 && Math.abs(y) < 1) continue;
        control.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: 'none' }], {
          id: 'control-position', duration: 180, easing: 'cubic-bezier(.22, 1, .36, 1)',
        });
      }
    },
  }, { injector });
}
