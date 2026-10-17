export interface SurfaceGeometry { left: number; top: number; width: number; height: number; radius: number }

/** Single in-flight IPC, latest geometry wins; never builds a per-frame backlog. */
export function createSurfaceWriter(send: (shape: SurfaceGeometry, epoch: number) => Promise<unknown>, onError: (error: unknown) => void) {
  let pending: { shape: SurfaceGeometry; epoch: number } | undefined;
  let busy = false;
  let revision = 0;
  async function drain(): Promise<void> {
    if (busy) return;
    busy = true;
    while (pending) {
      const next = pending, own = revision;
      pending = undefined;
      try { await send(next.shape, next.epoch); }
      catch (error) { if (own === revision) { pending = undefined; onError(error); } }
    }
    busy = false;
  }
  return {
    submit(shape: SurfaceGeometry, epoch: number) { pending = { shape, epoch }; void drain(); },
    cancel() { revision++; pending = undefined; },
  };
}
