#!/usr/bin/env node
/**
 * 精簡版多視口 UI/UX 煙霧測試：檢查 1440x900、820x800 與 390x844 的
 * Console 錯誤、橫向溢出與主要控制列碰撞情況。
 * 用法：node tools/ui-smoke.mjs [--url=http://127.0.0.1:4200]
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolvePlaywright() {
  const candidates = [
    path.resolve(__dirname, '..'),
    path.resolve(__dirname, '../apps/web'),
    process.env.PW_RUNNER_DIR || '',
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      return require(require.resolve('playwright', { paths: [p] }));
    } catch {
      // try next path
    }
  }
  return require('playwright');
}

const urlArg = process.argv.find(a => a.startsWith('--url='));
const shotArg = process.argv.find(a => a.startsWith('--screenshots='));
const SHOT_DIR = shotArg ? shotArg.slice('--screenshots='.length) : (process.env.UI_SMOKE_DIR || '');
if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true });
const BASE_URL = urlArg ? urlArg.slice('--url='.length) : (process.env.EXITPULSE_URL || 'http://127.0.0.1:4200/?b=2022-09&c=2026-09');
const { chromium } = resolvePlaywright();

const CHECKS = [
  { name: 'desktop-1440', viewport: { width: 1440, height: 900 }, mobile: false },
  { name: 'desktop-820', viewport: { width: 820, height: 800 }, mobile: false },
  { name: 'tablet-768', viewport: { width: 768, height: 1024 }, mobile: false },
  { name: 'mobile-390', viewport: { width: 390, height: 844 }, mobile: true },
  { name: 'mobile-360', viewport: { width: 360, height: 740 }, mobile: true },
];

const overlap = (a, b) => a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

(async () => {
  const launchOpts = { headless: true };
  if (process.env.CHROME_EXE) launchOpts.executablePath = process.env.CHROME_EXE;
  const browser = await chromium.launch(launchOpts);
  let failures = 0;

  try {
    for (const c of CHECKS) {
      const ctx = await browser.newContext({
        viewport: c.viewport,
        isMobile: c.mobile,
        hasTouch: c.mobile,
      });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));
      page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1800);

      if (c.mobile) {
        const later = page.getByRole('button', { name: '稍後' });
        if (await later.count() > 0 && await later.first().isVisible()) {
          await later.first().click();
          await page.waitForTimeout(200);
        }
        await page.getByRole('button', { name: '地圖', exact: true }).first().click();
        await page.waitForTimeout(400);
      } else {
        const firstRow = page.getByText('南港展覽館').first();
        if (await firstRow.count() > 0 && await firstRow.isVisible()) {
          await firstRow.click();
          await page.waitForTimeout(1350);
        }
      }

      const metrics = await page.evaluate(() => {
        const rect = sel => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return r.width && r.height ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
        };
        const panelEl = document.querySelector('.panel');
        const bodyEl = document.querySelector('.panel-body');
        const rankEl = document.querySelector('.ranking');
        const bodyRect = bodyEl ? bodyEl.getBoundingClientRect() : null;
        const visibleRows = bodyRect ? Array.from(document.querySelectorAll('.ranking ol > li')).filter(li => {
          const r = li.getBoundingClientRect();
          return r.height > 0 && r.bottom <= bodyRect.bottom + 2 && r.top >= bodyRect.top - 2;
        }).length : 0;
        const chromeRatio = panelEl && rankEl
          ? Number(((rankEl.getBoundingClientRect().top - panelEl.getBoundingClientRect().top) / Math.max(1, panelEl.getBoundingClientRect().height)).toFixed(2))
          : null;
        return {
          overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
          tools: rect('.map-tools'),
          mapOnly: rect('.map-only-toggle'),
          flowbar: rect('.flowbar'),
          zoomCtrl: rect('.maplibregl-ctrl-bottom-right'),
          visibleRows,
          chromeRatio,
        };
      });

      const problems = [];
      if (errors.length) problems.push(`console/page errors: ${errors.join('; ')}`);
      if (metrics.overflowX) problems.push('horizontal overflow detected');
      if (overlap(metrics.tools, metrics.mapOnly)) problems.push('.map-tools overlaps .map-only-toggle');
      if (overlap(metrics.flowbar, metrics.zoomCtrl)) problems.push('.flowbar overlaps zoom control');
      if (c.name === 'desktop-1440' && metrics.visibleRows < 5) {
        problems.push(`too few visible ranking rows above the fold: ${metrics.visibleRows}`);
      }

      if (problems.length) {
        failures++;
        console.error(`[FAIL] ${c.name}:`, problems);
      } else {
        const extra = c.name === 'desktop-1440'
          ? ` (visibleRows=${metrics.visibleRows}, chromeRatio=${metrics.chromeRatio})`
          : '';
        console.log(`[PASS] ${c.name}${extra}`);
      }
      if (SHOT_DIR) {
        await page.screenshot({ path: path.join(SHOT_DIR, `${c.name}.png`), fullPage: false });
      }
      if (c.name === 'desktop-1440') {
        const netTab = page.getByRole('button', { name: '全線人次', exact: true }).first();
        if (await netTab.count() > 0 && await netTab.isVisible()) {
          await netTab.click();
          await page.waitForTimeout(1000);
          const netMetricBtn = page.getByRole('button', { name: '淨進出', exact: true }).first();
          if (await netMetricBtn.count() > 0 && await netMetricBtn.isVisible()) {
            await netMetricBtn.click();
            await page.waitForTimeout(900);
          }
          if (SHOT_DIR) {
            await page.screenshot({ path: path.join(SHOT_DIR, `${c.name}-network.png`), fullPage: false });
          }
          const stationTab = page.getByRole('button', { name: '單站往來', exact: true }).first();
          if (await stationTab.count() > 0 && await stationTab.isVisible()) {
            await stationTab.click();
            await page.waitForTimeout(600);
          }
          const pairTab = page.getByRole('button', { name: '兩站比較', exact: true }).first();
          if (await pairTab.count() > 0 && await pairTab.isVisible()) {
            await pairTab.click();
            await page.waitForTimeout(500);
          }
        }
        const reselect = page.getByText('南港展覽館').first();
        if (await reselect.count() > 0 && await reselect.isVisible()) {
          await reselect.click();
          await page.waitForTimeout(1350);
          const evidenceSummary = page.getByText('深入分析與逐時分布').first();
          if (await evidenceSummary.count() > 0 && await evidenceSummary.isVisible()) {
            await evidenceSummary.click();
            await page.waitForTimeout(300);
          }
        }
        const themeBtn = page.locator('.theme-switch').first();
        if (await themeBtn.count() > 0 && await themeBtn.isVisible()) {
          await themeBtn.click();
          await page.mouse.move(10, 10);
          await page.waitForTimeout(450);
          if (SHOT_DIR) {
            await page.screenshot({ path: path.join(SHOT_DIR, `${c.name}-dark.png`), fullPage: false });
          }
        }
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }

  if (failures) process.exit(1);
})();
