// 車站沿革的資料模型：把通車日、路線與出口合併成依日期排序的事件。
export type StationHistoryLine = {
  code: string;
  name: string;
  stationCode: string;
  opened: string;
  source?: string;
};

export type StationHistoryExit = {
  name: string;
  code?: string;
  history?: {
    opened?: string;
    closed?: string;
    reopened?: string;
    source?: string;
    closureSource?: string;
  } | null;
};

export type StationHistoryEvent = {
  date: string;
  title: string;
  detail: string;
  source: string;
  kind: 'opening' | 'transfer' | 'entrance' | 'milestone';
};

const NETWORK_MILESTONES: readonly Omit<StationHistoryEvent, 'kind'>[] = [
  { date: '2021-05-19', title: '全國三級警戒防疫期間', detail: '疫情警戒啟動，全線人次驟降', source: 'https://www.cdc.gov.tw/' },
  { date: '2023-07-01', title: 'TPASS 基北北桃 1200 月票上路', detail: '定期票開通帶動跨區通勤回流', source: 'https://www.taipei.gov.tw/' },
];

const STATION_MILESTONES: Record<string, readonly Omit<StationHistoryEvent, 'kind'>[]> = {
  國父紀念館: [
    { date: '2023-12-02', title: '臺北大巨蛋正式啟用', detail: '賽事與演唱會帶動假日人潮倍增', source: 'https://www.taipei.gov.tw/' },
  ],
  南港: [
    { date: '2025-03-20', title: '南港 LaLaport 開幕', detail: '三鐵共構商圈與園區人流擴大', source: 'https://www.taipei.gov.tw/' },
  ],
};

/** 計算車站通車年份與營運年資（以最近資料年份為基準，若無則用當下年度）。 */
export function openingTenure(openingDate: string | null | undefined, refYear = 2026): { year: number; years: number } | null {
  if (!openingDate || openingDate.length < 4) return null;
  const year = Number(openingDate.slice(0, 4));
  if (!Number.isFinite(year) || year < 1990) return null;
  return { year, years: Math.max(1, refYear - year) };
}

export function buildStationHistory(
  opening: { date: string; source: string } | null | undefined,
  lines: StationHistoryLine[] | null | undefined,
  entrances: StationHistoryExit[] | null | undefined,
  stationName?: string,
): StationHistoryEvent[] {
  const events: StationHistoryEvent[] = [];
  if (opening?.date && opening.source) {
    events.push({
      date: opening.date,
      title: '車站通車',
      detail: '正式營運',
      source: opening.source,
      kind: 'opening',
    });
  }

  for (const line of lines ?? []) {
    if (!line.opened || !line.source || line.opened === opening?.date) continue;
    events.push({
      date: line.opened,
      title: `${line.name}納入營運`,
      detail: `${line.stationCode} · 轉乘服務開始`,
      source: line.source,
      kind: 'transfer',
    });
  }

  for (const entrance of entrances ?? []) {
    const history = entrance.history;
    if (!history) continue;
    const code = entrance.code ?? entrance.name;
    if (history.opened && history.source) {
      events.push({ date: history.opened, title: `${code} 號出口啟用`, detail: entrance.name, source: history.source, kind: 'entrance' });
    }
    if (history.closed && (history.closureSource || history.source)) {
      events.push({ date: history.closed, title: `${code} 號出口封閉`, detail: entrance.name, source: history.closureSource || history.source!, kind: 'entrance' });
    }
    if (history.reopened && history.source) {
      events.push({ date: history.reopened, title: `${code} 號出口重開`, detail: entrance.name, source: history.source, kind: 'entrance' });
    }
  }

  if (stationName) {
    const openedDate = opening?.date ?? '';
    for (const m of [...NETWORK_MILESTONES, ...(STATION_MILESTONES[stationName] ?? [])]) {
      if (!openedDate || m.date > openedDate) {
        events.push({ ...m, kind: 'milestone' });
      }
    }
  }

  return events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'zh-Hant'));
}
