import {bridge} from '../bridge.ts';
import {emptyGithub,type GithubSnapshot,type GithubItem} from '../github-state.ts';
import {createChoreography} from '../choreography.ts';
export function createGithubView(options:{close():void;reduced():boolean}){
 const root=document.getElementById('github')!,list=document.getElementById('github-list')!,detail=document.getElementById('github-detail')!,status=document.getElementById('github-status')!;
 const choreography=createChoreography(root,options.reduced),events=new AbortController();let snapshot=emptyGithub(),privateMode=true,filter='pull',selected:string|null=null,signature='',disposed=false;
 const labels={running:'En curso',success:'Correcta',failure:'Fallida',cancelled:'Cancelada',unknown:'Sin resultado confirmado'};
 function action(label:string,run:()=>void){const b=document.createElement('button');b.className='text-action';b.textContent=label;b.onclick=run;return b}
 function open(item:GithubItem){void bridge.openGithubItem(item.id).catch(e=>{status.textContent=String(e).slice(0,280)})}
 function paint(){
  status.textContent=snapshot.error??(!snapshot.options.enabled?'Conecta GitHub en Preferencias.':!snapshot.profile?'Verificando conexión…':snapshot.syncing?'Actualizando…':snapshot.lastSync?`Actualizado ${new Date(snapshot.lastSync).toLocaleTimeString('es-ES')}`:'Selecciona repositorios en Preferencias.');
  const chosen=snapshot.items.find(i=>i.id===selected);list.hidden=!!chosen;detail.hidden=!chosen;detail.replaceChildren();list.replaceChildren();
  for(const b of root.querySelectorAll<HTMLButtonElement>('[data-github-filter]'))b.setAttribute('aria-pressed',String(b.dataset.githubFilter===filter));
  if(chosen){
   const title=document.createElement('h2');title.textContent=privateMode?'Actividad privada':chosen.title;const repo=document.createElement('p');repo.className='detail-note';repo.textContent=privateMode?'Repositorio privado':chosen.repository;
   const summary=document.createElement('p');summary.className='detail-note';summary.textContent=`#${chosen.number} · ${chosen.state}${chosen.branch?` · ${privateMode?'Rama privada':chosen.branch}`:''}`;
   const checks=document.createElement('p');checks.className='detail-note';checks.textContent=`CI: ${labels[chosen.ci]} · Revisión: ${chosen.review==='APPROVED'?'Aprobada':chosen.review==='CHANGES_REQUESTED'?'Cambios solicitados':'Sin aprobación confirmada'}`;
   detail.append(repo,title,summary,checks,action(chosen.kind==='run'?'Ver ejecución':chosen.kind==='issue'?'Abrir issue':'Abrir PR',()=>open(chosen)),action('Volver',()=>choreography.change(()=>{selected=null;paint()})));
  }else if(filter==='calendar'){
   if(!snapshot.options.calendar||!snapshot.calendar){const p=document.createElement('p');p.className='detail-note';p.textContent=snapshot.options.calendar?'Contribuciones aún no disponibles.':'Activa contribuciones en Preferencias.';list.append(p)}
   else{const total=document.createElement('p');total.className='detail-note';total.textContent=privateMode?'Contribuciones privadas':`${snapshot.calendar.total} contribuciones · periodo anual de GitHub`;
    const grid=document.createElement('div');grid.className='github-calendar';grid.setAttribute('aria-label','Últimos días disponibles');
    for(const day of snapshot.calendar.days){const cell=document.createElement('button');cell.dataset.level=String(day.level??0);cell.title=privateMode?day.date:`${day.date} · ${day.count} contribuciones`;cell.setAttribute('aria-label',cell.title);cell.onclick=()=>{status.textContent=cell.title};grid.append(cell)}list.append(total,grid)}
  }else{
   const items=snapshot.items.filter(i=>filter==='reviews'?i.reviewRequested:filter==='run'?i.kind==='run':filter==='issue'?i.kind==='issue':i.kind==='pull'&&i.mine).slice(0,12);
   if(!items.length){const p=document.createElement('p');p.className='detail-note';p.textContent=snapshot.lastSync?'Sin actividad en esta selección.':'Esperando la primera consulta.';list.append(p)}
   for(const item of items){const card=document.createElement('button');card.className='github-card';card.dataset.ci=item.ci;const repo=document.createElement('span');repo.className='detail-note';repo.textContent=privateMode?'Repositorio privado':item.repository;
    const title=document.createElement('strong');title.textContent=privateMode?'Actividad privada':item.title;const state=document.createElement('span');state.className='detail-note';state.textContent=`#${item.number} · ${item.kind==='run'?labels[item.ci]:item.state}${item.reviewRequested?' · Revisión solicitada':''}`;
    card.append(repo,title,state);card.onclick=()=>choreography.change(()=>{selected=item.id;paint()});list.append(card)}
  }
 }
 root.addEventListener('click',event=>{const b=(event.target as Element).closest<HTMLButtonElement>('[data-github-filter]');if(b){filter=b.dataset.githubFilter!;selected=null;choreography.change(paint)}},{signal:events.signal});
 document.getElementById('github-back')!.addEventListener('click',()=>options.close(),{signal:events.signal});
 document.getElementById('github-refresh')!.addEventListener('click',()=>void bridge.refreshGithub().catch(e=>{status.textContent=String(e).slice(0,280)}),{signal:events.signal});
 document.getElementById('github-settings')!.addEventListener('click',()=>void bridge.openPreferences().catch(e=>{status.textContent=String(e).slice(0,280)}),{signal:events.signal});
 return{render(value:GithubSnapshot,privacy:boolean){if(disposed||value.revision<snapshot.revision)return;const key=`${value.revision}:${privacy}`;if(key===signature)return;signature=key;snapshot=value;privateMode=privacy;if(!value.options.enabled)selected=null;choreography.change(paint)},settle(){choreography.settle()},dispose(){disposed=true;events.abort();choreography.dispose()}};
}
