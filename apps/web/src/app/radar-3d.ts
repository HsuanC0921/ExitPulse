import { MercatorCoordinate, type CustomRenderMethodInput, type Map as MapLibreMap } from 'maplibre-gl';
import { arrowCount, lineWidth } from './radar-model';

const PROJECTION_LAYER_ID = 'elevated-flow-projection';
type Point = [number, number];
type Stream = { path: Point[]; daily: number; key: string; color: string; dashed: boolean; emphasis?: number };
const DEGREE_METERS = 111320;

export function metersPerPixel(latitude: number, zoom: number): number {
  return 40075017 * Math.cos(latitude * Math.PI / 180) / (512 * 2 ** zoom);
}

export function columnTick(peak: number): number {
  const target = Math.max(1, peak / 4);
  const order = 10 ** Math.floor(Math.log10(target));
  return ([1, 2, 2.5, 5, 10].find(tick => tick * order >= target) ?? 10) * order;
}

/** Spike map: a thin triangle per station, its screen height proportional to the value at every zoom. */
export type Spike = { at: Point; height: number; color: string };
const SPIKE_HALF_WIDTH = 4;
export const SPIKE_MAX_PX = 160;

/** Projects the elevated curve using the same Mercator camera as the map. */
export class ElevatedFlow {
  private readonly canvas = document.createElement('canvas');
  private readonly ink = this.canvas.getContext('2d')!;
  private spikes: Spike[] = [];
  private streams: { key: string; color: string; width: number; dashed: boolean; emphasis: number; arrows: number; points: MercatorCoordinate[] }[] = [];
  private drawn: { key: string; points: (Point | null)[]; width: number }[] = [];
  private dark = false;
  private elapsed = 0;

  constructor(private readonly map: MapLibreMap) {
    this.canvas.className = 'elevated-flow';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.hidden = true;
    map.getCanvas().after(this.canvas);
  }

  installLayer() {
    if (this.map.getLayer(PROJECTION_LAYER_ID)) return;
    this.map.addLayer({
      id: PROJECTION_LAYER_ID,
      type: 'custom',
      render: (_, { defaultProjectionData }) => this.draw(defaultProjectionData.mainMatrix),
    });
  }

  update(streams: Stream[], dark: boolean) {
    this.dark = dark;
    const scale = metersPerPixel(25.05, this.map.getZoom());
    this.streams = streams.map(({ key, color, daily, dashed, emphasis, path }) => {
      const first = path[0], last = path[path.length - 1];
      const distance = DEGREE_METERS * Math.hypot((last[0] - first[0]) * Math.cos(first[1] * Math.PI / 180), last[1] - first[1]);
      const lift = Math.min(distance * .30, 115 * scale);
      return { key, color, width: Math.max(1.7, lineWidth(daily) * .57), dashed, emphasis: emphasis ?? 1,
        arrows: Math.min(6, arrowCount(daily)),
        points: path.map((point, i) => MercatorCoordinate.fromLngLat(point, lift * Math.sin(Math.PI * i / (path.length - 1)))) };
    }).sort((a, b) => a.emphasis - b.emphasis || a.width - b.width);
    this.map.triggerRepaint();
  }

  setSpikes(spikes: Spike[]) {
    this.spikes = spikes;
    this.map.triggerRepaint();
  }

  show(visible: boolean) {
    this.canvas.hidden = !visible;
    if (!visible) this.drawn = [];
  }

  advance(elapsed: number) {
    if (elapsed === this.elapsed) return;
    this.elapsed = elapsed;
    this.map.triggerRepaint();
  }

  hit(point: { x: number; y: number }): string | undefined {
    for (let stream = this.drawn.length - 1; stream >= 0; stream--) {
      const { key, points, width } = this.drawn[stream];
      for (let i = 1; i < points.length; i++) {
        const from = points[i - 1], to = points[i];
        if (!from || !to) continue;
        const [x, y] = from, [nextX, nextY] = to;
        const dx = nextX - x, dy = nextY - y;
        const t = Math.max(0, Math.min(1, ((point.x - x) * dx + (point.y - y) * dy) / (dx * dx + dy * dy || 1)));
        if (Math.hypot(point.x - x - dx * t, point.y - y - dy * t) <= Math.max(6, width / 2)) return key;
      }
    }
    return undefined;
  }

