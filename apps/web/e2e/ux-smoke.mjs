import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '../dist/web/browser');
const API_ORIGIN = process.env.EXITPULSE_API_ORIGIN || 'https://exitpulse.150-230-109-154.sslip.io';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = [
    'playwright',
    ...(process.env.NODE_PATH ? process.env.NODE_PATH.split(path.delimiter).filter(Boolean).map(p => path.join(p, 'playwright')) : []),
  ];
  for (const mod of candidates) {
    try {
      return require(mod);
    } catch { /* try next candidate */ }
  }
  throw new Error('找不到 playwright 套件。請先執行 npm install -D playwright 或透過 NODE_PATH 指定其 node_modules。');
}

function startStaticWithProxy() {
  if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    throw new Error(`找不到編譯輸出 ${DIST_DIR}，請先執行 npm run build。`);
  }
  const proxyAgent = new https.Agent({ keepAlive: false });
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const urlPath = (req.url || '/').split('?')[0];
      if (urlPath.startsWith('/api/')) {
        const proxyReq = https.request(API_ORIGIN + req.url, {
          agent: proxyAgent,
          method: req.method,
          headers: { accept: req.headers.accept || '*/*' },
        }, proxyRes => {
          res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
          proxyRes.pipe(res);
        });
        proxyReq.on('error', err => {
          res.writeHead(502);
          res.end(String(err));
        });
        req.pipe(proxyReq);
        return;
      }

      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
      let filePath = path.join(DIST_DIR, rel);
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(DIST_DIR, 'index.html');
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, proxyAgent, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

