/** Product UI regression with explicitly simulated GSMTC data; never feeds production. */
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const out=new URL('../artifacts/music-polish/',import.meta.url);
await mkdir(out,{recursive:true});
const server=await createServer({configFile:false,root,logLevel:'error',server:{host:'127.0.0.1',port:0,watch:{ignored:['**/src-tauri/**','**/artifacts/**']}}});
await server.listen();
const browser=await chromium.launch({headless:true,chromiumSandbox:true});
const page=await browser.newPage({viewport:{width:1000,height:720},reducedMotion:'no-preference'});
page.setDefaultTimeout(8000);
const report={status:'running',environment:'Chromium, labelled synthetic media fixtures',checks:[],screenshots:[],selector:'Omitted at the user’s explicit confirmation; one and many sessions follow Windows active ID.'};
const errors=[];page.on('pageerror',e=>errors.push(e.message));
let sequence=0;
const media={id:'session-a',title:'Horizonte',artist:'Sesión de prueba visual',playback:'playing',positionMs:42000,durationMs:210000,canPrevious:true,canNext:true,canPlayPause:true,canSeek:false};
async function stable(){await page.waitForFunction(()=>document.getElementById('island').getAnimations({subtree:true}).every(a=>a.playState!=='running'));}
async function emit(session,others=[]){
  const value={sequence:++sequence,status:'ready',activeSessionId:session?.id??null,sessions:session?[session,...others]:[],error:null};
  await page.evaluate(value=>window.__music.emit('nivo://media',value),value);
  if(session)await page.waitForFunction(title=>document.getElementById('media-title').textContent===title,session.title);
  if(session?.artwork&&!session.artwork.includes('INVALID'))await page.waitForFunction(source=>{const image=document.getElementById('media-artwork');return image.src===source&&image.complete&&image.naturalWidth>0},session.artwork);
  await stable();
}
async function shot(name){await stable();await page.locator('#island').screenshot({path:fileURLToPath(new URL(`${name}.png`,out))});report.screenshots.push(name);}
async function actions(){
  assert.equal(await page.locator('#activity-footer').count(),1);
  for(const id of ['open-audio','open-preferences']){
    assert.equal(await page.locator(`#${id}`).count(),1);
    assert.equal(await page.locator(`#${id}:visible`).count(),1);
    assert.equal(await page.locator(`#${id} svg`).count(),1);
  }
  assert.equal(await page.locator('#media-widget select').count(),0);
}
try{
  await page.addInitScript(()=>{
    const listeners=new Map();
    const settings={schema_version:1,motion:'full',media_enabled:true};
    window.__music={emit:(name,value)=>listeners.get(name)?.({payload:value}),calls:[]};
    window.__TAURI__={event:{async listen(name,handler){listeners.set(name,handler);return()=>listeners.delete(name)}},core:{async invoke(command,args){
      if(command==='get_settings')return settings;
      if(command==='get_media_snapshot')return{sequence:0,status:'ready',sessions:[],activeSessionId:null,error:null};
      if(command==='get_audio_snapshot')return{sequence:0,status:'disabled',sessions:[],devices:[],output:null,input:null,error:null};
      if(command==='get_power_snapshot')return{present:false,percent:null,charging:null,saving:null,acOnline:null,remainingSeconds:null};
      if(command==='set_expanded')return 1;
      if(command==='media_control')window.__music.calls.push({command,...args});
      return true;
    }}};
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.waitForFunction(()=>document.getElementById('toggle').disabled===false);
  await emit(media);await shot('01-compacto');
  await page.locator('#toggle').click();await stable();await actions();await shot('02-reproduciendo-sin-portada');
  assert.equal((await page.locator('#island').boundingBox()).height,172);
  const geometry=await page.evaluate(()=>{
    const box=id=>{const b=document.getElementById(id).getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height,right:b.right,bottom:b.bottom}};
    const panel=document.querySelector('.panel-scroll');
    return{island:box('island'),progress:box('media-progress'),elapsed:box('media-elapsed'),duration:box('media-duration'),previous:box('media-previous'),play:box('media-play-pause'),next:box('media-next'),audio:box('open-audio'),scrollHeight:panel.scrollHeight,clientHeight:panel.clientHeight};
  });
  report.geometry=geometry;
  assert.ok(Math.abs(geometry.elapsed.x-geometry.progress.x)<1);
  assert.ok(Math.abs(geometry.duration.right-geometry.progress.right)<1);
  assert.ok(Math.abs(geometry.play.x+geometry.play.width/2-(geometry.island.x+geometry.island.width/2))<1);
  assert.equal(geometry.play.width,36);
  assert.ok(Math.abs((geometry.play.x-geometry.previous.right)-(geometry.next.x-geometry.play.right))<1);
  assert.ok(geometry.next.right<geometry.audio.x);
  assert.ok(geometry.scrollHeight<=geometry.clientHeight+1,'music must fit without scrolling');
  report.geometry=geometry;
  report.checks.push('One shared secondary group with one SVG per action; 172 DIP, centred transport, aligned times, no overflow or overlapping click areas.');
  await emit({...media,playback:'paused'});await shot('03-pausado');
  assert.equal(await page.locator('#media-play-icon').isVisible(),true);
  assert.equal(await page.locator('#media-pause-icon').isVisible(),false);
  await page.locator('#media-play-pause').click();
  assert.equal(await page.evaluate(()=>window.__music.calls.at(-1).sessionId),'session-a');
  const [coverA,coverB]=await page.evaluate(()=>['#527080','#9b6f59'].map(color=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
    const c=canvas.getContext('2d');c.fillStyle=color;c.fillRect(0,0,64,64);c.fillStyle='#ddd9cd';c.fillRect(12,12,40,40);return canvas.toDataURL('image/png');
  }));
  await emit({...media,artwork:coverA});await shot('04-con-portada');
  assert.deepEqual(await page.locator('#media-artwork').evaluate(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,fit:getComputedStyle(el).objectFit})),{width:56,height:56,fit:'cover'});
  await emit({...media,title:'Un título de canción muy largo que debe truncarse sin desplazar controles ni ensanchar la isla',artist:'Artista con un nombre deliberadamente extenso para verificar el truncado',artwork:coverB});await shot('05-titulo-largo');
  assert.ok(await page.locator('#media-title').evaluate(el=>el.scrollWidth>el.clientWidth&&getComputedStyle(el).textOverflow==='ellipsis'));
  await emit({...media,positionMs:3_661_000,durationMs:36_061_000});await shot('06-duracion-larga');
  assert.equal(await page.locator('#media-elapsed').textContent(),'1:01:01');
  assert.equal(await page.locator('#media-duration').textContent(),'10:01:01');
  await emit({...media,positionMs:null,durationMs:null});await shot('07-sin-tiempo');
  assert.equal((await page.locator('#island').boundingBox()).height,140);
  assert.equal(await page.locator('#media-timeline').isVisible(),false);
  await emit({...media,canPrevious:false,canNext:false,canPlayPause:false});await shot('08-controles-no-disponibles');
  for(const id of ['media-previous','media-play-pause','media-next'])assert.equal(await page.locator(`#${id}`).isDisabled(),true);
  await emit({...media,id:'windows-active'},[{...media,id:'another-app'}]);await actions();await shot('09-varias-sesiones-sin-selector');
  await page.locator('#media-play-pause').click();assert.equal(await page.evaluate(()=>window.__music.calls.at(-1).sessionId),'windows-active');
  // Deliberately complete older image decodes out of order during real UI updates.
  await page.evaluate(()=>{window.__nativeDecode=HTMLImageElement.prototype.decode;window.__decodes=[];HTMLImageElement.prototype.decode=function(){return new Promise((resolve,reject)=>window.__decodes.push({resolve,reject}))}});
  await page.evaluate(([a,b])=>{
    for(const [index,artwork] of [a,b].entries())window.__music.emit('nivo://media',{sequence:100+index,status:'ready',activeSessionId:'rapid',sessions:[{id:'rapid',title:`Cambio ${index}`,artist:'Fixture de interrupción',artwork,playback:'playing',positionMs:0,durationMs:10000,canPlayPause:true}],error:null});
    window.__decodes[1].resolve();window.__decodes[0].resolve();
  },[coverA,coverB]);
  await page.waitForFunction(()=>document.getElementById('media-title').textContent==='Cambio 1');await stable();
  assert.equal(await page.locator('#media-artwork').getAttribute('src'),coverB);
  await page.evaluate(()=>{HTMLImageElement.prototype.decode=window.__nativeDecode});sequence=101;
  await shot('10-cambios-rapidos');
  await emit({...media,title:'Portada no disponible',artwork:'data:image/png;base64,INVALID'});await shot('11-portada-invalida');
  assert.equal(await page.locator('#media-artwork-fallback').isVisible(),true);
  await page.evaluate(()=>window.__music.emit('nivo://settings',{schema_version:1,motion:'reduced',media_enabled:true}));
  await emit({...media,playback:'paused'});await actions();await shot('12-movimiento-reducido');
  assert.equal(await page.locator('#island').evaluate(el=>el.getAnimations({subtree:true}).filter(a=>a.playState==='running').length),0);
  for(let i=0;i<6;i++){await page.locator('#toggle').click();await stable();if(i%2===1)await actions()}
  await page.locator('#open-audio').click();await stable();
  assert.equal(await page.locator('#open-preferences:visible').count(),0);
  await page.keyboard.press('Escape');await stable();await page.locator('#toggle').click();await stable();await actions();
  report.checks.push('Playing/paused, decoded and missing covers, long titles, hour durations, unknown timeline, disabled capabilities, multiple sessions, obsolete decodes, repeat transitions and reduced motion validated.');
  assert.deepEqual(errors,[]);report.status='passed';
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;console.error(error);}
finally{report.errors=errors;await writeFile(new URL('validation.json',out),JSON.stringify(report,null,2));await browser.close();await server.close();}
console.log(JSON.stringify(report,null,2));
