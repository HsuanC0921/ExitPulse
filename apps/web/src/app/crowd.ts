// 全螢幕人潮對比：同一對起訖站，左邊基準月、右邊比較月，一個小人代表固定人次，用同一個比例，疏密差異一眼可見。
import { ChangeDetectionStrategy, Component, ElementRef, NgZone, OnDestroy, computed, effect, inject, input, signal, viewChild, viewChildren } from '@angular/core';
import { DecimalPipe } from '@angular/common';

type Walker = { t: number; speed: number; lane: number; phase: number; tone: number };
type HourProfile = { baseline: { forward: (number | null)[] }; current: { forward: (number | null)[] } };
type Scope = 'day' | 'band' | 'peak';
type Stage = { canvas: HTMLCanvasElement; walkers: Walker[]; color: string };

/** 每個小人代表的每日人次：挑 1、2、5、10… 的級距，讓人數較多的一邊約 500 人以內。 */
export function crowdUnit(max: number, cap = 520): number {
  for (let step = 1; ; step *= 10) for (const m of [1, 2, 5]) if (max / (step * m) <= cap) return step * m;
}

@Component({
  selector: 'app-crowd',
  imports: [DecimalPipe],
  template: `
    <dialog #dialog class="crowd" aria-labelledby="crowd-title" (close)="stop()">
      <header>
        <h2 id="crowd-title">{{ origin() }} → {{ destination() }}</h2>
        <p class="unit">1 個小人 ≈ {{ unit() | number }} 人次（{{ scopeText() }}），兩邊同一個比例</p>
        @if (scopes().length > 1) {
          <div class="scopes" role="group" aria-label="人潮對比的時間範圍">
            @for (option of scopes(); track option.key) {
              <button type="button" [attr.aria-pressed]="scope() === option.key" (click)="scope.set(option.key)">{{ option.label }}</button>
            }
          </div>
        }
        <button type="button" class="close" aria-label="關閉人潮對比" (click)="close()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </header>
      <div class="stages" role="group" [attr.aria-label]="summary()">
        @for (side of sides(); track side.label) {
          <section class="stage" [class.now]="side.now">
            <canvas #stage aria-hidden="true"></canvas>
            <div class="caption">
              <span class="month">{{ side.label }}</span>
              <strong>{{ side.daily | number: '1.0-0' }}</strong>
              <span class="per">人次（{{ scopeText() }}），約 {{ side.people | number }} 個小人</span>
            </div>
          </section>
        }
      </div>
      <p class="ratio" aria-hidden="true">{{ ratioText() }}</p>
    </dialog>
  `,
  styleUrl: './crowd.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Crowd implements OnDestroy {
  readonly origin = input.required<string>();
  readonly destination = input.required<string>();
  readonly baselineLabel = input.required<string>();
  readonly currentLabel = input.required<string>();
  readonly baseline = input.required<number>();
  readonly current = input.required<number>();
  /** 去程逐時人次（每日平均），有的話可切換所選時段與尖峰時段。 */
  readonly profile = input<HourProfile | null>(null);
  /** 目前查詢的進站時段，例如 [7, 10]。 */
  readonly hours = input<readonly number[] | null>(null);

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly canvases = viewChildren<ElementRef<HTMLCanvasElement>>('stage');
  private readonly zone = inject(NgZone);
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private stages: Stage[] = [];
  private tone = { ground: '', far: '', ink: '', dark: false };
  private frame?: number;
  private elapsed = 0;
  private resize?: ResizeObserver;
  readonly opened = signal(false);
  readonly scope = signal<Scope>('day');

  private readonly span = computed(() => {
    const profile = this.profile(), hours = this.hours();
    if (!profile) return null;
    const sum = (rows: (number | null)[], from: number, to: number) => rows.slice(from, to).reduce<number>((total, value) => total + (value ?? 0), 0);
    const [from, to] = hours ?? [0, 24];
    const both = Array.from({ length: 24 }, (_, hour) => (profile.baseline.forward[hour] ?? 0) + (profile.current.forward[hour] ?? 0));
    const top = Math.max(...both), hour = both.indexOf(top);
    return {
      band: from === 0 && to === 24 ? null : { from, to, baseline: sum(profile.baseline.forward, from, to), current: sum(profile.current.forward, from, to) },
      peak: top > 0 ? { hour, baseline: profile.baseline.forward[hour] ?? 0, current: profile.current.forward[hour] ?? 0 } : null,
    };
  });
  readonly scopes = computed<{ key: Scope; label: string }[]>(() => {
    const span = this.span();
    return [{ key: 'day', label: '全天' }, ...(span?.band ? [{ key: 'band' as const, label: '所選時段' }] : []), ...(span?.peak ? [{ key: 'peak' as const, label: '尖峰一小時' }] : [])];
  });
  private readonly figures = computed(() => {
    const span = this.span(), scope = this.scope();
    if (scope === 'band' && span?.band) return { baseline: span.band.baseline, current: span.band.current, text: `每日 ${span.band.from} 到 ${span.band.to} 點` };
    if (scope === 'peak' && span?.peak) return { baseline: span.peak.baseline, current: span.peak.current, text: `每日尖峰 ${span.peak.hour} 到 ${span.peak.hour + 1} 點` };
    return { baseline: this.baseline(), current: this.current(), text: '每日全天' };
  });
  readonly scopeText = () => this.figures().text;
  readonly unit = () => crowdUnit(Math.max(this.figures().baseline, this.figures().current, 1));
  readonly sides = () => [
    { label: this.baselineLabel(), daily: this.figures().baseline, people: Math.round(this.figures().baseline / this.unit()), now: false },
    { label: this.currentLabel(), daily: this.figures().current, people: Math.round(this.figures().current / this.unit()), now: true },
  ];
  readonly summary = () => `${this.baselineLabel()} ${this.scopeText()} ${Math.round(this.figures().baseline)} 人次，${this.currentLabel()} ${Math.round(this.figures().current)} 人次`;
  readonly ratioText = () => this.figures().baseline > 0 ? `${(this.figures().current / this.figures().baseline).toFixed(1)} 倍` : this.figures().current > 0 ? '新增旅次' : '';

  constructor() {
    effect(() => { this.figures(); if (this.opened()) queueMicrotask(() => this.start()); });
  }

  open() {
    const el = this.dialog().nativeElement;
    if (!el.open) el.showModal();
    this.opened.set(true);
  }
  close() { this.dialog().nativeElement.close(); }
  stop() {
    this.opened.set(false);
    if (this.frame != null) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.resize?.disconnect();
  }
  ngOnDestroy() { this.stop(); }

  private start() {
    if (this.frame != null) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.elapsed = 0;
    const make = (canvas: HTMLCanvasElement, daily: number, color: string): Stage => {
      const n = Math.max(daily > 0 ? 1 : 0, Math.round(daily / this.unit()));
      const walkers = Array.from({ length: n }, (_, i): Walker => ({ t: Math.random(), speed: .05 + Math.random() * .035, lane: (i * 0.618034 + Math.random() * .05) % 1, phase: Math.random() * 6.28, tone: .7 + Math.random() * .3 }));
      return { canvas, walkers, color };
    };
    // 跟著主畫面的淺深色走，會議室投影切換時不會突然閃黑
    const css = getComputedStyle(this.dialog().nativeElement), token = (name: string) => css.getPropertyValue(name).trim();
    this.tone = { ground: token('--panel-2'), far: token('--rule'), ink: token('--ink'), dark: !!this.dialog().nativeElement.closest('[data-theme="dark"]') };
    const [a, b] = this.canvases().map(c => c.nativeElement);
    this.stages = [make(a, this.figures().baseline, token('--ink-2')), make(b, this.figures().current, token('--ink'))];
    this.resize?.disconnect();
    this.resize = new ResizeObserver(() => { for (const s of this.stages) this.fit(s.canvas); this.draw(this.elapsed); });
    for (const s of this.stages) this.resize.observe(s.canvas);
    for (const s of this.stages) this.fit(s.canvas);
    if (this.reduced) { this.draw(0); return; }
    let last = performance.now();
    this.zone.runOutsideAngular(() => {
      const loop = (now: number) => {
        const dt = Math.min(.05, (now - last) / 1000); last = now; this.elapsed += dt;
        for (const s of this.stages) for (const w of s.walkers) { w.t += w.speed * dt; if (w.t > 1) w.t -= 1; }
        this.draw(this.elapsed);
        this.frame = requestAnimationFrame(loop);
      };
      this.frame = requestAnimationFrame(loop);
    });
  }

  private fit(canvas: HTMLCanvasElement) {
    const dpr = Math.min(2, devicePixelRatio || 1), r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr)); canvas.height = Math.max(1, Math.round(r.height * dpr));
  }

  private draw(time: number) {
    for (const s of this.stages) {
      const ctx = s.canvas.getContext('2d')!, W = s.canvas.width, H = s.canvas.height, u = H / 100;
      ctx.clearRect(0, 0, W, H);
      const floorTop = H * .4, floorBottom = H * .92, gateL = W * .08, gateR = W * .92;
      // 地面：兩條消失在遠方的邊線與幾道橫向格線，做出透視感
      const { ground, far, ink, dark } = this.tone;
      ctx.fillStyle = ground; ctx.fillRect(0, 0, W, floorTop);
      const floor = ctx.createLinearGradient(0, floorTop, 0, floorBottom); floor.addColorStop(0, far); floor.addColorStop(1, ground);
      ctx.fillStyle = floor; ctx.fillRect(0, floorTop, W, H - floorTop);
      ctx.strokeStyle = ink; ctx.globalAlpha = .07; ctx.lineWidth = 1;
      for (let i = 0; i <= 8; i++) { const y = floorTop + (floorBottom - floorTop) * (i / 8) ** 1.6; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      // 起訖兩道閘門
      ctx.fillStyle = ink; ctx.globalAlpha = .16;
      for (const x of [gateL, gateR]) ctx.fillRect(x - 2 * u, floorTop - 8 * u, 4 * u, floorBottom - floorTop + 8 * u);
      ctx.globalAlpha = 1;
      // 小人依深度由遠到近排序，近的畫在前面
      const list = s.walkers.map(w => ({ w, y: floorTop + (floorBottom - floorTop) * (.08 + .92 * w.lane) })).sort((p, q) => p.y - q.y);
      for (const { w, y } of list) {
        const depth = (y - floorTop) / (floorBottom - floorTop), h = (3.4 + 5.2 * depth) * u, x = gateL + (gateR - gateL) * w.t;
        const swing = Math.sin(time * 7 * (.7 + w.speed * 6) + w.phase), bob = Math.abs(swing) * h * .03;
        ctx.fillStyle = dark ? 'rgba(0,0,0,.35)' : 'rgba(0,0,0,.12)'; ctx.beginPath(); ctx.ellipse(x, y, h * .22, h * .06, 0, 0, 6.29); ctx.fill();
        ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.globalAlpha = w.tone * (.55 + .45 * depth); ctx.lineCap = 'round';
        const hip = y - h * .42 - bob, neck = y - h * .78 - bob;
        ctx.lineWidth = h * .15; ctx.beginPath(); ctx.moveTo(x, neck); ctx.lineTo(x, hip); ctx.stroke();
        ctx.lineWidth = h * .09;
        ctx.beginPath(); ctx.moveTo(x, hip); ctx.lineTo(x + swing * h * .16, y - bob * .4); ctx.moveTo(x, hip); ctx.lineTo(x - swing * h * .16, y - bob * .4); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, neck + h * .06); ctx.lineTo(x - swing * h * .12, neck + h * .26); ctx.moveTo(x, neck + h * .06); ctx.lineTo(x + swing * h * .12, neck + h * .26); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y - h * .9 - bob, h * .12, 0, 6.29); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }
}
