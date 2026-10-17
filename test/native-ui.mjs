/** Explicit local acceptance against a built Windows executable, never a Vite substitute. */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

if (process.platform !== 'win32') throw new Error('Native Windows test requires Windows.');
const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = new URL('../artifacts/native-ui/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const port = await new Promise(resolve => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
// Debugging is enabled only for this child; no product setting, remote listener or security policy changes.
const child = spawn(fileURLToPath(new URL('../src-tauri/target/debug/nivo-desktop.exe', import.meta.url)), [], {
  cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,
    WEBVIEW2_USER_DATA_FOLDER: fileURLToPath(new URL('webview-profile/', artifacts)) },
});
let log = '', browser, page, original;
child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
const report = { environment: 'actual debug Tauri executable / WebView2', status: 'running', checks: [], limits: 'Does not validate games, fullscreen, Alt+Tab, DPI combinations, perceived smoothness or long-session performance.' };
try {
  let endpoint;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error(`Nivo exited: ${child.exitCode}`);
    try { endpoint = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  if (!endpoint?.webSocketDebuggerUrl) throw new Error('WebView2 debug target did not respond.');
  browser = await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);
  page = browser.contexts()[0].pages()[0];
  if (!page) { const context = browser.contexts()[0]; page = await context.waitForEvent('page', { timeout: 10000 }); }
  page.setDefaultTimeout(10000);
  await page.waitForFunction(() => document.getElementById('toggle')?.disabled === false);
  assert.equal(await page.locator('body').getAttribute('data-environment'), 'native');
  original = await page.evaluate(() => window.__TAURI__.core.invoke('get_settings'));
  await page.locator('#island').screenshot({ path: fileURLToPath(new URL('native-compact.png', artifacts)) });
  await page.locator('#toggle').click();
  await page.waitForFunction(() => document.getElementById('toggle').getAttribute('aria-expanded') === 'true');
  await page.getByRole('button', { name: 'Preferencias', exact: true }).click();
  await page.locator('#audio-enabled').check();
  await page.getByRole('button', { name: 'Sonido', exact: true }).click();
  await page.waitForFunction(() => !document.getElementById('audio-controls').hidden);
  report.audio = await page.evaluate(async () => {
    const value = await window.__TAURI__.core.invoke('get_audio_snapshot');
    return { status: value.status, output: value.output?.name ?? null, input: value.input?.name ?? null, sessionCount: value.sessions.length, deviceCount: value.devices.length };
  });
  await page.locator('#island').screenshot({ path: fileURLToPath(new URL('native-audio.png', artifacts)) });
  assert.equal(report.audio.status, 'ready');
  report.checks.push('Real executable starts, renders native UI, opens settings and enumerates actual Core Audio devices/sessions.');
  for (let index = 0; index < 4; index++) {
    await page.locator('#toggle').evaluate(button => button.click());
    await page.waitForFunction(() => document.getElementById('island').getAnimations({ subtree: true }).every(value => value.playState !== 'running'));
  }
  const status = await page.locator('#bridge-status').textContent();
  if (status) report.nativeStatus = status;
  assert.ok(!/Geometría visual|región interactiva|fuera de la isla/.test(status), status);
  report.checks.push('Four open/close transitions with real geometry IPC complete without reported native region errors.');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.message; process.exitCode = 1;
} finally {
  if (page && original) {
    try { await page.evaluate(settings => window.__TAURI__.core.invoke('save_settings', { settings }), original); }
    catch (error) { report.restoreError = error.message; process.exitCode = 1; report.status = 'failed'; }
  }
  if (page) await page.evaluate(() => window.__TAURI__.core.invoke('quit_app')).catch(() => {});
  if (browser) await browser.close().catch(() => {});
  await new Promise(resolve => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); setTimeout(() => { child.kill(); resolve(); }, 4000).unref(); });
  await writeFile(new URL('native-ui.log', artifacts), log);
  await writeFile(new URL('native-ui.json', artifacts), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
