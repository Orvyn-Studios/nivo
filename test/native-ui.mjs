/** Explicit local acceptance against a built Windows executable, never a Vite substitute. */
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, createConnection } from 'node:net';
import assert from 'node:assert/strict';
import {checkNativeVisibility} from './native-visibility.mjs';

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
const report = { environment: `actual ${profile} Tauri executable / WebView2`, status: 'running', checks: [], limits: 'Does not validate games/exclusive fullscreen, Alt+Tab, DPI combinations, perceived smoothness or long-session performance. Borderless fullscreen is checked with an owned external fixture.' };
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
  const duplicateDirectory=fileURLToPath(new URL('duplicate/',artifacts));
  await mkdir(duplicateDirectory,{recursive:true});
  const duplicateExecutable=path.join(duplicateDirectory,'Nivo.exe');
  await copyFile(executable,duplicateExecutable);
  const duplicate=spawn(duplicateExecutable,[],{cwd:root,windowsHide:true,stdio:'ignore'});
  const duplicateCode=await new Promise((resolve,reject)=>{
    const deadline=setTimeout(()=>{duplicate.kill();reject(new Error('A second desktop copy remained running.'))},3000);
    duplicate.once('error',error=>{clearTimeout(deadline);reject(error)});
    duplicate.once('exit',code=>{clearTimeout(deadline);resolve(code)});
  });
  assert.equal(duplicateCode,0);
  assert.equal(child.exitCode,null,'primary desktop must remain running');
  report.checks.push('A second executable copied to another directory exits before creating a second island; the primary continues. Native-messaging hosts remain independent.');
  original = await page.evaluate(() => window.__TAURI__.core.invoke('get_settings'));
  report.appVisibility=await checkNativeVisibility(page,child.pid,root);
  report.checks.push('External ordinary HWND: Nivo stays above by default without taking focus, opt-in permits occlusion. External borderless fullscreen HWND: opt-in hides, exit restores, disabled setting remains visible.');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(async settings => {
    await window.__TAURI__.core.invoke('save_settings',{settings:{...settings,media_enabled:false,motion:'full',mascot_enabled:true}});
    window.__cursorSamples=[];
    await window.__TAURI__.event.listen('nivo://cursor',({payload})=>window.__cursorSamples.push(payload),{target:'island'});
  },original);
  function cursorProbe(action='snapshot',x=0,y=0) {
    return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-File',path.join(root,'test/native-cursor.ps1'),'-Action',action,'-X',String(x),'-Y',String(y)],{cwd:root,encoding:'utf8',windowsHide:true}).trim().replace(/^\uFEFF/,''));
  }
  const desktop=cursorProbe();
  try {
    const y=desktop.top+desktop.height-48;
    cursorProbe('move',desktop.left+16,y);
    await page.waitForFunction(()=>window.__cursorSamples.some(point=>point.x<0));
    await page.waitForFunction(()=>new DOMMatrix(getComputedStyle(document.querySelector('#nivo-companion .companion-gaze')).transform).m41<0);
    const left=await page.locator('#nivo-companion .companion-gaze').evaluate(el=>el.style.transform);
    cursorProbe('move',desktop.left+desktop.width-16,y);
    await page.waitForFunction(()=>window.__cursorSamples.some(point=>point.x>innerWidth));
    await page.waitForFunction(()=>new DOMMatrix(getComputedStyle(document.querySelector('#nivo-companion .companion-gaze')).transform).m41>0);
    const right=await page.locator('#nivo-companion .companion-gaze').evaluate(el=>el.style.transform);
    report.cursorIdleProbe={verified:false,attempts:[]};
    for(let attempt=0;attempt<4;attempt++){
      const settled=await page.evaluate(()=>window.__cursorSamples.length);
      await new Promise(resolve=>setTimeout(resolve,150));
      const probe=await page.evaluate(start=>({before:window.__cursorSamples[start-1],after:window.__cursorSamples.slice(start)}),settled);
      report.cursorIdleProbe.attempts.push(probe);
      if(!probe.after.length){report.cursorIdleProbe.verified=true;break;}
      // Shared-desktop physical movement is not idle. Repeated fixed positions,
      // however, remain a test failure rather than being hidden by a retry.
      assert.ok(probe.after.some(p=>p.x!==probe.before.x||p.y!==probe.before.y),'stationary mouse produced repeated cursor updates');
    }
    if(!report.cursorIdleProbe.verified)report.limits+=' Cursor idle subcheck had physical movement in all four bounded attempts; remains unverified in this run.';
    await page.locator('#toggle').click();
    await page.waitForFunction(()=>document.getElementById('toggle').getAttribute('aria-expanded')==='true');
    cursorProbe('move',desktop.left+16,y);
    await page.waitForFunction(()=>new DOMMatrix(getComputedStyle(document.querySelector('#companion-welcome .companion-gaze')).transform).m41<0);
    const expandedLeft=await page.locator('#companion-welcome .companion-gaze').evaluate(el=>el.style.transform);
    await page.locator('#island').screenshot({path:fileURLToPath(new URL('native-gaze-left.png',artifacts))});
    cursorProbe('move',desktop.left+desktop.width-16,y);
    await page.waitForFunction(()=>new DOMMatrix(getComputedStyle(document.querySelector('#companion-welcome .companion-gaze')).transform).m41>0);
    const expandedRight=await page.locator('#companion-welcome .companion-gaze').evaluate(el=>el.style.transform);
    await page.locator('#island').screenshot({path:fileURLToPath(new URL('native-gaze-right.png',artifacts))});
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.getElementById('toggle').getAttribute('aria-expanded')==='false');
    await page.evaluate(async()=>{const settings=await window.__TAURI__.core.invoke('get_settings');await window.__TAURI__.core.invoke('save_settings',{settings:{...settings,motion:'reduced'}})});
    await page.waitForFunction(()=>document.querySelector('#nivo-companion .companion-gaze').style.transform==='');
    const before=await page.evaluate(()=>window.__cursorSamples.length);
    cursorProbe('move',desktop.left+16,y);
    await new Promise(resolve=>setTimeout(resolve,150));
    assert.equal(await page.evaluate(()=>window.__cursorSamples.length),before,'reduced motion must unregister background cursor input');
    report.cursor={left,right,expandedLeft,expandedRight,samples:before,desktop:{width:desktop.width,height:desktop.height}};
  } finally { cursorProbe('restore',desktop.x,desktop.y); }
  report.checks.push('Real Win32 mouse movement at both desktop edges outside Nivo updates gaze in opposite directions; reduced motion unregisters cursor input; pointer position restored.');
  await page.locator('#island').screenshot({ path: fileURLToPath(new URL('native-compact.png', artifacts)) });
  await page.locator('#toggle').click();
  await page.waitForFunction(() => document.getElementById('toggle').getAttribute('aria-expanded') === 'true');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.getElementById('toggle').getAttribute('aria-expanded')==='true');
  assert.equal(await page.locator('#toggle').evaluate(el=>getComputedStyle(el).outlineStyle),'solid');
  await page.locator('#toggle').click();
  await page.locator('#toggle').click();
  await page.waitForFunction(()=>document.getElementById('toggle').getAttribute('aria-expanded')==='true');
  assert.equal(await page.locator('#toggle').evaluate(el=>getComputedStyle(el).outlineStyle),'none');
  assert.equal(await page.locator('.panel-scroll').evaluate(el=>getComputedStyle(el).scrollbarWidth),'none');
  assert.equal(await page.locator('#activity-footer').count(),1);
  for(const id of ['open-audio','open-preferences']){
    assert.equal(await page.locator(`#${id}:visible`).count(),1);
    assert.equal(await page.locator(`#${id} svg`).count(),1);
  }
  await page.locator('#island').screenshot({path:fileURLToPath(new URL('native-chevron-fixed.png',artifacts))});
  report.checks.push('Actual WebView2 chevron retains keyboard focus, removes pointer-click ring and hides the island scrollbar.');
  const context = browser.contexts()[0];
  const [preferencesPage] = await Promise.all([context.waitForEvent('page'), page.locator('#open-preferences').click()]);
  await preferencesPage.waitForSelector('body[data-ready=true]');
  await preferencesPage.locator('#hide-behind-apps').check();
  await preferencesPage.waitForFunction(async()=>(await window.__TAURI__.core.invoke('get_settings')).hide_behind_apps===true);
  await preferencesPage.locator('#hide-behind-apps').uncheck();
  await preferencesPage.waitForFunction(async()=>(await window.__TAURI__.core.invoke('get_settings')).hide_behind_apps===false);
  await preferencesPage.screenshot({path:fileURLToPath(new URL('native-visibility-preferences.png',artifacts))});
  await preferencesPage.screenshot({ path: fileURLToPath(new URL('native-preferences.png', artifacts)) });
  await preferencesPage.getByRole('button', { name: 'Audio', exact: true }).click();
  await preferencesPage.locator('#audio-enabled').check();
  await preferencesPage.getByRole('button', { name: 'Integraciones', exact: true }).click();
  await preferencesPage.locator('#integrations-enabled').check();
  await preferencesPage.waitForFunction(async () => (await window.__TAURI__.core.invoke('get_settings')).integrations_enabled);
  let denied = false;
  try { await preferencesPage.evaluate(() => window.__TAURI__.core.invoke('get_audio_snapshot')); } catch { denied = true; }
  assert.equal(denied, true, 'preferences capability must not read/control audio sessions');
  denied=false;
  try { await preferencesPage.evaluate(() => window.__TAURI__.core.invoke('set_companion_tracking',{enabled:true})); } catch { denied=true; }
  assert.equal(denied,true,'preferences capability must not enable desktop cursor tracking');
  for(const command of ['open_github_item','open_mail_draft']){
    const blocked=await preferencesPage.evaluate(async command=>{try{await window.__TAURI__.core.invoke(command,{id:'invalid',draft:{recipient:'invalid',subject:'',body:''}});return false}catch{return true}},command);
    assert.equal(blocked,true,'preferences must not open GitHub items or mail drafts');
  }
  for(const command of ['connect_github','get_github_connection']){
    const blocked=await page.evaluate(async command=>{try{await window.__TAURI__.core.invoke(command,{token:'invalid-fixture'});return false}catch{return true}},command);
    assert.equal(blocked,true,'island must not configure or enumerate the GitHub account');
  }
  const githubBoundary=await page.evaluate(async()=>{const s=await window.__TAURI__.core.invoke('get_github_snapshot');return{hasToken:Object.hasOwn(s,'token'),bounded:Array.isArray(s.items)&&s.items.length<=240}});
  assert.deepEqual(githubBoundary,{hasToken:false,bounded:true});
  report.checks.push('Actual capability boundaries: island cannot connect/enumerate the GitHub account; preferences cannot open GitHub items or mail drafts; snapshot has no token field and remains bounded. No real credential or mail client used.');
  await preferencesPage.keyboard.press('Escape');
  await page.locator('#open-audio').click();
  await page.waitForFunction(() => !document.getElementById('audio-controls').hidden);
  report.audio = await page.evaluate(async () => {
    const value = await window.__TAURI__.core.invoke('get_audio_snapshot');
    return { status: value.status, output: value.output?.name ?? null, input: value.input?.name ?? null, sessionCount: value.sessions.length, deviceCount: value.devices.length };
  });
  await page.locator('#island').screenshot({ path: fileURLToPath(new URL('native-audio.png', artifacts)) });
  assert.equal(report.audio.status, 'ready');
  report.checks.push('Actual independent preferences window opens, saves, closes with Escape, rejects audio access by ACL, and updates the island audio controls.');
  await page.locator('#input-mute').scrollIntoViewIfNeeded();
  await page.locator('#island').screenshot({ path: fileURLToPath(new URL('native-microphone.png', artifacts)) });
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
  await page.keyboard.press('Escape');
  await page.locator('#toggle').click();
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
  await page.evaluate(async()=>{
    const settings=await window.__TAURI__.core.invoke('get_settings');
    await window.__TAURI__.core.invoke('save_settings',{settings:{...settings,media_enabled:true,integrations_enabled:false,notifications_enabled:false}});
  });
  await page.waitForFunction(async()=>(await window.__TAURI__.core.invoke('get_media_snapshot')).status==='ready');
  report.nativeMusic=await page.evaluate(async()=>{
    const value=await window.__TAURI__.core.invoke('get_media_snapshot');
    return{status:value.status,sessions:value.sessions.length,active:Boolean(value.activeSessionId)};
  });
  if(report.nativeMusic.active){
    await page.waitForFunction(()=>document.getElementById('island').dataset.context==='music');
    await page.waitForFunction(()=>document.getElementById('island').getAnimations({subtree:true}).every(a=>a.playState!=='running'));
    assert.equal(await page.locator('#media-widget select').count(),0);
    for(const id of ['open-audio','open-preferences'])assert.equal(await page.locator(`#${id}:visible`).count(),1);
    const alignment=await page.evaluate(()=>{
      const rect=id=>document.getElementById(id).getBoundingClientRect();
      return{start:Math.abs(rect('media-elapsed').left-rect('media-progress').left),end:Math.abs(rect('media-duration').right-rect('media-progress').right),height:rect('island').height,timeline:!document.getElementById('media-timeline').hidden};
    });
    assert.equal(alignment.height,alignment.timeline?172:140);
    if(alignment.timeline){assert.ok(alignment.start<1);assert.ok(alignment.end<1)}
    report.nativeMusic.alignment=alignment;
    await page.locator('#island').screenshot({path:fileURLToPath(new URL('native-music-real.png',artifacts))});
    report.checks.push('Current actual GSMTC session renders the polished player: one action group, automatic session, aligned times and semantic height. No playback action was sent.');
  }
  for (let index = 0; index < 4; index++) {
    await page.locator('#toggle').evaluate(button => button.click());
    await page.waitForFunction(() => document.getElementById('island').getAnimations({ subtree: true }).every(value => value.playState !== 'running'));
  }
  const status = (await page.locator('#bridge-status').textContent() ?? '').trim();
  if (status) report.nativeStatus = status;
  assert.ok(!/Geometría visual|región interactiva|fuera de la isla/.test(status), status);
  report.checks.push('Four open/close transitions with real geometry IPC complete without reported native region errors.');
  async function probeRegion(label) {
    await page.waitForFunction(() => document.getElementById('island').getAnimations({subtree:true}).every(value => value.playState !== 'running'));
    const expected = await page.locator('#island').boundingBox();
    const value = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-File', path.join(root, 'test/native-region.ps1'), '-NivoId', String(child.pid)], { cwd:root, encoding:'utf8', windowsHide:true }).trim().replace(/^\uFEFF/,''));
    assert.equal(value.outerCornerHits, false); assert.equal(value.roundedCornerHits, false); assert.equal(value.centerHits, true);
    assert.ok(Math.abs(value.width - expected.width * value.scale) <= 2, `${label}: native width differs from CSS`);
    assert.ok(Math.abs(value.height - expected.height * value.scale) <= 2, `${label}: native height differs from CSS`);
    (report.regions ??= []).push({ label, ...value });
  }
  await probeRegion('expanded');
  await page.keyboard.press('Escape');
  await probeRegion('compact');
  report.checks.push('Actual HWND regions match settled CSS dimensions at current DPI; transparent padding and rounded corners excluded, center interactive (read-only Win32 probe).');
  if (process.env.NIVO_NATIVE_PERF_SMOKE === '1') {
    await page.evaluate(async () => { const settings=await window.__TAURI__.core.invoke('get_settings'); await window.__TAURI__.core.invoke('save_settings',{settings:{...settings,media_enabled:false,audio_enabled:false,integrations_enabled:false}}); });
    await new Promise((resolve,reject) => {
      const measure=spawn('powershell.exe',['-NoProfile','-File',path.join(root,'scripts/measure-process.ps1'),'-NivoProcessId',String(child.pid),'-DurationSeconds','15','-IntervalSeconds','1','-Condition','idle-visible-CDP-connected-15s','-BuildLabel',report.executableSha256,'-OutputDirectory',fileURLToPath(new URL('performance/',artifacts))],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
      let diagnostic=''; measure.stdout.on('data',chunk=>{diagnostic+=chunk});measure.stderr.on('data',chunk=>{diagnostic+=chunk});
      measure.once('error',reject);measure.once('close',code=>code===0?resolve():reject(new Error(diagnostic)));
    });
    report.checks.push('15-second process-tree CPU/memory smoke recorded separately with CDP attached; not a 30-minute performance acceptance.');
  }
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.stack ?? error.message; process.exitCode = 1;
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
    try {
      const restore=process.env.NIVO_APPLY_VISIBLE_DEFAULTS==='1'?{...original,hide_behind_apps:false,hide_in_fullscreen:false}:original;
      await page.evaluate(settings => window.__TAURI__.core.invoke('save_settings', { settings }), restore);
      if(process.env.NIVO_APPLY_VISIBLE_DEFAULTS==='1')report.appliedUserVisibilityDefaults=true;
    }
    catch (error) { report.restoreError = error.message; process.exitCode = 1; report.status = 'failed'; }
  }
  if (page) await page.evaluate(() => window.__TAURI__.core.invoke('quit_app')).catch(() => {});
  if (browser) await browser.close().catch(() => {});
  let forced = false;
  await new Promise(resolve => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); setTimeout(() => { forced = true; child.kill(); resolve(); }, 4000).unref(); });
  report.termination = { forced, exitCode: child.exitCode };
  if (forced || child.exitCode !== 0) { report.status = 'failed'; report.exitFailure = 'Nivo did not complete a normal zero-code exit.'; process.exitCode = 1; }
  await writeFile(new URL('native-ui.log', artifacts), log);
  await writeFile(new URL('native-ui.json', artifacts), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
