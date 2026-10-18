/** Bounded comparative motion probe. rAF observations are NOT presented DWM frames. */
import { chromium } from '@playwright/test';
import { createServer as viteServer } from 'vite';
import { createServer } from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const native=process.env.NIVO_MOTION_MODE==='native';
const extended=process.env.NIVO_MOTION_EXTENDED==='1';
const label=process.env.NIVO_MOTION_LABEL??'current';
if(!/^[a-z0-9-]+$/.test(label))throw new Error('Invalid result label.');
const output=path.join(root,'artifacts/motion',label+(native?'-native':'-browser'));
await mkdir(output,{recursive:true});
const report={status:'running',environment:native?'actual Windows release / WebView2 / local CDP':'Chromium / simulated providers',checks:[],actions:[],limits:'Observable rAF intervals and DOM changes are not presented DWM frames. No refresh-rate claim.'};
let browser,page,server,child,original,log='',probeDone;
try{
  if(native){
    const executable=process.env.NIVO_MOTION_BINARY??path.join(root,'src-tauri/target/release/nivo-desktop.exe');
    report.binarySha256=createHash('sha256').update(await readFile(executable)).digest('hex');
    const port=await new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});
    child=spawn(executable,[],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,WEBVIEW2_USER_DATA_FOLDER:path.join(output,'profile')}});
    child.stderr.on('data',d=>log+=d);child.stdout.on('data',d=>log+=d);
    let endpoint;
    for(let i=0;i<80;i++){
      if(child.exitCode!==null)throw new Error('Close the existing Nivo desktop before a native benchmark.');
      try{endpoint=await(await fetch(`http://127.0.0.1:${port}/json/version`)).json();break}catch{await new Promise(r=>setTimeout(r,100))}
    }
    browser=await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);
    page=browser.contexts()[0].pages()[0]??await browser.contexts()[0].waitForEvent('page');
  }else{
    server=await viteServer({configFile:false,root,logLevel:'error',server:{host:'127.0.0.1',port:0,watch:{ignored:['**/src-tauri/**','**/artifacts/**']}}});await server.listen();
    browser=await chromium.launch({headless:true,chromiumSandbox:true});
    page=await browser.newPage({viewport:extended?{width:420,height:352}:{width:1000,height:720},...(extended?{recordVideo:{dir:path.join(output,'recording'),size:{width:420,height:352}}}:{})});
    await page.addInitScript(()=>{
      const listeners=new Map();const settings={schema_version:1,motion:'full',mascot_enabled:false,media_enabled:true,audio_enabled:true,integrations_enabled:true,drop_enabled:true,caps_lock_enabled:true};
      window.__motionFixture={emit:(name,payload)=>listeners.get(name)?.({payload}),nativeDelay:0};
      window.__TAURI__={event:{async listen(n,h){listeners.set(n,h);return()=>listeners.delete(n)}},core:{async invoke(c,a){
        if(c==='get_settings')return settings;if(c==='save_settings'){Object.assign(settings,a.settings);return settings}
        if(c==='get_media_snapshot')return{sequence:0,status:'ready',sessions:[],activeSessionId:null,error:null};
        if(c==='get_audio_snapshot')return{sequence:0,status:'ready',output:{id:'output',name:'Fixture',volume:.4,muted:false},input:null,sessions:[],devices:[],error:null};
        if(c==='get_power_snapshot')return{present:false,percent:null,charging:null,saving:null,acOnline:null,remainingSeconds:null};
        if(c==='set_expanded'){if(window.__motionFixture.nativeDelay)await new Promise(r=>setTimeout(r,window.__motionFixture.nativeDelay));return 1;}return true;
      }}};
    });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  }
  page.setDefaultTimeout(10000);await page.emulateMedia({reducedMotion:'no-preference'});
  await page.waitForFunction(()=>document.getElementById('toggle')?.disabled===false);
  if(native){
    original=await page.evaluate(()=>window.__TAURI__.core.invoke('get_settings'));
    await page.evaluate(async settings=>window.__TAURI__.core.invoke('save_settings',{settings:{...settings,motion:'full',mascot_enabled:false,media_enabled:false,audio_enabled:false,integrations_enabled:false,notifications_enabled:false,drop_enabled:false,caps_lock_enabled:false,num_lock_enabled:false,battery_enabled:false}}),original);
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.getElementById('island').getAnimations({subtree:true}).every(a=>a.playState!=='running')&&document.getElementById('island-panel').hidden);
  }
  const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
  if(native&&process.env.NIVO_MOTION_REGION_PROBE==='1'){
    probeDone=new Promise((resolve,reject)=>{
      const probe=spawn('powershell.exe',['-NoProfile','-File',path.join(root,'test/native-motion-probe.ps1'),'-NivoId',String(child.pid),'-DurationMs','20000'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
      let data='',error='';probe.stdout.on('data',d=>data+=d);probe.stderr.on('data',d=>error+=d);probe.once('error',reject);
      probe.once('exit',async code=>{if(code!==0){reject(new Error(error));return}try{const value=JSON.parse(data.trim().replace(/^\uFEFF/,''));await writeFile(path.join(output,'regions.json'),JSON.stringify(value));resolve(value)}catch(error){reject(error)}});
    });
    // A failed action may close Nivo before the finite probe ends. Keep its
    // rejection handled while preserving the primary assertion and evidence.
    void probeDone.catch(()=>{});
  }
  report.before={performance:await cdp.send('Performance.getMetrics'),dom:await cdp.send('Memory.getDOMCounters')};
  await page.evaluate(()=>{
    window.__motionProbe={longTasks:[],ipc:[]};
    try{
      // Tauri's public core getter may return an isolated export object. The
      // internal IPC endpoint is wrapped only in this instrumented test child.
      const core=window.__TAURI_INTERNALS__??window.__TAURI__.core,invoke=core.invoke;
      core.invoke=async(command,args,options)=>{
        const start=performance.now();
        try{return await invoke.call(core,command,args,options)}finally{
          if(['set_expanded','set_surface_geometry'].includes(command)&&window.__motionProbe.ipc.length<20000)window.__motionProbe.ipc.push({command,ms:performance.now()-start});
        }
      };
      window.__motionProbe.restoreInvoke=()=>{core.invoke=invoke};
    }catch(error){window.__motionProbe.ipcUnavailable=String(error)}
    try{window.__motionProbe.observer=new PerformanceObserver(list=>{for(const e of list.getEntries())window.__motionProbe.longTasks.push({start:e.startTime,duration:e.duration})});window.__motionProbe.observer.observe({type:'longtask',buffered:false})}catch{}
  });
  async function action(kind,interruptMs=0){
    const value=await page.evaluate(async({kind,interruptMs})=>{
      const island=document.getElementById('island'),toggle=document.getElementById('toggle'),panel=document.getElementById('island-panel');
      const start=performance.now(),wall=performance.timeOrigin+start,firstClip=getComputedStyle(island).clipPath,firstWidth=island.getBoundingClientRect().width;
      const frames=[];let previous=start,firstResponse=null;
      const wasExpanded=toggle.getAttribute('aria-expanded')==='true';
      toggle.click();
      if(interruptMs)setTimeout(()=>toggle.click(),interruptMs);
      for(let i=0;i<600;i++){
        const now=await new Promise(requestAnimationFrame),style=getComputedStyle(island),box=island.getBoundingClientRect();
        if(firstResponse===null&&(style.clipPath!==firstClip||Math.abs(box.width-firstWidth)>.1))firstResponse=now-start;
        const content=[...panel.querySelectorAll('#notification,.media-copy,.media-empty')].find(el=>el.getBoundingClientRect().width>0);
        let contentOpacity=1;
        for(let node=content;node&&node!==island;node=node.parentElement)contentOpacity*=Number(getComputedStyle(node).opacity);
        frames.push({at:performance.timeOrigin+now,delta:now-previous,left:box.left,top:box.top,width:box.width,height:box.height,viewportWidth:innerWidth,viewportHeight:innerHeight,nativeMask:island.dataset.nativeMask,clip:style.clipPath,opacity:Number(getComputedStyle(panel).opacity),contentOpacity});previous=now;
        const expanded=toggle.getAttribute('aria-expanded')==='true';
        if(now-start>50&&(!interruptMs||now-start>interruptMs+35)&&island.getAnimations({subtree:true}).every(a=>a.playState!=='running')&&(expanded?!panel.inert:panel.hidden))break;
        if(now-start>2000)throw new Error(`Transition stuck: ${kind}`);
      }
      return{kind,wall,duration:performance.now()-start,firstResponse,frames,expectedExpanded:interruptMs?wasExpanded:!wasExpanded,expanded:toggle.getAttribute('aria-expanded'),actions:document.querySelectorAll('#activity-footer').length,status:document.getElementById('bridge-status')?.textContent?.trim().slice(0,280)};
    },{kind,interruptMs});
    report.actions.push(value);assert.equal(value.actions,1);assert.equal(value.expanded,String(value.expectedExpanded),'intent must settle in the requested state');
  }
  for(let i=0;i<60;i++)await action('settled');
  report.checks.push('30 complete open/close cycles.');
  for(let i=0;i<12;i++)await action('interrupted',18+i%4*9);
  report.checks.push('12 reversals before completion.');
  if(!native){
    await page.evaluate(()=>window.__motionFixture.emit('nivo://media',{sequence:1,status:'ready',activeSessionId:'fixture',sessions:[{id:'fixture',title:'Temporal test fixture',artist:'Synthetic provider',playback:'playing',positionMs:42000,durationMs:210000,canPlayPause:true}],error:null}));
    for(let i=0;i<4;i++)await action('music');
    for(let i=0;i<8;i++){
      await page.evaluate(i=>window.__motionFixture.emit('nivo://lock-key',{caps:true,enabled:i%2===0}),i);
      await page.waitForFunction(()=>document.getElementById('island').getAnimations({subtree:true}).every(a=>a.playState!=='running'));
      await page.keyboard.press('Escape');await page.waitForFunction(()=>document.getElementById('island').getAnimations({subtree:true}).every(a=>a.playState!=='running'));
    }
    report.checks.push('Contextual fixture notices restore music.');
    await page.evaluate(()=>window.__motionFixture.emit('nivo://settings',{schema_version:1,motion:'reduced',media_enabled:true}));
    await action('reduced');
    assert.equal(await page.locator('#island').evaluate(el=>el.getAnimations({subtree:true}).filter(a=>a.playState==='running').length),0);
    if(extended){
      await page.evaluate(()=>{document.body.style.background='#1c2431';window.__motionFooter=document.getElementById('activity-footer')});
      const stable=()=>page.waitForFunction(()=>{
        const panel=document.getElementById('island-panel');
        return document.getElementById('island').getAnimations({subtree:true}).every(a=>a.playState!=='running')&&(panel.hidden||!panel.inert);
      });
      const full=async()=>{
        await page.evaluate(()=>window.__motionFixture.emit('nivo://settings',{schema_version:1,motion:'full',media_enabled:true,audio_enabled:true,integrations_enabled:true,drop_enabled:true,caps_lock_enabled:true,mascot_enabled:false}));
        await stable();
      };
      const shot=async name=>{await stable();await page.screenshot({path:path.join(output,`${name}.png`)});};
      await full();
      if(await page.locator('#toggle').getAttribute('aria-expanded')==='false'){await page.locator('#toggle').click();await stable()}
      await shot('01-music');
      const temporal=[];
      for(let i=0;i<10;i++){
        const geometry=await page.evaluate(i=>{
          window.__motionFixture.nativeDelay=35;
          const old=document.getElementById('island').getBoundingClientRect();
          window.__motionFixture.emit('nivo://audio',{sequence:i+1,status:'ready',output:{id:'output',name:'Synthetic volume fixture',volume:.5+i*.02,muted:false},input:null,sessions:[],devices:[],error:null});
          const pending=document.getElementById('island').getBoundingClientRect();
          return{before:[old.width,old.height],pending:[pending.width,pending.height]};
        },i);
        assert.deepEqual(geometry.pending,geometry.before,'semantic CSS targets must not jump while native preparation is pending');
        await stable();
        if(i===0)await shot('02-volume');
        await page.keyboard.press('Escape');await stable();
        temporal.push(geometry);
      }
      report.delayedPreparation=temporal;
      await shot('03-restored-music');
      await page.evaluate(()=>{window.__motionFixture.nativeDelay=0;for(let i=0;i<12;i++)window.__motionFixture.emit('nivo://lock-key',{caps:true,enabled:i%2===0})});
      await stable();await shot('04-keyboard');await page.keyboard.press('Escape');await stable();
      await page.evaluate(()=>window.__motionFixture.emit('nivo://drop-phase','enter'));await stable();await shot('05-drop');
      await page.evaluate(()=>window.__motionFixture.emit('nivo://drop-phase','leave'));await stable();
      await page.evaluate(()=>window.__motionFixture.emit('nivo://integration',{kind:'agent',taskId:'motion-stress-fixture',status:'working'}));
      await stable();await shot('06-agent');await page.keyboard.press('Escape');await stable();
      // Change track while expansion is still active; controls remain one DOM instance.
      if(await page.locator('#toggle').getAttribute('aria-expanded')==='true'){await page.keyboard.press('Escape');await stable()}
      await page.evaluate(()=>{
        document.getElementById('toggle').click();
        setTimeout(()=>window.__motionFixture.emit('nivo://media',{sequence:20,status:'ready',activeSessionId:'new',sessions:[{id:'new',title:'Latest track during expansion',artist:'Temporal fixture',playback:'paused',positionMs:0,durationMs:150000,canPlayPause:true}],error:null}),35);
      });
      await stable();
      assert.equal(await page.locator('#media-title').textContent(),'Latest track during expansion');await shot('07-track-during-open');
      await page.keyboard.press('Escape');await stable();
      await page.evaluate(()=>{document.getElementById('toggle').click();setTimeout(()=>window.__motionFixture.emit('nivo://settings',{schema_version:1,motion:'reduced',media_enabled:true,mascot_enabled:false}),25)});
      await stable();await shot('08-reduced-mid-transition');
      assert.equal(await page.locator('#island').evaluate(el=>el.getAnimations({subtree:true}).filter(a=>a.playState==='running').length),0);
      await full();await page.keyboard.press('Escape');await stable();
      await page.evaluate(()=>{document.getElementById('toggle').click();setTimeout(()=>window.__motionFixture.emit('nivo://visibility',{visible:false}),25)});
      await new Promise(r=>setTimeout(r,80));
      assert.equal(await page.locator('#island').evaluate(el=>el.getAnimations({subtree:true}).filter(a=>a.playState==='running').length),0);
      await page.evaluate(()=>window.__motionFixture.emit('nivo://visibility',{visible:true}));await stable();await shot('09-restored-visibility');
      await page.evaluate(()=>{
        document.getElementById('toggle').click();
        setTimeout(()=>{const end=performance.now()+65;while(performance.now()<end){}},30);
      });
      await stable();await shot('10-after-controlled-block');
      assert.equal(await page.evaluate(()=>document.getElementById('activity-footer')===window.__motionFooter),true);
      assert.equal(await page.locator('#activity-footer').count(),1);
      report.checks.push('Extended temporal stress: delayed native preparation keeps geometry fixed; music/volume restores, coalesced notices, Drop, agent, track during expansion, reduced motion during flight, visibility and a finite 65ms main-thread block all settle without duplicate actions.');
      report.controlledLoad='One explicit 65ms main-thread busy task, test-only. A long frame is expected; completion and recovery are checked.';
      report.recording='Browser preview with simulated providers; not a recording of native DWM presentation.';
    }
  }
  report.after={performance:await cdp.send('Performance.getMetrics'),dom:await cdp.send('Memory.getDOMCounters')};
  report.metrics=await page.evaluate(()=>window.__NIVO_METRICS__());
  report.ipc=await page.evaluate(()=>{const probe=window.__motionProbe;probe.restoreInvoke?.();return{samples:probe.ipc,unavailable:probe.ipcUnavailable}});
  if(native&&!report.ipc.samples.length)report.ipc.unavailable='The injected wrapper did not intercept the bridge captured at startup; zero samples means unavailable, not zero IPC.';
  report.longTasks=await page.evaluate(()=>{window.__motionProbe.observer?.disconnect();return window.__motionProbe.longTasks});
  if(probeDone){
    const probe=await probeDone;
    assert.ok(probe.samples.length>100);
    assert.equal(probe.samples.filter(value=>value.exteriorOwnsPointer||value.roundedCornerOwnsPointer).length,0);
    report.nativeRegionProbe={samples:probe.samples.length,clientSizes:[...new Set(probe.samples.map(s=>`${s.clientWidth}x${s.clientHeight}`))],displayRefreshReportedHz:probe.displayRefreshReportedHz,dpi:probe.dpi,foregroundSamples:probe.samples.filter(s=>s.foreground).length,extendedStyle:probe.extendedStyle};
  }
  const idle=Number(process.env.NIVO_MOTION_IDLE_SECONDS??0);
  if(native&&idle){
    await new Promise((resolve,reject)=>{
      const p=spawn('powershell.exe',['-NoProfile','-File',path.join(root,'scripts/measure-process.ps1'),'-NivoProcessId',String(child.pid),'-ExpectedProcessName',path.basename(process.env.NIVO_MOTION_BINARY??'nivo-desktop.exe','.exe').toLowerCase(),'-DurationSeconds',String(idle),'-IntervalSeconds','2','-Condition','quiet-visible-CDP-after-same-stress','-BuildLabel',report.binarySha256,'-OutputDirectory',path.join(output,'performance')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let message='';p.stderr.on('data',d=>message+=d);p.once('error',reject);p.once('exit',code=>code===0?resolve():reject(new Error(message)));
    });
  }
  report.commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim();report.status='passed';
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;console.error(error);}
finally{
  if(native&&page){if(original)await page.evaluate(settings=>window.__TAURI__.core.invoke('save_settings',{settings}),original).catch(()=>{});await page.evaluate(()=>window.__TAURI__.core.invoke('quit_app')).catch(()=>{});}
  const video=extended?page?.video():null;
  await browser?.close().catch(()=>{});if(video)await video.saveAs(path.join(output,'motion-preview.webm')).catch(()=>{});await server?.close();
  if(child)await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(()=>{child.kill();resolve()},4000).unref()});
  await writeFile(path.join(output,'results.json'),JSON.stringify(report,null,2));if(log)await writeFile(path.join(output,'native.log'),log);
}
const all=report.actions.flatMap(a=>a.frames.map(f=>f.delta)).sort((a,b)=>a-b),pct=p=>all[Math.min(all.length-1,Math.floor(all.length*p))]??null;
console.log(JSON.stringify({status:report.status,actions:report.actions.length,observableRafMs:{p50:pct(.5),p95:pct(.95),max:all.at(-1)},longTasks:report.longTasks?.length,error:report.error,output},null,2));
