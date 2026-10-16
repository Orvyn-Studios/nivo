export interface TransitionSample {
  startedAt: number;
  durationMs: number;
  frameCount: number;
  p95FrameMs: number | null;
  maxFrameMs: number | null;
  interrupted: boolean;
}
const samples: TransitionSample[] = [];

/** Sampling exists only while a visible transition is in progress. No idle loop. */
export function measureTransition(): (interrupted: boolean) => void {
  const start = performance.now();
  let previous = start;
  let frame = 0;
  const intervals: number[] = [];
  const tick = (now: number) => {
    if (!document.hidden) intervals.push(now - previous);
    previous = now;
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return interrupted => {
    cancelAnimationFrame(frame);
    const sorted = [...intervals].sort((a, b) => a - b);
    samples.push({
      startedAt: start, durationMs: performance.now() - start,
      frameCount: intervals.length,
      p95FrameMs: sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)] : null,
      maxFrameMs: sorted.length ? sorted[sorted.length - 1] : null,
      interrupted,
    });
    if (samples.length > 32) samples.shift();
  };
}

export function transitionMetrics(): readonly TransitionSample[] {
  return samples.map(sample => ({ ...sample }));
}
