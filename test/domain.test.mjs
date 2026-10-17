import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PREFERENCES, MAX_QUEUED_NOTIFICATIONS,
  createIslandState, parseMediaSession, parsePreferences,
  presentation, reduceIsland, shouldReduceMotion,
} from '../src/domain/index.ts';

const session = (overrides = {}) => ({
  id: 'compatible-player', title: 'Real metadata supplied by the test adapter', artist: '',
  playback: 'playing', positionMs: 50, durationMs: 1_000,
  canPlayPause: true, canNext: true, canPrevious: false, canSeek: true, ...overrides,
});
const notify = (state, id, now = 0, extra = {}) => reduceIsland(state, {
  type: 'notify', now, notification: { id, source: 'Nivo', title: id, ...extra },
});

test('domain starts quiet without a fabricated player or notification', () => {
  const state = createIslandState();
  assert.deepEqual(presentation(state, 0), { kind: 'compact' });
  assert.equal(state.media, null);
  assert.equal(state.notification, null);
  assert.equal('timer' in state, false);
  const hovered = reduceIsland(state, { type: 'hover', active: true });
  assert.equal(presentation(hovered, 0).kind, 'hover');
  assert.equal(state.hovered, false, 'the original state is unchanged');
});

test('notification overlays restore current music and preserve expanded view', () => {
  let state = reduceIsland(createIslandState(), { type: 'media', sequence: 1, session: session() });
  assert.equal(presentation(state, 0).kind, 'music');
  state = notify(state, 'one');
  assert.equal(presentation(state, 1_000).kind, 'notification');
  state = reduceIsland(state, { type: 'advance', now: 5_000 });
  assert.equal(presentation(state, 5_000).kind, 'music');
  state = reduceIsland(state, { type: 'expand', view: 'preferences' });
  state = notify(state, 'two', 6_000);
  state = reduceIsland(state, { type: 'dismiss-notification', id: 'two', now: 6_100 });
  assert.deepEqual(presentation(state, 6_100), { kind: 'expanded', view: 'preferences' });
});

test('user intent changes while an overlay is visible remain authoritative', () => {
  let state = reduceIsland(createIslandState(), { type: 'expand' });
  state = notify(state, 'temporary');
  state = reduceIsland(state, { type: 'collapse' });
  assert.equal(presentation(state, 1_000).kind, 'notification');
  const stale = reduceIsland(state, { type: 'dismiss-notification', id: 'old', now: 1_000 });
  assert.equal(stale, state);
  state = reduceIsland(state, { type: 'dismiss-notification', id: 'temporary', now: 1_000 });
  assert.equal(presentation(state, 1_000).kind, 'compact');
});

test('notifications deduplicate, bound their queue and discard invalid input', () => {
  let state = notify(createIslandState(), 'active');
  const original = state;
  assert.equal(notify(state, 'active', 1_000), state, 'duplicate does not extend the deadline');
  for (let index = 0; index < 40; index++) state = notify(state, `pending-${index}`, index + 1);
  assert.equal(state.pendingNotifications.length, MAX_QUEUED_NOTIFICATIONS);
  assert.equal(state.seenNotificationIds.length, 41);
  assert.equal(notify(state, 'active', 100), state, 'visible notification remains deduplicated after history eviction');
  assert.equal(notify(state, 'pending-0', 100), state, 'queued notification remains deduplicated after history eviction');
  assert.equal(original.pendingNotifications.length, 0, 'updates do not mutate queues');
  assert.equal(notify(state, '', 10), state);
  assert.equal(notify(state, 'invalid-clock', NaN), state);
  assert.equal(notify(state, 'no-title', 10, { title: '' }), state);
});

test('privacy redacts a sensitive overlay; disabling notifications clears content immediately', () => {
  let state = notify(createIslandState(), 'private', 0, { sensitive: true, title: 'Personal message', body: 'Private contents' });
  const shown = presentation(state, 100).notification;
  assert.equal(shown.title, 'Notificación privada');
  assert.equal(shown.body, '');
  state = reduceIsland(state, { type: 'preferences', value: { ...state.preferences, notifications_enabled: false } });
  assert.equal(state.notification, null);
  assert.deepEqual(state.pendingNotifications, []);
  assert.equal(notify(state, 'disabled', 100), state);
});

test('fullscreen/hidden presentation suppresses UI without stopping real session state', () => {
  let state = reduceIsland(createIslandState(), { type: 'media', sequence: 4, session: session() });
  state = reduceIsland(state, { type: 'visibility', hidden: true });
  assert.equal(presentation(state, 0).kind, 'hidden');
  state = reduceIsland(state, { type: 'media', sequence: 5, session: session({ title: 'Changed while hidden' }) });
  state = reduceIsland(state, { type: 'visibility', hidden: false });
  assert.equal(presentation(state, 0).session.title, 'Changed while hidden');
});

