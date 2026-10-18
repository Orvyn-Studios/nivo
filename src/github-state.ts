export interface GithubOptions {enabled:boolean;repositories:string[];pullRequests:boolean;reviews:boolean;ci:boolean;issues:boolean;calendar:boolean;notifications:boolean;intervalSeconds:number}
export interface GithubItem {id:string;kind:'pull'|'run'|'issue';repository:string;title:string;number:number;state:string;url:string;updatedAt:string;headSha:string|null;branch:string;ci:'running'|'success'|'failure'|'cancelled'|'unknown';review:string;mine:boolean;reviewRequested:boolean;attempt:number}
export interface GithubSnapshot {revision:number;status:string;profile:{id:number;login:string;avatar:string|null}|null;options:GithubOptions;items:GithubItem[];calendar:{total:number;days:{date:string;count:number;level:number|null}[]}|null;lastSync:number|null;nextRefresh:number|null;syncing:boolean;error:string|null;warnings:string[]}
export interface GithubRepository {id:number;fullName:string;organization:boolean;private:boolean;defaultBranch:string}
export interface GithubConnection {snapshot:GithubSnapshot;repositories:GithubRepository[];truncated:boolean}
export interface GithubNotice {id:string;title:string;body:string;actionId:string;actionLabel:string;failure:boolean}
export const defaultGithubOptions=():GithubOptions=>({enabled:false,repositories:[],pullRequests:true,reviews:true,ci:true,issues:false,calendar:false,notifications:false,intervalSeconds:300});
export const emptyGithub=():GithubSnapshot=>({revision:0,status:'disconnected',profile:null,options:defaultGithubOptions(),items:[],calendar:null,lastSync:null,nextRefresh:null,syncing:false,error:null,warnings:[]});
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown,n=1024):v is string=>typeof v==='string'&&v.length<=n&&!/[\u0000-\u001f\u007f]/.test(v);
const number=(v:unknown):v is number=>Number.isSafeInteger(v)&&(v as number)>=0;
const nullableNumber=(v:unknown)=>v===null||number(v);
const repo=(v:unknown):v is string=>text(v,201)&&/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(v)&&!['.','..'].includes(v.split('/')[1]!);
export function parseGithub(value:unknown):GithubSnapshot|null{
 if(!obj(value)||!number(value.revision)||!['disabled','disconnected','verifying','connecting','connected','error'].includes(value.status as string)||typeof value.syncing!=='boolean'||!nullableNumber(value.lastSync)||!nullableNumber(value.nextRefresh)||!(value.error===null||text(value.error))||!Array.isArray(value.warnings)||value.warnings.length>32||!value.warnings.every(v=>text(v)))return null;
 const o=value.options;if(!obj(o)||!['enabled','pullRequests','reviews','ci','issues','calendar','notifications'].every(k=>typeof o[k]==='boolean')||!Array.isArray(o.repositories)||o.repositories.length>8||!o.repositories.every(repo)||new Set(o.repositories.map(v=>v.toLowerCase())).size!==o.repositories.length||!number(o.intervalSeconds)||o.intervalSeconds<300||o.intervalSeconds>3600)return null;
 const p=value.profile;if(p!==null&&(!obj(p)||!number(p.id)||!text(p.login,100)||!(p.avatar===null||text(p.avatar,360000)&&/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(p.avatar))))return null;
 const repositories=o.repositories;
 if(!Array.isArray(value.items)||value.items.length>240||!value.items.every(i=>obj(i)&&text(i.id,256)&&['pull','run','issue'].includes(i.kind as string)&&repo(i.repository)&&repositories.includes(i.repository)&&text(i.title)&&number(i.number)&&text(i.state,64)&&text(i.url,512)&&text(i.updatedAt,64)&&(i.headSha===null||text(i.headSha,64)&&/^[a-fA-F0-9]{40,64}$/.test(i.headSha))&&text(i.branch,256)&&['running','success','failure','cancelled','unknown'].includes(i.ci as string)&&text(i.review,64)&&typeof i.mine==='boolean'&&typeof i.reviewRequested==='boolean'&&number(i.attempt)))return null;
 const c=value.calendar;if(c!==null&&(!obj(c)||!number(c.total)||!Array.isArray(c.days)||c.days.length>91||!c.days.every(d=>obj(d)&&text(d.date,10)&&/^\d{4}-\d{2}-\d{2}$/.test(d.date)&&number(d.count)&&(d.level===null||number(d.level)&&d.level<=4))))return null;
 // A disabled/disconnected provider must not retain private data in the webview.
 const result=value as unknown as GithubSnapshot;
 return !result.options.enabled||result.status==='disconnected'?{...result,profile:null,items:[],calendar:null}:result;
}
export function parseGithubConnection(value:unknown):GithubConnection|null{
 if(!obj(value))return null;const snapshot=parseGithub(value.snapshot);
 if(!snapshot||!Array.isArray(value.repositories)||value.repositories.length>500||typeof value.truncated!=='boolean'||!value.repositories.every(r=>obj(r)&&number(r.id)&&repo(r.fullName)&&typeof r.organization==='boolean'&&typeof r.private==='boolean'&&text(r.defaultBranch,256)))return null;
 return{snapshot,repositories:snapshot.options.enabled?value.repositories as unknown as GithubRepository[]:[],truncated:value.truncated};
}
export function parseGithubNotices(value:unknown):GithubNotice[]{
 return Array.isArray(value)&&value.length<=3?value.filter((v):v is GithubNotice=>obj(v)&&text(v.id,120)&&text(v.title,160)&&text(v.body,280)&&text(v.actionId,256)&&text(v.actionLabel,40)&&typeof v.failure==='boolean'):[];
}
