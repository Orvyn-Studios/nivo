export type CompanionPose = 'quiet' | 'hover' | 'focus' | 'music' | 'working' | 'complete' | 'unavailable';

export interface CompanionContext {
  reaction?: 'attention' | 'working' | 'complete' | 'error' | 'device' | 'download';
  expanded?: boolean;
  hovered?: boolean;
  unavailable?: boolean;
}

/** Reactions follow real coordinator/provider events; no timer-specific poses. */
export function companionPose(playback: string | undefined, context: CompanionContext = {}): CompanionPose {
  if (context.reaction === 'complete' || context.reaction === 'download') return 'complete';
  if (context.reaction === 'error') return 'unavailable';
  if (context.reaction === 'working') return 'working';
  if (context.reaction === 'device' || context.reaction === 'attention') return 'hover';
  if (context.unavailable) return 'unavailable';
  if (playback === 'playing') return 'music';
  if (context.expanded) return 'focus';
  return context.hovered ? 'hover' : 'quiet';
}

/** Bounded eye travel; desktop reach spreads the response over a useful distance. */
export function companionGaze(x: number, y: number, width: number, height: number, reach = 1): { x: number; y: number } {
  if (![x, y, width, height, reach].every(Number.isFinite) || width <= 0 || height <= 0 || reach <= 0) return { x: 0, y: 0 };
  return {
    x: Math.tanh((x - width / 2) / Math.max(1, width * reach)) * 1.6,
    y: Math.tanh((y - height / 2) / Math.max(1, height * reach)) * 1.1,
  };
}
