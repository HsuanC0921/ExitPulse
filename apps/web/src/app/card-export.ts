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
  const font = getComputedStyle(document.body).getPropertyValue('--ui-font').trim();
  await Promise.allSettled([
    document.fonts.load(`800 40px ${font}`, `ExitPulse 捷運旅次變化雷達 ${r.origin} → ${r.destination} ${originCode ?? ''}${destCode ?? ''} 0123456789,.−+`),
    document.fonts.load(`700 40px ${font}`, s.headline),
    document.fonts.load(`400 40px ${font}`, `${s.when} · 納入比較 0123456789 站 · 兩期各有效天數與每日人次 資料：臺北市資料大平臺 臺北捷運每日分時各站 OD 流量統計`),
  ]);

  const scale = 2, W = 1200, H = 630;
  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const g = canvas.getContext('2d');
  if (!g) return { ok: false, reason: '這個瀏覽器無法產生圖片' };
  g.scale(scale, scale);

  const ink = '#1d2125', muted = '#5a6066', paper = '#f6f4ef', surface = '#ebe7de', border = '#ded8cc';
  const darkInkLines = new Set(['BR', 'O', 'Y']);
  const text = (value: string, x: number, y: number, size: number, weight: number, color = ink, align: CanvasTextAlign = 'left', maxW = W - 64 - x) => {
    g.font = `${weight} ${size}px ${font}`;
    g.fillStyle = color;
    g.textAlign = align;
    if (align === 'left') g.fillText(value, x, y, maxW);
    else g.fillText(value, x, y);
  };

  g.fillStyle = paper;
  g.fillRect(0, 0, W, H);

  // 頂部雙線捷運色帶
  const from = fromColor ?? ink, to = toColor ?? ink;
  g.fillStyle = from;
  g.fillRect(0, 0, W / 2, 12);
  g.fillStyle = to;
  g.fillRect(W / 2, 0, W / 2, 12);

  // 外圍極細編輯框線
  g.strokeStyle = border;
  g.lineWidth = 1;
  g.strokeRect(24, 28, W - 48, H - 52);

  // 品牌膠囊標頭與右側成長率膠囊
  g.fillStyle = ink;
  g.beginPath();
  g.roundRect(64, 52, 136, 34, 8);
  g.fill();
  text('EXITPULSE', 132, 76, 18, 800, paper, 'center');
  text('臺北捷運人流變化情報', 214, 76, 22, 700, muted);

  const growth = r.baselineDaily > 0 ? (r.currentDaily / r.baselineDaily - 1) * 100 : null;
  const pillText = growth == null ? '新路線／新增' : `${growth >= 0 ? '+' : '−'}${Math.round(Math.abs(growth))}%`;
  g.font = `800 26px ${font}`;
  const pillW = Math.max(120, Math.round(g.measureText(pillText).width + 44));
  g.fillStyle = surface;
  g.beginPath();
  g.roundRect(W - 64 - pillW, 48, pillW, 42, 999);
  g.fill();
  g.strokeStyle = border;
  g.stroke();
  text(pillText, W - 64 - pillW / 2, 78, 24, 800, ink, 'center');

  // 起訖站含彩色線路站碼徽章
  const drawBadge = (x: number, baselineY: number, code: string, fill: string, lightText: boolean) => {
    g.font = `800 28px ${font}`;
    const w = Math.max(76, Math.round(g.measureText(code).width + 26));
    g.fillStyle = fill;
    g.beginPath();
    g.roundRect(x, baselineY - 40, w, 46, 8);
    g.fill();
    text(code, x + w / 2, baselineY - 7, 26, 800, lightText ? '#ffffff' : ink, 'center');
    return w + 14;
  };

  let curX = 64;
  const titleY = 176;
  if (originCode) curX += drawBadge(curX, titleY, originCode, from, !darkInkLines.has(originLine ?? ''));
  g.font = `800 58px ${font}`;
  const arrowStr = '  →  ';
  const originW = g.measureText(r.origin).width;
  const arrowW = g.measureText(arrowStr).width;
  text(r.origin, curX, titleY, 58, 800, ink, 'left', 400);
  curX += Math.min(originW, 400);
  text(arrowStr, curX, titleY, 54, 400, muted, 'left', arrowW);
  curX += arrowW;
  if (destCode) curX += drawBadge(curX, titleY, destCode, to, !darkInkLines.has(destLine ?? ''));
  text(r.destination, curX, titleY, 58, 800, ink, 'left', Math.max(160, W - 64 - curX));

  text(s.headline, 64, 246, 36, 700, ink);

  // 數據對比卡片區塊
  g.fillStyle = surface;
  g.beginPath();
  g.roundRect(64, 290, W - 128, 224, 16);
  g.fill();
  g.strokeStyle = border;
  g.stroke();

  const figure = (x: number, label: string, daily: number, color: string) => {
    text(label, x, 342, 24, 700, muted);
    text(formatDailyTrips(daily), x, 442, 102, 800, color);
    text('每日人次', x, 488, 22, 400, muted);
  };
  figure(100, d.baseline, r.baselineDaily, muted);
  text('→', 588, 428, 58, 400, muted, 'center');
  figure(656, d.current, r.currentDaily, ink);

  const days = d.days[0] === d.days[1] ? `兩期各 ${d.days[0]} 天` : `有效天數 ${d.days[0]} 與 ${d.days[1]} 天`;
  text(`${s.when} · 納入比較 ${d.commonStations} 站 · ${days}`, 64, 566, 21, 400, muted);
  const originHost = typeof location !== 'undefined' && location.host && !location.host.startsWith('127.0.0.1') ? ` · ${location.host}` : '';
  text(`資料來源：臺北市資料大平臺 臺北捷運每日分時各站 OD 流量統計${originHost}`, 64, 596, 17, 400, muted);

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return { ok: false, reason: '圖片產生失敗，請再試一次' };

  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), {
    href: url,
    download: `exitpulse-${r.origin}-${r.destination}-${d.baseline}-${d.current}.png`,
  }).click();
  URL.revokeObjectURL(url);
  return { ok: true };
}
