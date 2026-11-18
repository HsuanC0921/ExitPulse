// 共用的 CSV 匯出：前段是 # 開頭的說明列，空一行後才是資料表，數字欄保持純數字。
export type CsvCell = string | number | null | undefined;

// 單一儲存格：空值留白，字串開頭是公式字元時加單引號防止試算表當成公式執行
function cell(value: CsvCell): string {
  if (value == null) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * 組出完整 CSV 文字。meta 是「項目、內容」成對的說明列（查詢條件、有效天數、資料來源與方法），
 * 以「# 項目,內容」輸出。檔案以 BOM 開頭，Excel 才會用 UTF-8 開啟，換行用 CRLF。
 */
export function buildCsv(meta: ReadonlyArray<readonly [string, CsvCell]>, header: string[], rows: CsvCell[][]): string {
  const lines = meta.map(([key, value]) => `${cell('# ' + key)},${cell(value)}`);
  if (lines.length) lines.push('');
  lines.push(header.map(cell).join(','), ...rows.map(row => row.map(cell).join(',')));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// 觸發瀏覽器下載
export function downloadCsv(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  link.click();
  URL.revokeObjectURL(url);
}

// 每份匯出都帶的固定說明：資料來源、方法與匯出時間
export function exportBasis(now = new Date()): Array<[string, string]> {
  return [
    ['資料集', 'ExitPulse 捷運旅次變化雷達'],
    ['資料來源', '臺北市資料大平臺 臺北捷運每日分時各站OD流量統計資料'],
    ['統計口徑', '閘門進出站人次，不含轉乘後的完整行程'],
    ['匯出時間', now.toISOString()],
  ];
}