test('media sequence rejects stale, duplicate and malformed events and permits real session disappearance', () => {
  let state = reduceIsland(createIslandState(), { type: 'media', sequence: 10, session: session() });
  for (const sequence of [9, 10, -1, NaN, Infinity, 10.1]) {
    assert.equal(reduceIsland(state, { type: 'media', sequence, session: null }), state);
  }
  assert.equal(reduceIsland(state, { type: 'media', sequence: 11, session: {} }), state);
  state = reduceIsland(state, { type: 'media', sequence: 11, session: session({ title: 'New track' }) });
  assert.equal(state.media.title, 'New track');
  state = reduceIsland(state, { type: 'media', sequence: 12, session: null });
  assert.equal(presentation(state, 0).kind, 'compact');
});

test('incomplete media metadata stays empty and unsafe artwork cannot cause a network request', () => {
  const parsed = parseMediaSession(session({
    title: null, artist: undefined, positionMs: Infinity, durationMs: -1,
    artwork: 'https://example.invalid/private-art.jpg', canNext: 'true',
  }));
  assert.equal(parsed.title, '');
  assert.equal(parsed.artist, '');
  assert.equal(parsed.positionMs, null);
  assert.equal(parsed.durationMs, null);
  assert.equal(parsed.canNext, false);
  assert.equal(parsed.canSeek, false);
  assert.equal(parsed.artwork, undefined);
  assert.equal(parseMediaSession(session({ positionMs: 5_000 })).positionMs, 1_000);
  assert.equal(parseMediaSession(session({ artwork: 'data:image/png;base64,aGVsbG8=' })).artwork, 'data:image/png;base64,aGVsbG8=');
  assert.equal(parseMediaSession({ id: '', playback: 'playing' }), null);
  assert.equal(parseMediaSession(session({ playback: { toString: () => 'playing' } })), null);
  assert.equal(parseMediaSession(session({ id: 'x'.repeat(257) })), null);
});

test('disabling media releases artwork and metadata and retains only the latest sequence', () => {
  let state = reduceIsland(createIslandState(), { type: 'media', sequence: 10, session: session({ artwork: 'data:image/png;base64,aGVsbG8=' }) });
  state = reduceIsland(state, { type: 'preferences', value: { ...state.preferences, media_enabled: false } });
  assert.equal(state.media, null);
  assert.equal(state.mediaSequence, 10);
  state = reduceIsland(state, { type: 'media', sequence: 11, session: session({ title: 'Private metadata after opt-out' }) });
  assert.equal(state.media, null);
  assert.equal(state.mediaSequence, 11);
  state = reduceIsland(state, { type: 'preferences', value: { ...state.preferences, media_enabled: true } });
  assert.equal(state.media, null, 'opt-in does not restore cached metadata');
  assert.equal(reduceIsland(state, { type: 'media', sequence: 10, session: session() }), state);
  state = reduceIsland(state, { type: 'media', sequence: 12, session: session({ title: 'Current session after opt-in' }) });
  assert.equal(state.media.title, 'Current session after opt-in');
});

test('preferences use a versioned allowlist, safe defaults and bounded monitor positioning', () => {
  assert.deepEqual(parsePreferences(null), DEFAULT_PREFERENCES);
  assert.deepEqual(parsePreferences({ schema_version: 99, privacy_mode: false }), DEFAULT_PREFERENCES);
  const preferences = parsePreferences({
    schema_version: 1, theme: 'light', motion: 'reduced', privacy_mode: false,
    notifications_enabled: 'yes', horizontal_position: 8, top_gap: -20,
    monitor_name: '\\DISPLAY2', shell: 'do not accept',
  });
  assert.equal(preferences.theme, 'light');
  assert.equal(preferences.privacy_mode, false);
  assert.equal(preferences.notifications_enabled, true);
  assert.equal(preferences.horizontal_position, 1);
  assert.equal(preferences.top_gap, 0);
  assert.equal(preferences.monitor_name, '\\DISPLAY2');
  assert.equal('shell' in preferences, false);
  assert.deepEqual(parsePreferences(JSON.parse(JSON.stringify(preferences))), preferences);
  assert.equal(parsePreferences({ schema_version: 1, top_gap: Infinity }).top_gap, 8);
  assert.equal(parsePreferences({ schema_version: 1, top_gap: 12.5 }).top_gap, 8, 'native u16 requires an integer');
  for (const monitor_name of ['\\DISPLAY2\u0000', 'screen\nname', '\u007fDISPLAY', 'DISPLAY\u009f']) {
    assert.equal(parsePreferences({ schema_version: 1, monitor_name }).monitor_name, null);
  }
  assert.equal(shouldReduceMotion({ ...preferences, motion: 'full' }, true), true);
  assert.equal(shouldReduceMotion({ ...preferences, motion: 'system' }, false), false);
});

