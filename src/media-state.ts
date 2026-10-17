import { parseMediaSession, type MediaSession } from './domain/media.ts';

export type MediaAction = 'playPause' | 'previous' | 'next';
export interface MediaSnapshot {
  sequence: number;
  status: 'connecting' | 'ready' | 'unavailable' | 'disabled';
  sessions: MediaSession[];
  activeSessionId: string | null;
  error: string | null;
}

const validId = (id: unknown): id is string => typeof id === 'string' &&
  id.length > 0 && id.length <= 256 && Boolean(id.trim()) && !/[\u0000-\u001f\u007f-\u009f]/.test(id);

/** Accept only the bounded native contract. Invalid events cannot erase a valid snapshot. */
export function parseMediaSnapshot(payload: unknown): MediaSnapshot | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.sequence !== 'number' || !Number.isSafeInteger(value.sequence) || value.sequence < 0 ||
      (value.status !== 'connecting' && value.status !== 'ready' && value.status !== 'unavailable' && value.status !== 'disabled') ||
      !Array.isArray(value.sessions) || value.sessions.length > 8 ||
      (value.activeSessionId !== null && !validId(value.activeSessionId))) return null;
  const status = value.status as MediaSnapshot['status'];
  const error = typeof value.error === 'string'
    ? value.error.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, 280) || null
    : null;
  // A provider disabled by the user must not retain titles or artwork in presentation memory.
  if (status !== 'ready') return { sequence: value.sequence, status, sessions: [], activeSessionId: null, error };
  const sessions: MediaSession[] = [];
  const ids = new Set<string>();
  for (const entry of value.sessions) {
    const session = parseMediaSession(entry);
    if (!session || !validId(session.id) || ids.has(session.id)) continue;
    ids.add(session.id);
    sessions.push(session);
  }
  return {
    sequence: value.sequence, status, sessions,
    activeSessionId: typeof value.activeSessionId === 'string' && ids.has(value.activeSessionId) ? value.activeSessionId : null,
    error,
  };
}

/** No guessed active player: selection always comes from the native provider. */
export function activeMedia(snapshot: MediaSnapshot): MediaSession | null {
  return snapshot.status === 'ready'
    ? snapshot.sessions.find(session => session.id === snapshot.activeSessionId) ?? null
    : null;
}

function emptySnapshot(sequence: number, status: 'unavailable' | 'disabled'): MediaSnapshot {
  return { sequence, status, sessions: [], activeSessionId: null, error: null };
}

/** User consent gates storage as well as rendering; disabled events retain only ordering. */
export class MediaInbox {
  #enabled: boolean;
  #lastSequence = -1;
  #snapshot: MediaSnapshot;

  constructor(enabled = true) {
    this.#enabled = enabled;
    this.#snapshot = emptySnapshot(0, enabled ? 'unavailable' : 'disabled');
  }

  get enabled(): boolean { return this.#enabled; }
  get snapshot(): MediaSnapshot { return this.#snapshot; }

  setEnabled(enabled: boolean): MediaSnapshot {
    if (enabled === this.#enabled) return this.#snapshot;
    this.#enabled = enabled;
    // Re-enabling cannot resurrect metadata received before or during the opt-out.
    this.#snapshot = emptySnapshot(Math.max(0, this.#lastSequence), enabled ? 'unavailable' : 'disabled');
    return this.#snapshot;
  }

  /** Equal sequence is accepted only for an explicitly requested authoritative resync. */
  receive(snapshot: MediaSnapshot, reconcile = false): boolean {
    const sequence = snapshot.sequence;
    if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence < this.#lastSequence ||
        (!reconcile && sequence === this.#lastSequence)) return false;
    this.#lastSequence = sequence;
    this.#snapshot = this.#enabled ? snapshot : emptySnapshot(sequence, 'disabled');
    return true;
  }
}
