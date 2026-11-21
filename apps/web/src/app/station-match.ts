// 車站輸入正規化與模糊／站碼解析共用工具。

export function normalizeStationKey(value: string): string {
  return value.trim().normalize('NFKC').replaceAll('臺', '台').toLowerCase();
}

export interface StationMatchResult {
  match: string | null;
  candidates: string[];
}

/** 解析使用者輸入的站名或站代號（例如「台北車站」、「臺北車」、「BL12」）。 */
export function resolveStationInput(
  raw: string,
  stations: readonly string[],
  stationCodes?: Record<string, Record<string, string>>,
): StationMatchResult {
  const key = normalizeStationKey(raw);
  if (!key) return { match: null, candidates: [] };

  const uniqueStations: string[] = [];
  const seen = new Set<string>();
  const byNormName = new Map<string, string>();
  for (const station of stations) {
    if (seen.has(station)) continue;
    seen.add(station);
    uniqueStations.push(station);
    const norm = normalizeStationKey(station);
    if (!byNormName.has(norm)) byNormName.set(norm, station);
  }

  const exactName = byNormName.get(key);
  if (exactName) return { match: exactName, candidates: [exactName] };

  const codesOfStation = new Map<string, string[]>();
  if (stationCodes) {
    for (const entries of Object.values(stationCodes)) {
      for (const [stationName, code] of Object.entries(entries)) {
        const target = seen.has(stationName) ? stationName : byNormName.get(normalizeStationKey(stationName));
        if (!target) continue;
        const normCode = normalizeStationKey(code);
        if (!normCode) continue;
        const list = codesOfStation.get(target);
        if (list) list.push(normCode);
        else codesOfStation.set(target, [normCode]);
      }
    }
  }

  const exactCodes: string[] = [];
  for (const station of uniqueStations) {
    const codes = codesOfStation.get(station);
    if (codes?.some(code => code === key)) exactCodes.push(station);
  }
  if (exactCodes.length === 1) return { match: exactCodes[0], candidates: exactCodes };
  if (exactCodes.length > 1) return { match: null, candidates: exactCodes };

  const prefix: string[] = [];
  const contains: string[] = [];
  for (const station of uniqueStations) {
    const normName = normalizeStationKey(station);
    const codes = codesOfStation.get(station) ?? [];
    if (normName.startsWith(key) || codes.some(code => code.startsWith(key))) {
      prefix.push(station);
    } else if (normName.includes(key) || codes.some(code => code.includes(key))) {
      contains.push(station);
    }
  }

  const candidates = [...prefix, ...contains];
  return {
    match: candidates.length === 1 ? candidates[0] : null,
    candidates,
  };
}
