import { formatDailyTrips, type Result } from './radar-model';

export interface CardDataset {
  baseline: string;
  current: string;
  days: number[];
  commonStations: number;
}

export interface CardStory {
  headline: string;
  when: string;
}

export interface StationCardParams {
  station: string;
  periodLabel: string;
  hoursText: string;
  direction: 'outbound' | 'inbound';
  dailyEntries: number | null;
  dailyExits: number | null;
  compareLabel?: string | null;
  compareEntries?: number | null;
  hourlyEntries: (number | null)[];
  topRelations: Array<{ station: string; daily: number | null; color?: string }>;
  badges: Array<{ code: string; line: string; color: string }>;
  lineColor?: string;
}

export interface NetworkCardParams {
  metric: 'entries' | 'net';
  periodLabel: string;
  hoursText: string;
  totalEntries: number;
  compareLabel?: string | null;
  compareTotal?: number | null;
  stationCount: number;
  topStations: Array<{ station: string; value: number | null; color?: string }>;
}

const CARD_W = 1200;
const CARD_H = 630;
const CARD_COLORS = { ink: '#1d2125', muted: '#5a6066', paper: '#f6f4ef', surface: '#ebe7de', border: '#ded8cc' };
const DARK_INK_LINES = new Set(['BR', 'O', 'Y']);

async function prepareCardCanvas(preloadChars: string): Promise<{ canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; font: string } | { error: string }> {
  const font = getComputedStyle(document.body).getPropertyValue('--ui-font').trim();
  await Promise.allSettled([
    document.fonts.load(`800 40px ${font}`, `ExitPulse 捷運旅次變化雷達 0123456789,.−+% ${preloadChars}`),
    document.fonts.load(`700 40px ${font}`, preloadChars),
    document.fonts.load(`400 40px ${font}`, '資料來源：臺北市資料大平臺 臺北捷運每日分時各站 OD 流量統計'),
  ]);
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W * scale;
  canvas.height = CARD_H * scale;
  const g = canvas.getContext('2d');
  if (!g) return { error: '這個瀏覽器無法產生圖片' };
  g.scale(scale, scale);

  g.fillStyle = CARD_COLORS.paper;
  g.fillRect(0, 0, CARD_W, CARD_H);
  g.strokeStyle = CARD_COLORS.border;
  g.lineWidth = 1;
  g.strokeRect(24, 28, CARD_W - 48, CARD_H - 52);
  return { canvas, g, font };
}

function makeTextPainter(g: CanvasRenderingContext2D, font: string) {
  return (value: string, x: number, y: number, size: number, weight: number, color = CARD_COLORS.ink, align: CanvasTextAlign = 'left', maxW = CARD_W - 64 - x) => {
    g.font = `${weight} ${size}px ${font}`;
    g.fillStyle = color;
    g.textAlign = align;
    if (align === 'left') g.fillText(value, x, y, maxW);
    else g.fillText(value, x, y);
  };
}

function drawCardHeader(
  g: CanvasRenderingContext2D,
  font: string,
  subtitle: string,
  pillText: string | null,
  leftColor: string,
  rightColor = leftColor,
) {
  const text = makeTextPainter(g, font);
  g.fillStyle = leftColor;
  g.fillRect(0, 0, CARD_W / 2, 12);
  g.fillStyle = rightColor;
  g.fillRect(CARD_W / 2, 0, CARD_W / 2, 12);

  g.fillStyle = CARD_COLORS.ink;
  g.beginPath();
  g.roundRect(64, 52, 136, 34, 8);
  g.fill();
  text('EXITPULSE', 132, 76, 18, 800, CARD_COLORS.paper, 'center');
  text(subtitle, 214, 76, 22, 700, CARD_COLORS.muted);

  if (pillText) {
    g.font = `800 26px ${font}`;
    const pillW = Math.max(120, Math.round(g.measureText(pillText).width + 44));
    g.fillStyle = CARD_COLORS.surface;
    g.beginPath();
    g.roundRect(CARD_W - 64 - pillW, 48, pillW, 42, 999);
    g.fill();
    g.strokeStyle = CARD_COLORS.border;
    g.stroke();
    text(pillText, CARD_W - 64 - pillW / 2, 78, 24, 800, CARD_COLORS.ink, 'center');
  }
}

