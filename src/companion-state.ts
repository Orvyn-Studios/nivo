export type CompanionPose = 'quiet' | 'music' | 'focus' | 'complete';

/** Every pose derives from a real Nivo state, with timer completion first. */
export function companionPose(timer: string, playback: string | undefined): CompanionPose {
  if (timer === 'finished') return 'complete';
  if (timer === 'running') return 'focus';
  return playback === 'playing' ? 'music' : 'quiet';
}

/** Local pointer coordinates only; no global cursor tracking. */
export function companionGaze(x: number, y: number, width: number, height: number): { x: number; y: number } {
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return { x: 0, y: 0 };
  return {
    x: Math.tanh((x - width / 2) / Math.max(1, width)) * 1.6,
    y: Math.tanh((y - height / 2) / Math.max(1, height)) * 1.1,
  };
}
