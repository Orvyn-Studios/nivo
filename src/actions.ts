import {parseDroppedFiles,type DroppedFile,type DropAction} from './drop-state.ts';

export interface ActionDefinition {
  id:DropAction; context:'files'; name:string;
  permission:'native-drop'; selection:'one'|'batch'; cancellable:boolean;
}
export const FILE_ACTIONS:readonly ActionDefinition[]=Object.freeze([
  {id:'copyPath',context:'files',name:'Copiar ruta',permission:'native-drop',selection:'one',cancellable:false},
  {id:'openFolder',context:'files',name:'Abrir carpeta',permission:'native-drop',selection:'one',cancellable:false},
  {id:'copy',context:'files',name:'Guardar copia…',permission:'native-drop',selection:'one',cancellable:true},
  {id:'zip',context:'files',name:'Crear ZIP…',permission:'native-drop',selection:'batch',cancellable:true},
]);
export interface ActionProgress {
  operationId:string; phase:'destination'|'running'|'finalizing';
  completed:number; total:number|null; cancellable:boolean;
}
export interface ActionResult {
  operationId:string; outcome:'success'|'cancelled'; message:string; file:DroppedFile|null;
}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const operation=(v:unknown):v is string=>typeof v==='string'&&/^action:\d+$/.test(v);
export function parseActionProgress(value:unknown):ActionProgress|null{
  if(!record(value)||!operation(value.operationId)||!['destination','running','finalizing'].includes(String(value.phase))
    ||!Number.isSafeInteger(value.completed)||(value.completed as number)<0||typeof value.cancellable!=='boolean'
    ||(value.total!==null&&(!Number.isSafeInteger(value.total)||(value.total as number)<0)))return null;
  return {operationId:value.operationId,phase:value.phase as ActionProgress['phase'],completed:value.completed as number,total:value.total as number|null,cancellable:value.cancellable};
}
export function parseActionResult(value:unknown):ActionResult{
  if(!record(value)||!operation(value.operationId)||!['success','cancelled'].includes(String(value.outcome))
    ||typeof value.message!=='string'||value.message.length>280)throw new Error('Resultado de acción no válido.');
  const files=value.file==null?[]:parseDroppedFiles([value.file]);
  if(!files)throw new Error('Archivo de resultado no válido.');
  return{operationId:value.operationId,outcome:value.outcome as ActionResult['outcome'],message:value.message,file:files[0]??null};
}
export function actionFraction(value:ActionProgress):number|undefined{
  return value.phase==='running'&&value.total!==null&&value.total>0&&value.completed<=value.total?value.completed/value.total:undefined;
}
export function formatBytes(bytes:number):string{
  if(bytes<1024)return `${bytes} B`;
  const unit=bytes>=1024**3?'GB':bytes>=1024**2?'MB':'KB';
  const divisor=unit==='GB'?1024**3:unit==='MB'?1024**2:1024;
  return `${new Intl.NumberFormat('es-ES',{maximumFractionDigits:1}).format(bytes/divisor)} ${unit}`;
}
export function fileKind(name:string):{label:string;icon:string}{
  const ext=name.split('.').at(-1)?.toLowerCase();
  if(ext==='pdf')return{label:'Documento PDF',icon:'file'};
  if(['png','jpg','jpeg','gif','webp','bmp'].includes(ext??''))return{label:'Imagen',icon:'image'};
  if(['zip','7z','rar','gz'].includes(ext??''))return{label:'Archivo comprimido',icon:'archive'};
  if(['mp3','wav','flac','m4a'].includes(ext??''))return{label:'Audio',icon:'sound'};
  if(['txt','md','csv','json','log'].includes(ext??''))return{label:'Documento de texto',icon:'file'};
  return{label:'Archivo',icon:'file'};
}
