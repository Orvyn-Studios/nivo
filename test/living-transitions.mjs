/** Reviewable temporal evidence. All providers/operations here are explicit fixtures. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const reduced=process.env.NIVO_MOTION==='reduced';
const output=path.join(root,'artifacts/living-review',reduced?'reduced':'normal');
await mkdir(output,{recursive:true});
const report={status:'running',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim(),reduced,
 environment:'Chromium; synthetic media, volume, Codex lifecycle and ZIP bytes/result. No native ZIP, GitHub account or DWM acceptance.',
 limits:'Screenshots perturb timing. Each PNG is bracketed by the state sample and capture completion; neither is a DWM exposure time or presented FPS.',transitions:[],errors:[]};
const server=await createServer({configFile:false,root,logLevel:'error',server:{host:'127.0.0.1',port:0,watch:{ignored:['**/src-tauri/**','**/artifacts/**']}}});
await server.listen();const browser=await chromium.launch({headless:true,chromiumSandbox:true});let page;
try{
 page=await browser.newPage({viewport:{width:420,height:352},reducedMotion:reduced?'reduce':'no-preference',recordVideo:{dir:output,size:{width:420,height:352}}});
 page.on('pageerror',e=>report.errors.push(e.message));
 await page.addInitScript(reduced=>{
  const listeners=new Map();
  const settings={schema_version:1,motion:reduced?'reduced':'full',privacy_mode:false,mascot_enabled:true,drop_enabled:true,media_enabled:true,audio_enabled:true,integrations_enabled:true,caps_lock_enabled:true,battery_enabled:true};
  window.__living={emit:(n,p)=>listeners.get(n)?.({payload:p}),calls:[],job:null};
  window.__TAURI__={event:{async listen(n,fn){listeners.set(n,fn);return()=>listeners.delete(n)}},core:{async invoke(c,a){
   if(c==='get_settings')return settings;
   if(c==='get_media_snapshot')return{sequence:0,status:'ready',activeSessionId:null,sessions:[],error:null};
   if(c==='get_audio_snapshot')return{sequence:0,status:'ready',output:{id:'out',name:'Fixture',volume:.3,muted:false},input:null,devices:[],sessions:[],error:null};
   if(c==='get_power_snapshot')return{present:false,percent:null,charging:null,saving:null,acOnline:null,remainingSeconds:null};
   if(c==='set_expanded')return 1;
   if(c==='media_control')window.__living.calls.push(c);
   if(c==='drop_action')return new Promise(resolve=>{window.__living.job=resolve;window.__living.emit('nivo://action-progress',{operationId:'action:1',phase:'destination',completed:0,total:null,cancellable:false})});
  }}};
 },reduced);
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
 await page.waitForFunction(()=>!document.getElementById('toggle').disabled);
 await page.evaluate(()=>{
  document.body.style.background='#1c2431';
  const label=document.createElement('div');label.textContent='FIXTURE · proveedores y ZIP simulados';
  label.style.cssText='position:fixed;bottom:0;left:0;font:11px sans-serif;color:#bec5d0;padding:3px;pointer-events:none';document.body.append(label);
 });
 const stable=()=>page.waitForFunction(()=>document.getElementById('island').getAnimations({subtree:true}).every(a=>a.playState!=='running')&&!document.querySelector('[data-choreography-exiting]'));
 const emit=(n,p)=>page.evaluate(([n,p])=>window.__living.emit(n,p),[n,p]);
 const media={sequence:1,status:'ready',activeSessionId:'song',sessions:[{id:'song',title:'Música de prueba',artist:'Proveedor simulado',playback:'playing',positionMs:42000,durationMs:210000,canPlayPause:true,canPrevious:true,canNext:true}],error:null};
 await emit('nivo://media',media);await page.locator('#toggle').click();await stable();
 async function transition(name,action){
  await stable();
  await page.screenshot({path:path.join(output,`${name}-before.png`)});
  await page.evaluate(()=>{window.__sharedCard=document.querySelector('#drop-list .file-heading');window.__started=performance.now();window.__outgoingLeft=Object.fromEntries([...document.querySelectorAll('[data-context-panel]')].filter(n=>n.getBoundingClientRect().width).map(n=>[n.id,n.getBoundingClientRect().left]))});
  await action();const frames=[];
  for(const wait of [0,35,45,70,100,180]){
   if(wait)await new Promise(r=>setTimeout(r,wait));
   const sample=await page.evaluate(()=>{
    const island=document.getElementById('island'),r=island.getBoundingClientRect();
    return{ms:performance.now()-window.__started,width:r.width,height:r.height,context:island.dataset.context,
     exits:[...document.querySelectorAll('[data-choreography-exiting]')].map(n=>({id:n.id,inert:n.inert,aria:n.getAttribute('aria-hidden'),left:n.getBoundingClientRect().left,previousLeft:window.__outgoingLeft[n.id]})),
     scrollOverflow:getComputedStyle(document.querySelector('.panel-scroll')).overflow,
     sameCard:!window.__sharedCard||window.__sharedCard===document.querySelector('#drop-list .file-heading'),
     animations:island.getAnimations({subtree:true}).map(a=>({target:a.effect?.target?.id||a.effect?.target?.className,time:a.currentTime,duration:a.effect?.getTiming().duration,frames:a.effect?.getKeyframes().map(f=>({offset:f.offset,opacity:f.opacity}))})),
     footerCount:document.querySelectorAll('#activity-footer').length,ids:[...document.querySelectorAll('[id]')].map(n=>n.id)};
   });
   assert.equal(sample.footerCount,1);assert.equal(new Set(sample.ids).size,sample.ids.length,'no duplicate DOM IDs');delete sample.ids;
   for(const exit of sample.exits){assert.equal(exit.inert,true);assert.equal(exit.aria,'true')}
   for(const exit of sample.exits)if(exit.previousLeft!==undefined)assert.ok(Math.abs(exit.left-exit.previousLeft)<1,'changing target width must not jump outgoing content sideways');
   if(sample.exits.length)assert.equal(sample.scrollOverflow,'visible','target scroll height must not crop departing content');
   assert.equal(sample.sameCard,true,'shared file card must retain identity');
   const file=`${name}-${frames.length}.png`;await page.screenshot({path:path.join(output,file)});
   const captureCompletedMs=await page.evaluate(()=>performance.now()-window.__started);frames.push({...sample,captureCompletedMs,file});
  }
  await stable();assert.equal(await page.locator('[data-choreography-exiting]').count(),0);
  report.transitions.push({name,before:`${name}-before.png`,frames});
 }
 await emit('nivo://drop-files',[{id:'drop:1:0',name:'Propuesta.pdf',size:1048576}]);await stable();
 await transition('file-progress',()=>page.locator('#drop-zip').click());
 await emit('nivo://action-progress',{operationId:'action:1',phase:'running',completed:524288,total:1048576,cancellable:true});
 assert.equal(await page.locator('#drop-progress').evaluate(n=>n.value),.5);
 await transition('progress-result',()=>page.evaluate(()=>window.__living.job({operationId:'action:1',outcome:'success',message:'ZIP comprimido creado.',file:{id:'drop:2:0',name:'Entrega.zip',size:1024}})));
 assert.equal(await page.locator('#drop-list h2').getAttribute('title'),'Entrega.zip');
 assert.equal(await page.locator('#drop-list .file-mark').getAttribute('data-kind'),'archive');
 assert.notEqual(await page.locator('#drop-status').textContent(),await page.locator('#drop-result-detail').textContent());
 await transition('result-music',()=>page.locator('#drop-done').click());
 assert.equal(await page.locator('#media-title').textContent(),'Música de prueba');
 await transition('music-volume',()=>emit('nivo://audio',{sequence:1,status:'ready',output:{id:'out',name:'Fixture',volume:.6,muted:false},input:null,devices:[],sessions:[],error:null}));
 assert.equal(await page.locator('#island').getAttribute('data-context'),'volume');
 await transition('volume-music',()=>page.keyboard.press('Escape'));
 assert.equal(await page.locator('#media-player').isVisible(),true);
 await emit('nivo://media',{...media,sequence:2,activeSessionId:null,sessions:[]});
 await stable();const metricsBefore=await page.evaluate(()=>window.__NIVO_METRICS__().length);
 await transition('calm-codex',()=>emit('nivo://integration',{kind:'agent',taskId:'explicit-review-fixture',status:'working'}));
 if(!reduced)assert.ok(await page.evaluate(()=>window.__NIVO_METRICS__().length)>metricsBefore,'working events must pass through the surface transition controller');
 assert.equal(await page.locator('#integration-activity').isVisible(),true);
 assert.equal(await page.locator('#media-widget').isVisible(),false);
 assert.match(await page.locator('#agent-status').textContent(),/Codex está trabajando/);
 assert.equal(await page.locator('#island').getAttribute('data-context'),'agent');
 await transition('codex-result',()=>emit('nivo://integration',{kind:'agent',taskId:'explicit-review-fixture',status:'complete'}));
 assert.match(await page.locator('#notification-title').textContent(),/Turno de Codex finalizado/);
 await transition('codex-dismiss',()=>page.keyboard.press('Escape'));
 const audio={status:'ready',output:{id:'out',name:'Fixture',volume:.6,muted:false},input:{id:'in',name:'Micrófono simulado',volume:.5,muted:true},devices:[],sessions:[],error:null};
 await transition('microphone',()=>emit('nivo://audio',{...audio,sequence:2}));
 assert.equal(await page.locator('#island').getAttribute('data-context'),'microphone');
 await transition('microphone-dismiss',()=>page.keyboard.press('Escape'));
 await transition('device',()=>emit('nivo://audio',{...audio,sequence:3,output:{...audio.output,id:'headphones',name:'Auriculares simulados'}}));
 assert.equal(await page.locator('#island').getAttribute('data-context'),'device');
 await transition('device-dismiss',()=>page.keyboard.press('Escape'));
 await transition('keyboard',()=>emit('nivo://lock-key',{caps:true,enabled:true}));
 await transition('keyboard-dismiss',()=>page.keyboard.press('Escape'));
 const power={present:true,percent:60,acOnline:false,charging:false,saving:false,remainingSeconds:null};
 await emit('nivo://power',{...power,sequence:1});
 await transition('battery',()=>emit('nivo://power',{...power,sequence:2,percent:10}));
 await transition('battery-dismiss',()=>page.keyboard.press('Escape'));
 const download={kind:'download',id:'explicit-download-fixture',source:'browser',name:'Descarga simulada.zip',state:'active',received:42,total:100,bytesPerSecond:1000};
 await transition('download',()=>emit('nivo://integration',download));
 await transition('download-result',()=>emit('nivo://integration',{...download,state:'complete',received:100}));
 await transition('download-dismiss',()=>page.keyboard.press('Escape'));
 await transition('mixer',()=>page.locator('#open-audio').click());
 await transition('mixer-dismiss',()=>page.keyboard.press('Escape'));
 await transition('compact-expand',()=>page.locator('#toggle').click());
 await transition('expanded-compact',()=>page.locator('#toggle').click());
 assert.deepEqual(await page.evaluate(()=>window.__living.calls),[],'no playback commands during restoration');
 assert.deepEqual(report.errors,[]);
 // A contact sheet makes the recorded intermediate states reviewable without
 // claiming screenshot cadence is native presentation timing.
 const sheet=await browser.newPage({viewport:{width:1260,height:report.transitions.length*210}});
 const rows=[];
 for(const t of report.transitions){const cells=[];for(const f of [{file:t.before,ms:0},t.frames[0],t.frames.at(-1)])cells.push(`<div><p>${t.name} · ${Math.round(f.ms)} ms observados</p><img src="data:image/png;base64,${(await readFile(path.join(output,f.file))).toString('base64')}"></div>`);rows.push(cells.join(''))}
 await sheet.setContent(`<style>body{margin:0;background:#26303e;color:white;font:12px sans-serif;display:grid;grid-template-columns:repeat(3,420px)}p{margin:3px}img{width:250px;height:185px;object-fit:contain;object-position:top left}</style>${rows.join('')}`);
 await sheet.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(img=>img.decode())));
 await sheet.screenshot({path:path.join(output,'filmstrip.png'),fullPage:true});
 for(let row=0;row<report.transitions.length;row+=7)await sheet.screenshot({path:path.join(output,`filmstrip-${1+row/7}.png`),clip:{x:0,y:row*210,width:1260,height:Math.min(7,report.transitions.length-row)*210}});
 await sheet.close();
 report.status='passed';
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1}
finally{
 const video=page?.video();await page?.close();if(video)await video.saveAs(path.join(output,'transitions.webm')).catch(e=>{report.videoError=e.message;report.status='failed';process.exitCode=1});await browser.close();await server.close();
 await writeFile(path.join(output,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,transitions:report.transitions.length,error:report.error,output},null,2));
}

