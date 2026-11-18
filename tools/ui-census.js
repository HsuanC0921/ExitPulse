#!/usr/bin/env node
/**
 * Non-AI reproducible UI consistency & accessibility census.
 * Scans pairs / station / network / mobile views across light & dark themes
 * and 1440 / 768 / 390 / 320 viewports, then outputs docs/ui-census.md (+ json).
 */
const fs = require('fs');
const path = require('path');

function resolvePkg(name) {
  const candidates = [
    path.resolve(__dirname, '..'),
    path.resolve(__dirname, '../apps/web'),
    process.env.PW_RUNNER_DIR || '',
  ].filter(Boolean);
  return require(require.resolve(name, { paths: candidates }));
}

const { chromium } = resolvePkg('playwright');
const AxeBuilder = resolvePkg('@axe-core/playwright').default;

const BASE = process.env.EXITPULSE_URL || 'http://localhost:4200/';
const CHROME_EXE = process.env.CHROME_EXE;
const DOCS_DIR = path.resolve(__dirname, '../docs');

const VIEWPORTS = [
  [1440, 900],
  [768, 1024],
  [390, 844],
  [320, 640],
];

const STATES = [
  { id: 'pairs', url: '?b=2022-09&c=2026-09&h=7-10&w=0&t=all&m=20&s=share' },
  { id: 'station', url: 'STATION' },
  { id: 'network', url: '?v=network&pe=2026-09&d=weekday&h=0-24' },
];

const RADIUS_TOKENS = new Set(['0px', '4px', '8px', '12px', '999px', '9999px', '50%']);
const FONT_SIZE_LADDER = new Set(['12px', '14px', '16px', '18px', '20px', '26px', '32px']);
const FONT_WEIGHT_LADDER = new Set(['400', '700', '800']);
const BTN_HEIGHT_LADDER = new Set([36, 44, 56]);
const GAP_LADDER = new Set([
  '0px', '2px', '4px', '8px', '12px', '16px', '24px',
  '2px 8px', '2px 12px', '0px 4px', '0px 8px', '0px 12px',
  '4px 8px', '4px 12px', '8px 12px', '8px 24px',
]);

function bump(map, key, selector) {
  if (!map[key]) map[key] = { count: 0, selectors: new Set() };
  map[key].count++;
  if (map[key].selectors.size < 6) map[key].selectors.add(selector);
}

