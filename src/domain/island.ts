import { parseMediaSession } from './media.ts';
import type { MediaSession } from './media.ts';
import { parsePreferences } from './preferences.ts';
import type { Preferences } from './preferences.ts';
import { createEventCoordinator, enqueue, nextNotification, type EventCoordinator, type IslandNotification } from './event-coordinator.ts';

export type View = 'activity' | 'audio' | 'preferences' | 'drop';
export type BaseState = { kind: 'compact' } | { kind: 'expanded'; view: View };
export interface IslandState extends EventCoordinator {
  base: BaseState;
  hovered: boolean;
  hidden: boolean;
  preferences: Preferences;
  media: MediaSession | null;
  mediaSequence: number;

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
  | { type: 'pause-events'; paused: boolean }
  | { type: 'cancel-event-group'; groupKey: string; now: number };

export function createIslandState(preferences?: unknown): IslandState {
  return {
    base: { kind: 'compact' }, hovered: false, hidden: false,
    preferences: parsePreferences(preferences), media: null, mediaSequence: -1,
    ...createEventCoordinator(),
  };
}

export function reduceIsland(state: IslandState, event: IslandEvent): IslandState {
  switch (event.type) {
    case 'expand':
      return { ...state, base: { kind: 'expanded', view: event.view === 'preferences' ? 'preferences' : event.view === 'audio' ? 'audio' : event.view === 'drop' ? 'drop' : 'activity' } };
    case 'collapse': return { ...state, base: { kind: 'compact' }, hovered: false };
    case 'hover': return { ...state, hovered: event.active };
    case 'visibility': return { ...state, hidden: event.hidden, hovered: false,
      ...(event.hidden ? { notification: null, pendingNotifications: [] } : {}) };
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
    case 'notify': return enqueue(state, event.notification, event.now, state.preferences.notifications_enabled && !state.hidden);
    case 'dismiss-notification':
      return state.notification && (!event.id || event.id === state.notification.notification.id) && Number.isFinite(event.now) && event.now >= 0 ? nextNotification(state, event.now) : state;
    case 'pause-events': return { ...state, eventsPaused: event.paused, notification: null, pendingNotifications: [] };
    case 'cancel-event-group': {
      const next = { ...state, pendingNotifications: state.pendingNotifications.filter(item => item.notification.groupKey !== event.groupKey) };
      return next.notification?.notification.groupKey === event.groupKey ? nextNotification(next, event.now) : next;
    }
    case 'advance': {
      if (!Number.isFinite(event.now) || event.now < 0) return state;
      let next = state;
      if (next.notification && event.now >= next.notification.expiresAtMs) next = nextNotification(next, event.now);
      return next;
    }
  }
}

export type Presentation =
  | { kind: 'hidden' | 'hover' | 'compact' }
  | { kind: 'expanded'; view: View }
  | { kind: 'notification'; notification: IslandNotification }
  | { kind: 'music'; session: MediaSession };

/** Overlay never mutates the base; closing it restores the current user intent. */
export function presentation(state: IslandState, now: number): Presentation {
  if (state.hidden) return { kind: 'hidden' };
  if (state.notification && now < state.notification.expiresAtMs) {
    const value = state.notification.notification;
    return { kind: 'notification', notification: state.preferences.privacy_mode && value.sensitive ? { ...value, title: 'Notificación privada', body: '' } : value };
  }
  if (state.base.kind === 'expanded') return state.base;
  if (state.preferences.media_enabled && state.media) return { kind: 'music', session: state.media };
  return { kind: state.hovered ? 'hover' : 'compact' };
}
