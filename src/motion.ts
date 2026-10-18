import { measureTransition } from './metrics.ts';
import { springTrack, sampleTrack, type SpringPoint } from './spring.ts';
import { smoothStep, geometryMesh } from './motion-profiles.ts';
import { createSurfaceWriter, SurfaceSupersededError, type SurfaceGeometry, type SurfaceVelocity, type SurfaceSnapshot } from './native-surface.ts';

interface Geometry { width:number; height:number; radius:number }
interface NativeMotion {
  send(shape:SurfaceGeometry,epoch:number,velocity?:SurfaceVelocity):Promise<unknown>;
  epoch():number;
  snapshot?():SurfaceSnapshot|undefined;
  recover?(expanded:boolean):Promise<void>;
  onError(error:unknown):void;
}
const zero=():SurfaceVelocity=>({width:0,height:0,radius:0});
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
function mask(layout:Geometry,visual:Geometry):string {
  const side=Math.max(0,(layout.width-visual.width)/2);
  return `inset(0px ${side}px ${Math.max(0,layout.height-visual.height)}px ${side}px round ${visual.radius}px)`;
}

/** One finite timeline. The browser preview uses a CSS mask; Windows uses its
 * HRGN as the authoritative paint + input silhouette, avoiding two drifting masks. */
export class IslandMotion {
  private active:Animation[]=[];
  private clock:Animation|undefined;
  private stopMeasurement:((interrupted:boolean)=>void)|undefined;
  private frozen:Geometry|undefined;
  private velocity=zero();
  private tracks:{width:SpringPoint[];height:SpringPoint[];radius:SpringPoint[];duration:number}|undefined;
  private revision=0;
  private targetExpanded=false;
  private nativeMask=false;
  private base=new Map<HTMLElement,{opacity:string;transform:string;origin:string}>();
  private frozenContent=new Map<HTMLElement,{opacity:number;transform:string;origin:string}>();
  private surface:ReturnType<typeof createSurfaceWriter>|undefined;
  private island:HTMLElement;
  private panel:HTMLElement;
  private identity:HTMLElement|undefined;
  private native:NativeMotion|undefined;
  private previousGroups:Set<HTMLElement>|undefined;
  constructor(island:HTMLElement,panel:HTMLElement,identity?:HTMLElement,native?:NativeMotion){
    this.island=island;this.panel=panel;this.identity=identity;this.native=native;
    if(native)this.surface=createSurfaceWriter(native.send,native.onError);
  }

  private point(time:number):{shape:Geometry;velocity:SurfaceVelocity} {
    const t=this.tracks;
    if(!t)return{shape:this.frozen??{width:112,height:34,radius:17},velocity:this.velocity};
    const w=sampleTrack(t.width,time,t.duration),h=sampleTrack(t.height,time,t.duration),r=sampleTrack(t.radius,time,t.duration);
    const width=clamp(w.value,1,388),height=clamp(h.value,1,320),radius=clamp(r.value,0,Math.min(width,height)/2);
    return{shape:{width,height,radius},velocity:{width:width===w.value?w.velocity:0,height:height===h.value?h.velocity:0,radius:radius===r.value?r.velocity:0}};
  }

  cancel():void {
    this.revision++;
    this.surface?.cancel();
    if(this.clock&&this.tracks){
      const time=typeof this.clock.currentTime==='number'?this.clock.currentTime:0;
      const point=this.point(time);this.frozen=point.shape;this.velocity=point.velocity;
      if(!this.nativeMask){
        // Read the currently composited CSS mask only on interruption.
        const bounds=this.island.getBoundingClientRect(),style=getComputedStyle(this.island);
        const match=style.clipPath?.match(/^inset\((.+?) round ([\d.e+-]+)px\)$/);
        const values=match?.[1]?.split(/\s+/).map(v=>/^-?[\d.e+-]+px$/.test(v)?Number.parseFloat(v):NaN);
        if(match&&values&&values.length>=1&&values.length<=4&&values.every(Number.isFinite)){
          const top=values[0]!,right=values[1]??top,bottom=values[2]??top,left=values[3]??right;
          this.frozen={width:bounds.width-left-right,height:bounds.height-top-bottom,radius:Number(match[2])};
          this.island.style.clipPath=style.clipPath;
        }
      }
    }
    // Batch reads before writes. Cancellation preserves content opacity as well
    // as geometry, so a reversal cannot flash back to an unanimated first frame.
    const frozen=[...this.base.keys()].map(target=>{const s=getComputedStyle(target);return{target,opacity:Number.parseFloat(s.opacity)||0,transform:s.transform,origin:s.transformOrigin}});
    for(const value of frozen){
      this.frozenContent.set(value.target,{opacity:value.opacity,transform:value.transform,origin:value.origin});
      value.target.style.opacity=String(value.opacity);value.target.style.transform=value.transform;value.target.style.transformOrigin=value.origin;
    }
    this.active.forEach(a=>a.cancel());this.active=[];this.clock=undefined;this.tracks=undefined;
    this.stopMeasurement?.(true);this.stopMeasurement=undefined;
  }

