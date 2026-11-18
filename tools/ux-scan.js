// Paste into any browser's JS evaluator (Playwright MCP browser_evaluate, DevTools console).
// Reports what the current viewport actually shows: small targets, text covered by another element, clipped text, horizontal scroll.
async () => {
  await new Promise(r => setTimeout(r, 4000));
  const clipped = e => { const b = e.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2;
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const c = getComputedStyle(p);
      if (c.overflowX !== 'visible' || c.overflowY !== 'visible') { const r = p.getBoundingClientRect(); if (x < r.left || x > r.right || y < r.top || y > r.bottom) return true; } } return false; };
  const closed = e => !!e.closest('details:not([open])') && !e.closest('summary');
  const vis = e => { const b = e.getBoundingClientRect(), c = getComputedStyle(e);
    return b.width > 0 && b.height > 0 && c.visibility !== 'hidden' && c.display !== 'none' && c.opacity !== '0'
      && b.bottom > 0 && b.top < innerHeight && b.right > 0 && b.left < innerWidth && !closed(e) && !e.closest('[hidden], [inert]') && !clipped(e); };
  const name = e => e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/)[0] : '')
    + ':' + (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 14);
  const out = { viewport: [innerWidth, innerHeight], hscroll: document.documentElement.scrollWidth > innerWidth, small: [], covered: [], clipped: [] };
  for (const e of document.querySelectorAll('button, a[href], input, select, summary, [role=button]')) {
    if (!vis(e) || e.closest('.maplibregl-ctrl, .visually-hidden')) continue;
    const b = e.getBoundingClientRect();
    if (Math.min(b.width, b.height) < 44) out.small.push(`${name(e)} ${Math.round(b.width)}x${Math.round(b.height)}`);
  }
  for (const e of document.querySelectorAll('h1,h2,h3,p,span,strong,b,td,th,label,button,a,summary,li')) {
    if (!vis(e) || e.closest('.visually-hidden') || !(e.firstChild && e.firstChild.nodeType === 3 && e.firstChild.textContent.trim())) continue;
    const b = e.getBoundingClientRect();
    const x = Math.min(Math.max(b.left + b.width / 2, 0), innerWidth - 1), y = Math.min(Math.max(b.top + b.height / 2, 0), innerHeight - 1);
    const top = document.elementFromPoint(x, y);
    if (top && top !== e && !e.contains(top) && !top.contains(e)) out.covered.push(`${name(e)} <- ${name(top)}`);
    const c = getComputedStyle(e);
    if (e.scrollWidth > e.clientWidth + 1 && c.overflow !== 'visible' && c.textOverflow !== 'ellipsis') out.clipped.push(name(e));
  }
  for (const k of ['small', 'covered', 'clipped']) out[k] = [...new Set(out[k])].slice(0, 20);
  return out;
}
