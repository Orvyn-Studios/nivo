import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = new URL('../artifacts/redesign/', import.meta.url);
await mkdir(output, { recursive:true });
const server = await createServer({ configFile:false, root, logLevel:'error', server:{ host:'127.0.0.1', port:0, watch:{ ignored:['**/src-tauri/**','**/artifacts/**'] } } });
await server.listen();
const address = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless:true, chromiumSandbox:true });
const report = { status:'running', environment:'Chromium browser visual fixtures; simulated events, not physical Windows acceptance', checks:[], screenshots:[] };
const errors=[];
async function fixture(page) {
  await page.addInitScript(() => {
    const listeners=new Map();
    const settings={ schema_version:1, media_enabled:true, audio_enabled:true, integrations_enabled:true, drop_enabled:true, caps_lock_enabled:true, battery_enabled:true, privacy_mode:false, motion:'reduced' };
    const audio={ sequence:1,status:'ready',output:{id:'out',name:'Auriculares de escritorio',volume:.42,muted:false},input:{id:'in',name:'Micrófono USB',volume:.6,muted:false},devices:[],sessions:[{id:'s',name:'Reproductor',volume:.7,muted:false,active:true}],error:null };
    window.__test={ emit:(name,payload)=>listeners.get(name)?.({payload}), settings, audio, calls:[] };
    window.__TAURI__={ event:{async listen(name,handler){listeners.set(name,handler);return()=>listeners.delete(name)}},core:{async invoke(command,args){
      if(command==='get_settings')return settings;
      if(command==='get_audio_snapshot')return audio;
      if(command==='get_media_snapshot')return {sequence:0,status:'ready',sessions:[],activeSessionId:null,error:null};
      if(command==='get_displays')return [];
      if(command==='get_power_snapshot')return {present:false,percent:null,ac:true,charging:false,saving:false,remainingSeconds:null};
      if(command==='set_expanded')return 1;
      if(command==='get_autostart')return false;
      if(command==='audio_control'||command==='media_control'){window.__test.calls.push({command,...args});return true;}
      if(command==='drop_action'){window.__test.calls.push(args);return 'Ruta copiada.';}
      if(command==='save_settings'){Object.assign(settings,args.settings);return settings;}
    }}};
  });
}
async function ready(page){ await page.waitForFunction(()=>document.getElementById('toggle')?.disabled===false); }
async function stable(page){ await page.waitForFunction(()=>document.getElementById('island').getAnimations({subtree:true}).every(a=>a.playState!=='running')); }
async function emit(page,name,payload){await page.evaluate(([name,payload])=>{if(name==='nivo://audio')window.__test.audio=payload;window.__test.emit(name,payload)},[name,payload]);await stable(page);}
async function shot(page,name){await stable(page);await page.locator('#island').screenshot({path:fileURLToPath(new URL(`${name}.png`,output))});report.screenshots.push(name);}
async function notice(page){if(await page.locator('#notification-dismiss').isVisible())await page.locator('#notification-dismiss').click();await stable(page);}
let page;
try {
  page=await browser.newPage({viewport:{width:1000,height:720},reducedMotion:'reduce'});
  page.on('pageerror',error=>errors.push(error.message));
  await fixture(page); await page.goto(address); await ready(page);
  assert.equal(await page.locator('#island nav').count(),0);
  await shot(page,'01-compacto');
  await page.locator('#toggle').hover();await shot(page,'02-hover');
  await page.locator('#toggle').click();await stable(page);
  let size=await page.locator('#island').boundingBox();assert.equal(size.width,260);assert.equal(size.height,138);
  await shot(page,'03-calma');
  await page.keyboard.press('Escape'); await stable(page);
  const media={sequence:1,status:'ready',activeSessionId:'music',sessions:[{id:'music',title:'Horizonte',artist:'Sesión de prueba visual',playback:'playing',positionMs:42000,durationMs:210000,canPrevious:true,canNext:true,canPlayPause:true,canSeek:false}],error:null};
  await emit(page,'nivo://media',media);await shot(page,'04-musica-compacta');
  await page.locator('#toggle').click();await stable(page);await shot(page,'05-musica');
  assert.equal(await page.locator('#media-pause-icon').isVisible(),true);
  assert.equal(await page.locator('#media-play-icon').isVisible(),false);
  size=await page.locator('#island').boundingBox();assert.equal(size.height,202);
  await page.locator('#media-play-pause').click();assert.equal(await page.evaluate(()=>window.__test.calls[0].action),'playPause');
  await page.keyboard.press('Escape');await stable(page);
  await emit(page,'nivo://audio',{...await page.evaluate(()=>window.__test.audio),sequence:2,output:{id:'out',name:'Auriculares de escritorio',volume:.65,muted:false}});
  await shot(page,'06-volumen');assert.equal(await page.locator('#notification-progress').getAttribute('value'),'0.65');await notice(page);
  await emit(page,'nivo://audio',{...await page.evaluate(()=>window.__test.audio),sequence:3,input:{id:'in',name:'Micrófono USB',volume:.6,muted:true}});
  await shot(page,'07-microfono');await notice(page);
  await emit(page,'nivo://audio',{...await page.evaluate(()=>window.__test.audio),sequence:4,output:{id:'headphones',name:'Auriculares USB',volume:.42,muted:false}});
  await shot(page,'08-dispositivo');await notice(page);
  await emit(page,'nivo://lock-key',{caps:true,enabled:true});await shot(page,'09-caps-lock');await notice(page);
  await emit(page,'nivo://power',{sequence:1,present:true,percent:60,acOnline:false,charging:false,saving:false,remainingSeconds:null});
  await emit(page,'nivo://power',{sequence:2,present:true,percent:10,acOnline:false,charging:false,saving:false,remainingSeconds:null});await shot(page,'10-bateria');await notice(page);
  await emit(page,'nivo://media',{...media,sequence:2,sessions:[],activeSessionId:null});
  const download={kind:'download',id:'visual-download',source:'browser',name:'Proyecto Orvyn.zip',state:'active',received:42,total:100,bytesPerSecond:524288};
  await emit(page,'nivo://integration',download);await page.locator('#toggle').click();await stable(page);await shot(page,'11-descarga');
  await page.keyboard.press('Escape');await stable(page);
  await emit(page,'nivo://integration',{...download,state:'complete',received:100});await shot(page,'12-descarga-lista');await notice(page);
  await emit(page,'nivo://integration',{kind:'agent',taskId:'visual-agent',status:'working'});await shot(page,'13-codex-compacto');
  await page.locator('#toggle').click();await stable(page);await shot(page,'14-codex-trabajando');
  await page.keyboard.press('Escape');await stable(page);
  await emit(page,'nivo://integration',{kind:'agent',taskId:'visual-agent',status:'complete'});await shot(page,'15-codex-listo');await notice(page);
  await emit(page,'nivo://drop-phase','enter');await shot(page,'16-drop-destino');
  await emit(page,'nivo://drop-phase','leave');assert.equal(await page.locator('#toggle').getAttribute('aria-expanded'),'false');
  await emit(page,'nivo://drop-files',[{id:'drop:1:0',name:'Propuesta de diseño.pdf',size:2048}]);await shot(page,'17-drop-archivo');
  await page.locator('#drop-list button').first().click();assert.equal(await page.evaluate(()=>window.__test.calls.at(-1).action),'copyPath');
  await emit(page,'nivo://settings',{schema_version:1,drop_enabled:true,media_enabled:true,audio_enabled:true,integrations_enabled:true,privacy_mode:true,motion:'reduced'});
  assert.equal(await page.locator('#drop-list h2').textContent(),'Archivo 1');
  assert.ok(!(await page.locator('#drop-list').textContent()).includes('Propuesta'));
  await page.keyboard.press('Escape');await stable(page);await page.locator('#toggle').click();await stable(page);
  await page.locator('#open-audio').click();await stable(page);await shot(page,'18-mezclador');
  await page.locator('#output-volume').fill('35');assert.equal(await page.evaluate(()=>window.__test.calls.at(-1).action.value),.35);
  await page.locator('#input-mute').click();assert.equal(await page.evaluate(()=>window.__test.calls.at(-1).action.kind),'inputMute');
  report.checks.push('Real UI components: contextual sizes, no island tabs/preferences, media/audio commands, real-value HUD, notices, downloads, agent states and Drop capability actions using labelled fixtures.');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await emit(page,'nivo://settings',{schema_version:1,motion:'full',media_enabled:true,audio_enabled:true});
  for(let i=0;i<8;i++)await page.locator('#toggle').evaluate(button=>button.click());
  await stable(page);await page.emulateMedia({reducedMotion:'reduce'});await stable(page);
  assert.equal(await page.locator('#island').evaluate(el=>el.getAnimations({subtree:true}).filter(a=>a.playState==='running').length),0);
  report.checks.push('Rapid interrupted transitions settle; reduced motion leaves no running animations.');
  for(const [width,height,scale] of [[1920,1080,1],[2560,1440,1.25],[3840,2160,1.5],[1920,1080,2]]){
    const p=await browser.newPage({viewport:{width:Math.round(width/scale),height:Math.round(height/scale)},deviceScaleFactor:scale,reducedMotion:'reduce'});
    await fixture(p);await p.goto(address);await ready(p);await p.locator('#toggle').click();await stable(p);
    assert.ok(await p.locator('#island').evaluate(el=>{const b=el.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth}));await p.close();
  }
  report.checks.push('Viewport/deviceScaleFactor simulations at 100/125/150/200%; not physical multimonitor acceptance.');
  const settings=await browser.newPage({viewport:{width:820,height:620}});
  settings.on('pageerror',error=>errors.push(error.message));await settings.goto(`${address}/preferences.html`);await settings.waitForSelector('body[data-ready=true]');
  await settings.screenshot({path:fileURLToPath(new URL('19-preferencias.png',output))});report.screenshots.push('19-preferencias');
  await settings.getByRole('button',{name:'Apariencia',exact:true}).click();await settings.locator('#reduce-motion').check();
  await settings.waitForFunction(()=>JSON.parse(localStorage.getItem('nivo:preferences:v1')).motion==='reduced');
  await settings.reload();await settings.waitForSelector('body[data-ready=true]');await settings.getByRole('button',{name:'Apariencia',exact:true}).click();assert.equal(await settings.locator('#reduce-motion').isChecked(),true);
  await settings.close();assert.deepEqual(errors,[]);report.checks.push('Independent preferences page saves and restores settings, with seven sections.');
  report.status='passed';
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;console.error(error);}
finally{
  report.errors=errors;await writeFile(new URL('validation.json',output),JSON.stringify(report,null,2));
  await browser.close();await server.close();
}
console.log(JSON.stringify(report,null,2));
