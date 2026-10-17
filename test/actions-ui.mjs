import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url)),output=new URL('../artifacts/actions/ui/',import.meta.url);
await mkdir(output,{recursive:true});
const server=await createServer({configFile:false,root,logLevel:'error',server:{host:'127.0.0.1',port:0,watch:{ignored:['**/src-tauri/**','**/artifacts/**']}}});await server.listen();
const browser=await chromium.launch({headless:true,chromiumSandbox:true});
const report={status:'running',environment:'Chromium / labelled synthetic operation and media fixtures; no native file or mail side effects',checks:[],screenshots:[],errors:[]};
let page;
try{
 page=await browser.newPage({viewport:{width:700,height:520},reducedMotion:'reduce'});page.on('pageerror',e=>report.errors.push(e.message));
 await page.addInitScript(()=>{
  const listeners=new Map();let serial=0;
  const settings={schema_version:1,motion:'reduced',privacy_mode:false,drop_enabled:true,media_enabled:true};
  window.__actions={calls:[],emit:(name,payload)=>listeners.get(name)?.({payload}),job:null};
  window.__TAURI__={event:{async listen(name,fn){listeners.set(name,fn);return()=>listeners.delete(name)}},core:{async invoke(command,args){
   if(command==='get_settings')return settings;
   if(command==='get_media_snapshot')return{sequence:0,status:'ready',activeSessionId:null,sessions:[],error:null};
   if(command==='get_audio_snapshot')return{sequence:0,status:'disabled',output:null,input:null,devices:[],sessions:[],error:null};
   if(command==='get_power_snapshot')return{present:false,percent:null,charging:null,saving:null,acOnline:null,remainingSeconds:null};
   if(command==='set_expanded')return 1;
   if(command==='media_control')window.__actions.calls.push({command,args});
   if(command==='cancel_drop_action'){window.__actions.calls.push({command,args});window.__actions.job.resolve({operationId:window.__actions.job.id,outcome:'cancelled',message:'Operación cancelada.',file:null});return true;}
   if(command==='drop_action'){
     const operationId=`action:${++serial}`;window.__actions.calls.push({command,args});
     if(['copyPath','openFolder'].includes(args.action))return{operationId,outcome:'success',message:'Acción confirmada por fixture.',file:null};
     return new Promise(resolve=>{window.__actions.job={id:operationId,resolve};window.__actions.emit('nivo://action-progress',{operationId,phase:'destination',completed:0,total:null,cancellable:false});});
   }
  }}};
 });
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);await page.waitForFunction(()=>!document.getElementById('toggle').disabled);
 const stable=()=>page.waitForFunction(()=>document.getElementById('island').getAnimations({subtree:true}).every(a=>a.playState!=='running'));
 const emit=async(name,value)=>{await page.evaluate(([n,v])=>window.__actions.emit(n,v),[name,value]);await stable();};
 const shot=async name=>{await stable();await page.locator('#island').screenshot({path:fileURLToPath(new URL(`${name}.png`,output))});report.screenshots.push(name);};
 const media={sequence:1,status:'ready',activeSessionId:'music',sessions:[{id:'music',title:'Música de prueba',artist:'Fixture explícito',playback:'playing',positionMs:42000,durationMs:210000,canPrevious:true,canNext:true,canPlayPause:true,canSeek:false}],error:null};
 await emit('nivo://media',media);await page.locator('#toggle').click();await stable();
 await emit('nivo://drop-phase','enter');await shot('01-drag');await emit('nivo://drop-phase','leave');
 assert.equal(await page.locator('#media-widget').isVisible(),true);assert.equal(await page.locator('#toggle').getAttribute('aria-expanded'),'true');
 const files=[{id:'drop:8:0',name:'Propuesta de diseño.pdf',size:2516582}];
 await emit('nivo://drop-phase','enter');await emit('nivo://drop-files',files);await emit('nivo://drop-phase','drop');
 assert.equal(await page.locator('#drop').isVisible(),true);assert.match(await page.locator('#drop-list').textContent(),/Documento PDF/);await shot('02-file');
 await page.locator('#drop-zip').click();await page.waitForFunction(()=>window.__actions.job!==null);
 const running=()=>page.evaluate(()=>window.__actions.emit('nivo://action-progress',{operationId:window.__actions.job.id,phase:'running',completed:2,total:10,cancellable:true}));
 await running();assert.equal(await page.locator('#drop-progress').evaluate(el=>el.value),.2);await shot('03-measured-progress');
 await page.evaluate(()=>window.__actions.job.resolve({operationId:window.__actions.job.id,outcome:'success',message:'ZIP comprimido creado.',file:{id:'drop:9:0',name:'Entrega.zip',size:1024}}));
 await page.waitForFunction(()=>document.getElementById('drop').dataset.stage==='result');await shot('04-result');
 await page.locator('#drop-result-folder').click();
 assert.equal(await page.evaluate(()=>window.__actions.calls.at(-1).args.id),'drop:9:0');
 await page.locator('#drop-done').click();await stable();assert.equal(await page.locator('#media-widget').isVisible(),true);
 await emit('nivo://drop-files',[{...files[0],id:'drop:10:0'}]);await page.locator('#drop-zip').click();await running();await page.locator('#drop-cancel').click();
 await page.waitForFunction(()=>document.getElementById('drop').dataset.stage==='result');assert.match(await page.locator('#drop-result-title').textContent(),/cancelada/);await shot('05-cancelled');
 await page.locator('#drop-done').click();await stable();
 assert.equal(await page.locator('#media-title').textContent(),'Música de prueba');
 assert.equal(await page.evaluate(()=>window.__actions.calls.filter(c=>c.command==='media_control').length),0);
 report.checks.push('File type/size, measured bytes, typed result and result-folder capability; cancellation; drag cancellation and Done restore the prior expanded music without playback commands.');
 assert.deepEqual(report.errors,[]);report.status='passed';
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;}
finally{await browser.close();await server.close();await writeFile(new URL('results.json',output),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
