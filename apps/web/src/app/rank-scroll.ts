/** 直接捲動所屬的 .panel-body，讓所選列落在可視範圍。手機面板切換有 display 過渡，頭一次可能量不到版面，所以 200ms 後再量一次。 */
export function revealRankRow(row: HTMLElement, reduced: boolean) {
  const place = (behavior: ScrollBehavior) => {
    const body = row.closest<HTMLElement>('.panel-body');
    if (!body || !body.clientHeight) return;
    const top = row.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
    const bottom = top + row.offsetHeight;
    if (top < body.scrollTop) body.scrollTo({ top: Math.max(0, top - 8), behavior });
    else if (bottom > body.scrollTop + body.clientHeight) body.scrollTo({ top: bottom - body.clientHeight + 8, behavior });
  };
  place(reduced ? 'instant' : 'smooth');
  setTimeout(() => place('instant'), 200);
}
