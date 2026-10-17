export type EventPriority = 'passive' | 'normal' | 'high' | 'critical';
export type ActivityKind = 'system' | 'volume' | 'microphone' | 'device' | 'keyboard' | 'battery' | 'agent' | 'download' | 'drop';
export interface IslandNotification {
  id: string;
  source: string;
  title: string;
  body?: string;
  kind?: ActivityKind;
  sensitive?: boolean;
  durationMs?: number;
  priority?: EventPriority;
  groupKey?: string;
  compact?: boolean;
  progress?: number;
  reaction?: 'attention' | 'working' | 'complete' | 'error' | 'device' | 'download';
}
export interface PendingNotification { notification: IslandNotification; remainingMs: number }
export interface ActiveNotification { notification: IslandNotification; expiresAtMs: number }
export interface EventCoordinator {
  notification: ActiveNotification | null;
  pendingNotifications: readonly PendingNotification[];
  seenNotificationIds: readonly string[];
  eventsPaused: boolean;
}
export const MAX_QUEUED_NOTIFICATIONS = 8;
const rank: Record<EventPriority, number> = { passive: 0, normal: 1, high: 2, critical: 3 };
const kinds: ActivityKind[] = ['system', 'volume', 'microphone', 'device', 'keyboard', 'battery', 'agent', 'download', 'drop'];
const reactions = ['attention', 'working', 'complete', 'error', 'device', 'download'];
const clean = (value: unknown, limit: number): string => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, limit) : '';

/** All provider payloads cross the same bounded, plain-text boundary. */
export function parseActivityEvent(value: unknown): IslandNotification | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const id = clean(item.id, 120), source = clean(item.source, 80), title = clean(item.title, 160);
  if (!id || !source || !title) return null;
  if (item.priority !== undefined && (typeof item.priority !== 'string' || !Object.hasOwn(rank, item.priority))) return null;
  if (item.kind !== undefined && !kinds.includes(item.kind as ActivityKind)) return null;
  return {
    id, source, title, body: clean(item.body, 280), kind: (item.kind as ActivityKind) ?? 'system',
    sensitive: item.sensitive === true, priority: (item.priority as EventPriority) ?? 'normal',
    durationMs: typeof item.durationMs === 'number' && Number.isFinite(item.durationMs)
      ? Math.min(15_000, Math.max(1_200, item.durationMs)) : 5_000,
    groupKey: clean(item.groupKey, 120) || undefined, compact: item.compact === true,
    progress: typeof item.progress === 'number' && Number.isFinite(item.progress) && item.progress >= 0 && item.progress <= 1 ? item.progress : undefined,
    reaction: reactions.includes(item.reaction as string) ? item.reaction as IslandNotification['reaction'] : undefined,
  };
}

export function createEventCoordinator(): EventCoordinator {
  return { notification: null, pendingNotifications: [], seenNotificationIds: [], eventsPaused: false };
}

export function nextNotification<T extends EventCoordinator>(state: T, now: number): T {
  const [next, ...pendingNotifications] = state.pendingNotifications;
  return { ...state, pendingNotifications, notification: next ? { notification: next.notification, expiresAtMs: now + next.remainingMs } : null };
}

function ordered(queue: readonly PendingNotification[]): PendingNotification[] {
  // Stable sorting preserves FIFO among equally important events.
  return [...queue].sort((a, b) => rank[b.notification.priority ?? 'normal'] - rank[a.notification.priority ?? 'normal']).slice(0, MAX_QUEUED_NOTIFICATIONS);
}

export function enqueue<T extends EventCoordinator>(state: T, value: unknown, now: number, enabled: boolean): T {
  const event = parseActivityEvent(value);
  if (!event || !enabled || state.eventsPaused || !Number.isFinite(now) || now < 0 || event.priority === 'passive') return state;
  if (state.seenNotificationIds.includes(event.id) || state.notification?.notification.id === event.id || state.pendingNotifications.some(item => item.notification.id === event.id)) return state;
  let next = state.notification && now >= state.notification.expiresAtMs ? nextNotification(state, now) : state;
  next = { ...next, seenNotificationIds: [...next.seenNotificationIds, event.id].slice(-64) };
  const active = { notification: event, expiresAtMs: now + event.durationMs! };
  if (!next.notification) return { ...next, notification: active };
  // Repeated volume/device observations replace their group instead of queuing a storm.
  if (event.groupKey && event.groupKey === next.notification.notification.groupKey && event.priority === next.notification.notification.priority) {
    return { ...next, notification: active };
  }
  const pending = next.pendingNotifications.filter(item => !event.groupKey || item.notification.groupKey !== event.groupKey);
  if (rank[event.priority!] > rank[next.notification.notification.priority ?? 'normal']) {
    const previous = { notification: next.notification.notification, remainingMs: Math.max(1, next.notification.expiresAtMs - now) };
    return { ...next, notification: active, pendingNotifications: ordered([previous, ...pending]) };
  }
  return { ...next, pendingNotifications: ordered([...pending, { notification: event, remainingMs: event.durationMs! }]) };
}
