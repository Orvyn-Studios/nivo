/** Actual OLE + native save dialog + Rust ZIP. All files belong to this fixture. */
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=path.join(root,'artifacts/actions/native');await mkdir(output,{recursive:true});
const exe=path.join(root,'src-tauri/target/release/nivo-desktop.exe');
const port=await new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});
const child=spawn(exe,[],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,WEBVIEW2_USER_DATA_FOLDER:path.join(output,'profile')}});
const report={status:'running',environment:'Actual Windows release / WebView2 / owned WinForms OLE source / native Save dialog / Rust Deflate',sha256:createHash('sha256').update(await readFile(exe)).digest('hex'),checks:[]};
let page,browser,original;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function native(action,extra=[]){return new Promise((resolve,reject)=>{
 const p=spawn('powershell.exe',['-NoProfile','-STA','-File',path.join(root,'test/native-drop-fixture.ps1'),'-Action',action,'-NivoId',String(child.pid),...extra],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';
 const timeout=setTimeout(()=>{p.kill();reject(new Error(`Owned ${action} fixture exceeded 25 seconds. ${err} ${out}`))},25000);
 p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.once('error',e=>{clearTimeout(timeout);reject(e)});p.once('exit',code=>{clearTimeout(timeout);code===0?resolve(out.trim()):reject(new Error(err||out))});
})}
try{
 let endpoint;for(let n=0;n<80;n++){if(child.exitCode!==null)throw new Error('Close the existing workspace Nivo copy before native acceptance.');try{endpoint=await(await fetch(`http://127.0.0.1:${port}/json/version`)).json();break}catch{await delay(100)}}
 browser=await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);page=browser.contexts()[0].pages()[0]??await browser.contexts()[0].waitForEvent('page');page.setDefaultTimeout(12000);
 await page.waitForFunction(()=>!document.getElementById('toggle').disabled);
 original=await page.evaluate(()=>window.__TAURI__.core.invoke('get_settings'));
 await page.evaluate(async settings=>{await window.__TAURI__.core.invoke('save_settings',{settings:{...settings,drop_enabled:true,privacy_mode:false,motion:'full',media_enabled:false}});window.__nativeProgress=[];await window.__TAURI__.event.listen('nivo://action-progress',({payload})=>window.__nativeProgress.push(payload),{target:'island'})},original);
 async function drag(file){
  const point=await page.locator('#toggle').evaluate(node=>{const r=node.getBoundingClientRect();return{x:Math.round(screenX+(r.left+r.width/2)*devicePixelRatio),y:Math.round(screenY+(r.top+r.height/2)*devicePixelRatio)}});
  report.ole=await native('Drag',['-FixturePath',file,'-X',String(point.x),'-Y',String(point.y)]);
  await page.waitForFunction(()=>document.getElementById('drop').dataset.stage==='files');
 }
 async function dialog(action,destination){
  let error;for(let i=0;i<12;i++){try{return await native(action,destination?['-FixturePath',destination]:[])}catch(e){error=e;await delay(150)}}throw error;
 }
 const input=path.join(output,'diseño-ñ.txt'),destination=path.join(output,`resultado-${Date.now()}.zip`);
 await writeFile(input,Buffer.alloc(1024*1024,65));await drag(input);
 await page.locator('#drop-zip').click();await dialog('Cancel');
 await page.waitForFunction(()=>document.getElementById('drop').dataset.stage==='result');assert.match(await page.locator('#drop-result-title').textContent(),/cancelada/);
 report.checks.push('Cancel in the actual native Save dialog returns cancellation, without a fabricated success.');
 await page.locator('#drop-done').click();await drag(input);await page.locator('#drop-zip').click();await dialog('Save',destination);
 await page.waitForFunction(()=>document.getElementById('drop').dataset.stage==='result');assert.match(await page.locator('#drop-result-title').textContent(),/ZIP listo/);
 const zip=await readFile(destination);assert.equal(zip.readUInt32LE(0),0x04034b50);assert.equal(zip.readUInt16LE(8),8);assert.ok(zip.length<10000);assert.equal((await stat(input)).size,1024*1024);
 await page.locator('#island').screenshot({path:path.join(output,'actual-zip-result.png')});
 report.checks.push('Actual OLE Unicode file drop creates a real Deflate ZIP through the native destination dialog; source intact and compressed size <1% of repetitive fixture.');
 await page.locator('#drop-done').click();const large=path.join(output,'cancel-fixture.txt'),partial=path.join(output,`cancelled-${Date.now()}.zip`);await writeFile(large,randomBytes(128*1024*1024));await drag(large);
 await page.locator('#drop-zip').click();await dialog('Save',partial);await page.waitForFunction(()=>!document.getElementById('drop-cancel').disabled);await page.locator('#drop-cancel').click();
 await page.waitForFunction(()=>document.getElementById('drop').dataset.stage==='result');assert.match(await page.locator('#drop-result-title').textContent(),/cancelada/);assert.equal(await stat(partial).then(()=>true,()=>false),false);assert.equal((await stat(large)).size,128*1024*1024);
 report.checks.push('Actual streaming cancellation removes its exclusively created partial destination and preserves the original.');report.progress=await page.evaluate(()=>window.__nativeProgress);report.status='passed';
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;if(page)await page.locator('#island').screenshot({path:path.join(output,'failure.png')}).catch(()=>{})}
finally{
 if(page&&original)await page.evaluate(settings=>window.__TAURI__.core.invoke('save_settings',{settings}),original).catch(e=>{report.restoreError=e.message;process.exitCode=1});
 if(page)await page.evaluate(()=>window.__TAURI__.core.invoke('quit_app')).catch(()=>{});if(browser)await browser.close().catch(()=>{});
 await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(()=>{child.kill();resolve()},4000).unref()});
 await writeFile(path.join(output,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