  settle():void {
    const operation=this.to(this.targetExpanded,true),own=this.revision;
    void operation.catch(error=>{if(own===this.revision)this.native?.onError(error)});
  }

  captureLayout():void {
    if(this.active.length){this.cancel();return;}
    const bounds=this.island.getBoundingClientRect();
    this.frozen={width:bounds.width,height:bounds.height,radius:Number.parseFloat(getComputedStyle(this.island).borderRadius)||17};
    // Hold the actual layout while the new semantic target and its native epoch
    // are prepared. Otherwise changing CSS variables jumps before WAAPI starts.
    this.island.style.width=`${bounds.width}px`;this.island.style.height=`${bounds.height}px`;
  }
  captureContent():void{this.previousGroups=new Set(this.groups());}

  private restoreContent():void {
    for(const [target,style] of this.base){
      target.style.opacity=style.opacity;target.style.transform=style.transform;target.style.transformOrigin=style.origin;
    }
    this.base.clear();
  }

  private clearLayout():void {
    for(const name of ['clip-path','width','height'])this.island.style.removeProperty(name);
    this.panel.style?.removeProperty('width');this.panel.style?.removeProperty('height');this.panel.style?.removeProperty('margin-inline');
    this.identity?.style.removeProperty('transform');
    this.island.dataset.nativeMask='false';this.frozen=undefined;
  }

  private groups():HTMLElement[] {
    const selected=this.panel.querySelectorAll?.<HTMLElement>('.media-copy,.media-controls,.media-timeline,#activity-footer,.media-empty,#integration-activity,#notification,#audio,#drop');
    const groups=selected?[...selected].filter(target=>target.getBoundingClientRect().width>0&&!target.closest?.('[data-choreography-exiting=true]')):[];
    return groups.length?groups:[this.panel];
  }