function drawLineBadge(
  g: CanvasRenderingContext2D,
  font: string,
  x: number,
  baselineY: number,
  code: string,
  fill: string,
  lineCode?: string,
) {
  const text = makeTextPainter(g, font);
  g.font = `800 28px ${font}`;
  const w = Math.max(76, Math.round(g.measureText(code).width + 26));
  g.fillStyle = fill;
  g.beginPath();
  g.roundRect(x, baselineY - 40, w, 46, 8);
  g.fill();
  text(code, x + w / 2, baselineY - 7, 26, 800, DARK_INK_LINES.has(lineCode ?? '') ? CARD_COLORS.ink : '#ffffff', 'center');
  return w + 14;
}

function drawCardFooter(g: CanvasRenderingContext2D, font: string, summaryLine: string) {
  const text = makeTextPainter(g, font);
  text(summaryLine, 64, 566, 21, 400, CARD_COLORS.muted);
  const originHost = typeof location !== 'undefined' && location.host && !location.host.startsWith('127.0.0.1') ? ` · ${location.host}` : '';
  text(`資料來源：臺北市資料大平臺 臺北捷運每日分時各站 OD 流量統計${originHost}`, 64, 596, 17, 400, CARD_COLORS.muted);
}

async function finishCardDownload(canvas: HTMLCanvasElement, filename: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return { ok: false, reason: '圖片產生失敗，請再試一次' };

  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
  return { ok: true };
}

