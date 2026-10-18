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
type Sample={left:number;top:number;opacity:number;text:string|null};
export function createChoreography(root:HTMLElement,reduced:()=>boolean){
  const active=new Map<HTMLElement,Animation>();
  let disposed=false;
  function settle(){for(const animation of active.values())animation.cancel();active.clear();}
  function sample(node:HTMLElement):Sample|undefined{
    const box=node.getBoundingClientRect();
    return box.width&&box.height?{left:box.left,top:box.top,opacity:Number.parseFloat(getComputedStyle(node).opacity),text:node.textContent}:undefined;
  }
  return {
    change(mutate:()=>void,profile:Profile='soft'){
      if(disposed)return;
      const nodes=[...root.querySelectorAll<HTMLElement>('[data-choreography]')];
      // Read the composited state before cancellation, including an interrupted FLIP.
      const before=new Map(nodes.map(node=>[node,sample(node)]));
      settle();mutate();
      if(reduced()||document.hidden||!root.getBoundingClientRect().width)return;
      const after=nodes.map(node=>({node,box:sample(node)}));
      for(const {node,box} of after){
        if(!box)continue;
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
