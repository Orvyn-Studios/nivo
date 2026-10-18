import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url)),output=new URL('../artifacts/github/ui/',import.meta.url);await mkdir(output,{recursive:true});
const server=await createServer({configFile:false,root,logLevel:'error',server:{host:'127.0.0.1',port:0,watch:{ignored:['**/src-tauri/**','**/artifacts/**']}}});await server.listen();const browser=await chromium.launch({headless:true,chromiumSandbox:true});
const report={status:'running',environment:'Explicit synthetic GitHub API/account fixtures in Chromium; no real account, PAT, networking or browser opening',checks:[],errors:[]};
try{
 const context=await browser.newContext({viewport:{width:820,height:620},reducedMotion:'no-preference',recordVideo:{dir:fileURLToPath(output),size:{width:820,height:620}}});
 await context.addInitScript(()=>{
  const listeners=new Map(),options={enabled:true,repositories:['Orvyn-Studios/nivo'],pullRequests:true,reviews:true,ci:true,issues:false,calendar:true,notifications:true,intervalSeconds:300};
  const connected={revision:3,status:'connected',profile:{id:123,login:'fixture-account',avatar:null},options,items:[{id:'pr:42',kind:'pull',repository:'Orvyn-Studios/nivo',title:'Revisión de continuidad · fixture',number:42,state:'open',url:'https://github.com/Orvyn-Studios/nivo/pull/42',updatedAt:'2026-10-18T08:00:00Z',headSha:'a'.repeat(40),branch:'feature/fixture',ci:'failure',review:'REVIEW_REQUIRED',mine:true,reviewRequested:true,attempt:1}],calendar:{total:127,days:Array.from({length:28},(_,i)=>({date:`2026-09-${String(i+1).padStart(2,'0')}`,count:i%5,level:i%5}))},lastSync:1792300000000,nextRefresh:null,syncing:false,error:null,warnings:[]};
  const disconnected={...connected,revision:1,status:'disconnected',profile:null,items:[],calendar:null,options:{...options,enabled:false,repositories:[]}};
  const repos=[{id:1,fullName:'fixture-account/private',organization:false,private:true,defaultBranch:'main'},{id:2,fullName:'Orvyn-Studios/nivo',organization:true,private:false,defaultBranch:'main'}];
  let current=disconnected;
  window.__githubFixture={calls:[],clearedBeforeInvoke:false,connected,emit:(name,payload)=>listeners.get(name)?.({payload})};
  window.__TAURI__={event:{async listen(n,fn){listeners.set(n,fn);return()=>listeners.delete(n)}},core:{async invoke(command,args){
   if(command==='get_settings')return{schema_version:1,motion:'full',privacy_mode:false,media_enabled:true};
   if(command==='get_media_snapshot')return{sequence:0,status:'ready',activeSessionId:null,sessions:[],error:null};
   if(command==='get_audio_snapshot')return{sequence:0,status:'disabled',output:null,input:null,devices:[],sessions:[],error:null};
   if(command==='get_power_snapshot')return{present:false,percent:null,charging:null,saving:null,acOnline:null,remainingSeconds:null};
   if(command==='set_expanded')return 1;
   if(command==='get_github_snapshot')return current;
   if(command==='get_github_connection')return{snapshot:current,repositories:current.options.enabled?repos:[],truncated:false};
   if(command==='connect_github'){window.__githubFixture.clearedBeforeInvoke=document.getElementById('github-token').value==='';current=connected;return{snapshot:current,repositories:repos,truncated:false}}
   if(command==='disconnect_github'){current={...disconnected,revision:5};return{snapshot:current,repositories:[],truncated:false}}
   if(command==='configure_github'){current={...connected,revision:current.revision+1,options:args.options,...(!args.options.enabled?{status:'disabled',profile:null,items:[],calendar:null}:{})};window.__githubFixture.calls.push({command,args});return{snapshot:current,repositories:args.options.enabled?repos:[],truncated:false}}
   if(command==='open_github_item')window.__githubFixture.calls.push({command,args});
  }}};
 });
 const prefs=await context.newPage();prefs.on('pageerror',e=>report.errors.push(e.message));await prefs.goto(`http://127.0.0.1:${server.httpServer.address().port}/preferences.html#integrations`);
 await prefs.locator('#github-token').fill('github_pat_fixture_not_a_real_credential_00000000000000000');await prefs.locator('#github-settings button[type=submit]').click();await prefs.waitForFunction(()=>document.querySelector('#github-settings [role=status]').textContent.includes('@fixture-account'));
 assert.equal(await prefs.evaluate(()=>window.__githubFixture.clearedBeforeInvoke),true);assert.equal(await prefs.locator('#github-token').inputValue(),'');
 assert.equal(await prefs.locator('input[data-repository]').count(),2);assert.match(await prefs.locator('#github-settings').textContent(),/Organización/);await prefs.locator('#github-settings').screenshot({path:fileURLToPath(new URL('preferences-connected-fixture.png',output))});
 await prefs.locator('[data-github-option=enabled]').uncheck();await prefs.locator('#github-save').click();await prefs.waitForFunction(()=>document.querySelector('#github-settings [role=status]').textContent.startsWith('Sincronización desactivada'));
 assert.equal(await prefs.locator('[data-github-option=enabled]').isVisible(),true);assert.equal(await prefs.getByRole('button',{name:'Desconectar y borrar credencial'}).isVisible(),true);
 await prefs.locator('[data-github-option=enabled]').check();await prefs.locator('#github-save').click();await prefs.waitForFunction(()=>document.querySelector('#github-settings [role=status]').textContent.includes('@fixture-account'));
 assert.deepEqual(await prefs.evaluate(()=>window.__githubFixture.calls.at(-1).args.options.repositories),['Orvyn-Studios/nivo']);
 await prefs.getByRole('button',{name:'Desconectar y borrar credencial'}).click();await prefs.waitForFunction(()=>document.querySelector('#github-settings [role=status]').textContent==='Sin cuenta conectada');assert.equal(await prefs.locator('input[data-repository]').count(),0);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);await page.waitForFunction(()=>!document.getElementById('toggle').disabled);
 await page.evaluate(()=>{const label=document.createElement('p');label.textContent='FIXTURE GitHub · sin cuenta real ni red';label.style.cssText='position:fixed;bottom:0;left:0;color:#a4abb7;font:12px sans-serif';document.body.append(label)});
 await page.evaluate(()=>{window.__githubFixture.emit('nivo://github',{snapshot:window.__githubFixture.connected,notices:[]});window.__githubFixture.emit('nivo://github-open',null)});
 await page.waitForFunction(()=>document.getElementById('island').getAnimations({subtree:true}).every(a=>a.playState!=='running'));
 await new Promise(r=>setTimeout(r,200));
 await page.locator('.github-card').click();await page.waitForFunction(()=>document.getElementById('island').getAnimations({subtree:true}).every(a=>a.playState!=='running'));
 assert.match(await page.locator('#github-detail').textContent(),/CI: Fallida/);assert.match(await page.locator('#github-detail').textContent(),/Sin aprobación confirmada/);
 report.geometry=await page.evaluate(()=>Object.fromEntries(['island','island-panel','github'].map(id=>{const n=document.getElementById(id),r=n.getBoundingClientRect();return[id,{x:r.x,y:r.y,height:r.height,scrollTop:n.scrollTop,parentScroll:n.parentElement.scrollTop}]})));
 assert.equal(report.geometry.github.parentScroll,0,'context fits without scrolling its heading out of the native mask');
 await page.locator('#github-detail').getByRole('button',{name:'Abrir PR',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.__githubFixture.calls.at(-1)),{command:'open_github_item',args:{id:'pr:42'}});
 // Element screenshots can crop Chromium's video screencast. Keep its viewport
 // fixed so the recording cannot manufacture a zoom absent from the product.
 await page.screenshot({path:fileURLToPath(new URL('pull-detail-fixture.png',output))});await page.locator('#github-detail').getByRole('button',{name:'Volver',exact:true}).click();await page.locator('[data-github-filter=calendar]').click();assert.equal(await page.locator('.github-calendar button').count(),28);
 await page.waitForFunction(()=>document.getElementById('island').getAnimations({subtree:true}).every(a=>a.playState!=='running'));await page.screenshot({path:fileURLToPath(new URL('contributions-fixture.png',output))});
 await page.evaluate(()=>window.__githubFixture.emit('nivo://github',{snapshot:{...window.__githubFixture.connected,revision:9,status:'disconnected',profile:null,options:{...window.__githubFixture.connected.options,enabled:false}},notices:[]}));assert.equal(await page.locator('.github-calendar button').count(),0);
 await new Promise(r=>setTimeout(r,150));const video=page.video();await page.close();await video.saveAs(fileURLToPath(new URL('github-context-fixture.webm',output)));
 report.recording='github-context-fixture.webm: synthetic account/items/calendar only, no authentication or actual network.';
 report.checks.push('PAT field cleared before native invoke; connected identity and personal/org repo selection; disconnect clears private repository list; contextual PR details keep CI separate from approval; opening passes only opaque ID; actual-shape calendar cells; opt-out clears calendar.');assert.deepEqual(report.errors,[]);report.status='passed';
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1}finally{await browser.close();await server.close();await writeFile(new URL('results.json',output),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))}
