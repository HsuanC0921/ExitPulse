import type { GeoJSONSource, Map } from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';

const SOURCE = 'rank-highlight';
/** 圓圈半徑（像素）隨縮放級別放大，讓圈圈跟底圖一起變大，但不照幾何比例放大（每級 2 倍會在近景大到蓋住街道）。 */
const ZOOM_SCALE: [number, number][] = [[9, .6], [11, 1], [13, 1.8], [16, 3.2]];
export function zoomScaled(value: unknown[] | number, pad = 0, divisor = 1) {
  const expr = (k: number) => ['/', ['+', ['*', value, k], pad], divisor];
  return ['interpolate', ['linear'], ['zoom'], ...ZOOM_SCALE.flatMap(([zoom, k]) => [zoom, expr(k)])] as never;
}
type Coordinate = [number, number];
const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };

export function installRankLink(map: Map) {
  map.addSource(SOURCE, { type: 'geojson', data: empty });
  for (const dashed of [false, true]) {
    map.addLayer({
      id: dashed ? `${SOURCE}-dashed` : `${SOURCE}-line`, type: 'line', source: SOURCE,
      filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'dashed'], dashed]],
      layout: { 'line-cap': dashed ? 'butt' : 'round' },
      paint: { 'line-color': ['get', 'ink'], 'line-width': 4, 'line-opacity': .92,
        ...(dashed ? { 'line-dasharray': [1.5, 1.2] } : {}) },
    }, 'od-count-labels');
  }
  map.addLayer({
    id: `${SOURCE}-station`, type: 'circle', source: SOURCE, filter: ['==', '$type', 'Point'],
    paint: { 'circle-radius': zoomScaled(['coalesce', ['get', 'radius'], 12], 6), 'circle-color': ['get', 'ink'], 'circle-opacity': .12,
      'circle-stroke-color': ['get', 'ink'], 'circle-stroke-width': ['case', ['get', 'selected'], 3, 2] },
  }, 'od-count-labels');
}

export function drawRankLink(map: Map | undefined, station: string | null, point: Coordinate | undefined,
  ink: string, selected: boolean, path?: Coordinate[], dashed = false, radius?: number) {
  const source = map?.getSource<GeoJSONSource>(SOURCE);
  if (!source) return;
  if (!point || !station) { source.setData(empty); return; }
  const features: Feature[] = [{ type: 'Feature', properties: { station, ink, selected, radius }, geometry: { type: 'Point', coordinates: point } }];
  if (path) features.unshift({ type: 'Feature', properties: { station, ink, dashed }, geometry: { type: 'LineString', coordinates: path } });
  source.setData({ type: 'FeatureCollection', features });
}