/** 把目前選取的兩站畫成一張 1200×630 的結論卡並觸發下載，方便貼到訊息或簡報。 */
export async function exportPairCard(params: {
  result: Result;
  data: CardDataset;
  story: CardStory;
  fromColor?: string;
  toColor?: string;
  originCode?: string;
  destCode?: string;
  originLine?: string;
  destLine?: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { result: r, data: d, story: s, fromColor, toColor, originCode, destCode, originLine, destLine } = params;
  const ctx = await prepareCardCanvas(`${r.origin} → ${r.destination} ${originCode ?? ''}${destCode ?? ''} ${s.headline} ${s.when}`);
  if ('error' in ctx) return { ok: false, reason: ctx.error };
  const { canvas, g, font } = ctx;
  const text = makeTextPainter(g, font);

  const from = fromColor ?? CARD_COLORS.ink, to = toColor ?? CARD_COLORS.ink;
  const growth = r.baselineDaily > 0 ? (r.currentDaily / r.baselineDaily - 1) * 100 : null;
  const pillText = growth == null ? '新路線／新增' : `${growth >= 0 ? '+' : '−'}${Math.round(Math.abs(growth))}%`;
  drawCardHeader(g, font, '臺北捷運人流變化情報', pillText, from, to);

  let curX = 64;
  const titleY = 176;
  if (originCode) curX += drawLineBadge(g, font, curX, titleY, originCode, from, originLine);
  g.font = `800 58px ${font}`;
  const arrowStr = '  →  ';
  const originW = g.measureText(r.origin).width;
  const arrowW = g.measureText(arrowStr).width;
  text(r.origin, curX, titleY, 58, 800, CARD_COLORS.ink, 'left', 400);
  curX += Math.min(originW, 400);
  text(arrowStr, curX, titleY, 54, 400, CARD_COLORS.muted, 'left', arrowW);
  curX += arrowW;
  if (destCode) curX += drawLineBadge(g, font, curX, titleY, destCode, to, destLine);
  text(r.destination, curX, titleY, 58, 800, CARD_COLORS.ink, 'left', Math.max(160, CARD_W - 64 - curX));

  text(s.headline, 64, 246, 36, 700, CARD_COLORS.ink);

  g.fillStyle = CARD_COLORS.surface;
  g.beginPath();
  g.roundRect(64, 290, CARD_W - 128, 224, 16);
  g.fill();
  g.strokeStyle = CARD_COLORS.border;
  g.stroke();

  const figure = (x: number, label: string, daily: number, color: string) => {
    text(label, x, 342, 24, 700, CARD_COLORS.muted);
    text(formatDailyTrips(daily), x, 442, 102, 800, color);
    text('每日人次', x, 488, 22, 400, CARD_COLORS.muted);
  };
  figure(100, d.baseline, r.baselineDaily, CARD_COLORS.muted);
  text('→', 588, 428, 58, 400, CARD_COLORS.muted, 'center');
  figure(656, d.current, r.currentDaily, CARD_COLORS.ink);

  const days = d.days[0] === d.days[1] ? `兩期各 ${d.days[0]} 天` : `有效天數 ${d.days[0]} 與 ${d.days[1]} 天`;
  drawCardFooter(g, font, `${s.when} · 納入比較 ${d.commonStations} 站 · ${days}`);
  return finishCardDownload(canvas, `exitpulse-${r.origin}-${r.destination}-${d.baseline}-${d.current}.png`);
}

/** 匯出「單站往來」1200×630 分享圖卡：進／出站人次、24 小時趨勢線與主要往來前 3 站。 */
export async function exportStationCard(params: StationCardParams): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { station, periodLabel, hoursText, direction, dailyEntries, dailyExits, compareLabel, compareEntries, hourlyEntries, topRelations, badges, lineColor } = params;
  const ctx = await prepareCardCanvas(`${station} ${periodLabel} ${hoursText} ${topRelations.map(r => r.station).join('')}`);
  if ('error' in ctx) return { ok: false, reason: ctx.error };
  const { canvas, g, font } = ctx;
  const text = makeTextPainter(g, font);
  const accent = lineColor || CARD_COLORS.ink;

  const pct = compareEntries && dailyEntries != null && compareEntries > 0
    ? ((dailyEntries / compareEntries - 1) * 100)
    : null;
  const pill = pct == null ? null : `${pct >= 0 ? '+' : '−'}${Math.round(Math.abs(pct))}%`;
  drawCardHeader(g, font, '臺北捷運單站人流快照', pill, accent);

  let curX = 64;
  for (const b of badges.slice(0, 3)) curX += drawLineBadge(g, font, curX, 174, b.code, b.color, b.line);
  text(station, curX, 174, 58, 800, CARD_COLORS.ink, 'left', CARD_W - 64 - curX);
  text(`${periodLabel} · ${hoursText}${compareLabel ? ` · 對照 ${compareLabel}` : ''}`, 64, 224, 24, 700, CARD_COLORS.muted);

  // 左側指標卡片（進／出站與 24h 曲線）
  g.fillStyle = CARD_COLORS.surface;
  g.beginPath();
  g.roundRect(64, 256, 600, 260, 16);
  g.fill();
  g.strokeStyle = CARD_COLORS.border;
  g.stroke();

  text('每日進站', 96, 300, 20, 700, CARD_COLORS.muted);
  text(dailyEntries == null ? '—' : formatDailyTrips(dailyEntries), 96, 368, 66, 800, CARD_COLORS.ink, 'left', 260);
  text('每日出站', 380, 300, 20, 700, CARD_COLORS.muted);
  text(dailyExits == null ? '—' : formatDailyTrips(dailyExits), 380, 368, 66, 800, CARD_COLORS.muted, 'left', 250);

  // 24 小時進站曲線
  const vals = hourlyEntries.map(v => v ?? 0);
  const maxVal = Math.max(1, ...vals);
  const cx = 96, cy = 408, cw = 536, ch = 76;
  g.strokeStyle = CARD_COLORS.border;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(cx, cy + ch);
  g.lineTo(cx + cw, cy + ch);
  g.stroke();

  g.strokeStyle = accent;
  g.lineWidth = 4;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.beginPath();
  let started = false;
  hourlyEntries.forEach((v, h) => {
    if (v == null) { started = false; return; }
    const px = cx + (h / 23) * cw;
    const py = cy + ch - (v / maxVal) * (ch - 8);
    if (!started) { g.moveTo(px, py); started = true; } else g.lineTo(px, py);
  });
  g.stroke();
  text('24 小時逐時進站曲線（0 時–23 時）', cx, 502, 16, 400, CARD_COLORS.muted);

  // 右側前 3 大往來車站
  g.fillStyle = CARD_COLORS.surface;
  g.beginPath();
  g.roundRect(692, 256, 444, 260, 16);
  g.fill();
  g.strokeStyle = CARD_COLORS.border;
  g.stroke();
  text(direction === 'outbound' ? '最常前往前 3 站' : '主要來自前 3 站', 724, 300, 22, 700, CARD_COLORS.muted);
  topRelations.slice(0, 3).forEach((rel, i) => {
    const ry = 358 + i * 54;
    g.fillStyle = rel.color || accent;
    g.beginPath();
    g.arc(732, ry - 8, 6, 0, Math.PI * 2);
    g.fill();
    text(`${i + 1}. ${rel.station}`, 752, ry, 26, 700, CARD_COLORS.ink, 'left', 230);
    text(rel.daily == null ? '—' : `${formatDailyTrips(rel.daily)} 人次`, 1104, ry, 24, 800, CARD_COLORS.ink, 'right');
  });

  drawCardFooter(g, font, `${station} · ${periodLabel} · ${hoursText}`);
  return finishCardDownload(canvas, `exitpulse-station-${station}-${periodLabel}.png`);
}