  async to(expanded:boolean,reduced:boolean):Promise<void> {
    const previousGroups=this.previousGroups;this.previousGroups=undefined;
    this.cancel();const own=this.revision;
    const oldLayout=this.island.getBoundingClientRect();
    const nativeState=this.native?.snapshot?.();
    this.nativeMask=Boolean(nativeState?.sample);
    const before:Geometry=nativeState?.sample?.shape??this.frozen??{width:oldLayout.width,height:oldLayout.height,radius:this.island.dataset.expanded==='true'?28:17};
    if(nativeState?.sample)this.velocity={...nativeState.sample.velocity};
    const wasExpanded=this.targetExpanded;this.targetExpanded=expanded;
    const frozen=new Map(this.frozenContent);this.frozenContent.clear();this.restoreContent();
    this.clearLayout();

    // Two finite layout states determine the artwork's shared coordinates. Only
    // its bitmap/fallback is transformed; text is never scaled or reflowed per frame.
    const compact=this.island.querySelector?.<HTMLElement>('#compact-media');
    let compactBox:DOMRect|undefined;
    if(compact){this.island.dataset.expanded='false';compactBox=compact.getBoundingClientRect();}
    this.island.dataset.expanded='true';
    const target=this.island.getBoundingClientRect();
    const after:Geometry=expanded?{width:target.width,height:target.height,radius:Number.parseFloat(getComputedStyle(this.island).borderRadius)||28}:{width:Math.min(112,target.width),height:34,radius:17};
    let epoch=this.native?.epoch()??0;
    const duration=expanded?Number(getComputedStyle(this.island).getPropertyValue('--context-duration'))||280:190;
    const buildStart=performance.now();
    const tracks={
      width:springTrack(before.width,after.width,duration,this.velocity.width),
      height:springTrack(before.height,after.height,duration,this.velocity.height,'gentle'),
      radius:springTrack(before.radius,after.radius,duration,this.velocity.radius,'responsive'),duration,
    };
    const denseCount=Math.max(tracks.width.length,tracks.height.length,tracks.radius.length)-1;
    this.tracks=tracks;
    const dense=Array.from({length:denseCount+1},(_,i)=>this.point(duration*i/denseCount));
    const indices=geometryMesh(dense.map(point=>point.shape));
    const points=indices.map(index=>dense[index]!);
    const offsets=indices.map(index=>index/denseCount);
    const layout:Geometry={
      width:Math.min(388,Math.max(before.width,after.width,this.nativeMask?oldLayout.width:0,...points.map(p=>p.shape.width))),
      height:Math.min(320,Math.max(before.height,after.height,this.nativeMask?oldLayout.height:0,...points.map(p=>p.shape.height))),radius:after.radius,
    };
    this.island.style.width=`${layout.width}px`;this.island.style.height=`${layout.height}px`;
    this.panel.style?.setProperty('width',`${target.width}px`);this.panel.style?.setProperty('height',`${target.height}px`);this.panel.style?.setProperty('margin-inline','auto');
    this.island.dataset.nativeMask=String(this.nativeMask);
    const full=this.island.getBoundingClientRect();
    const shape=(value:Geometry):SurfaceGeometry=>({left:full.left+(full.width-value.width)/2,top:full.top,...value});
    const finish=async()=>{
      // One completion barrier, never one await per frame. Keep backing paint
      // covering the HRGN until the final native silhouette is confirmed.
      if(this.surface){
        try { await this.surface.flush(shape(after),epoch,zero()); }
        catch(error){
          if(own!==this.revision)return;
          if(!(error instanceof SurfaceSupersededError)||!this.native?.recover)throw error;
          // Settings/DPI may invalidate a final packet before their event reaches
          // JS. Reacquire once; this is a transaction boundary, never a frame wait.
          await this.native.recover(expanded);
          if(own!==this.revision)return;
          epoch=this.native.epoch();
          await this.surface.flush(shape(after),epoch,zero());
        }
      }
      if(own!==this.revision)return;
      this.island.dataset.expanded=String(expanded);this.restoreContent();this.clearLayout();
      this.velocity=zero();this.tracks=undefined;
    };
    const stationary=Math.abs(before.width-after.width)+Math.abs(before.height-after.height)+Math.abs(before.radius-after.radius)<.001&&Object.values(this.velocity).every(value=>Math.abs(value)<.01);
    const contentGroups=this.groups();
    const changedContent=previousGroups&&contentGroups.some(group=>!previousGroups.has(group));
    if(reduced||document.hidden||stationary&&!changedContent){await finish();return;}

    const geometry=this.island.animate(this.nativeMask?[{},{}]:points.map((p,i)=>({clipPath:mask(layout,p.shape),offset:offsets[i]})),{duration,easing:'linear',fill:'both'});
    this.clock=geometry;
    const ownAnimations=[geometry];
    const progress=(value:Geometry)=>Math.min(clamp((value.width-112)/Math.max(1,target.width-112),0,1),clamp((value.height-34)/Math.max(1,target.height-34),0,1));
    for(const group of contentGroups){
      this.base.set(group,{opacity:group.style.opacity,transform:group.style.transform,origin:group.style.transformOrigin});
      const previous=frozen.get(group);
      const secondary=group.id==='activity-footer'||group.classList?.contains('media-controls');
      const phase=(p:number)=>smoothStep((p-(secondary?.38:.12))/(secondary?.48:.58));
      const first=previous?.opacity??(wasExpanded?(previousGroups&&!previousGroups.has(group)?0:1):phase(progress(before)));
      const end=expanded?1:0;
      const firstPhase=phase(progress(before)),lastPhase=phase(progress(after));
      const frames=points.map((point,i)=>{
        const movement=lastPhase===firstPhase?smoothStep(offsets[i]!):clamp((phase(progress(point.shape))-firstPhase)/(lastPhase-firstPhase),0,1);
        const opacity=first+(end-first)*movement;
        return{opacity,transform:`translateY(${(1-opacity)*-3}px)`,offset:offsets[i]};
      });
      if(previous)frames[0]={opacity:previous.opacity,transform:previous.transform,offset:0};
      ownAnimations.push(group.animate(frames,{duration,easing:'linear',fill:'both'}));
    }
    const art=this.island.querySelector?.<HTMLElement>('.media-artwork');
    if(art&&compactBox&&compactBox.width>0&&art.getBoundingClientRect().width>0){
      const box=art.getBoundingClientRect();
      const from={x:compactBox.x-box.x,y:compactBox.y-box.y,scale:compactBox.width/box.width};
      this.base.set(art,{opacity:art.style.opacity,transform:art.style.transform,origin:art.style.transformOrigin});
      const previous=frozen.get(art);
      const transform=(p:number)=>`translate(${from.x*(1-p)}px,${from.y*(1-p)}px) scale(${from.scale+(1-from.scale)*p})`;
      const frames=points.map((point,i)=>({transform:transform(progress(point.shape)),transformOrigin:'0 0',offset:offsets[i]}));
      if(previous)frames[0]={transform:previous.transform,transformOrigin:'0 0',offset:0};
      ownAnimations.push(art.animate(frames,{duration,easing:'linear',fill:'both'}));
    }
    this.active=ownAnimations;
    const firstStats=this.surface?.metrics();
    const sync=()=>{
      if(!this.surface)return;
      const time=typeof geometry.currentTime==='number'?geometry.currentTime:0;
      const point=this.point(time);this.surface.submit(shape(point.shape),epoch,point.velocity);
    };
    sync();
    const stop=measureTransition(sync);this.stopMeasurement=stop;
    const buildMs=performance.now()-buildStart;
    await Promise.all(ownAnimations.map(a=>a.finished.catch(()=>undefined)));
    if(own!==this.revision)return;
    stop(false,{buildMs,native:this.surface&&firstStats?Object.fromEntries(Object.entries(this.surface.metrics()).map(([k,v])=>[k==='maxAckMs'?'maxAckMsHighWater':k,k==='maxAckMs'?v:v-(firstStats[k as keyof typeof firstStats]??0)])):undefined});this.stopMeasurement=undefined;
    await finish();
    if(own!==this.revision)return;
    this.active=[];this.clock=undefined;ownAnimations.forEach(a=>a.cancel());
  }
}