async function scanPage(page, ctxLabel, vw) {
  return page.evaluate(({ vw }) => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0' && !el.closest('[inert],[hidden]');
    };
    const selOf = (el) => {
      const t = el.tagName.toLowerCase();
      const cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      return t + (cls ? '.' + cls : '');
    };
    const descOf = (el) => {
      const txt = (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 20);
      return selOf(el) + (txt ? ` "${txt}"` : '');
    };

    const raw = {
      radius: [], fontSize: [], fontWeight: [], btnHeight: [], padX: [], gap: [],
      components: { button: [], rowCardButton: [], chip: [], input: [], select: [], badge: [] },
      contrastFail: [],
      smallTouch: [],
      rowMisalign: [],
      verticalSqueeze: [],
    };

    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el) || el.closest('.maplibregl-map')) continue;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const sel = selOf(el);

      if (s.borderTopLeftRadius !== '0px') raw.radius.push([s.borderTopLeftRadius, sel]);
      const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (ownText) {
        raw.fontSize.push([s.fontSize, sel]);
        raw.fontWeight.push([s.fontWeight, sel]);
      }
      if (s.paddingLeft !== '0px' || s.paddingRight !== '0px') {
        if (el.matches('button, input, select, .chip, .pill, .card, .badge, a')) {
          raw.padX.push([`${s.paddingLeft}/${s.paddingRight}`, sel]);
        }
      }
      if (s.gap && s.gap !== 'normal' && s.gap !== '0px') raw.gap.push([s.gap, sel]);
      if (el.matches('.chip, .chips button')) {
        raw.components.chip.push([Math.round(r.height), s.borderTopLeftRadius, s.fontSize, sel]);
      } else if (el.matches('button, [role=button]')) {
        const h = Math.round(r.height);
        const isRowOrCard = el.matches('li > button, .pill, .section-toggle, .place-results button, .siblings button, .saved-apply, .first-query-matches button, .first-query-preset-list button, .entrances button, .peak-hour, .compact-time, .tabbar button, .view-tabs button, .result-tools-toggle');
        if (isRowOrCard) {
          raw.components.rowCardButton.push([h, s.borderTopLeftRadius, s.fontSize, sel]);
        } else {
          raw.btnHeight.push([h, sel]);
          raw.components.button.push([h, s.borderTopLeftRadius, s.fontSize, sel]);
        }
      }
      if (el.matches('input:not([type=hidden], [type=range], [role=switch])')) raw.components.input.push([Math.round(r.height), s.borderTopLeftRadius, s.fontSize, sel]);
      if (el.matches('select')) raw.components.select.push([Math.round(r.height), s.borderTopLeftRadius, s.fontSize, sel]);
      if (el.matches('.badge, b.badge')) raw.components.badge.push([Math.round(r.height), s.borderTopLeftRadius, s.fontSize, sel]);

      // Touch target < 44px on coarse/mobile viewports
      if (vw <= 768 && el.matches('button, a[href], input:not([type=hidden]), select, summary, [role=button], [role=tab]')) {
        if (r.top >= 0 && r.bottom <= innerHeight && (r.width < 43.5 || r.height < 43.5)) {
          raw.smallTouch.push(`${descOf(el)} (${Math.round(r.width)}x${Math.round(r.height)})`);
        }
      }

      // Unexpected vertical text squeeze (text wrapping into >=3 narrow lines inside buttons/pills/headers)
      if (el.matches('.index-pill, .export, .wide-toggle, .segmented button, .chips button, th:not(:has(.v-name)), .badge, .pill-main')) {
        const txt = (el.innerText || '').trim();
        const range = document.createRange();
        range.selectNodeContents(el);
        const lineCount = new Set([...range.getClientRects()].map((rc) => Math.round(rc.top / 4))).size;
        if (txt.length >= 3 && lineCount >= 3 && r.width < r.height * 1.1) {
          raw.verticalSqueeze.push(`${descOf(el)} (${Math.round(r.width)}x${Math.round(r.height)}, lines=${lineCount})`);
        }
      }

      // Row alignment check for flex/grid rows (exclude position:absolute children)
      if ((s.display === 'flex' || s.display === 'inline-flex') && (s.flexDirection === 'row' || !s.flexDirection) && s.flexWrap === 'nowrap') {
        const kids = [...el.children].filter((k) => visible(k) && getComputedStyle(k).position !== 'absolute');
        if (kids.length >= 2 && kids.every((k) => k.getBoundingClientRect().height < 60)) {
          const rects = kids.map((k) => k.getBoundingClientRect());
          const spanOf = (vals) => Math.round(Math.max(...vals) - Math.min(...vals));
          const topSpan = spanOf(rects.map((x) => x.top));
          const midSpan = spanOf(rects.map((x) => x.top + x.height / 2));
          const botSpan = spanOf(rects.map((x) => x.bottom));
          if (Math.min(topSpan, midSpan, botSpan) > 6) {
            raw.rowMisalign.push(`${sel} min-align-diff=${Math.min(topSpan, midSpan, botSpan)}px`);
          }
        }
      }
    }

    // WCAG contrast
    const parse = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 };
    };
    const lum = (c) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const bgOf = (el) => {
      const layers = [];
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c.a > 0) { layers.push(c); if (c.a >= 0.99) break; }
      }
      let base = { r: 255, g: 255, b: 255 };
      for (const c of layers.reverse()) {
        base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a) };
      }
      return base;
    };
    const seenC = new Set();
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el) || el.closest('.maplibregl-map')) continue;
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const s = getComputedStyle(el);
      const fg = parse(s.color);
      if (!fg) continue;
      const bg = bgOf(el);
      const f = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
      const L1 = lum(f), L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const size = parseFloat(s.fontSize), bold = parseInt(s.fontWeight, 10) >= 700;
      const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
      if (ratio < need) {
        const key = `${selOf(el)}:${ratio.toFixed(1)}`;
        if (!seenC.has(key)) {
          seenC.add(key);
          raw.contrastFail.push(`${descOf(el)} ${ratio.toFixed(2)} < ${need} (${s.fontSize})`);
        }
      }
    }

    return raw;
  }, { vw });
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME_EXE, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const dist = { radius: {}, fontSize: {}, fontWeight: {}, btnHeight: {}, padX: {}, gap: {} };
  const compStats = { button: {}, rowCardButton: {}, chip: {}, input: {}, select: {}, badge: {} };
  const contrastMap = new Map();
  const touchMap = new Map();
  const alignMap = new Map();
  const squeezeMap = new Map();
  const axeMap = new Map();

  for (const st of STATES) {
    for (const [w, h] of VIEWPORTS) {
      for (const theme of ['light', 'dark']) {
        const label = `${st.id} ${w}x${h} ${theme}`;
        await page.setViewportSize({ width: w, height: h });
        if (st.url === 'STATION') {
          await page.goto(BASE, { waitUntil: 'networkidle' });
          await page.waitForTimeout(900);
          await page.evaluate(() => window.ng.getComponent(document.querySelector('app-root')).openStation('台北車站', { hourly: true }));
        } else {
          await page.goto(BASE + st.url, { waitUntil: 'networkidle' });
        }
        await page.waitForTimeout(1400);
        await page.evaluate((t) => window.ng.getComponent(document.querySelector('app-root')).setTheme(t), theme);
        await page.waitForTimeout(450);

        // Mobile tabs coverage on 390/320
        const subViews = w <= 720 ? ['map', 'analysis', 'conditions'] : ['default'];
        for (const sv of subViews) {
          if (sv === 'analysis' || sv === 'conditions') {
            const txt = sv === 'analysis' ? '分析' : '條件';
            const tab = page.locator('.tabbar button', { hasText: txt }).first();
            if (await tab.count()) {
              await tab.click();
              await page.waitForTimeout(300);
            }
          }
          const subLabel = sv === 'default' ? label : `${label}/${sv}`;
          const res = await scanPage(page, subLabel, w);
          for (const [v, sel] of res.radius) bump(dist.radius, v, sel);
          for (const [v, sel] of res.fontSize) bump(dist.fontSize, v, sel);
          for (const [v, sel] of res.fontWeight) bump(dist.fontWeight, v, sel);
          for (const [v, sel] of res.btnHeight) bump(dist.btnHeight, `${v}px`, sel);
          for (const [v, sel] of res.padX) bump(dist.padX, v, sel);
          for (const [v, sel] of res.gap) bump(dist.gap, v, sel);

          for (const cName of Object.keys(compStats)) {
            for (const [ch, cr, cf, sel] of res.components[cName]) {
              bump(compStats[cName], `h=${ch}px r=${cr} fs=${cf}`, sel);
            }
          }
          for (const x of res.contrastFail) (contrastMap.get(x) || contrastMap.set(x, []).get(x)).push(subLabel);
          for (const x of res.smallTouch) (touchMap.get(x) || touchMap.set(x, []).get(x)).push(subLabel);
          for (const x of res.rowMisalign) (alignMap.get(x) || alignMap.set(x, []).get(x)).push(subLabel);
          for (const x of res.verticalSqueeze) (squeezeMap.get(x) || squeezeMap.set(x, []).get(x)).push(subLabel);

          // On desktop 1440 light/dark, also walk all explore subtabs (時段/每天/歷年/矩陣/榜單/涵蓋) to catch squeezed labels
          if (w === 1440 && (st.id === 'station' || st.id === 'network')) {
            const subTabs = await page.locator('.section-tabs button').all();
            for (const subTab of subTabs) {
              const tName = (await subTab.innerText()).trim();
              await subTab.click();
              await page.waitForTimeout(350);
              const sRes = await scanPage(page, `${subLabel}/${tName}`, w);
              for (const x of sRes.verticalSqueeze) (squeezeMap.get(x) || squeezeMap.set(x, []).get(x)).push(`${subLabel}/${tName}`);
              for (const x of sRes.rowMisalign) (alignMap.get(x) || alignMap.set(x, []).get(x)).push(`${subLabel}/${tName}`);
            }
          }

          if (sv === 'default' || sv === 'analysis') {
            try {
              const axe = await new AxeBuilder({ page }).exclude('.maplibregl-map').analyze();
              for (const v of axe.violations) {
                const k = `${v.id} (${v.impact}): ${v.help}`;
                (axeMap.get(k) || axeMap.set(k, new Set()).get(k)).add(`${subLabel} [${v.nodes.length}]`);
              }
            } catch {}
          }
        }
      }
    }
  }

  await browser.close();

  const serializeDist = (m) =>
    Object.entries(m)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([val, info]) => ({ val, count: info.count, selectors: [...info.selectors] }));

  const outliers = [];
  const checkOutlier = (cat, items, allowFn) => {
    for (const it of items) {
      if (!allowFn(it.val)) outliers.push({ category: cat, val: it.val, count: it.count, selectors: it.selectors });
    }
  };
  const dRadius = serializeDist(dist.radius);
  const dFs = serializeDist(dist.fontSize);
  const dFw = serializeDist(dist.fontWeight);
  const dBtn = serializeDist(dist.btnHeight);
  const dPad = serializeDist(dist.padX);
  const dGap = serializeDist(dist.gap);

  checkOutlier('border-radius', dRadius, (v) => RADIUS_TOKENS.has(v));
  checkOutlier('font-size', dFs, (v) => FONT_SIZE_LADDER.has(v));
  checkOutlier('font-weight', dFw, (v) => FONT_WEIGHT_LADDER.has(v));
  checkOutlier('button-height', dBtn, (v) => BTN_HEIGHT_LADDER.has(parseInt(v, 10)));
  checkOutlier('gap', dGap, (v) => GAP_LADDER.has(v));
  outliers.sort((a, b) => b.count - a.count);

  const report = {
    generatedAt: new Date().toISOString(),
    distributions: { radius: dRadius, fontSize: dFs, fontWeight: dFw, btnHeight: dBtn, padX: dPad, gap: dGap },
    outliersTop20: outliers.slice(0, 20),
    components: Object.fromEntries(Object.entries(compStats).map(([k, v]) => [k, serializeDist(v)])),
    contrastFails: [...contrastMap.entries()].map(([item, ctx]) => ({ item, count: ctx.length, sample: ctx.slice(0, 3) })),
    smallTouch: [...touchMap.entries()].map(([item, ctx]) => ({ item, count: ctx.length, sample: ctx.slice(0, 3) })),
    rowMisalign: [...alignMap.entries()].map(([item, ctx]) => ({ item, count: ctx.length, sample: ctx.slice(0, 3) })),
    verticalSqueeze: [...squeezeMap.entries()].map(([item, ctx]) => ({ item, count: ctx.length, sample: ctx.slice(0, 3) })),
    axeViolations: [...axeMap.entries()].map(([rule, ctx]) => ({ rule, contexts: [...ctx].slice(0, 6) })),
  };

  if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
  fs.writeFileSync(path.join(DOCS_DIR, 'ui-census.json'), JSON.stringify(report, null, 2));

  const md = [];
  md.push('# ExitPulse UI 一致性與無障礙盤點報告（非 AI 程式化掃描）\n');
  md.push(`產生時間：${report.generatedAt}\n`);
  md.push(`掃描矩陣：pairs / station / network（手機含 map / analysis / conditions 分頁）× 1440 / 768 / 390 / 320 × light / dark\n`);

  md.push('## 1. Token 階梯外離群值 Top 20\n');
  md.push('| # | 類別 | 值 | 出現次數 | 範例選擇器 |');
  md.push('|---|------|----|----------|------------|');
  report.outliersTop20.forEach((o, i) => {
    md.push(`| ${i + 1} | ${o.category} | \`${o.val}\` | ${o.count} | \`${o.selectors.slice(0, 3).join(', ')}\` |`);
  });

  md.push('\n## 2. 屬性值分佈摘要\n');
  for (const [label, arr] of [
    ['border-radius', dRadius],
    ['font-size', dFs],
    ['font-weight', dFw],
    ['button-height', dBtn],
    ['gap', dGap],
    ['horizontal-padding (top 15)', dPad.slice(0, 15)],
  ]) {
    md.push(`### ${label}`);
    for (const it of arr) md.push(`- \`${it.val}\`：${it.count} 次（\`${it.selectors.slice(0, 3).join(', ')}\`）`);
    md.push('');
  }

  md.push('## 3. 同類元件規格一致性（height / radius / font-size）\n');
  for (const [k, arr] of Object.entries(report.components)) {
    md.push(`### ${k}（組合數：${arr.length} 組）`);
    for (const it of arr.slice(0, 10)) md.push(`- \`${it.val}\`：${it.count} 次（\`${it.selectors.slice(0, 2).join(', ')}\`）`);
    md.push('');
  }

  md.push(`## 4. WCAG 文字對比不及格（${report.contrastFails.length} 項）\n`);
  for (const c of report.contrastFails.slice(0, 30)) md.push(`- ${c.item} [${c.count} 場景：${c.sample.join(', ')}]`);

  md.push(`\n## 5. 粗指標／手機觸控目標 < 44px（${report.smallTouch.length} 項）\n`);
  for (const t of report.smallTouch.slice(0, 30)) md.push(`- ${t.item} [${t.count} 場景：${t.sample.join(', ')}]`);

  md.push(`\n## 6. 同列元素 top 不齊（${report.rowMisalign.length} 項）\n`);
  for (const a of report.rowMisalign.slice(0, 20)) md.push(`- ${a.item} [${a.count} 場景：${a.sample.join(', ')}]`);

  md.push(`\n## 6b. 意外直書／窄欄文字擠壓（${report.verticalSqueeze.length} 項）\n`);
  for (const sq of report.verticalSqueeze.slice(0, 20)) md.push(`- ${sq.item} [${sq.count} 場景：${sq.sample.join(', ')}]`);

  md.push(`\n## 7. @axe-core/playwright 掃描違規（${report.axeViolations.length} 項）\n`);
  for (const ax of report.axeViolations) md.push(`- ${ax.rule}\n  - ${ax.contexts.join('\n  - ')}`);

  fs.writeFileSync(path.join(DOCS_DIR, 'ui-census.md'), md.join('\n'));
  console.log('UI_CENSUS_DONE outliers=' + report.outliersTop20.length + ' axe=' + report.axeViolations.length);
})();
