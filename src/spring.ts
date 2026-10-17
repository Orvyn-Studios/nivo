// Spring integration adapted from Louis-CFM/coucou windows/src/core/anim.ts,
// commit 434d6a2b4af2e5ce117fa425170abe25620130b9. Copyright 2026 Louis Raillé.
// MIT license: public/licenses/coucou-MIT.txt. No character/artwork is reused.

// Closed-form refinement: finite tracks with a continuous settling tail.
import { motionProfiles, type MotionProfile } from './motion-profiles.ts';
export interface SpringPoint { value: number; velocity: number }

function critical(point: SpringPoint, target: number, seconds: number, omega: number): SpringPoint {
  const a = point.value - target, b = point.velocity + omega * a;
  const decay = Math.exp(-omega * seconds);
  return { value: target + (a + b * seconds) * decay,
    velocity: (b - omega * (a + b * seconds)) * decay };
}

/** Bounded, sub-stepped integration; preserving velocity permits retargeting. */
export function stepSpring(point: SpringPoint, target: number, deltaSeconds: number): SpringPoint {
  if (![point.value, point.velocity, target, deltaSeconds].every(Number.isFinite) || deltaSeconds < 0) {
    throw new RangeError('Invalid spring input');
  }
  return critical(point, target, Math.min(.05, deltaSeconds), motionProfiles.smooth.omega);
}

/** Elapsed-time solution. A quintic taper settles the last quarter with continuous
 * position/velocity, instead of replacing the last simulated frame with a jump. */
export function springAt(from: number, to: number, durationMs: number, elapsedMs: number, velocity = 0, profile: MotionProfile = 'smooth'): SpringPoint {
  if (![from,to,durationMs,elapsedMs,velocity].every(Number.isFinite) || durationMs < 1 || durationMs > 450) throw new RangeError('Invalid spring input');
  const t=Math.max(0,Math.min(durationMs,elapsedMs));
  const point=critical({value:from,velocity},to,t/1000,motionProfiles[profile].omega);
  const u=Math.max(0,(t/durationMs-.75)/.25);
  const fade=1-10*u**3+15*u**4-6*u**5;
  const rate=(-30*u**2+60*u**3-30*u**4)*4000/durationMs;
  return {value:to+(point.value-to)*fade,velocity:point.velocity*fade+(point.value-to)*rate};
}

/** Density follows curvature/error, not a presumed monitor FPS. No runtime solver. */
export function springTrack(from: number, to: number, durationMs: number, velocity = 0, profile: MotionProfile = 'smooth'): SpringPoint[] {
  springAt(from,to,durationMs,0,velocity,profile);
  const omega=motionProfiles[profile].omega;
  const acceleration=2*omega*omega*Math.abs(to-from)+4*omega*Math.abs(velocity);
  const interval=Math.sqrt(8*.025/Math.max(1,acceleration));
  const count=Math.min(512,Math.max(8,Math.ceil(durationMs/1000/interval)));
  return Array.from({length:count+1},(_,i)=>springAt(from,to,durationMs,durationMs*i/count,velocity,profile));
}

export function sampleTrack(track: readonly SpringPoint[], elapsed: number, duration: number): SpringPoint {
  if (!track.length) return {value:0,velocity:0};
  const position=Math.max(0,Math.min(1,Number.isFinite(elapsed)?elapsed/duration:0))*(track.length-1);
  const index=Math.floor(position), mix=position-index, a=track[index]!, b=track[Math.min(index+1,track.length-1)]!;
  return {value:a.value+(b.value-a.value)*mix,velocity:a.velocity+(b.velocity-a.velocity)*mix};
}
export function trackVelocity(track: readonly SpringPoint[], elapsed: number, duration: number): number {
  return sampleTrack(track,elapsed,duration).velocity;
}