(async () => {
  const { chromium } = loadPlaywright();
  const targetUrl = process.env.EXITPULSE_BASE_URL;
  const local = targetUrl ? null : await startStaticWithProxy();
  const baseUrl = targetUrl || local.baseUrl;
  console.log('ExitPulse E2E smoking:', baseUrl);

  const launchOpts = {
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader'],
  };
  if (process.env.PLAYWRIGHT_CHROME_EXE && fs.existsSync(process.env.PLAYWRIGHT_CHROME_EXE)) {
    launchOpts.executablePath = process.env.PLAYWRIGHT_CHROME_EXE;
  }

  const browser = await chromium.launch(launchOpts);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(String(e)));

  try {
    // --- 1. FirstQuery keyboard selection (ArrowDown, Escape, Enter) & station code BL12 ---
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    const fqInput = page.locator('#first-query-station');
    await fqInput.waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(800);

    await fqInput.fill('南港');
    await page.locator('#first-query-matches button').first().waitFor({ state: 'visible', timeout: 5000 });
    assert((await page.locator('#first-query-matches button').count()) >= 2, 'Expected >=2 matches for 南港');
    assert(await page.locator('#fq-opt-0').evaluate(el => el.classList.contains('active')), 'First option should start active');

    await fqInput.press('ArrowDown');
    await page.locator('#fq-opt-1.active').waitFor({ state: 'visible', timeout: 3000 });
    const secondText = (await page.locator('#fq-opt-1 .first-query-station-name').innerText()).trim();

    await fqInput.press('Escape');
    await page.waitForTimeout(150);
    assert((await fqInput.inputValue()) === '', 'Escape should clear FirstQuery input');
    assert((await page.locator('#first-query-matches').count()) === 0, 'Matches should close after Escape');

    await fqInput.fill('南港');
    await page.locator('#first-query-matches button').nth(1).waitFor({ state: 'visible' });
    await fqInput.press('ArrowDown');
    await fqInput.press('Enter');
    await page.locator('app-explore').waitFor({ state: 'visible', timeout: 10000 });
    assert((await page.locator('app-explore .pill').first().locator('.pill-main').innerText()).trim() === secondText, 'ArrowDown+Enter should open highlighted station');
    console.log('PASS 1a: FirstQuery keyboard selection');

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await fqInput.waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(800);
    await fqInput.fill('BL12');
    await page.locator('#first-query-matches button').first().waitFor({ state: 'visible', timeout: 5000 });
    await fqInput.press('Enter');
    await page.locator('app-explore').waitFor({ state: 'visible', timeout: 10000 });
    assert((await page.locator('app-explore .pill').first().locator('.pill-main').innerText()).trim() === '台北車站', 'BL12+Enter should open 台北車站');
    console.log('PASS 1b: FirstQuery station code resolution');

    // --- 2. Station mode: '/' search, R10/BL18 switch, peer auto-close, card export & StationPreview ---
    await page.locator('.panel-body').click({ position: { x: 10, y: 10 } });
    await page.keyboard.press('/');
    const searchSelector = '#editor-station input[type="search"]';
    await page.locator(searchSelector).waitFor({ state: 'visible', timeout: 5000 });
    assert(await page.evaluate(() => document.activeElement?.closest('#editor-station') !== null && document.activeElement?.tagName === 'INPUT'), '/ should focus station search');

    await page.locator(searchSelector).fill('BL18');
    await page.locator(searchSelector).press('Enter');
    await page.waitForTimeout(400);
    assert((await page.locator('app-explore .pill').first().locator('.pill-main').innerText()).trim() === '市政府', 'BL18+Enter -> 市政府');

    await page.locator('.panel-body').click({ position: { x: 10, y: 10 } });
    await page.keyboard.press('/');
    await page.locator(searchSelector).waitFor({ state: 'visible', timeout: 5000 });
    await page.locator(searchSelector).fill('R10');
    await page.locator(searchSelector).press('Enter');
    await page.waitForTimeout(400);
    assert((await page.locator('app-explore .pill').first().locator('.pill-main').innerText()).trim() === '台北車站', 'R10+Enter -> 台北車站');

    await page.locator('app-explore .query-item').nth(3).locator('button.pill').click();
    await page.locator('#editor-peer select').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('#editor-peer select').selectOption('市政府');
    await page.waitForTimeout(400);
    assert((await page.locator('#editor-peer').count()) === 0, 'Peer editor should auto-close');
    await page.locator('.peer-card').waitFor({ state: 'visible', timeout: 10000 });

    // Check StationPreview extracted component via Station Info link in TimePlayer & share card button
    await page.locator('app-time-player button.station-info-link').click();
    await page.locator('section.station-preview .station-preview-head h2').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('section.station-preview button[aria-label="關閉車站資訊"]').click();
    await page.waitForFunction(() => document.querySelector('section.station-preview') === null, null, { timeout: 3000 });

    await page.locator('app-explore button.result-tools-toggle').click();
    await page.locator('app-explore .tools button', { hasText: '圖卡' }).waitFor({ state: 'visible', timeout: 3000 });
    console.log('PASS 2: Station / search, peer auto-close, StationPreview & share card CTA');

    // --- 3. TimePlayer keyboard Space/ArrowRight with zero button/map conflict ---
    const startHourlyBtn = page.locator('app-time-player button.start');
    if (await startHourlyBtn.count()) await startHourlyBtn.click();
    await page.locator('app-time-player strong.hour').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(600);

    const hourBefore = (await page.locator('app-time-player strong.hour').innerText()).trim();
    await page.locator('app-explore .headline').first().click({ position: { x: 5, y: 5 } });
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    assert((await page.locator('app-time-player strong.hour').innerText()).trim() !== hourBefore, 'ArrowRight should advance hour');

    const playBtn = page.locator('app-time-player button.play');
    assert((await playBtn.innerText()).includes('播放'));
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    assert((await playBtn.innerText()).includes('暫停'), 'Space should start playback');
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    assert((await playBtn.innerText()).includes('播放'), 'Space should pause playback');

    await page.locator('app-time-player button.all-day').focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    assert((await playBtn.innerText()).includes('播放'), 'Space on button must not trigger TimePlayer');

    await page.locator('app-time-player .quick-hours button').first().click();
    await page.waitForTimeout(200);
    const hourFixed = (await page.locator('app-time-player strong.hour').innerText()).trim();
    await page.locator('.maplibregl-canvas').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    assert((await page.locator('app-time-player strong.hour').innerText()).trim() === hourFixed, 'ArrowRight on map canvas must not advance TimePlayer');
    console.log('PASS 3: TimePlayer Space/ArrowRight zero-conflict');

    // --- 4. Network mode '/' shortcut & coverage tab ---
    await page.locator('.view-tabs button', { hasText: '全線人次' }).click();
    await page.locator('app-explore .list-title h2', { hasText: '各站進出' }).waitFor({ state: 'visible', timeout: 15000 });
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('/');
    await page.waitForFunction(() => document.activeElement?.tagName === 'INPUT' && document.activeElement?.closest('.tools') !== null, null, { timeout: 3000 });

    await page.locator('app-explore .section-tabs button', { hasText: '紀錄' }).click();
    await page.locator('app-explore-coverage .coverage-summary').waitFor({ state: 'visible', timeout: 10000 });
    console.log('PASS 4: Network / shortcut & ExploreCoverage');

    // --- 5. Pairs mode: auto-query, swap, 3D lowAngle exit, About version ---
    await page.locator('.view-tabs button', { hasText: '兩站比較' }).click();
    await page.waitForTimeout(400);
    const fqCompare = page.locator('button.first-query-compare');
    if (await fqCompare.count()) await fqCompare.click();
    else await page.locator('button.primary', { hasText: '找出變化最大的兩站' }).click();
    await page.locator('.ranking ol li button').first().waitFor({ state: 'visible', timeout: 15000 });

    await page.locator('section.conditions .section-toggle').click();
    await page.locator('#conditions-body').waitFor({ state: 'visible' });
    const oldFirstPair = (await page.locator('.ranking ol li button').first().innerText()).trim();
    await page.locator('#conditions-body .grid select').nth(1).selectOption('16-19');
    await page.waitForFunction(() => {
      const fb = document.querySelector('.panel .radar-feedback')?.textContent || '';
      const loadingBtn = document.querySelector('.panel button.primary');
      return !loadingBtn && !fb.includes('將自動更新');
    }, null, { timeout: 15000 });
    assert(await page.locator('#conditions-body').isVisible(), 'Auto-query must keep conditions open');
    assert((await page.locator('.ranking ol li button').first().innerText()).trim() !== oldFirstPair, 'Ranking should auto-refresh');

    await page.locator('details.direct-pair summary').click();
    const originInput = page.locator('.direct-pair-row input').nth(0);
    const destInput = page.locator('.direct-pair-row input').nth(1);
    const directSubmit = page.locator('button.direct-submit');
    await originInput.fill('台北車');
    await destInput.fill('BL23');
    assert(!(await directSubmit.isDisabled()), 'directSubmit should enable');

    await page.locator('button.pair-swap-btn').click();
    await page.waitForFunction(() => {
      const inputs = document.querySelectorAll('.direct-pair-row input');
      return inputs[0]?.value === 'BL23' && inputs[1]?.value === '台北車';
    }, null, { timeout: 3000 });
    await page.locator('button.pair-swap-btn').click();
    await page.waitForFunction(() => {
      const inputs = document.querySelectorAll('.direct-pair-row input');
      return inputs[0]?.value === '台北車' && inputs[1]?.value === 'BL23';
    }, null, { timeout: 3000 });
    await directSubmit.click();
    await page.locator('app-pair-detail .detail').waitFor({ state: 'visible', timeout: 10000 });

    await page.locator('button.tower-switch').click();
    const lowAngleBtn = page.locator('button.map-angle');
    await lowAngleBtn.waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(800);
    await lowAngleBtn.click();
    await page.waitForFunction(() => document.querySelector('button.map-angle')?.getAttribute('aria-pressed') === 'true', null, { timeout: 3000 });

    await page.locator('.ranking ol li button').nth(2).click();
    await page.waitForFunction(() => document.querySelector('button.map-angle')?.getAttribute('aria-pressed') === 'false', null, { timeout: 4000 });

    await lowAngleBtn.click();
    await page.waitForFunction(() => document.querySelector('button.map-angle')?.getAttribute('aria-pressed') === 'true', null, { timeout: 3000 });
    await page.locator('.map-tools button', { hasText: '全圖' }).first().click();
    await page.waitForFunction(() => document.querySelector('button.map-angle')?.getAttribute('aria-pressed') === 'false', null, { timeout: 3000 });

    await page.locator('button.map-about').click();
    const aboutText = await page.locator('app-about dialog').innerText();
    assert(aboutText.includes('v1.4.0'), 'About dialog must mention v1.4.0');
    await page.locator('app-about button.close').click();
    console.log('PASS 5: Pairs auto-update, manual swap, 3D lowAngle exit & About v1.4.0');

    assert(consoleErrors.length === 0, `Console errors: ${JSON.stringify(consoleErrors)}`);
    assert(pageErrors.length === 0, `Page errors: ${JSON.stringify(pageErrors)}`);
    console.log('ALL_E2E_SMOKE_PASSED (0 console/page errors)');
  } finally {
    await browser.close();
    local?.proxyAgent.destroy();
    local?.server.closeAllConnections?.();
    local?.server.close();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
