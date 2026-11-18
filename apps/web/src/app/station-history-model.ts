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
  kind: 'opening' | 'transfer' | 'entrance';
};

export function buildStationHistory(
  opening: { date: string; source: string } | null | undefined,
  lines: StationHistoryLine[] | null | undefined,
  entrances: StationHistoryExit[] | null | undefined,
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

  return events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'zh-Hant'));
}