  private draw(m: CustomRenderMethodInput['defaultProjectionData']['mainMatrix']) {
    if (this.canvas.hidden) return;
    const target = this.map.getCanvas(), width = target.clientWidth, height = target.clientHeight;
    const pixelRatio = target.width / width;
    if (!pixelRatio || !height) return;
    if (this.canvas.width !== target.width || this.canvas.height !== target.height) {
      this.canvas.width = target.width;
      this.canvas.height = target.height;
    }
    const ink = this.ink;
    ink.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ink.clearRect(0, 0, width, height);
    ink.lineCap = 'round';
    ink.lineJoin = 'round';
    const project = ({ x, y, z }: MercatorCoordinate): Point | null => {
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (w <= 1e-7) return null;
      return [
        width / 2 * (1 + (m[0] * x + m[4] * y + m[8] * z + m[12]) / w),
        height / 2 * (1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w),
      ];
    };
    this.drawn = this.streams.flatMap((stream, index) => {
      const points = stream.points.map(project);
      ink.globalAlpha = .3 + .62 * stream.emphasis;
      ink.strokeStyle = stream.color;
      ink.lineWidth = stream.width;
      ink.setLineDash(stream.dashed ? [6, 5] : []);
      ink.beginPath();
      points.forEach((point, i) => {
        if (!point) return;
        const [x, y] = point;
        if (points[i - 1]) ink.lineTo(x, y);
        else ink.moveTo(x, y);
      });
      ink.stroke();
      ink.setLineDash([]);
      for (let i = 0; i < stream.arrows; i++) {
        const phase = (this.elapsed / 3800 + (i + .5) / stream.arrows + index * .13) % 1;
        const position = (.13 + .74 * phase) * (points.length - 1);
        const step = Math.floor(position), t = position - step;
        const from = points[step], to = points[step + 1];
        if (!from || !to) continue;
        const [x, y] = from, [nextX, nextY] = to;
        const size = Math.min(6, 2.5 + stream.width * .25);
        ink.save();
        ink.translate(x + (nextX - x) * t, y + (nextY - y) * t);
        ink.rotate(Math.atan2(nextY - y, nextX - x));
        ink.beginPath();
        ink.moveTo(-size * .7, -size);
        ink.lineTo(size * .7, 0);
        ink.lineTo(-size * .7, size);
        ink.lineWidth = 3.8;
        ink.strokeStyle = stream.color;
        ink.stroke();
        ink.lineWidth = 1.9;
        ink.strokeStyle = this.dark ? '#111619' : '#f4f1ea';
        ink.stroke();
        ink.restore();
      }
      return [{ key: stream.key, points, width: stream.width }];
    });
    ink.globalAlpha = 1;
    const meters = metersPerPixel(25.05, this.map.getZoom());
    const spikes = this.spikes.flatMap(({ at, height: px, color }) => {
      const base = project(MercatorCoordinate.fromLngLat(at, 0)), tip = project(MercatorCoordinate.fromLngLat(at, px * meters));
      return base && tip ? [{ base, tip, color }] : [];
    }).sort((a, b) => a.base[1] - b.base[1]);
    for (const { base: [x, y], tip: [tipX, tipY], color } of spikes) {
      ink.beginPath();
      ink.moveTo(x - SPIKE_HALF_WIDTH, y);
      ink.lineTo(tipX, tipY);
      ink.lineTo(x + SPIKE_HALF_WIDTH, y);
      ink.fillStyle = color;
      ink.globalAlpha = .22;
      ink.fill();
      ink.globalAlpha = 1;
      ink.lineWidth = 1.3;
      ink.strokeStyle = color;
      ink.stroke();
    }
  }
}

