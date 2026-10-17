import { measureTransition } from './metrics.ts';
import { springTrack, trackVelocity, type SpringPoint } from './spring.ts';
import { createSurfaceWriter, type SurfaceGeometry } from './native-surface.ts';

interface Geometry { width: number; height: number; radius: number }

function mask(layout: Geometry, visual: Geometry): string {
  const side = Math.max(0, (layout.width - visual.width) / 2);
  return `inset(0px ${side}px ${Math.max(0, layout.height - visual.height)}px ${side}px round ${visual.radius}px)`;
}

export class IslandMotion {
  private active: Animation[] = [];
  private stopMeasurement: ((interrupted: boolean) => void) | undefined;
  private frozen: Geometry | undefined;
  private velocity = { width: 0, height: 0, radius: 0 };
  private tracks: { width: SpringPoint[]; height: SpringPoint[]; radius: SpringPoint[]; duration: number } | undefined;
  private targetExpanded = false;
  private island: HTMLElement;
  private panel: HTMLElement;
  private identity: HTMLElement | undefined;
  private surface: ReturnType<typeof createSurfaceWriter> | undefined;
  private epoch: () => number;
  constructor(island: HTMLElement, panel: HTMLElement, identity?: HTMLElement,
    native?: { send(shape: SurfaceGeometry, epoch: number): Promise<unknown>; epoch(): number; onError(error: unknown): void }) {
    this.island = island; this.panel = panel; this.identity = identity;
    this.epoch = native?.epoch ?? (() => 0);
    if (native) this.surface = createSurfaceWriter(native.send, native.onError);
  }

  cancel(): void {
    this.surface?.cancel();
    if (this.active.length) {
      const time = this.active[0]?.currentTime;
      if (this.tracks && typeof time === 'number') {
        this.velocity = {
          width: trackVelocity(this.tracks.width, time, this.tracks.duration),
          height: trackVelocity(this.tracks.height, time, this.tracks.duration),
          radius: trackVelocity(this.tracks.radius, time, this.tracks.duration),
        };
      }
      // Read only on interruption, never per animation frame.
      const bounds = this.island.getBoundingClientRect();
      const computed = getComputedStyle(this.island);
      const clip = computed.clipPath;
      // CSSOM can shorten four equal/symmetric insets to one, two or three.
      const inset = clip?.match(/^inset\((.+?) round ([\d.e+-]+)px\)$/);
      const values = inset?.[1]?.split(/\s+/).map(value => /^-?[\d.e+-]+px$/.test(value) ? Number.parseFloat(value) : NaN);
      const valid = values && values.length >= 1 && values.length <= 4 && values.every(Number.isFinite);
      const top = values?.[0] ?? 0;
      const right = values?.[1] ?? top;
      const bottom = values?.[2] ?? top;
      const left = values?.[3] ?? right;
      this.frozen = valid && inset ? {
        width: Math.max(1, Math.min(bounds.width, bounds.width - left - right)),
        height: Math.max(1, Math.min(bounds.height, bounds.height - top - bottom)), radius: Number(inset[2]),
      } : { width: bounds.width, height: bounds.height, radius: Number.parseFloat(computed.borderRadius) || 17 };
      this.island.style.clipPath = clip;
      if (this.identity) this.identity.style.transform = getComputedStyle(this.identity).transform;
    }
    this.active.forEach(animation => animation.cancel()); this.active = [];
    this.tracks = undefined;
    this.stopMeasurement?.(true); this.stopMeasurement = undefined;
  }

  settle(): void {
    this.cancel();
    this.island.dataset.expanded = String(this.targetExpanded);
    this.clearFrozen();
    this.velocity = { width: 0, height: 0, radius: 0 };
    this.syncSettled();
  }

  private syncSettled(): void {
    if (!this.surface || document.hidden) return;
    const box = this.island.getBoundingClientRect();
    this.surface.submit({ left: box.left, top: box.top, width: box.width, height: box.height,
      radius: this.targetExpanded ? 28 : 17 }, this.epoch());
  }

