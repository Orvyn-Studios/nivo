import {bridge,isNative} from '../bridge.ts';
import {defaultGithubOptions,type GithubConnection,type GithubOptions} from '../github-state.ts';
export function createGithubPreferences(parent:HTMLElement){
 const root=document.createElement('section');root.className='github-settings';root.id='github-settings';
 const heading=document.createElement('h2');heading.textContent='GitHub';
 const state=document.createElement('p');state.className='settings-intro';state.setAttribute('role','status');
 const avatar=document.createElement('img');avatar.alt='';avatar.width=32;avatar.height=32;avatar.hidden=true;
 const form=document.createElement('form');form.autocomplete='off';
 const label=document.createElement('label');label.textContent='Token fine-grained';label.htmlFor='github-token';
 const input=document.createElement('input');input.type='password';input.id='github-token';input.autocomplete='off';input.spellcheck=false;input.maxLength=255;
 const connect=document.createElement('button');connect.type='submit';connect.textContent='Conectar cuenta';connect.disabled=!isNative;
 const disconnect=document.createElement('button');disconnect.type='button';disconnect.textContent='Desconectar y borrar credencial';
 form.append(label,input,connect,disconnect);
 const options=document.createElement('div');options.className='github-options';
 const repositories=document.createElement('fieldset');const legend=document.createElement('legend');legend.textContent='Repositorios · máximo 8';repositories.append(legend);
 const controls=new Map<keyof GithubOptions,HTMLInputElement>();
 for(const [key,title]of [['enabled','Sincronizar GitHub'],['pullRequests','Mis Pull Requests'],['reviews','Revisiones solicitadas'],['ci','Comprobaciones y ejecuciones'],['issues','Issues asignadas'],['calendar','Calendario de contribuciones'],['notifications','Avisos en la isla']] as const){
  const row=document.createElement('label');row.className='setting';const text=document.createElement('span');text.textContent=title;const toggle=document.createElement('input');toggle.type='checkbox';toggle.dataset.githubOption=key;controls.set(key,toggle);row.append(text,toggle);options.append(row);
 }
 const frequency=document.createElement('label');frequency.textContent='Actualizar cada ';const interval=document.createElement('select');interval.id='github-interval';
 for(const minutes of [5,10,15,30,60]){const choice=document.createElement('option');choice.value=String(minutes*60);choice.textContent=`${minutes} min`;interval.append(choice)}frequency.append(interval);options.append(frequency,repositories);
 const save=document.createElement('button');save.textContent='Guardar selección';save.id='github-save';const refresh=document.createElement('button');refresh.textContent='Actualizar ahora';options.append(save,refresh);
 const error=document.createElement('p');error.className='settings-intro';error.setAttribute('role','status');
 const guide=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Configurar acceso de solo lectura';
 const help=document.createElement('p');help.className='settings-intro';help.textContent='En GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens, elige el propietario de los recursos y solo los repositorios deseados. Permisos de lectura: Metadata, Pull requests, Actions, Commit statuses y Checks. Issues es opcional. Las organizaciones pueden exigir aprobación; un token pendiente o de otro propietario no permite ver todos sus repositorios. Nivo no necesita permisos de escritura. Introduce el token únicamente aquí: se valida contra GitHub y Windows lo guarda en Credential Manager. El campo se vacía al conectar. Desconectar borra la credencial y los datos de la cuenta. No se envían archivos, conversaciones ni código.';
 guide.append(summary,help);root.append(heading,avatar,state,form,options,error,guide);parent.append(root);
 let current:GithubConnection={snapshot:{revision:0,status:'disconnected',profile:null,options:defaultGithubOptions(),items:[],calendar:null,lastSync:null,nextRefresh:null,syncing:false,error:null,warnings:[]},repositories:[],truncated:false};
 let pending=false,disposed=false,unlisten:(()=>void)|undefined,request=0,editing=false;
 options.addEventListener('change',()=>{editing=true});
 function render(value:GithubConnection){
  if(disposed||value.snapshot.revision<current.snapshot.revision)return;if(value.snapshot.profile?.id!==current.snapshot.profile?.id||!value.snapshot.options.enabled)editing=false;current=value;
  const s=value.snapshot;state.textContent=s.profile?`Conectado como @${s.profile.login}${s.syncing?' · Actualizando…':''}${s.lastSync?` · Última consulta ${new Date(s.lastSync).toLocaleTimeString('es-ES')}`:''}`:s.status==='connecting'?'Validando cuenta…':s.status==='verifying'?'Verificando credencial guardada…':s.status==='disabled'?'Sincronización desactivada. Actívala para verificar la conexión guardada.':'Sin cuenta conectada';
  avatar.hidden=!s.profile?.avatar;if(s.profile?.avatar)avatar.src=s.profile.avatar;else avatar.removeAttribute('src');
  error.textContent=s.error??s.warnings.join(' · ');options.hidden=!s.profile&&!s.options.enabled&&s.status!=='disabled';
  disconnect.hidden=!s.options.enabled&&s.status!=='connecting'&&s.status!=='disabled';connect.disabled=pending||!isNative;input.disabled=pending;
  if(editing)return;
  for(const[key,control]of controls)control.checked=s.options[key]===true;interval.value=String(s.options.intervalSeconds);
  repositories.querySelectorAll('label,p').forEach(n=>n.remove());
  for(const organization of [false,true])for(const repo of value.repositories.filter(r=>r.organization===organization)){
   const row=document.createElement('label');row.className='github-repository';const toggle=document.createElement('input');toggle.type='checkbox';toggle.value=repo.fullName;toggle.checked=s.options.repositories.includes(repo.fullName);toggle.dataset.repository='true';
   const text=document.createElement('span');text.textContent=`${repo.fullName}${repo.private?' · Privado':''}${repo.organization?' · Organización':''}`;row.append(toggle,text);repositories.append(row);
  }
  if(!value.repositories.length)for(const saved of s.options.repositories){const row=document.createElement('label');row.className='github-repository';const toggle=document.createElement('input');toggle.type='checkbox';toggle.value=saved;toggle.checked=true;toggle.dataset.repository='true';const text=document.createElement('span');text.textContent=`${saved} · Selección guardada, por verificar`;row.append(toggle,text);repositories.append(row)}
  if(!value.repositories.length||value.truncated){const note=document.createElement('p');note.textContent=value.truncated?'Lista limitada a 500 repositorios. Reduce el acceso del token para localizar los que necesitas.':'No hay repositorios disponibles con este token. Revisa el propietario, los permisos y la aprobación de la organización.';repositories.append(note)}
 }
 async function run(job:()=>Promise<GithubConnection>){pending=true;connect.disabled=true;input.disabled=true;error.textContent='';try{const value=await job();editing=false;render(value)}catch(e){error.textContent=(e instanceof Error?e.message:String(e)).slice(0,500)}finally{pending=false;connect.disabled=!isNative;input.disabled=false}}
 form.addEventListener('submit',event=>{event.preventDefault();if(pending)return;let token=input.value.trim();input.value='';const operation=bridge.connectGithub(token);token='';void run(()=>operation)});
 disconnect.addEventListener('click',()=>{input.value='';request++;void run(()=>bridge.disconnectGithub())});
 save.addEventListener('click',()=>{if(pending)return;const o={...current.snapshot.options,repositories:[...repositories.querySelectorAll<HTMLInputElement>('input:checked')].map(i=>i.value),intervalSeconds:Number(interval.value)};for(const[key,control]of controls)(o as unknown as Record<string,unknown>)[key]=control.checked;void run(()=>bridge.configureGithub(o))});
 refresh.addEventListener('click',()=>{if(pending)return;refresh.disabled=true;void bridge.refreshGithub().catch(e=>{error.textContent=String(e).slice(0,500)}).finally(()=>{refresh.disabled=false})});
 async function load(){const own=++request;try{const value=await bridge.githubConnection();if(own===request)render(value)}catch(e){if(!disposed)error.textContent=String(e).slice(0,500)}}
 void bridge.onGithub(()=>void load()).then(fn=>{if(disposed)fn();else unlisten=fn});void load();
 return{dispose(){disposed=true;request++;input.value='';unlisten?.()}};
}
