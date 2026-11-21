// Fetch of the Taipei / New Taipei rapid-transit network from OpenStreetMap (ODbL) via Overpass.
// Writes apps/web/public/metro/{lines,stations}.geojson in the shape core/api.ts expects.
// Usage: node tools/fetch-metro-osm.mjs [--sync-dir=/srv/web/current/metro]
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const syncArg = process.argv.find((arg) => arg.startsWith('--sync-dir='));
const SYNC_DIR = (syncArg ? syncArg.slice('--sync-dir='.length) : process.env.EXITPULSE_METRO_SYNC_DIR || '').trim();
const BBOX = '24.67,121.28,25.30,122.01'; // S,W,N,E covering both cities
const query = `[out:json][timeout:120];
relation["type"="route"]["route"~"^(subway|light_rail|monorail)$"](${BBOX});
out geom;
node["railway"="station"]["station"~"^(subway|light_rail|monorail)$"](${BBOX});
out;`;

const res = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'exitpulse-metro-build/1.0' },
  body: 'data=' + encodeURIComponent(query),
});
if (!res.ok) throw new Error(`overpass ${res.status}`);
const { elements } = await res.json();

// Each line usually has one relation per direction; keep one per ref and union their track ways.
// OSM line names and colours are inconsistent (direction suffixes, 'orange'); the network is small and fixed, so name it here.
const OFFICIAL = {
  BL: ['板南線', 'Bannan Line', '#0070BD'], BR: ['文湖線', 'Wenhu Line', '#C48C31'], G: ['松山新店線', 'Songshan–Xindian Line', '#008659'],
  R: ['淡水信義線', 'Tamsui–Xinyi Line', '#E3002C'], O: ['中和新蘆線', 'Zhonghe–Xinlu Line', '#F8B61C'], Y: ['環狀線', 'Circular Line', '#FFDB00'],
  A: ['機場捷運', 'Airport MRT', '#8246AF'], V: ['淡海輕軌', 'Danhai LRT', '#E2BCA5'], K: ['安坑輕軌', 'Ankeng LRT', '#C3B091'], LB: ['三鶯線', 'Sanying Line', '#6DB7D0'],
};
const lines = new Map();
for (const r of elements.filter((e) => e.type === 'relation')) {
  const t = r.tags;
  const id = /新北投/.test(t.name + (t.ref ?? '')) ? 'R' : t.ref ?? t.name; // the Xinbeitou branch is part of R
  const ways = r.members.filter((m) => m.type === 'way' && !m.role && m.geometry).map((m) => m.geometry.map((p) => [+p.lon.toFixed(6), +p.lat.toFixed(6)]));
  const stops = r.members.filter((m) => m.type === 'node' && m.role.startsWith('stop')).map((m) => [m.lon, m.lat]);
  const line = lines.get(id) ?? {
    lineId: id,
    operator: t.operator ?? '',
    name: OFFICIAL[id]?.[0] ?? t.name,
    nameEn: OFFICIAL[id]?.[1] ?? '',
    color: OFFICIAL[id]?.[2] ?? t.colour,
    ways: new Map(),
    stops: [],
  };
  for (const w of ways) line.ways.set(JSON.stringify([w[0], w.at(-1)].sort()), w);
  line.stops.push(...stops);
  lines.set(id, line);
}

const near = (a, b) => Math.hypot((a[0] - b[0]) * 101_000, (a[1] - b[1]) * 111_000) < 250;
const stations = elements
  .filter((e) => e.type === 'node' && (e.tags['name:zh'] ?? e.tags.name))
  .map((n) => {
    const at = [n.lon, n.lat];
    const on = [...lines.values()].filter((l) => l.stops.some((s) => near(s, at)));
    return { name: (n.tags['name:zh'] ?? n.tags.name).replace(/(?<!車)站$/, ''), at, on };
  })
  .filter((s) => s.on.length)
  // Some stations are mapped as one node per line (十四張); merge them by name.
  .reduce((acc, s) => {
    const seen = acc.find((x) => x.name === s.name);
    if (seen) seen.on = [...new Set([...seen.on, ...s.on])];
    else acc.push(s);
    return acc;
  }, []);

const fc = (features) => ({ type: 'FeatureCollection', attribution: '© OpenStreetMap contributors (ODbL)', features });
const linesGeoJson = JSON.stringify(fc([...lines.values()].map((l) => ({
  type: 'Feature',
  properties: { operator: l.operator, lineId: l.lineId, name: l.name, nameEn: l.nameEn, color: l.color },
  geometry: { type: 'MultiLineString', coordinates: [...l.ways.values()] },
}))));
const stationsGeoJson = JSON.stringify(fc(stations.map((s) => ({
  type: 'Feature',
  properties: { name: s.name, lines: s.on.map((l) => l.lineId).join(','), colors: s.on.map((l) => l.color).join(','), transfer: s.on.length > 1 },
  geometry: { type: 'Point', coordinates: s.at },
}))));

if (lines.size < 6 || stations.length < 100) {
  throw new Error(`Aborted: suspicious Overpass output (${lines.size} lines, ${stations.length} stations)`);
}

const outDir = 'apps/web/public/metro';
const linesPath = path.join(outDir, 'lines.geojson');
const stationsPath = path.join(outDir, 'stations.geojson');
if (existsSync(stationsPath)) {
  try {
    const existing = JSON.parse(await readFile(stationsPath, 'utf8'));
    const existingCount = Array.isArray(existing?.features) ? existing.features.length : 0;
    if (existingCount > 0 && stations.length < Math.floor(existingCount * 0.9)) {
      throw new Error(`Aborted: station count dropped (${existingCount} -> ${stations.length})`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Aborted:')) throw err;
  }
}

async function writeAtomic(filePath, content, backup) {
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, content, 'utf8');
  if (backup && existsSync(filePath)) {
    await copyFile(filePath, `${filePath}.bak`);
  }
  await rename(tmpPath, filePath);
}

await mkdir(outDir, { recursive: true });
await writeAtomic(linesPath, linesGeoJson, true);
await writeAtomic(stationsPath, stationsGeoJson, true);

if (SYNC_DIR) {
  await mkdir(SYNC_DIR, { recursive: true });
  await writeAtomic(path.join(SYNC_DIR, 'lines.geojson'), linesGeoJson, false);
  await writeAtomic(path.join(SYNC_DIR, 'stations.geojson'), stationsGeoJson, false);
  console.log(`Synced metro geojson to ${SYNC_DIR}`);
}

console.log(`${lines.size} lines, ${stations.length} stations`);
for (const l of lines.values()) console.log(l.lineId, l.name, l.color, l.ways.size, 'ways');
