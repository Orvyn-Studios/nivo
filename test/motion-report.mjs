/** Summarize bounded local probes. Never interpret rAF as presented FPS. */
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const root=new URL('../artifacts/motion/',import.meta.url);
const percentile=(values,p)=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return a[Math.min(a.length-1,Math.floor(a.length*p))]??null};
const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const json=async p=>JSON.parse(await readFile(new URL(p,root),'utf8'));
async function motion(label){
 const r=await json(`${label}/results.json`),before=Object.fromEntries(r.before.performance.metrics.map(v=>[v.name,v.value])),after=Object.fromEntries(r.after.performance.metrics.map(v=>[v.name,v.value]));
 const gaps=r.actions.flatMap(a=>a.frames.map(f=>f.delta));
 let regionResponse;
 if(r.nativeRegionProbe){
   const {samples}=await json(`${label}/regions.json`),shape=s=>[s.windowX+s.left,s.windowY+s.top,s.right-s.left,s.bottom-s.top].join(','),responses=[];
   for(const action of r.actions.filter(a=>a.kind==='settled')){
     const previous=samples.findLast(s=>s.wallMs<=action.wall);if(!previous)continue;
     const next=samples.find(s=>s.wallMs>action.wall&&s.wallMs<action.wall+action.duration&&shape(s)!==shape(previous));if(next)responses.push(next.wallMs-action.wall);
   }
   regionResponse={samples:responses.length,medianMs:percentile(responses,.5),p95Ms:percentile(responses,.95),limit:'First sampled physical region change; approx 5ms probe quantization and wall-clock alignment error; not DWM pixel presentation.'};
 }
 return {label,status:r.status,sha256:r.binarySha256,actions:r.actions.length,layout:after.LayoutCount-before.LayoutCount,recalc:after.RecalcStyleCount-before.RecalcStyleCount,scriptMs:(after.ScriptDuration-before.ScriptDuration)*1000,taskMs:(after.TaskDuration-before.TaskDuration)*1000,heapMiB:after.JSHeapUsedSize/1048576,rafP95Ms:percentile(gaps,.95),rafMaxMs:Math.max(...gaps),regionResponse,longTasks:r.longTasks.length,region:r.nativeRegionProbe,transitionBuildMaxMs:Math.max(...r.metrics.map(m=>m.buildMs??0)),nativeAck:r.metrics.flatMap(m=>m.native?[m.native]:[])};
}
async function resources(label){
 const folder=new URL(label+'/',root),files=await readdir(folder),file=files.find(f=>f.endsWith('.csv'));
 const lines=(await readFile(new URL(file,folder),'utf8')).trim().split(/\r?\n/),parse=l=>[...l.matchAll(/(?:^|,)(?:"((?:[^"]|"")*)"|([^,]*))/g)].map(m=>(m[1]??m[2]).replaceAll('""','"'));
 const keys=parse(lines.shift()),rows=lines.map(l=>Object.fromEntries(parse(l).map((v,i)=>[keys[i],v]))),n=(r,k)=>r[k]===''?NaN:Number(r[k]?.replace(',','.'));
 const cpu=rows.map(r=>n(r,'cpu_percent_normalized')).filter(Number.isFinite),ws=rows.map(r=>n(r,'working_set_bytes_sum')/1048576),privateBytes=rows.map(r=>n(r,'private_bytes_sum')/1048576);
 const last=n(rows.at(-1),'elapsed_seconds'),tail=rows.filter(r=>n(r,'elapsed_seconds')>=last-120),steadyCpu=tail.map(r=>n(r,'cpu_percent_normalized')).filter(Number.isFinite);
 return {label,samples:rows.length,elapsedSeconds:last,cpuNormalizedMeanPercent:avg(cpu),cpuNormalizedMaxPercent:Math.max(...cpu),workingSetMedianMiB:percentile(ws,.5),workingSetMaxMiB:Math.max(...ws),privateCommitMedianMiB:percentile(privateBytes,.5),privateCommitMaxMiB:Math.max(...privateBytes),privateCommitFirstMiB:privateBytes[0],privateCommitLastMiB:privateBytes.at(-1),last120Seconds:{samples:tail.length,cpuNormalizedMeanPercent:avg(steadyCpu),workingSetMedianMiB:percentile(tail.map(r=>n(r,'working_set_bytes_sum')/1048576),.5),privateCommitMedianMiB:percentile(tail.map(r=>n(r,'private_bytes_sum')/1048576),.5)}};
}
const result={limits:'Single sequential runs, shared desktop. rAF is callback scheduling, not DWM presentation. CPU normalized across all 24 logical processors. Summed working sets double-count shared pages; private commit is a separate measure, not additional RAM.',motion:[],resources:[]};
for(const label of ['baseline-compare-native','final-region-native','baseline-browser','stress-browser'])try{result.motion.push(await motion(label))}catch(e){result.motion.push({label,unavailable:String(e)})}
for(const label of ['baseline-uninstrumented','after-uninstrumented','baseline-native/performance','after-compare-native/performance'])try{result.resources.push(await resources(label))}catch(e){result.resources.push({label,unavailable:String(e)})}
await mkdir(root,{recursive:true});await writeFile(new URL('summary.json',root),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
