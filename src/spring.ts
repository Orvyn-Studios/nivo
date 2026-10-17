// Spring integration adapted from Louis-CFM/coucou windows/src/core/anim.ts,
// commit 434d6a2b4af2e5ce117fa425170abe25620130b9. Copyright 2026 Louis Raillé.
// MIT license: public/licenses/coucou-MIT.txt. No character/artwork is reused.

export interface SpringPoint { value: number; velocity: number }

/** Bounded, sub-stepped integration; preserving velocity permits retargeting. */
export function stepSpring(point: SpringPoint, target: number, deltaSeconds: number): SpringPoint {
  if (![point.value, point.velocity, target, deltaSeconds].every(Number.isFinite) || deltaSeconds < 0) {
    throw new RangeError('Invalid spring input');
  }
  const duration = Math.min(.05, deltaSeconds);
  const steps = Math.max(1, Math.ceil(duration * 240));
  const h = duration / steps;
  const omega = 2 * Math.PI / .22;
  const damping = .9;
  let { value, velocity } = point;
  for (let index = 0; index < steps; index++) {
    const acceleration = omega * omega * (target - value) - 2 * damping * omega * velocity;
    velocity += acceleration * h;
    value += velocity * h;
  }
  return { value, velocity };
}

/** Precompute a finite WAAPI track, with no physics or layout work each frame. */
export function springTrack(from: number, to: number, durationMs: number, velocity = 0): SpringPoint[] {
  if (!Number.isFinite(durationMs) || durationMs < 1 || durationMs > 450) throw new RangeError('Invalid spring duration');
  const count = Math.ceil(durationMs / (1000 / 60));
  const result = [{ value: from, velocity }];
  for (let index = 1; index <= count; index++) result.push(stepSpring(result[index - 1]!, to, durationMs / count / 1000));
  result[count] = { value: to, velocity: 0 };
  return result;
}

export function trackVelocity(track: readonly SpringPoint[], elapsed: number, duration: number): number {
  if (!Number.isFinite(elapsed) || elapsed <= 0) return track[0]?.velocity ?? 0;
  const position = Math.min(1, elapsed / duration) * (track.length - 1);
  const index = Math.floor(position);
  const a = track[index]?.velocity ?? 0;
  return a + ((track[index + 1]?.velocity ?? a) - a) * (position - index);
}
