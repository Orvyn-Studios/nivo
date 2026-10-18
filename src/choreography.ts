/** Finite content choreography. Geometry remains owned by IslandMotion.
 * Shared nodes retain their composited position on interruption; text is never
 * scaled. There are no cloned views, frame loops or operation completion gates. */
export const choreographyProfiles = {
  instant: {duration:100,easing:'cubic-bezier(.2,.8,.2,1)'},
  soft: {duration:180,easing:'cubic-bezier(.2,.7,.2,1)'},
  completion: {duration:260,easing:'cubic-bezier(.16,1,.3,1)'},
  dismiss: {duration:180,easing:'cubic-bezier(.4,0,.2,1)'},
} as const;
type Profile=keyof typeof choreographyProfiles;
type Sample={left:number;top:number;width:number;height:number;opacity:number;text:string|null;exiting:boolean};
export function createChoreography(root:HTMLElement,reduced:()=>boolean,selector='[data-choreography]',incoming=true){
  const active=new Map<HTMLElement,Animation>();
  const releases=new Map<HTMLElement,()=>void>();
  let disposed=false;
  function settle(){for(const animation of active.values())animation.cancel();active.clear();for(const release of releases.values())release();releases.clear();}
  function sample(node:HTMLElement):Sample|undefined{
    const box=node.getBoundingClientRect();
    return box.width&&box.height?{left:box.left,top:box.top,width:box.width,height:box.height,opacity:Number.parseFloat(getComputedStyle(node).opacity),text:node.textContent,exiting:node.dataset?.choreographyExiting==='true'}:undefined;
  }
  return {
    change(mutate:()=>void,profile:Profile='soft'){
      if(disposed)return;
      const nodes=[...root.querySelectorAll<HTMLElement>(selector)];
      // Read the composited state before cancellation, including an interrupted FLIP.
      const before=new Map(nodes.map(node=>[node,sample(node)]));
      settle();mutate();
      if(reduced()||document.hidden||!root.getBoundingClientRect().width)return;
      const after=nodes.map(node=>({node,box:sample(node)}));
      const bounds=root.getBoundingClientRect();
      for(const {node,box} of after){
        if(!box){
          const old=before.get(node);
          // Reuse the outgoing node for a short inert fade. It leaves normal
          // layout immediately, so real progress/results never wait behind it.
          if(!old||old.exiting||!node.hidden)continue;
          const properties=['position','left','top','width','height','pointer-events'];
          const style=properties.map(key=>({key,value:node.style.getPropertyValue(key),priority:node.style.getPropertyPriority(key)})),inert=node.inert,aria=node.getAttribute('aria-hidden');
          node.hidden=false;node.inert=true;node.setAttribute('aria-hidden','true');node.dataset.choreographyExiting='true';
          Object.assign(node.style,{position:'absolute',left:`${old.left-bounds.left+root.scrollLeft}px`,top:`${old.top-bounds.top+root.scrollTop}px`,width:`${old.width}px`,height:`${old.height}px`,pointerEvents:'none'});
          const release=()=>{node.hidden=true;node.inert=inert;for(const p of style){if(p.value)node.style.setProperty(p.key,p.value,p.priority);else node.style.removeProperty(p.key);}if(aria===null)node.removeAttribute('aria-hidden');else node.setAttribute('aria-hidden',aria);delete node.dataset.choreographyExiting;};
          releases.set(node,release);
          const animation=node.animate([{opacity:old.opacity,transform:'translateY(0px)'},{opacity:0,transform:'translateY(-2px)'}],{...choreographyProfiles.dismiss,duration:120});active.set(node,animation);
          void animation.finished.catch(()=>undefined).then(()=>{if(active.get(node)!==animation)return;active.delete(node);releases.delete(node);release();});
          continue;
        }
        if(!incoming)continue;
        const old=before.get(node),x=old?old.left-box.left:0,y=old?old.top-box.top:4;
        const replaced=old&&old.text!==box.text;
        if(old&&!replaced&&Math.abs(x)+Math.abs(y)<.1&&old.opacity===1)continue;
        const animation=node.animate([
          {transform:`translate(${x}px,${y}px)`,opacity:replaced?Math.min(old.opacity,.65):old?.opacity??0},
          {transform:'translate(0px,0px)',opacity:1},
        ],choreographyProfiles[profile]);
        active.set(node,animation);
        void animation.finished.catch(()=>undefined).then(()=>{if(active.get(node)===animation)active.delete(node);});
      }
    },
    settle,
    dispose(){disposed=true;settle();},
  };
}
