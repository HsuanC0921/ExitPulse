/** 防止 App 停在舊版：回到前景、連線恢復、每 5 分鐘都檢查新版，有就重新載入。狀態都在網址列，重新載入不會丟查詢。 */
export function watchForNewVersion() {
  const running = /main-[A-Z0-9]+\.js/.exec(Array.from(document.scripts).map(s => s.src).join(' '))?.[0];
  if (!running) return; // 開發伺服器的檔名沒有雜湊，不檢查
  let checking = false;
  const check = async () => {
    if (checking || document.visibilityState !== 'visible') return;
    checking = true;
    try {
      const html = await (await fetch('/', { cache: 'no-store' })).text();
      const latest = /main-[A-Z0-9]+\.js/.exec(html)?.[0];
      if (latest && latest !== running) location.reload();
    } catch { /* 離線或暫時連不上就下次再查 */ } finally { checking = false; }
  };
  document.addEventListener('visibilitychange', check);
  addEventListener('pageshow', check);
  addEventListener('online', check);
  setInterval(check, 5 * 60_000);

  // 舊頁面要載入已被換掉的分頁檔會失敗，重新載入一次就能拿到新版（同一分頁只重載一次，避免無限迴圈）
  const reloadOnce = (reason: unknown) => {
    if (!/dynamically imported module|Loading chunk|ChunkLoadError|Importing a module script failed/i.test(String(reason))) return;
    try { if (sessionStorage.getItem('exitpulse.chunk-reload')) return; sessionStorage.setItem('exitpulse.chunk-reload', '1'); } catch { return; }
    location.reload();
  };
  addEventListener('unhandledrejection', e => reloadOnce((e.reason as Error)?.message ?? e.reason));
  addEventListener('error', e => reloadOnce(e.message));
}
