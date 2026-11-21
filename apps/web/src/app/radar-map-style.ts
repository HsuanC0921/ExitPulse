import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl';
import type { AllPaintProperties } from '@maplibre/maplibre-gl-style-spec';
import type { FeatureCollection } from 'geojson';

export type Point = [number, number];

/** 人流用中性色描邊，避免和路線識別色混在一起。 */
/** 流線是畫面的主角，用一個不與任何路線色重疊的靛紫色，不再是黑白。基準期維持中性灰，當成對照。 */
export const FLOW = { light: '#292929', dark: '#ededeb' } as const;

export const LINES: Record<string, string> = {
  BL: '板南線',
  BR: '文湖線',
  G: '松山新店線',
  R: '淡水信義線',
  O: '中和新蘆線',
  Y: '環狀線',
};

/** 明暗共用同一張底圖，深色只是把燈調暗，樣式不換。 */
export const STYLE = 'https://tiles.openfreemap.org/styles/positron';

export const LOCAL_MAP: StyleSpecification = {
  version: 8,
  sources: {},
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  layers: [{ id: 'local-background', type: 'background', paint: { 'background-color': '#e8e4da' } }],
};

export const NB = '\u00a0';

export const BANDS: Record<string, string> = {
  '7-10': `早上${NB}7${NB}到${NB}10${NB}點`,
  '10-16': `白天${NB}10${NB}到${NB}16${NB}點`,
  '16-19': `傍晚${NB}16${NB}到${NB}19${NB}點`,
  '19-24': `晚上${NB}19${NB}點以後`,
};

export const TYPES = {
  all: '全部變化',
  increase: '比例上升',
  decrease: '比例下降',
  reversal: '流向對調',
} as const;

/** 每個點通過整條線的時間相同，所以每秒經過某處的點數正比於每日人次。 */
export const TRAVERSE_MS = 7000;
export const OVERVIEW_PAIRS = 30;
export const PAGE = 30;
export const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
export const FLAT_FLOW_LAYERS = ['od-ribbons', 'od-streams', 'od-streams-dashed', 'od-comets-flow', 'od-comets-muted', 'od-particles', 'od-pulse', 'od-flow-labels'];
export const TOWER_PITCH = 66;
export const PHONE_TOWER_PITCH = 50;
export const WEBGL_RESTORE_TIMEOUT = 3000;
export const LOW_PITCH = 82;
export const STREET_ZOOM = 16.4;
export const PHONE_STREET_PITCH = 76;
export const PHONE_STREET_ZOOM = 15.8;
export const MIN_TOWER_PITCH = 20;

/** 全線圓圈底色：淺底深藍、深底亮青，兩種底圖上都跟灰色路網分得開。圖層資料裡的灰色只是「未選取」的記號。 */
export const DOT = { light: '#23282d', dark: '#f1f4f6' } as const;
export const dotColor = (dark: boolean) => ['case', ['==', ['get', 'color'], '#6f7b85'], dark ? DOT.dark : DOT.light, ['get', 'color']] as never;
export const networkDotColor = (dark: boolean) => ['match', ['get', 'tone'], 'in', dark ? '#ff8c42' : '#d95f02', 'out', dark ? '#4db8ff' : '#1f78b4', dotColor(dark)] as never;

/** 圓圈透明度 k（1 為預設，越小越淡），外環、淡填色與內圓一起縮放 */
export const dotFill = (k: number) => ['case', ['==', ['get', 'inner'], 0], .14 * k, .06 * k] as never;

export const NIGHT_STATION = { regular: '#a6b7c0', ranked: '#e7eef1', rim: '#35454e', rankInk: '#15232b' } as const;

/** Positron 底圖幾乎全白，這組色票讓陸地、水域、公園與文字有足夠層次，長時間看也不刺眼。 */
export const LIGHT_MAP = { land: '#e8e4da', water: '#b7d0da', park: '#d3dfc8', building: '#dcd7cb', label: '#5e5a51', halo: '#f4f1ea' } as const;

/** 與淺色同一組層次，燈關掉的版本：陸地最暗，水域與公園保留色相，道路略亮於陸地。 */
export const DARK_MAP = { land: '#111619', water: '#152633', park: '#17221e', building: '#1d252a', label: '#a2acb2', halo: '#0d1215', road: '#303b43', outline: '#252e34' } as const;

export type MapColorProperty = 'background-color' | 'fill-color' | 'fill-outline-color' | 'line-color' | 'text-color' | 'text-halo-color';
export type MapColor = AllPaintProperties[MapColorProperty];
export type MapPaint = { layer: string; property: MapColorProperty; day: MapColor; night: string };

export function shadedPaint({ day, night }: MapPaint, shade: number): MapColor {
  if (shade === 0) return day;
  if (shade === 1) return night;
  const mix = (color: string): ExpressionSpecification => ['interpolate', ['linear'], shade, 0, color, 1, night];
  if (typeof day === 'string') return mix(day);
  // 逐個縮放級距上色，保留 Positron 隨縮放變化的道路顏色
  if (Array.isArray(day) && day[0] === 'interpolate' && Array.isArray(day[2]) && day[2][0] === 'zoom') {
    return day.map((value, i) => i >= 4 && i % 2 === 0 && typeof value === 'string'
      ? mix(value) : value) as ExpressionSpecification;
  }
  return shade >= .5 ? night : day;
}

export const stored = (key: string): string | null => {
  try { return localStorage.getItem(key); } catch { return null; }
};

export const store = (key: string, value: string): void => {
  try { localStorage.setItem(key, value); } catch { /* private mode: the choice lasts this visit only */ }
};

/** 從 a 到 b 的弧線，彎向由行進方向決定，所以 A→B 與 B→A 會分開。 */
export function arcGeometry(a: Point, b: Point, bend: number): Point[] {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  return Array.from({ length: 49 }, (_, i) => {
    const t = i / 48, lift = bend * Math.sin(Math.PI * t);
    return [a[0] + dx * t - dy * lift, a[1] + dy * t + dx * lift] as Point;
  });
}

/** 依各線顏色等分成色環的 DOM 元素 */
export function lineRingElement(colors: string[]): HTMLDivElement {
  const element = document.createElement('div');
  element.className = 'focus-ring';
  element.setAttribute('aria-hidden', 'true');
  const step = 360 / colors.length;
  element.style.background = `conic-gradient(${colors.map((c, i) => `${c} ${i * step}deg ${(i + 1) * step}deg`).join(', ')})`;
  return element;
}
