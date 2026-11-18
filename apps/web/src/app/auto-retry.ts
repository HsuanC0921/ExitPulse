import { DestroyRef, effect, inject, untracked } from '@angular/core';

/** 失敗後隔 5、10、20、40 秒，之後每 60 秒自動重試；分頁在背景時暫停，回到前景或恢復連線時立刻重試。 */
export const RETRY_DELAYS = [5000, 10000, 20000, 40000, 60000];

export function retryDelay(attempt: number): number {
  return RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];
}

/** 在建構子內呼叫：failed() 變成 true 時排程 retry()，持續正常 30 秒後重設間隔。 */
export function autoRetry(failed: () => boolean, retry: () => void) {
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fire = () => {
    clearTimeout(timer); timer = undefined;
    if (!failed()) return;
    if (document.hidden) return;
    attempt++;
    retry();
  };
  const now = () => { if (failed()) fire(); };
  effect(() => {
    const isFailed = failed();
    untracked(() => {
      clearTimeout(timer); timer = undefined;
      // 重試時狀態會短暫清空再失敗，持續正常 30 秒才把間隔重設回 5 秒
      if (!isFailed) { timer = setTimeout(() => { attempt = 0; timer = undefined; }, 30000); return; }
      timer = setTimeout(fire, retryDelay(attempt));
    });
  });
  const onVisible = () => { if (!document.hidden) now(); };
  document.addEventListener('visibilitychange', onVisible);
  addEventListener('online', now);
  inject(DestroyRef).onDestroy(() => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
    removeEventListener('online', now);
  });
}
