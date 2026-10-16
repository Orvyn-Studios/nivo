import { parseMediaSession } from './media.ts';
import type { MediaSession } from './media.ts';
import { parsePreferences } from './preferences.ts';
import type { Preferences } from './preferences.ts';
import { advanceTimer, cancelTimer, pauseTimer, remainingMs, resumeTimer, startTimer } from './timer.ts';
import type { TimerState } from './timer.ts';

export type View = 'activity' | 'preferences';
export type BaseState = { kind: 'compact' } | { kind: 'expanded'; view: View };
export interface IslandNotification {
  id: string;
  source: string;
  title: string;
  body?: string;
  sensitive?: boolean;
  durationMs?: number;
  priority?: 'normal' | 'timer';
}
interface PendingNotification { notification: IslandNotification; remainingMs: number }
interface ActiveNotification { notification: IslandNotification; expiresAtMs: number }
export interface IslandState {
  base: BaseState;
  hovered: boolean;
  hidden: boolean;
  preferences: Preferences;
  media: MediaSession | null;
  mediaSequence: number;
  timer: TimerState;
  timerGeneration: number;
  notification: ActiveNotification | null;
  pendingNotifications: readonly PendingNotification[];
  seenNotificationIds: readonly string[];
}
export type IslandEvent =
  | { type: 'expand'; view?: View }
  | { type: 'collapse' }
  | { type: 'hover'; active: boolean }
  | { type: 'visibility'; hidden: boolean }
  | { type: 'preferences'; value: unknown }
  | { type: 'media'; sequence: number; session: unknown }
  | { type: 'notify'; notification: IslandNotification; now: number }
  | { type: 'dismiss-notification'; id?: string; now: number }
  | { type: 'advance'; now: number }
  | { type: 'timer-start'; durationMs: number; now: number }
  | { type: 'timer-pause' | 'timer-resume' | 'timer-cancel'; now: number };

export const MAX_QUEUED_NOTIFICATIONS = 3;
const MAX_SEEN_NOTIFICATION_IDS = 32;

export function createIslandState(preferences?: unknown): IslandState {
  return {
    base: { kind: 'compact' }, hovered: false, hidden: false,
    preferences: parsePreferences(preferences), media: null, mediaSequence: -1,
    timer: cancelTimer(), timerGeneration: 0, notification: null, pendingNotifications: [], seenNotificationIds: [],
  };
}

function notification(value: IslandNotification): IslandNotification | null {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id.trim() || value.id.length > 120 || typeof value.title !== 'string' || !value.title.trim() || typeof value.source !== 'string') return null;
  return {
    id: value.id, source: value.source.slice(0, 60), title: value.title.slice(0, 120),
    body: typeof value.body === 'string' ? value.body.slice(0, 240) : '',
    sensitive: value.sensitive === true,
    durationMs: typeof value.durationMs === 'number' && Number.isFinite(value.durationMs) ? Math.min(15_000, Math.max(2_000, value.durationMs)) : 5_000,
    priority: value.priority === 'timer' ? 'timer' : 'normal',
  };
}

function nextNotification(state: IslandState, now: number): IslandState {
  const [next, ...pendingNotifications] = state.pendingNotifications;
  return { ...state, pendingNotifications, notification: next ? { notification: next.notification, expiresAtMs: now + next.remainingMs } : null };
}

function enqueue(state: IslandState, value: IslandNotification, now: number): IslandState {
  const normalized = notification(value);
  if (!normalized || !state.preferences.notifications_enabled || !Number.isFinite(now) || now < 0 || state.seenNotificationIds.includes(normalized.id) || state.notification?.notification.id === normalized.id || state.pendingNotifications.some(item => item.notification.id === normalized.id)) return state;
  let next = state.notification && now >= state.notification.expiresAtMs ? nextNotification(state, now) : state;
  next = { ...next, seenNotificationIds: [...next.seenNotificationIds, normalized.id].slice(-MAX_SEEN_NOTIFICATION_IDS) };
  if (!next.notification) return { ...next, notification: { notification: normalized, expiresAtMs: now + normalized.durationMs! } };
  if (normalized.priority === 'timer' && next.notification.notification.priority !== 'timer') {
    const previous = { notification: next.notification.notification, remainingMs: Math.max(1, next.notification.expiresAtMs - now) };
    return { ...next, notification: { notification: normalized, expiresAtMs: now + normalized.durationMs! }, pendingNotifications: [previous, ...next.pendingNotifications].slice(0, MAX_QUEUED_NOTIFICATIONS) };
  }
  const pending = { notification: normalized, remainingMs: normalized.durationMs! };
  if (normalized.priority === 'timer') {
    // Equal-priority alerts remain FIFO; when full, release the newest normal
    // notification rather than losing a timer completion behind ordinary content.
    const firstNormal = next.pendingNotifications.findIndex(item => item.notification.priority !== 'timer');
    const index = firstNormal < 0 ? next.pendingNotifications.length : firstNormal;
    return { ...next, pendingNotifications: [...next.pendingNotifications.slice(0, index), pending, ...next.pendingNotifications.slice(index)].slice(0, MAX_QUEUED_NOTIFICATIONS) };
  }
  if (next.pendingNotifications.length >= MAX_QUEUED_NOTIFICATIONS) return next;
  return { ...next, pendingNotifications: [...next.pendingNotifications, pending] };
}

