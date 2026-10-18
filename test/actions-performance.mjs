/** Sequential process-tree measurements, with no debugging attached to Nivo. */
import {spawn} from 'node:child_process';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const currentOnly=process.argv.includes('--current-only');
if(process.argv.slice(2).some(arg=>arg!=='--current-only'))throw new Error('Only --current-only is supported.');
const baseline=process.env.NIVO_BASELINE_BINARY;
if(!currentOnly&&(!baseline||!path.isAbsolute(baseline)))throw new Error('Provide the absolute, immutable NIVO_BASELINE_BINARY.');
const output=path.join(root,'artifacts/actions/performance-pair',new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(output,{recursive:true});
const report={status:'running',limits:'Sequential 120-second compact visible samples on a shared desktop, same persisted preferences and Windows providers. No CDP, no exclusive-workload isolation. Summed working sets count shared pages more than once. Private commit is separate, not extra resident RAM. This is not a long-session or FPS acceptance.',runs:[]};
report.selection=currentOnly?'current-only; no baseline measured by this invocation':'baseline-then-current';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function command(file,args){return new Promise((resolve,reject)=>{const p=spawn(file,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';p.stdout.on('data',d=>log+=d);p.stderr.on('data',d=>log+=d);p.once('error',reject);p.once('exit',code=>code===0?resolve(log):reject(new Error(log)))})}
function csv(text){const parse=line=>[...line.matchAll(/(?:^|,)(?:"((?:[^"]|"")*)"|([^,]*))/g)].map(m=>(m[1]??m[2]).replaceAll('""','"'));const lines=text.trim().replace(/^\uFEFF/,'').split(/\r?\n/),keys=parse(lines.shift());return lines.map(l=>Object.fromEntries(parse(l).map((v,i)=>[keys[i],v])))}
const n=(row,key)=>row[key]===''?NaN:Number(row[key]?.replace(',','.'));
const mean=values=>values.reduce((a,b)=>a+b,0)/Math.max(1,values.length);
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
try{
 for(const [label,exe]of [...(currentOnly?[]:[['before',baseline]]),['after',path.join(root,'src-tauri/target/release/nivo-desktop.exe')]]){
  const sha256=createHash('sha256').update(await readFile(exe)).digest('hex'),folder=path.join(output,label);await mkdir(folder,{recursive:true});
  const child=spawn(exe,[],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'',WEBVIEW2_USER_DATA_FOLDER:''}});
  try{await sleep(5000);if(child.exitCode!==null)throw new Error('Close the existing Nivo instance before a sequential performance measurement.');
   console.log(`Measuring ${label}: 120 seconds, compact visible, without CDP.`);
   const log=await command('powershell.exe',['-NoProfile','-File',path.join(root,'scripts/measure-process.ps1'),'-NivoProcessId',String(child.pid),'-ExpectedProcessName',path.basename(exe,'.exe').toLowerCase(),'-DurationSeconds','120','-IntervalSeconds','2','-Condition',`compact-visible-no-CDP-${label}-living-island`,'-BuildLabel',sha256,'-OutputDirectory',folder]);
   await writeFile(path.join(folder,'measurement.log'),log);const files=await readdir(folder),metadata=JSON.parse((await readFile(path.join(folder,files.find(n=>n.endsWith('.json'))),'utf8')).replace(/^\uFEFF/,'')),rows=csv(await readFile(path.join(folder,files.find(n=>n.endsWith('.csv'))),'utf8'));
   if(metadata.status!=='completed')throw new Error('Measurement did not complete.');
   const cpu=rows.map(r=>n(r,'cpu_percent_normalized')).filter(Number.isFinite);
   report.runs.push({label,sha256,samples:rows.length,elapsedSeconds:n(rows.at(-1),'elapsed_seconds'),incompleteCpuSamples:metadata.incompleteCpuSamples,cpuNormalizedMeanPercent:mean(cpu),cpuNormalizedMaxPercent:Math.max(...cpu),workingSetMedianMiB:median(rows.map(r=>n(r,'working_set_bytes_sum')/1048576)),privateCommitMedianMiB:median(rows.map(r=>n(r,'private_bytes_sum')/1048576))});
  }finally{if(child.exitCode===null)await command('powershell.exe',['-NoProfile','-File',path.join(root,'test/close-owned-nivo.ps1'),'-NivoId',String(child.pid),'-ExpectedPath',exe]);await sleep(500)}
 }
 report.status='passed';
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1}finally{await writeFile(path.join(output,'summary.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,output},null,2))}
