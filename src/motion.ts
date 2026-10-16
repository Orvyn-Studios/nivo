import { measureTransition } from './metrics.ts';
/** Springs are sampled once per transition; no idle frame loop or layout reads per frame. */
function spring(from: number, to: number, duration: number): number[] {
  const frames = Math.ceil(duration / (1000 / 60));
  return Array.from({ length: frames + 1 }, (_, i) => {
    if (i === frames) return to;
    const t = i / frames;
    const eased = 1 - (1 + 8 * t) * Math.exp(-8 * t);
    return from + (to - from) * eased;
  });
}

export class IslandMotion {
  private active: Animation[] = [];
  private stopMeasurement: ((interrupted: boolean) => void) | undefined;
  private island: HTMLElement;
  private panel: HTMLElement;
  constructor(island: HTMLElement, panel: HTMLElement) {
    this.island = island;
    this.panel = panel;
  }
  cancel(): void {
    if (this.active.length) {
      const current = this.island.getBoundingClientRect();
      this.island.style.width = `${current.width}px`;
      this.island.style.height = `${current.height}px`;
      this.island.style.borderRadius = getComputedStyle(this.island).borderRadius;
    }
    this.active.forEach(animation => animation.cancel()); this.active = [];
    this.stopMeasurement?.(true); this.stopMeasurement = undefined;
  }
  settle(): void {
    this.cancel();
    this.island.style.removeProperty('width');
    this.island.style.removeProperty('height');
    this.island.style.removeProperty('border-radius');
  }
  async to(expanded: boolean, reduced: boolean): Promise<void> {
    // Capture the rendered geometry before cancelling to preserve interrupted position.
    const before = this.island.getBoundingClientRect();
    this.cancel();
    this.island.style.removeProperty('width');
    this.island.style.removeProperty('height');
    this.island.style.removeProperty('border-radius');
    this.island.dataset.expanded = String(expanded);
    const after = this.island.getBoundingClientRect();
    if (reduced || document.hidden) return;
    const stopMeasurement = measureTransition();
    this.stopMeasurement = stopMeasurement;
    const duration = expanded ? 340 : 260;
    const widths = spring(before.width, after.width, duration);
    const heights = spring(before.height, after.height, duration);
    const geometry = this.island.animate(widths.map((width, i) => ({
      width: `${width}px`, height: `${heights[i]}px`,
      borderRadius: `${17 + (28 - 17) * Math.min(1, Math.max(0, (heights[i] - 34) / 286))}px`,
    })), { duration, easing: 'linear' });
    const content = this.panel.animate(expanded ? [
      { opacity: 0, transform: 'translateY(-5px)', offset: 0 },
      { opacity: 0, transform: 'translateY(-5px)', offset: .15 },
      { opacity: 1, transform: 'translateY(0)', offset: 1 },
    ] : [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-4px)' }], {
      duration: expanded ? duration : 160, easing: 'cubic-bezier(.2,.7,.2,1)',
    });
    const own = [geometry, content];
    this.active = own;
    await Promise.all(own.map(animation => animation.finished.catch(() => undefined)));
    if (this.active === own) {
      this.active = [];
      stopMeasurement(false); this.stopMeasurement = undefined;
    }
  }
}