function setTimer(state: IslandState, timer: TimerState, now: number): IslandState {
  const next = timer === state.timer ? state : { ...state, timer };
  return state.timer.phase === 'running' && timer.phase === 'finished'
    ? enqueue(next, { id: `timer:${state.timerGeneration}`, source: 'Nivo', title: 'Temporizador terminado', priority: 'timer' }, now)
    : next;
}

export function reduceIsland(state: IslandState, event: IslandEvent): IslandState {
  switch (event.type) {
    case 'expand':
      return { ...state, base: { kind: 'expanded', view: event.view === 'preferences' ? 'preferences' : 'activity' } };
    case 'collapse': return { ...state, base: { kind: 'compact' }, hovered: false };
    case 'hover': return { ...state, hovered: event.active };
    case 'visibility': return { ...state, hidden: event.hidden, hovered: false };
    case 'preferences': {
      const preferences = parsePreferences(event.value);
      return { ...state, preferences, ...(!preferences.media_enabled ? { media: null } : {}), ...(!preferences.notifications_enabled ? { notification: null, pendingNotifications: [] } : {}) };
    }
    case 'media': {
      if (!Number.isSafeInteger(event.sequence) || event.sequence < 0 || event.sequence <= state.mediaSequence) return state;
      // Release artwork/metadata immediately on opt-out and remember only the
      // event sequence, so an in-flight older payload cannot reappear on opt-in.
      if (!state.preferences.media_enabled) return { ...state, media: null, mediaSequence: event.sequence };
      // Invalid data does not erase a valid current session or consume its sequence.
      const media = event.session === null ? null : parseMediaSession(event.session);
      if (event.session !== null && !media) return state;
      return { ...state, media, mediaSequence: event.sequence };
    }
    case 'notify': return enqueue(state, event.notification, event.now);
    case 'dismiss-notification':
      return state.notification && (!event.id || event.id === state.notification.notification.id) && Number.isFinite(event.now) && event.now >= 0 ? nextNotification(state, event.now) : state;
    case 'timer-start': return { ...state, timer: startTimer(event.durationMs, event.now), timerGeneration: state.timerGeneration + 1 };
    case 'timer-pause': return setTimer(state, pauseTimer(state.timer, event.now), event.now);
    case 'timer-resume': return { ...state, timer: resumeTimer(state.timer, event.now) };
    case 'timer-cancel': return { ...state, timer: cancelTimer() };
    case 'advance': {
      if (!Number.isFinite(event.now) || event.now < 0) return state;
      let next = state;
      if (next.notification && event.now >= next.notification.expiresAtMs) next = nextNotification(next, event.now);
      return setTimer(next, advanceTimer(state.timer, event.now), event.now);
    }
  }
}

export type Presentation =
  | { kind: 'hidden' | 'hover' | 'compact' }
  | { kind: 'expanded'; view: View }
  | { kind: 'notification'; notification: IslandNotification }
  | { kind: 'timer'; phase: TimerState['phase']; remainingMs: number }
  | { kind: 'music'; session: MediaSession };

/** Overlay never mutates the base; closing it restores the current user intent. */
export function presentation(state: IslandState, now: number): Presentation {
  if (state.hidden) return { kind: 'hidden' };
  if (state.notification && now < state.notification.expiresAtMs) {
    const value = state.notification.notification;
    return { kind: 'notification', notification: state.preferences.privacy_mode && value.sensitive ? { ...value, title: 'Notificación privada', body: '' } : value };
  }
  if (state.base.kind === 'expanded') return state.base;
  if (state.timer.phase !== 'idle') return { kind: 'timer', phase: state.timer.phase, remainingMs: remainingMs(state.timer, now) };
  if (state.preferences.media_enabled && state.media) return { kind: 'music', session: state.media };
  return { kind: state.hovered ? 'hover' : 'compact' };
}
