export type TimerState =
  | { phase: 'idle' }
  | { phase: 'running'; durationMs: number; deadlineMs: number; observedAtMs: number }
  | { phase: 'paused'; durationMs: number; remainingMs: number; observedAtMs: number }
  | { phase: 'finished'; durationMs: number; finishedAtMs: number; observedAtMs: number };

export const MIN_TIMER_MS = 1_000;
export const MAX_TIMER_MS = 86_400_000;

export interface TimerSnapshot {
  schema_version: 1;
  phase: 'running' | 'paused';
  duration_ms: number;
  observed_at_ms: number;
  deadline_ms: number | null;
  remaining_ms: number | null;
}

function clock(now: number): number {
  if (!Number.isSafeInteger(now) || now < 0) throw new RangeError('Invalid timer clock.');
  return now;
}

function observed(timer: TimerState, now: number): number {
  return timer.phase === 'idle' ? clock(now) : Math.max(timer.observedAtMs, clock(now));
}

/**
 * The caller injects epoch milliseconds (Date.now in the desktop adapter). A fixed
 * deadline includes suspension and avoids accumulating interval/tick drift. A
 * backward wall-clock adjustment cannot increase the last observed countdown;
 * forward adjustments can finish it early. This is not a monotonic-clock claim.
 * The native adapter should reconcile its deadline on resume and emit one event.
 * This module owns no timers, animation frames, persistence or system operations.
 */
export function startTimer(durationMs: number, now: number): TimerState {
  const timestamp = clock(now);
  if (!Number.isSafeInteger(durationMs) || durationMs < MIN_TIMER_MS || durationMs > MAX_TIMER_MS) {
    throw new RangeError('Timer duration must be between one second and 24 hours.');
  }
  const deadlineMs = timestamp + durationMs;
  if (!Number.isSafeInteger(deadlineMs)) throw new RangeError('Invalid timer deadline.');
  return { phase: 'running', durationMs, deadlineMs, observedAtMs: timestamp };
}

export function remainingMs(timer: TimerState, now: number): number {
  if (timer.phase === 'idle' || timer.phase === 'finished') return 0;
  if (timer.phase === 'paused') return timer.remainingMs;
  return Math.max(0, timer.deadlineMs - observed(timer, now));
}

export function advanceTimer(timer: TimerState, now: number): TimerState {
  const timestamp = observed(timer, now);
  if (timer.phase !== 'running' || timestamp === timer.observedAtMs) return timer;
  return timestamp >= timer.deadlineMs
    ? { phase: 'finished', durationMs: timer.durationMs, finishedAtMs: timer.deadlineMs, observedAtMs: timestamp }
    : { ...timer, observedAtMs: timestamp };
}

export function pauseTimer(timer: TimerState, now: number): TimerState {
  const advanced = advanceTimer(timer, now);
  if (advanced.phase !== 'running') return advanced;
  return { phase: 'paused', durationMs: advanced.durationMs, remainingMs: remainingMs(advanced, now), observedAtMs: advanced.observedAtMs };
}

export function resumeTimer(timer: TimerState, now: number): TimerState {
  const timestamp = observed(timer, now);
  if (timer.phase !== 'paused') return timer;
  const deadlineMs = timestamp + timer.remainingMs;
  if (!Number.isSafeInteger(deadlineMs)) throw new RangeError('Invalid timer deadline.');
  return { phase: 'running', durationMs: timer.durationMs, deadlineMs, observedAtMs: timestamp };
}

export function cancelTimer(): TimerState {
  return { phase: 'idle' };
}

/** Only an active countdown is persisted; completed/idle content leaves no history. */
export function exportTimer(timer: TimerState): TimerSnapshot | null {
  if (timer.phase === 'idle' || timer.phase === 'finished') return null;
  return {
    schema_version: 1, phase: timer.phase, duration_ms: timer.durationMs,
    observed_at_ms: timer.observedAtMs,
    deadline_ms: timer.phase === 'running' ? timer.deadlineMs : null,
    remaining_ms: timer.phase === 'paused' ? timer.remainingMs : null,
  };
}

/**
 * Invalid snapshots return idle. Expired running snapshots restore as finished,
 * without generating an alert for a deadline that elapsed while Nivo was closed.
 * JSON/storage errors stay at the adapter boundary; no storage API is used here.
 */
export function restoreTimer(value: unknown, now: number): TimerState {
  clock(now);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return cancelTimer();
  const input = value as Record<string, unknown>;
  const duration = input.duration_ms;
  const previous = input.observed_at_ms;
  if (input.schema_version !== 1 || typeof duration !== 'number' || !Number.isSafeInteger(duration) || duration < MIN_TIMER_MS || duration > MAX_TIMER_MS || typeof previous !== 'number' || !Number.isSafeInteger(previous) || previous < 0) return cancelTimer();
  if (input.phase === 'running') {
    const deadline = input.deadline_ms;
    if (typeof deadline !== 'number' || !Number.isSafeInteger(deadline) || deadline <= previous || deadline - previous > duration || input.remaining_ms !== null) return cancelTimer();
    return advanceTimer({ phase: 'running', durationMs: duration, deadlineMs: deadline, observedAtMs: previous }, now);
  }
  if (input.phase === 'paused') {
    const remaining = input.remaining_ms;
    if (typeof remaining !== 'number' || !Number.isSafeInteger(remaining) || remaining <= 0 || remaining > duration || input.deadline_ms !== null) return cancelTimer();
    return { phase: 'paused', durationMs: duration, remainingMs: remaining, observedAtMs: Math.max(previous, now) };
  }
  return cancelTimer();
}
