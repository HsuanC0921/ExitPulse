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
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { result: r, data: d, story: s, fromColor, toColor } = params;
  const font = getComputedStyle(document.body).getPropertyValue('--ui-font').trim();
  await Promise.allSettled([
    document.fonts.load(`800 40px ${font}`, `ExitPulse 捷運旅次變化雷達 ${r.origin} → ${r.destination} 0123456789,.−+`),
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
  const text = (value: string, x: number, y: number, size: number, weight: number, color = ink, align: CanvasTextAlign = 'left') => {
    g.font = `${weight} ${size}px ${font}`;
    g.fillStyle = color;
    g.textAlign = align;
    // 長站名或長句不會超出右緣，過長時整行等比壓縮
    if (align === 'left') g.fillText(value, x, y, W - 64 - x);
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

  // 外圍極細編輯框線與數據比較底襯
  g.strokeStyle = border;
  g.lineWidth = 1;
  g.strokeRect(24, 28, W - 48, H - 52);

  text('ExitPulse　台北捷運旅次變化雷達', 64, 84, 24, 800, muted);
  text(`${r.origin}  →  ${r.destination}`, 64, 186, 66, 800, ink);
  text(s.headline, 64, 254, 38, 700, ink);

  // 數據對比卡片區塊
  g.fillStyle = surface;
  g.beginPath();
  g.roundRect(64, 296, W - 128, 224, 16);
  g.fill();
  g.strokeStyle = border;
  g.stroke();

  const figure = (x: number, label: string, daily: number, color: string) => {
    text(label, x, 348, 24, 700, muted);
    text(formatDailyTrips(daily), x, 448, 104, 800, color);
    text('每日人次', x, 494, 22, 400, muted);
  };
  figure(100, d.baseline, r.baselineDaily, muted);
  text('→', 588, 434, 58, 400, muted, 'center');
  figure(656, d.current, r.currentDaily, ink);

  const days = d.days[0] === d.days[1] ? `兩期各 ${d.days[0]} 天` : `有效天數 ${d.days[0]} 與 ${d.days[1]} 天`;
  text(`${s.when} · 納入比較 ${d.commonStations} 站 · ${days}`, 64, 568, 21, 400, muted);
  text('資料來源：臺北市資料大平臺 臺北捷運每日分時各站 OD 流量統計', 64, 598, 17, 400, muted);

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
