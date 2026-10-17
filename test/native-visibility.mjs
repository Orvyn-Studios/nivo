import {spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
/** External real HWND, finite lifetime, restored settings by caller. */
export async function checkNativeVisibility(page,pid,root){
 const helper=spawn('powershell.exe',['-NoProfile','-File',path.join(root,'test/native-visibility-fixture.ps1'),'-NivoId',String(pid)],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
 let pending,buffer='',error='';const messages=[];
 helper.stdout.on('data',data=>{buffer+=data;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);if(line.startsWith('{')){const value=JSON.parse(line);if(pending){const resolve=pending;pending=undefined;resolve(value);}else messages.push(value);}}});
 helper.stderr.on('data',data=>error+=data);
 const next=()=>messages.length?Promise.resolve(messages.shift()):new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending=undefined;reject(new Error('Visibility fixture timeout: '+error));},10000);pending=value=>{clearTimeout(timer);resolve(value)};});
 const send=command=>{helper.stdin.write(command+'\n');return next();};
 const settings=patch=>page.evaluate(async patch=>{const s=await window.__TAURI__.core.invoke('get_settings');await window.__TAURI__.core.invoke('save_settings',{settings:{...s,...patch}})},patch);
 const wait=async predicate=>{let value;for(let i=0;i<30;i++){value=await send('snapshot');if(predicate(value))return value;await new Promise(r=>setTimeout(r,50));}throw new Error('Native visibility did not reach requested state: '+JSON.stringify(value)+' '+error);};
 const result={};
 try{
   await next();await settings({hide_behind_apps:false,hide_in_fullscreen:false});
   await send('normal');result.aboveNormalApp=await wait(s=>s.fixtureForeground&&s.visible&&s.topmost&&s.islandOwnsPoint);
   await settings({hide_behind_apps:true});
   // Bringing the ordinary fixture forward after opting into occlusion must
   // cover Nivo while keeping Nivo's own visible intent intact.
   await send('normal');result.behindNormalApp=await wait(s=>s.fixtureForeground&&s.visible&&!s.topmost&&!s.islandOwnsPoint);
   await settings({hide_behind_apps:false,hide_in_fullscreen:true});
   await send('fullscreen');result.fullscreenOptIn=await wait(s=>s.fixtureForeground&&!s.visible);
   await send('normal');result.restoredAfterFullscreen=await wait(s=>s.fixtureForeground&&s.visible&&s.islandOwnsPoint);
   await settings({hide_in_fullscreen:false});await send('fullscreen');
   result.fullscreenDefault=await wait(s=>s.fixtureForeground&&s.visible&&s.topmost&&s.islandOwnsPoint);
   assert.equal(result.aboveNormalApp.fixtureForeground,true,'showing Nivo must not activate it');
   return result;
 }finally{
   helper.stdin.end('close\n');await new Promise(resolve=>{if(helper.exitCode!==null)return resolve();helper.once('exit',resolve);setTimeout(resolve,3000).unref();});
 }
}
