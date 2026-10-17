import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let chromium, createServer;
console.log('UI: loading Playwright and Vite');
try {
  ({ chromium } = createRequire(import.meta.url)('@playwright/test'));
  ({ createServer } = await import('vite'));
} catch (error) {
  const message = 'UI_DEPENDENCIES_UNAVAILABLE: instala las dependencias de Nivo con npm.cmd ci antes de ejecutar npm.cmd run test:ui. No se ha probado la interfaz.';
  const artifacts = new URL('../artifacts/', import.meta.url);
  await mkdir(artifacts, { recursive: true });
  await writeFile(new URL('ui-validation.json', artifacts), JSON.stringify({
    schemaVersion: 1, status: 'blocked', finishedUtc: new Date().toISOString(),
    environment: 'Vite browser preview; not native Tauri', failure: message,
    checks: [], screenshots: [], metrics: [],
  }, null, 2));
  throw new Error(message, { cause: error });
}

const root = fileURLToPath(new URL('../', import.meta.url));
const browserChannel = process.env.NIVO_TEST_BROWSER ?? 'chromium';
if (!['chromium', 'msedge'].includes(browserChannel)) throw new Error('NIVO_TEST_BROWSER must be chromium or msedge.');
const softwareRendering = process.env.NIVO_TEST_SOFTWARE_RENDERING === '1';
console.log('UI: creating the loopback server');
const server = await createServer({
  configFile: false, root, logLevel: 'error', clearScreen: false,
  server: {
    host: '127.0.0.1', port: 0, strictPort: false, allowedHosts: ['127.0.0.1', 'localhost'],
    watch: { ignored: ['**/src-tauri/**', '**/artifacts/**'] },
    fs: { strict: true, deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/src-tauri/**'] },
  },
});
await server.listen();
console.log('UI: loopback server listening');
let browser;
let page;
const report = { schemaVersion: 1, status: 'running', startedUtc: new Date().toISOString(), environment: 'Vite browser preview; not native Tauri', browserChannel, softwareRendering, node: process.version, checks: [], screenshots: [], metrics: [] };
const errors = [];
const artifacts = new URL('../artifacts/', import.meta.url);
await mkdir(artifacts, { recursive: true });
await writeFile(new URL('ui-validation.json', artifacts), JSON.stringify(report, null, 2));

async function bounded(label, operation, timeoutMs = 15000) {
  console.log(`UI: ${label}`);
  let timer;
  try {
    return await Promise.race([operation(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs} ms`)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

async function stable(expanded) {
  await page.waitForFunction(value => {
    const island = document.getElementById('island');
    const panel = document.getElementById('island-panel');
    return document.getElementById('toggle').getAttribute('aria-expanded') === String(value)
      && panel.hidden === !value && panel.inert === !value
      && island.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running');
  }, expanded);
}

async function dimensions(width, height) {
  const bounds = await page.locator('#island').boundingBox();
  assert.ok(bounds);
  assert.ok(Math.abs(bounds.width - width) < .5, `Expected width ${width}, got ${bounds.width}`);
  assert.ok(Math.abs(bounds.height - height) < .5, `Expected height ${height}, got ${bounds.height}`);
}

async function capture(name) {
  await page.screenshot({ path: fileURLToPath(new URL(name, artifacts)), animations: 'disabled' });
  report.screenshots.push(name);
}

try {
  console.log(`UI: launching ${browserChannel} with sandbox enabled`);
  browser = await chromium.launch({ channel: browserChannel, headless: true, chromiumSandbox: true, timeout: 15000, args: softwareRendering ? ['--disable-gpu'] : [] });
  report.browser = browser.version();
  console.log(`UI: Chromium ${report.browser} connected`);
  page = await bounded('creating the browser page', () => browser.newPage({ viewport: { width: 1100, height: 720 }, reducedMotion: 'no-preference' }));
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  await page.goto(`http://127.0.0.1:${address.port}`);
  const toggle = page.locator('#toggle');
  await page.waitForFunction(() => !document.getElementById('toggle').disabled);
  assert.equal(await page.locator('body').getAttribute('data-environment'), 'preview');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('#nivo-companion').isVisible(), true);
  await dimensions(112, 34);
  await capture('island-compact.png');
  report.checks.push('Current Vite/TypeScript frontend, quiet 112x34 capsule.');

  await toggle.focus();
  await page.keyboard.press('Enter');
  await stable(true);
  await dimensions(388, 320);
  assert.equal(await page.locator('#activity').isVisible(), true);
  assert.match(await page.locator('#media-empty-description').textContent(), /El reproductor se conecta al abrir la aplicación Nivo/);
  assert.equal(await page.locator('#media-player').isVisible(), false, 'preview has no live Windows session');
  assert.equal(await page.locator('#nivo-companion').getAttribute('data-pose'), 'focus');
  assert.equal(await page.locator('#companion-welcome').evaluate(el => getComputedStyle(el).color), 'rgb(35, 40, 49)');
  await capture('island-expanded.png');
  await page.getByRole('button', { name: 'Preferencias', exact: true }).click();
  await page.keyboard.press('Escape');
  await stable(false);
  assert.equal(await toggle.evaluate(el => document.activeElement === el), true);
  report.checks.push('Keyboard opening, Escape closure and restored trigger focus.');

  await toggle.evaluate(button => { for (let index = 0; index < 5; index++) button.click(); });
  await stable(true);
  await toggle.evaluate(button => { for (let index = 0; index < 3; index++) button.click(); });
  await stable(false);
  await dimensions(112, 34);
  report.checks.push('Rapid repeated intent settles in the latest compact state.');

  await toggle.click();
  await stable(true);
  await page.getByRole('button', { name: 'Actividad', exact: true }).click();
  await page.locator('[data-minutes="1"]').click();
  await page.waitForFunction(() => document.getElementById('timer-phase').textContent === 'En marcha');
  assert.match(await page.locator('#timer-count').textContent(), /^(01:00|00:5\d)$/);
  assert.equal(await page.locator('#nivo-companion').getAttribute('data-pose'), 'timer');
  await capture('island-timer-running.png');
  await page.locator('#timer-pause').click();
  await page.waitForFunction(() => document.getElementById('timer-phase').textContent === 'En pausa');
  const paused = await page.locator('#timer-count').textContent();
  await page.waitForTimeout(1100);
  assert.equal(await page.locator('#timer-count').textContent(), paused);
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('toggle').disabled && document.getElementById('timer-phase').textContent === 'En pausa');
  await toggle.click();
  await stable(true);
  assert.equal(await page.locator('#timer-count').textContent(), paused);
  assert.equal(await page.locator('#timer-pause').textContent(), 'Reanudar');
  await capture('island-timer-restored.png');
  await page.locator('#timer-pause').click();
  await page.waitForFunction(() => document.getElementById('timer-phase').textContent === 'En marcha');
  await page.locator('#timer-cancel').click();
  assert.equal(await page.locator('#timer-idle').isVisible(), true);
  assert.equal(await page.evaluate(() => localStorage.getItem('nivo:timer:v1')), null);
  report.checks.push('Countdown starts, stays paused, survives reload, resumes and cancels.');

  await page.getByRole('button', { name: 'Preferencias', exact: true }).click();
  await page.locator('#reduce-motion').check();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('nivo:preferences:v1')).motion === 'reduced');
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('toggle').disabled);
  await toggle.click();
  await stable(true);
  await page.getByRole('button', { name: 'Preferencias', exact: true }).click();
  assert.equal(await page.locator('#reduce-motion').isChecked(), true);
  await page.locator('#mascot-enabled').uncheck();
  await page.waitForFunction(() => !JSON.parse(localStorage.getItem('nivo:preferences:v1')).mascot_enabled);
  assert.equal(await page.locator('#nivo-companion').isVisible(), false);
  await page.locator('#mascot-enabled').check();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('nivo:preferences:v1')).mascot_enabled);
  assert.equal(await page.locator('#nivo-companion').isVisible(), true);
  await capture('island-preferences.png');
  await page.locator('#reduce-motion').uncheck();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('nivo:preferences:v1')).motion === 'system');
  await page.keyboard.press('Escape');
  await stable(false);
  report.checks.push('Reduced-motion preference persists after reload.');

  const beforeInterruption = await page.evaluate(() => performance.now());
  await toggle.evaluate(button => button.click());
  await page.waitForFunction(() => document.getElementById('island').getAnimations().some(animation => animation.playState === 'running'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await stable(true);
  await dimensions(388, 320);
  assert.equal(await page.locator('#island').evaluate(el => [el.style.width, el.style.height, el.style.borderRadius].join('')), '');
  assert.equal(await page.evaluate(since => window.__NIVO_METRICS__().some(sample => sample.startedAt >= since && sample.interrupted), beforeInterruption), true);
  await page.getByRole('button', { name: 'Preferencias', exact: true }).click();
  assert.equal(await page.locator('#reduce-motion').isDisabled(), true);
  assert.equal(await page.locator('#reduce-motion').isChecked(), true);
  assert.equal(await page.locator('#hide-island').isVisible(), false, 'preview cannot hide a native window');
  assert.equal(await page.locator('#quit-app').isVisible(), false, 'preview cannot exit a native process');
  report.checks.push('System reduced motion interrupts a transition and settles final geometry.');

  await page.setViewportSize({ width: 320, height: 640 });
  await dimensions(288, 320);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator('#island-panel').evaluate(el => el.getBoundingClientRect().bottom <= document.querySelector('#island').getBoundingClientRect().bottom), true);
  await capture('island-small-viewport.png');
  report.checks.push('320px viewport keeps island and panel inside their bounds.');
  await page.getByRole('button', { name: 'Actividad', exact: true }).click();
  await page.clock.install();
  await page.locator('[data-minutes="1"]').click();
  await page.clock.fastForward(60_100);
  await page.waitForFunction(() => document.getElementById('nivo-companion').dataset.pose === 'complete');
  assert.equal(await page.locator('#nivo-companion').evaluate(el => el.getAnimations({ subtree: true }).length), 0);
  await capture('island-companion-complete-reduced.png');
  report.checks.push('Timer and completion expressions follow real countdown; reduced motion keeps completion static.');

  // Labelled visual fixtures use the shipped controller, SVG and CSS, never demo product data.
  await page.evaluate(async () => {
    const { createCompanion } = await import('/src/components/companion.ts');
    const gallery = document.createElement('div');
    gallery.id = 'companion-review';
    gallery.style.cssText = 'position:fixed;inset:0;background:#0c0e12;color:#a4abb7;padding:30px;display:flex;gap:24px;align-items:center;justify-content:center;font:12px Segoe UI;z-index:10';
    for (const pose of ['quiet', 'hover', 'focus', 'music', 'timer', 'complete', 'unavailable']) {
      const cell = document.createElement('div');
      cell.style.cssText = 'display:grid;justify-items:center;gap:22px';
      const label = document.createElement('span'); label.textContent = pose;
      cell.append(label);
      for (const large of [false, true]) {
        const face = document.getElementById('nivo-companion').cloneNode(true);
        face.removeAttribute('id'); face.removeAttribute('hidden');
        if (large) face.classList.add('companion-welcome');
        cell.append(face);
        createCompanion(face, cell).update({ enabled: true, visible: true, reduced: true, pose });
      }
      gallery.append(cell);
    }
    document.body.append(gallery);
  });
  await page.setViewportSize({ width: 1000, height: 300 });
  await capture('companion-expression-review.png');
  await page.locator('#companion-review').evaluate(el => el.remove());
  assert.deepEqual(errors, []);
  report.status = 'passed';
  console.log('PASS: current Vite frontend, geometry, keyboard/focus, rapid intent, timer/persistence, preferences, reduced-motion interruption and 320px viewport. Native Tauri acceptance remains separate.');
} catch (error) {
  report.status = 'failed';
  report.failure = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  report.errors = errors;
  if (page && !page.isClosed()) report.metrics = await page.evaluate(() => window.__NIVO_METRICS__?.() ?? []).catch(() => []);
  report.finishedUtc = new Date().toISOString();
  await writeFile(new URL('ui-validation.json', artifacts), JSON.stringify(report, null, 2));
  try { if (browser) await bounded('closing Chromium', () => browser.close(), 5000); }
  finally { await bounded('closing the development server', () => server.close(), 5000); }
}
