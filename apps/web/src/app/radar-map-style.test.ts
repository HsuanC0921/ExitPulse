import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASEMAP_STYLES,
  FLAT_FLOW_LAYERS,
  arcGeometry,
  buildingExtrusionColor,
  buildingLodFilter,
  dotColor,
  dotFill,
  isBasemapStyleId,
  mapLightConfig,
  networkDotColor,
  nlscRasterPaint,
  nlscStyle,
  roadNightColor,
  shadedPaint,
  type MapPaint,
  type Point,
} from './radar-map-style.ts';

test('arcGeometry generates 49 points connecting a to b with opposite directional bend', () => {
  const a: Point = [121.5, 25.04];
  const b: Point = [121.56, 25.04];
  const forward = arcGeometry(a, b, -0.14);
  const reverse = arcGeometry(b, a, -0.14);

  assert.equal(forward.length, 49);
  assert.deepEqual(forward[0], a);
  assert.deepEqual(forward[48], b);
  assert.ok(forward[24][1] < a[1], 'eastbound with negative bend curves southward');
  assert.ok(reverse[24][1] > a[1], 'westbound with same bend curves opposite side');
});

test('shadedPaint handles endpoints and interpolates color ramps', () => {
  const simple: MapPaint = { layer: 'background', property: 'background-color', day: '#e8e4da', night: '#111619' };
  assert.equal(shadedPaint(simple, 0), '#e8e4da');
  assert.equal(shadedPaint(simple, 1), '#111619');
  assert.deepEqual(shadedPaint(simple, 0.5), ['interpolate', ['linear'], 0.5, 0, '#e8e4da', 1, '#111619']);

  const zoomRamp: MapPaint = {
    layer: 'road',
    property: 'line-color',
    day: ['interpolate', ['linear'], ['zoom'], 10, '#ffffff', 16, '#eeeeee'],
    night: '#303b43',
  };
  const mid = shadedPaint(zoomRamp, 0.4) as unknown[];
  assert.equal(mid[0], 'interpolate');
  assert.equal(mid[3], 10);
  assert.deepEqual(mid[4], ['interpolate', ['linear'], 0.4, 0, '#ffffff', 1, '#303b43']);
  assert.equal(mid[5], 16);
  assert.deepEqual(mid[6], ['interpolate', ['linear'], 0.4, 0, '#eeeeee', 1, '#303b43']);
});

test('dot and network circle paint helpers produce deterministic MapLibre expressions', () => {
  const lightDot = dotColor(false) as unknown[];
  const darkDot = dotColor(true) as unknown[];
  assert.equal(lightDot[2], '#23282d');
  assert.equal(darkDot[2], '#f1f4f6');

  const netDark = networkDotColor(true) as unknown[];
  assert.equal(netDark[0], 'match');
  assert.equal(netDark[3], '#ff8c42');
  assert.equal(netDark[5], '#4db8ff');

  const fillHalf = dotFill(0.5) as unknown[];
  assert.equal(fillHalf[0], 'case');
  assert.ok(Math.abs((fillHalf[2] as number) - 0.07) < 1e-9);
  assert.ok(Math.abs((fillHalf[3] as number) - 0.03) < 1e-9);
});

test('basemap cartography helpers differentiate road tiers, building height ramps, and 3D lighting', () => {
  assert.ok(FLAT_FLOW_LAYERS.includes('od-streams-casing'));
  assert.equal(roadNightColor('highway_motorway_inner'), '#3a4852');
  assert.equal(roadNightColor('road_minor'), '#232c33');

  const lightBuildings = buildingExtrusionColor(false) as unknown[];
  const darkBuildings = buildingExtrusionColor(true) as unknown[];
  assert.equal(lightBuildings[0], 'interpolate');
  assert.equal(lightBuildings[10], '#f4f0e8');
  assert.equal(darkBuildings[10], '#3f515e');

  const lightCfg = mapLightConfig(false);
  const darkCfg = mapLightConfig(true);
  assert.equal(lightCfg.anchor, 'viewport');
  assert.ok(lightCfg.intensity > darkCfg.intensity);
});

test('multi-basemap switcher helpers validate IDs and build NLSC raster style', () => {
  assert.equal(isBasemapStyleId('positron'), true);
  assert.equal(isBasemapStyleId('liberty'), true);
  assert.equal(isBasemapStyleId('nlsc'), true);
  assert.equal(isBasemapStyleId('unknown'), false);
  assert.equal(isBasemapStyleId(null), false);

  assert.equal(BASEMAP_STYLES.liberty.sourceId, 'openmaptiles');
  assert.equal(BASEMAP_STYLES.liberty.vector, true);
  assert.equal(BASEMAP_STYLES.nlsc.sourceId, 'nlsc-emap');
  assert.equal(BASEMAP_STYLES.nlsc.vector, false);
  assert.equal(BASEMAP_STYLES.nlsc.url, null);

  assert.ok(nlscRasterPaint(true)['raster-brightness-max'] < nlscRasterPaint(false)['raster-brightness-max']);
  const styleDark = nlscStyle(true);
  assert.equal(styleDark.version, 8);
  assert.equal(styleDark.layers[1]?.id, 'nlsc-emap');

  const detailedLight = buildingExtrusionColor(false, true) as unknown[];
  assert.equal(detailedLight[0], 'interpolate');
  assert.equal(detailedLight[detailedLight.length - 1], '#f8f6f0');
  const lod = buildingLodFilter(true) as unknown[];
  assert.equal(lod[0], 'all');
  assert.deepEqual(lod[1], ['!', ['has', 'hide_3d']]);
});
