/** Semantic surface sizes in DIP. The native envelope is bounded to 388 × 320. */
export type Context = 'summary' | 'music' | 'audio' | 'drop' | 'downloads' | 'agent' | 'volume' | 'microphone' | 'device' | 'keyboard' | 'battery' | 'notice';
export interface Geometry { width: number; height: number; radius: number; duration: number }
export const COMPACT: Geometry = { width: 112, height: 34, radius: 17, duration: 190 };
const sizes: Record<Context, [number, number, number]> = {
  summary: [260, 138, 250], music: [360, 202, 310], audio: [360, 300, 310],
  drop: [352, 152, 280], downloads: [340, 150, 280], agent: [316, 138, 270],
  volume: [300, 96, 230], microphone: [300, 88, 230], device: [316, 88, 240],
  keyboard: [252, 68, 210], battery: [288, 88, 240], notice: [316, 110, 260],
};
export function contextGeometry(context: Context, count = 0, hasTimeline = true): Geometry {
  const [width, initial, duration] = sizes[context];
  const height = context === 'drop' && count ? Math.min(300, 116 + Math.min(16, count) * 88)
    : context === 'downloads' ? Math.min(280, 90 + Math.max(1, Math.min(32, count)) * 64)
    : context === 'music' ? (hasTimeline ? 202 : 174) + (count > 1 ? 32 : 0) : initial;
  return { width, height, radius: Math.min(28, height / 2), duration };
}
