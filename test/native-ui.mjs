/** Explicit local acceptance against a built Windows executable, never a Vite substitute. */
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, createConnection } from 'node:net';
import assert from 'node:assert/strict';

if (process.platform !== 'win32') throw new Error('Native Windows test requires Windows.');
const root = fileURLToPath(new URL('../', import.meta.url));
const profile = process.env.NIVO_NATIVE_TEST_PROFILE ?? 'debug';
if (!['debug', 'release'].includes(profile)) throw new Error('Invalid native test profile.');
const executable = fileURLToPath(new URL(`../src-tauri/target/${profile}/nivo-desktop.exe`, import.meta.url));
const artifacts = new URL('../artifacts/native-ui/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const port = await new Promise(resolve => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
// Debugging is enabled only for this child; no product setting, remote listener or security policy changes.
const child = spawn(executable, [], {
  cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,
    WEBVIEW2_USER_DATA_FOLDER: fileURLToPath(new URL('webview-profile/', artifacts)) },
});
let log = '', browser, page, original;
child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
const report = { environment: `actual ${profile} Tauri executable / WebView2`, status: 'running', checks: [], limits: 'Does not validate games, fullscreen, Alt+Tab, DPI combinations, perceived smoothness or long-session performance.' };
report.executableSha256 = createHash('sha256').update(await readFile(executable)).digest('hex');
report.sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
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
  await page.locator('#input-mute').scrollIntoViewIfNeeded();
  await page.locator('#island').screenshot({ path: fileURLToPath(new URL('native-microphone.png', artifacts)) });
  await page.getByRole('button', { name: 'Preferencias', exact: true }).click();
  const integrationsDetails = page.locator('details').filter({ has: page.locator('#integrations-enabled') });
  if (!(await integrationsDetails.evaluate(details => details.open))) await integrationsDetails.locator('summary').click();
  await page.locator('#integrations-enabled').check();
  let credentials;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { credentials = JSON.parse(await readFile(path.join(process.env.APPDATA, 'com.orvyn.nivo', 'integrations', 'connection.json'), 'utf8')); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.ok(credentials?.pipe && credentials?.token);
  async function send(event) {
    return new Promise((resolve, reject) => {
      const socket = createConnection(credentials.pipe); let response = '';
      socket.setTimeout(2000, () => socket.destroy(new Error('Pipe fixture timed out.')));
      socket.once('error', reject);
      socket.once('connect', () => socket.write(JSON.stringify({ token: credentials.token, event }) + '\n'));
      socket.on('data', chunk => { response += chunk; if (response.includes('\n')) { socket.destroy(); resolve(JSON.parse(response).ok); } });
    });
  }
  assert.equal(await send({ kind: 'agent', taskId: 'native-acceptance-fixture', status: 'working' }), true);
  await page.getByRole('button', { name: 'Actividad', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('agent-status').textContent === 'Codex está trabajando');
  const host = spawn(executable, ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/'], { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const payload = Buffer.from(JSON.stringify({ kind: 'download', id: 'native-browser-fixture', source: 'browser', name: 'fixture.txt', state: 'active', received: 25, total: 100, bytesPerSecond: null }));
  const length = Buffer.alloc(4); length.writeUInt32LE(payload.length);
  const response = await new Promise((resolve, reject) => {
    const chunks = []; const deadline = setTimeout(() => { host.kill(); reject(new Error('Native messaging fixture timed out.')); }, 5000);
    host.once('error', error => { clearTimeout(deadline); reject(error); });
    host.stdout.on('data', chunk => chunks.push(chunk));
    host.once('close', code => { clearTimeout(deadline); if (code !== 0) reject(new Error(`Native messaging host exited ${code}`)); else resolve(Buffer.concat(chunks)); });
    host.stdin.end(Buffer.concat([length, payload]));
  });
  assert.equal(response.readUInt32LE(0), response.length - 4);
  assert.equal(JSON.parse(response.subarray(4).toString()).ok, true);
  await page.waitForFunction(() => document.querySelector('#download-activity progress')?.value === .25);
  report.checks.push('Authenticated local pipe and native-messaging executable deliver typed fixture events into the actual UI; no user hooks or browser registration changed.');
  for (let index = 0; index < 4; index++) {
    await page.locator('#toggle').evaluate(button => button.click());
    await page.waitForFunction(() => document.getElementById('island').getAnimations({ subtree: true }).every(value => value.playState !== 'running'));
  }
  const status = (await page.locator('#bridge-status').textContent() ?? '').trim();
  if (status) report.nativeStatus = status;
  assert.ok(!/Geometría visual|región interactiva|fuera de la isla/.test(status), status);
  report.checks.push('Four open/close transitions with real geometry IPC complete without reported native region errors.');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.message; process.exitCode = 1;
  if (page) {
    report.ui = await page.evaluate(() => ({ expanded: document.getElementById('toggle')?.getAttribute('aria-expanded'),
      views: ['activity', 'audio', 'preferences', 'drop', 'notification'].map(id => [id, document.getElementById(id)?.hidden]),
      tabs: [...document.querySelectorAll('nav button')].map(button => [button.id, button.getAttribute('aria-pressed')]),
      status: document.getElementById('bridge-status')?.textContent,
    })).catch(() => null);
    await page.locator('#island').screenshot({ path: fileURLToPath(new URL('native-failure.png', artifacts)) }).catch(() => {});
  }
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