  private clearFrozen(): void {
    this.frozen = undefined;
    this.island.style.removeProperty('clip-path');
    this.identity?.style.removeProperty('transform');
  }

  async to(expanded: boolean, reduced: boolean): Promise<void> {
    this.cancel();
    const bounds = this.island.getBoundingClientRect();
    const before = this.frozen ?? { width: bounds.width, height: bounds.height, radius: this.island.dataset.expanded === 'true' ? 28 : 17 };
    this.targetExpanded = expanded;
    this.clearFrozen();
    if (reduced || document.hidden) {
      this.island.dataset.expanded = String(expanded);
      this.velocity = { width: 0, height: 0, radius: 0 };
      this.syncSettled();
      return;
    }

    // Layout once at full size. Only the mask, transform and opacity animate:
    // text never scales or reflows on every frame.
    this.island.dataset.expanded = 'true';
    const full = this.island.getBoundingClientRect();
    const layout = { width: full.width, height: full.height, radius: 28 };
    const after = expanded ? layout : { width: Math.min(112, full.width), height: 34, radius: 17 };
    const duration = expanded ? 280 : 200;
    const tracks = {
      width: springTrack(before.width, after.width, duration, this.velocity.width),
      height: springTrack(before.height, after.height, duration, this.velocity.height),
      radius: springTrack(before.radius, after.radius, duration, this.velocity.radius), duration,
    };
    this.tracks = tracks;
    const widths = tracks.width.map(point => Math.max(1, Math.min(layout.width, point.value)));
    const heights = tracks.height.map(point => Math.max(1, Math.min(layout.height, point.value)));
    const radii = tracks.radius.map(point => Math.max(1, point.value));
    const geometry = this.island.animate(widths.map((width, index) => ({
      clipPath: mask(layout, { width, height: heights[index]!, radius: radii[index]! }),
    })), { duration, easing: 'linear', fill: 'both' });
    const epoch = this.epoch();
    const syncGeometry = () => {
      if (!this.surface) return;
      const time = typeof geometry.currentTime === 'number' ? geometry.currentTime : 0;
      const position = Math.min(widths.length - 1, Math.max(0, time / duration * (widths.length - 1)));
      const index = Math.floor(position), next = Math.min(index + 1, widths.length - 1), mix = position - index;
      const sample = (values: number[]) => values[index]! + (values[next]! - values[index]!) * mix;
      const width = sample(widths), height = sample(heights);
      this.surface.submit({ left: full.left + (full.width - width) / 2, top: full.top, width, height,
        radius: Math.min(sample(radii), width / 2, height / 2) }, epoch);
    };
    syncGeometry();
    // Reuse the finite measurement frame; no extra loop or per-frame DOM reads.
    const stopMeasurement = measureTransition(syncGeometry);
    this.stopMeasurement = stopMeasurement;
    const content = this.panel.animate(expanded ? [
      { opacity: 0, transform: 'translateY(-4px)', offset: 0 },
      { opacity: 0, transform: 'translateY(-4px)', offset: .18 },
      { opacity: 1, transform: 'translateY(0)', offset: 1 },
    ] : [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-3px)' }], {
      duration: expanded ? duration : 120, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both',
    });
    const own = [geometry, content];
    if (this.identity) own.push(this.identity.animate(widths.map(width => {
      const compact = Math.min(112, layout.width);
      const progress = layout.width === compact ? 1 : Math.min(1, Math.max(0, (width - compact) / (layout.width - compact)));
      return { transform: `translate(${(layout.width - width) / 2 - 8 * (1 - progress)}px, ${-7 * (1 - progress)}px)` };
    }), { duration, easing: 'linear', fill: 'both' }));
    this.active = own;
    await Promise.all(own.map(animation => animation.finished.catch(() => undefined)));
    if (this.active === own) {
      this.island.dataset.expanded = String(expanded);
      this.active = [];
      own.forEach(animation => animation.cancel());
      this.clearFrozen();
      this.tracks = undefined;
      this.velocity = { width: 0, height: 0, radius: 0 };
      this.syncSettled();
      stopMeasurement(false); this.stopMeasurement = undefined;
    }
  }
}
