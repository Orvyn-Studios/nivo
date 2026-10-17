export interface SurfaceGeometry { left: number; top: number; width: number; height: number; radius: number }
export interface SurfaceVelocity { width: number; height: number; radius: number }
export interface SurfaceSample { shape: SurfaceGeometry; velocity: SurfaceVelocity }
export interface SurfaceSnapshot { epoch: number; sample: SurfaceSample | null }
const zero: SurfaceVelocity = {width:0,height:0,radius:0};
export class SurfaceSupersededError extends Error { readonly superseded=true; }

/** Single in-flight IPC, latest geometry wins; never builds a per-frame backlog. */
export function createSurfaceWriter(send: (shape: SurfaceGeometry, epoch: number, velocity?: SurfaceVelocity) => Promise<unknown>, onError: (error: unknown) => void) {
  let pending: { shape: SurfaceGeometry; epoch: number; velocity: SurfaceVelocity; resolve?:()=>void; reject?:(error:unknown)=>void } | undefined;
  let busy = false;
  let revision = 0;
  let lastKey='';
  const waiters=new Set<(error:unknown)=>void>();
  const stats={submitted:0,sent:0,coalesced:0,duplicates:0,stale:0,totalAckMs:0,maxAckMs:0,ackLt1:0,ackLt2:0,ackLt4:0,ackLt8:0,ackLt16:0,ackLt32:0,ackGe32:0};
  function key(shape:SurfaceGeometry,epoch:number): string {
    const scale=typeof devicePixelRatio==='number'?devicePixelRatio:1;
    return [epoch,shape.left,shape.top,shape.left+shape.width,shape.top+shape.height,shape.radius*2].map((value,i)=>i?Math.round(value*scale):value).join(':');
  }
  function failPending(error:unknown):void { const value=pending;pending=undefined;value?.reject?.(error); }
  async function drain(): Promise<void> {
    if (busy) return;
    busy = true;
    while (pending) {
      const next = pending, own = revision;
      pending = undefined;
      const start=performance.now();stats.sent++;
      try {
        const accepted=await send(next.shape,next.epoch,next.velocity);
        const elapsed=performance.now()-start;stats.totalAckMs+=elapsed;stats.maxAckMs=Math.max(stats.maxAckMs,elapsed);
        if(elapsed<1)stats.ackLt1++;else if(elapsed<2)stats.ackLt2++;else if(elapsed<4)stats.ackLt4++;else if(elapsed<8)stats.ackLt8++;else if(elapsed<16)stats.ackLt16++;else if(elapsed<32)stats.ackLt32++;else stats.ackGe32++;
        if(accepted===false){stats.stale++;next.reject?.(new SurfaceSupersededError('Obsolete surface epoch'));}
        else next.resolve?.();
      } catch (error) {
        next.reject?.(error);
        if(own===revision&&!next.reject){failPending(error);onError(error);}
      }
    }
    busy = false;
  }
  return {
    submit(shape: SurfaceGeometry, epoch: number, velocity:SurfaceVelocity=zero) {
      stats.submitted++;
      const signature=key(shape,epoch);
      if(signature===lastKey){stats.duplicates++;return;}
      lastKey=signature;
      if(pending)stats.coalesced++;
      pending={shape,epoch,velocity};void drain();
    },
    flush(shape:SurfaceGeometry,epoch:number,velocity:SurfaceVelocity=zero):Promise<void> {
      return new Promise((resolve,reject)=>{
        const fail=(error:unknown)=>{waiters.delete(fail);reject(error)};
        waiters.add(fail);
        pending?.reject?.(new Error('Surface superseded'));
        pending={shape,epoch,velocity,resolve:()=>{waiters.delete(fail);resolve()},reject:fail};
        lastKey=key(shape,epoch);void drain();
      });
    },
    metrics:()=>({...stats}),
    cancel() {
      revision++;pending=undefined;lastKey='';
      for(const reject of waiters)reject(new Error('Surface cancelled'));
      waiters.clear();
    },
  };
}
