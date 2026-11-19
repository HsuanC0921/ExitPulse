import { DestroyRef, inject, signal } from '@angular/core';

/** The layout follows the available space and input, not the device name. */
export function watchDeviceProfile() {
  const narrow = matchMedia('(max-width: 720px)');
  const short = matchMedia('(max-height: 500px)');
  const landscape = matchMedia('(orientation: landscape)');
  const touch = matchMedia('(pointer: coarse)');
  const hover = matchMedia('(hover: hover)');
  const installed = matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)');
  const media = [narrow, short, landscape, touch, hover, installed];
  const probe = document.createElement('div');
  probe.className = 'device-inset-probe';
  probe.setAttribute('aria-hidden', 'true');
  document.body.append(probe);

  const read = () => {
    const { paddingTop, paddingLeft, paddingRight } = getComputedStyle(probe);
    const top = parseFloat(paddingTop);
    // The band describes available space, not the physical shape of the cutout.
    const inset = top >= 54 ? 'island' : top > 0 || parseFloat(paddingLeft) > 0 || parseFloat(paddingRight) > 0 ? 'notch' : 'none';
    return {
      inset,
      landscape: landscape.matches,
      standalone: installed.matches || !!(navigator as Navigator & { standalone?: boolean }).standalone,
      touch: touch.matches,
      hover: hover.matches,
      layout: narrow.matches || (short.matches && landscape.matches && touch.matches) ? 'compact' : 'wide',
    } as const;
  };

  const profile = signal(read(), { equal: (a, b) => a.inset === b.inset && a.landscape === b.landscape
    && a.standalone === b.standalone && a.touch === b.touch && a.hover === b.hover && a.layout === b.layout });
  let frame = 0;
  const update = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      profile.set(read());
    });
  };
  const viewport = window.visualViewport;
  const observer = new ResizeObserver(update);
  observer.observe(probe, { box: 'border-box' });
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
  viewport?.addEventListener('resize', update);
  for (const query of media) query.addEventListener('change', update);
  inject(DestroyRef).onDestroy(() => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    probe.remove();
    window.removeEventListener('resize', update);
    window.removeEventListener('orientationchange', update);
    viewport?.removeEventListener('resize', update);
    for (const query of media) query.removeEventListener('change', update);
  });
  return profile.asReadonly();
}
