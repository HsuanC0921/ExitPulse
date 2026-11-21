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

export type BasemapStyleId = 'positron' | 'liberty' | 'nlsc';

export const BASEMAP_STYLES: Record<BasemapStyleId, {
  id: BasemapStyleId;
  label: string;
  url: string | null;
  sourceId: string;
  vector: boolean;
}> = {
  positron: { id: 'positron', label: '簡潔', url: STYLE, sourceId: 'openmaptiles', vector: true },
  liberty: { id: 'liberty', label: '詳圖', url: 'https://tiles.openfreemap.org/styles/liberty', sourceId: 'openmaptiles', vector: true },
  nlsc: { id: 'nlsc', label: '臺灣地圖', url: null, sourceId: 'nlsc-emap', vector: false },
};

export function isBasemapStyleId(value: string | null): value is BasemapStyleId {
  return value === 'positron' || value === 'liberty' || value === 'nlsc';
}

export const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

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
export const FLAT_FLOW_LAYERS = ['od-streams-casing', 'od-ribbons', 'od-streams', 'od-streams-dashed', 'od-comets-flow', 'od-comets-muted', 'od-particles', 'od-pulse', 'od-flow-labels'];
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

/** Positron 底圖幾乎全白，這組色票讓陸地、水域、公園、建物邊線與道路有足夠層次，長時間看也不刺眼。 */
export const LIGHT_MAP = {
  land: '#e8e4da',
  water: '#b7d0da',
  waterOutline: '#97b7c6',
  park: '#d3dfc8',
  building: '#dcd7cb',
  outline: '#ccc5b7',
  label: '#5e5a51',
  halo: '#f4f1ea',
  roadMajor: '#f7f4ec',
  roadMinor: '#efebe2',
} as const;

/** 與淺色同一組層次，燈關掉的版本：陸地最暗，水域與公園保留色相，幹道略亮於巷弄。 */
export const DARK_MAP = {
  land: '#111619',
  water: '#152633',
  waterOutline: '#20394c',
  park: '#17221e',
  building: '#1d252a',
  label: '#a2acb2',
  halo: '#0d1215',
  road: '#303b43',
  roadMajor: '#3a4852',
  roadMinor: '#232c33',
  outline: '#273239',
} as const;

export function roadNightColor(layerId: string): string {
  return /motorway|trunk|primary|highway|rail|bridge/i.test(layerId) ? DARK_MAP.roadMajor : DARK_MAP.roadMinor;
}

/** 3D 建築物依高度分級著色；詳圖模式拉開塔樓玻璃高光與低矮街廓對比。 */
export function buildingExtrusionColor(dark: boolean, detailed = false): ExpressionSpecification {
  if (detailed) {
    return dark
      ? ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, '#1b242b', 18, '#26333d', 45, '#334552', 95, '#425b6e', 180, '#56768f']
      : ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, '#d9cfc0', 18, '#e5ddd0', 45, '#efe9df', 95, '#dce6ee', 180, '#c9dceb'];
  }
  return dark
    ? ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, '#1a2228', 24, '#232e36', 65, '#2f3d47', 140, '#3f515e']
    : ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, '#d8d2c5', 24, '#e2ddd1', 65, '#ebe6dc', 140, '#f4f0e8'];
}

export function mapLightConfig(dark: boolean, detailed = false) {
  return {
    anchor: 'viewport' as const,
    color: dark ? '#9ab4cc' : '#fffbf2',
    intensity: detailed ? (dark ? 0.36 : 0.44) : (dark ? 0.28 : 0.34),
    position: (detailed
      ? (dark ? [1.25, 215, 38] : [1.4, 130, 28])
      : (dark ? [1.2, 220, 42] : [1.35, 135, 32])) as [number, number, number],
  };
}

/** 3D 俯視傾斜時的天際與霧氣漸層，避免遠處地平線生硬切白。 */
export function mapSkyConfig(dark: boolean) {
  return {
    'sky-color': dark ? '#0d151d' : '#c9d9e6',
    'sky-horizon-blend': 0.55,
    'horizon-color': dark ? '#1a2630' : '#ece7dc',
    'horizon-fog-blend': 0.7,
    'fog-color': dark ? '#141c22' : '#e8e4da',
    'fog-ground-blend': 0.45,
  };
}

export function nlscRasterPaint(dark: boolean) {
  return {
    'raster-brightness-max': dark ? 0.52 : 0.96,
    'raster-saturation': dark ? -0.42 : -0.12,
    'raster-contrast': dark ? 0.14 : 0.04,
    'raster-fade-duration': 200,
  };
}

/** 國土測繪中心臺灣通用電子地圖（WMTS 點陣圖磚），文字標籤繼續沿用 OpenFreeMap 字型檔。 */
export function nlscStyle(dark: boolean): StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      'nlsc-emap': {
        type: 'raster',
        tiles: ['https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 18,
        attribution: '© 內政部國土測繪中心',
      },
    },
    layers: [
      { id: 'nlsc-background', type: 'background', paint: { 'background-color': dark ? DARK_MAP.land : LIGHT_MAP.land } },
      { id: 'nlsc-emap', type: 'raster', source: 'nlsc-emap', paint: nlscRasterPaint(dark) },
    ],
  };
}

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