/** 匯出「全線人次」1200×630 分享圖卡：總人次規模與前 5 大車站排行。 */
export async function exportNetworkCard(params: NetworkCardParams): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { metric, periodLabel, hoursText, totalEntries, compareLabel, compareTotal, stationCount, topStations } = params;
  const ctx = await prepareCardCanvas(`全線 ${periodLabel} ${hoursText} ${topStations.map(s => s.station).join('')}`);
  if ('error' in ctx) return { ok: false, reason: ctx.error };
  const { canvas, g, font } = ctx;
  const text = makeTextPainter(g, font);

  const pct = compareTotal && compareTotal > 0 ? ((totalEntries / compareTotal - 1) * 100) : null;
  const pill = pct == null ? null : `${pct >= 0 ? '+' : '−'}${Math.round(Math.abs(pct))}%`;
  drawCardHeader(g, font, '臺北捷運全線人流統計', pill, '#0070bd', '#008659');

  const headline = metric === 'net' ? '全線各站淨進出分布' : '全線捷運旅次總覽';
  text(headline, 64, 172, 54, 800, CARD_COLORS.ink);
  text(`${periodLabel} · ${hoursText}${compareLabel ? ` · 對照 ${compareLabel}` : ''}`, 64, 222, 24, 700, CARD_COLORS.muted);

  g.fillStyle = CARD_COLORS.surface;
  g.beginPath();
  g.roundRect(64, 256, 440, 260, 16);
  g.fill();
  g.strokeStyle = CARD_COLORS.border;
  g.stroke();

  text('全線合計進站人次', 96, 306, 22, 700, CARD_COLORS.muted);
  text(formatDailyTrips(totalEntries), 96, 408, 78, 800, CARD_COLORS.ink, 'left', 380);
  text(`統計 ${stationCount} 座車站${compareTotal != null ? ` · 對照期 ${formatDailyTrips(compareTotal)}` : ''}`, 96, 480, 20, 400, CARD_COLORS.muted, 'left', 380);

  g.fillStyle = CARD_COLORS.surface;
  g.beginPath();
  g.roundRect(532, 256, 604, 260, 16);
  g.fill();
  g.strokeStyle = CARD_COLORS.border;
  g.stroke();
  text(metric === 'net' ? '淨流入／流出前 5 站' : '進站旅次前 5 站', 564, 300, 22, 700, CARD_COLORS.muted);

  const top = topStations.slice(0, 5);
  const maxBar = Math.max(1, ...top.map(s => Math.abs(s.value ?? 0)));
  top.forEach((st, i) => {
    const rowY = 342 + i * 38;
    const val = st.value ?? 0;
    const barW = Math.round((Math.abs(val) / maxBar) * 210);
    text(`${i + 1}. ${st.station}`, 564, rowY, 21, 700, CARD_COLORS.ink, 'left', 180);
    g.fillStyle = st.color || CARD_COLORS.ink;
    g.beginPath();
    g.roundRect(756, rowY - 16, Math.max(6, barW), 16, 4);
    g.fill();
    const label = metric === 'net' && val > 0 ? `+${formatDailyTrips(val)}` : formatDailyTrips(val);
    text(label, 1108, rowY, 21, 800, CARD_COLORS.ink, 'right');
  });

  drawCardFooter(g, font, `${headline} · ${periodLabel} · ${hoursText}`);
  return finishCardDownload(canvas, `exitpulse-network-${metric}-${periodLabel}.png`);
}
