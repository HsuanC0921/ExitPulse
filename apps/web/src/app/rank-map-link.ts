import type { GeoJSONSource, Map } from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';

const SOURCE = 'rank-highlight';
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
    paint: { 'circle-radius': 18, 'circle-color': ['get', 'ink'], 'circle-opacity': .12,
      'circle-stroke-color': ['get', 'ink'], 'circle-stroke-width': ['case', ['get', 'selected'], 3, 2] },
  }, 'od-count-labels');
}

export function drawRankLink(map: Map | undefined, station: string | null, point: Coordinate | undefined,
  ink: string, selected: boolean, path?: Coordinate[], dashed = false) {
  const source = map?.getSource<GeoJSONSource>(SOURCE);
  if (!source) return;
  if (!point || !station) { source.setData(empty); return; }
  const features: Feature[] = [{ type: 'Feature', properties: { station, ink, selected }, geometry: { type: 'Point', coordinates: point } }];
  if (path) features.unshift({ type: 'Feature', properties: { station, ink, dashed }, geometry: { type: 'LineString', coordinates: path } });
  source.setData({ type: 'FeatureCollection', features });
}
