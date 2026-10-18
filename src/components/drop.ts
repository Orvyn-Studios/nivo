import type {DroppedFile,DropAction} from '../drop-state.ts';
import {FILE_ACTIONS,actionFraction,fileKind,formatBytes,type ActionProgress,type ActionResult} from '../actions.ts';
import {icon} from './icons.ts';
import {createChoreography} from '../choreography.ts';
import {createMailComposer} from './mail.ts';

export function createDropView(options:{
  run(action:DropAction,id?:string):Promise<ActionResult>;
  cancel(operationId:string):Promise<boolean>; changed():void; close():void;
  reduced():boolean;
  mail(draft:{recipient:string;subject:string;body:string}):Promise<void>;
}){
  const root=document.getElementById('drop')!;
  const list=document.getElementById('drop-list')!;
  const status=document.getElementById('drop-status')!;
  const zip=document.getElementById('drop-zip') as HTMLButtonElement;
  const operation=document.getElementById('drop-operation')!;
  const progress=document.getElementById('drop-progress') as HTMLProgressElement;
  const measure=document.getElementById('drop-measure')!;
  const cancel=document.getElementById('drop-cancel') as HTMLButtonElement;
  const result=document.getElementById('drop-result')!;
  const resultTitle=document.getElementById('drop-result-title')!;
  const resultDetail=document.getElementById('drop-result-detail')!;
  const folder=document.getElementById('drop-result-folder') as HTMLButtonElement;
  const retry=document.getElementById('drop-retry') as HTMLButtonElement;
  const listeners=new AbortController();
  const choreography=createChoreography(root,options.reduced);
  let files:DroppedFile[]=[],privacy=true,signature='',busy=false,operationId:string|undefined;
  let output:DroppedFile|null=null,stage:'drag'|'files'|'running'|'result'|'error'='drag';
  let revision=0,closeRequested=false,disposed=false,cancelled=false;
  let paintedStage:'drag'|'files'|'running'|'result'|'error'='drag';
  let composing=false;
  const composer=createMailComposer(root,{open:options.mail,back:()=>{composing=false;update()},done:()=>{composing=false;update();options.close()}});
  function update(){
    const changed=paintedStage!==stage;
    const paint=()=>{
    root.dataset.stage=stage;root.setAttribute('aria-busy',String(busy));
    list.hidden=stage==='drag'||composing;composer.form.hidden=!composing;operation.hidden=stage!=='running';result.hidden=stage!=='result'&&stage!=='error';
    for(const [index,row] of [...list.children].entries()){
      (row as HTMLElement).hidden=stage!=='files'&&index>0;
      const title=row.querySelector('h2')!,detail=row.querySelector('.detail-note')!;
      const file=output??files[index];
      if(file){
        const kind=fileKind(file.name),mark=row.querySelector<HTMLElement>('.file-mark')!;
        title.textContent=privacy?`Archivo ${index+1}`:file.name;title.setAttribute('title',title.textContent);
        detail.textContent=`${kind.label} · ${formatBytes(file.size)}`;
        if(mark.dataset.kind!==kind.icon){mark.replaceChildren(icon(kind.icon));mark.dataset.kind=kind.icon;}
      }
      for(const control of row.querySelectorAll<HTMLElement>('.drop-actions,.drop-more'))control.hidden=stage!=='files';
    }
    zip.hidden=stage!=='files'||composing;zip.disabled=busy||!files.length;
    for(const button of list.querySelectorAll('button'))button.disabled=busy;
    options.changed();
    };
    if(changed)choreography.change(paint,stage==='result'&&!cancelled?'completion':'soft');else paint();
    paintedStage=stage;
  }
  function button(action:DropAction,name:string,id:string){
    const node=document.createElement('button');node.type='button';node.className='text-action';
    node.textContent=name;node.dataset.action=action;node.dataset.id=id;return node;
  }
  function rows(){
    list.replaceChildren();
    for(const [index,file]of files.entries()){
      const kind=fileKind(file.name),row=document.createElement('section');row.className='drop-file';
      const heading=document.createElement('div');heading.className='file-heading';heading.dataset.choreography='file';
      const mark=document.createElement('span');mark.className='file-mark';mark.dataset.kind=kind.icon;mark.append(icon(kind.icon));
      const copy=document.createElement('div');copy.className='file-copy';
      const title=document.createElement('h2');title.textContent=privacy?`Archivo ${index+1}`:file.name;title.title=title.textContent;
      const detail=document.createElement('p');detail.className='detail-note';detail.textContent=`${kind.label} · ${formatBytes(file.size)}`;
      copy.append(title,detail);heading.append(mark,copy);row.append(heading);
      const actions=document.createElement('div');actions.className='drop-actions';actions.dataset.choreography='secondary';
      actions.append(button('copyPath','Copiar ruta',file.id),button('openFolder','Ver carpeta',file.id));
      const more=document.createElement('details');more.className='drop-more';more.dataset.choreography='more';
      const summary=document.createElement('summary');summary.textContent='Más acciones';
      more.append(summary,button('copy',FILE_ACTIONS.find(a=>a.id==='copy')!.name,file.id));
      const email=document.createElement('button');email.type='button';email.className='text-action';email.textContent='Redactar correo…';email.onclick=()=>{if(!busy){choreography.change(()=>{composing=true;status.textContent='Borrador de correo';update()})}};more.append(email);
      more.addEventListener('toggle',()=>options.changed(),{signal:listeners.signal});
      row.append(actions,more);list.append(row);
    }
  }
  async function run(kind:DropAction,id?:string){
    if(busy||disposed)return;
    const own=revision;busy=true;operationId=undefined;closeRequested=false;output=null;cancelled=false;
    stage='running';status.textContent=kind==='zip'?'Preparando ZIP…':kind==='copy'?'Preparando copia…':'Preparando acción…';
    progress.removeAttribute('value');measure.textContent='';cancel.disabled=true;cancel.textContent='Cancelar';update();
    try{
      const value=await options.run(kind,id);
      if(disposed||own!==revision)return;
      if(kind==='copyPath'||kind==='openFolder'){stage='files';status.textContent=value.message;}
      else{
        stage='result';output=value.file;cancelled=value.outcome==='cancelled';
        if(value.outcome==='success'){progress.value=1;measure.textContent='Confirmado en disco';}
        resultTitle.textContent=value.outcome==='cancelled'?'Operación cancelada':kind==='zip'?'ZIP listo':'Copia guardada';
        resultDetail.textContent=value.message;
        folder.hidden=!output;retry.hidden=true;status.textContent='Los archivos originales se conservan.';
      }
    }catch(error){
      if(disposed||own!==revision)return;
      stage='error';resultTitle.textContent='No se completó la acción';
      resultDetail.textContent=(error instanceof Error?error.message:String(error)).slice(0,280);
      folder.hidden=true;retry.hidden=false;status.textContent='Los archivos originales se conservan.';
    }finally{
      if(!disposed&&own===revision){busy=false;operationId=undefined;update();if(closeRequested){closeRequested=false;options.close();}}
    }
  }
  async function requestCancel(close=false){
    if(composing){composing=false;composer.clear();update();return;}
    if(!busy){options.close();return;}
    closeRequested ||=close;
    if(!operationId)return;
    cancel.disabled=true;cancel.textContent='Cancelando…';
    try{await options.cancel(operationId);}catch{cancel.disabled=false;cancel.textContent='Reintentar cancelación';}
  }
  root.addEventListener('click',event=>{
    const target=(event.target as Element).closest<HTMLButtonElement>('button[data-action]');
    if(target)void run(target.dataset.action as DropAction,target.dataset.id);
  },{signal:listeners.signal});
  zip.addEventListener('click',()=>void run('zip'),{signal:listeners.signal});
  cancel.addEventListener('click',()=>void requestCancel(),{signal:listeners.signal});
  document.getElementById('drop-back')!.addEventListener('click',()=>void requestCancel(true),{signal:listeners.signal});
  document.getElementById('drop-done')!.addEventListener('click',()=>options.close(),{signal:listeners.signal});
  retry.addEventListener('click',()=>{stage='files';status.textContent='Elige otra acción o destino.';update();},{signal:listeners.signal});
  folder.addEventListener('click',()=>{if(output)void options.run('openFolder',output.id).then(v=>{status.textContent=v.message;options.close();}).catch(error=>{status.textContent=String(error).slice(0,280);});},{signal:listeners.signal});
  return{
    get busy(){return busy;},get stage(){return stage;},
    get reaction():'working'|'complete'|'error'|'attention'{return stage==='running'?'working':stage==='result'&&!cancelled?'complete':stage==='error'?'error':'attention';},
    height(){return composing?320:stage==='drag'?152:stage==='running'?248:stage==='result'||stage==='error'?284:Math.min(300,files.length>1?300:list.querySelector('details[open]')?300:264);},
    settle(){choreography.settle();},
    render(value:DroppedFile[],privateMode:boolean){
      const key=JSON.stringify(value),changed=key!==signature;
      if(changed){if(operationId)void options.cancel(operationId).catch(()=>{});revision++;busy=false;operationId=undefined;closeRequested=false;signature=key;files=value;stage=value.length?'files':'drag';output=null;composing=false;composer.clear();}
      if(changed||privacy!==privateMode){privacy=privateMode;rows();}
      if(changed)status.textContent=value.length?`${value.length} archivo${value.length===1?'':'s'} · originales intactos`:'Suelta archivos sobre la isla.';
      update();
    },
    progress(value:ActionProgress){
      if(!busy||operationId&&operationId!==value.operationId)return;
      operationId=value.operationId;cancel.disabled=!value.cancellable;
      status.textContent=value.phase==='destination'?'Elige dónde guardar…':value.phase==='finalizing'?'Confirmando en disco…':'Trabajando con tus archivos…';
      const fraction=actionFraction(value);if(fraction===undefined)progress.removeAttribute('value');else progress.value=fraction;
      measure.textContent=value.phase==='running'?`${formatBytes(value.completed)}${value.total===null?'':` de ${formatBytes(value.total)}`}`:'';
      if(closeRequested&&value.cancellable)void requestCancel(true);
    },
    close(){void requestCancel(true);},
    dispose(){disposed=true;revision++;choreography.dispose();composer.clear();composer.dispose();if(operationId)void options.cancel(operationId).catch(()=>{});listeners.abort();},
  };
}
