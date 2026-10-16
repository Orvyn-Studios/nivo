import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PREFERENCES, MAX_QUEUED_NOTIFICATIONS, advanceTimer, cancelTimer, exportTimer,
  createIslandState, parseMediaSession, parsePreferences, pauseTimer,
  presentation, reduceIsland, remainingMs, restoreTimer, resumeTimer, shouldReduceMotion, startTimer,
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
  assert.equal(state.timer.phase, 'idle');
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
  assert.equal(state.seenNotificationIds.length, 32);
  assert.equal(notify(state, 'active', 100), state, 'visible notification remains deduplicated after history eviction');
  assert.equal(notify(state, 'pending-0', 100), state, 'queued notification remains deduplicated after history eviction');
  assert.equal(original.pendingNotifications.length, 0, 'updates do not mutate queues');
  assert.equal(notify(state, '', 10), state);
  assert.equal(notify(state, 'invalid-clock', NaN), state);
  assert.equal(notify(state, 'no-title', 10, { title: '' }), state);
});

test('timer completion interrupts normal notifications and restores their remaining display time', () => {
  let state = reduceIsland(createIslandState(), { type: 'timer-start', durationMs: 2_000, now: 0 });
  state = notify(state, 'message', 0, { durationMs: 5_000 });
  state = reduceIsland(state, { type: 'advance', now: 2_000 });
  assert.equal(state.notification.notification.priority, 'timer');
  assert.equal(state.pendingNotifications[0].remainingMs, 3_000);
  assert.equal(state.timer.phase, 'finished');
  const completedId = state.notification.notification.id;
  state = reduceIsland(state, { type: 'advance', now: 2_100 });
  assert.equal(state.notification.notification.id, completedId, 'completion emitted once');
  assert.equal(state.pendingNotifications.length, 1);
  state = reduceIsland(state, { type: 'dismiss-notification', now: 3_000 });
  assert.equal(state.notification.notification.id, 'message');
  assert.equal(state.notification.expiresAtMs, 6_000);
});

test('consecutive timer completions keep priority and FIFO order in a full notification queue', () => {
  let state = reduceIsland(createIslandState(), { type: 'timer-start', durationMs: 1_000, now: 0 });
  state = reduceIsland(state, { type: 'advance', now: 1_000 });
  for (let index = 1; index <= MAX_QUEUED_NOTIFICATIONS; index++) state = notify(state, `message-${index}`, 1_000);
  const originalQueue = state.pendingNotifications;
  state = reduceIsland(state, { type: 'timer-start', durationMs: 1_000, now: 2_000 });
  state = reduceIsland(state, { type: 'advance', now: 3_000 });
  assert.equal(state.notification.notification.id, 'timer:1', 'an equally important visible alert is not interrupted');
  assert.deepEqual(state.pendingNotifications.map(item => item.notification.id), ['timer:2', 'message-1', 'message-2']);
  assert.deepEqual(originalQueue.map(item => item.notification.id), ['message-1', 'message-2', 'message-3'], 'the previous queue is unchanged');

  state = reduceIsland(state, { type: 'timer-start', durationMs: 1_000, now: 3_000 });
  state = reduceIsland(state, { type: 'advance', now: 4_000 });
  assert.deepEqual(state.pendingNotifications.map(item => item.notification.id), ['timer:2', 'timer:3', 'message-1']);
  for (const [now, expected] of [[4_000, 'timer:2'], [4_100, 'timer:3'], [4_200, 'message-1']]) {
    state = reduceIsland(state, { type: 'dismiss-notification', now });
    assert.equal(state.notification.notification.id, expected);
    assert.equal(state.notification.expiresAtMs, now + 5_000, 'queued content retains its display duration');
  }
  assert.equal(state.pendingNotifications.length, 0);
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

test('timer deadline is precise despite sparse ticks and includes time while suspended', () => {
  let timer = startTimer(60_000, 1_000_000);
  assert.equal(remainingMs(timer, 1_001_234), 58_766);
  timer = advanceTimer(timer, 1_030_501);
  assert.equal(remainingMs(timer, 1_030_501), 29_499);
  timer = advanceTimer(timer, 1_100_000);
  assert.equal(timer.phase, 'finished');
  assert.equal(timer.finishedAtMs, 1_060_000, 'deadline, not late interval callback time');
  assert.equal(remainingMs(timer, 1_100_000), 0);
  assert.equal(advanceTimer(timer, 1_100_100), timer);
});

test('pause/resume preserves remaining duration; cancelling prevents a stale completion', () => {
  let timer = pauseTimer(startTimer(10_000, 1_000), 4_100);
  assert.equal(timer.phase, 'paused');
  assert.equal(remainingMs(timer, 1_000_000), 6_900);
  timer = resumeTimer(timer, 100_000);
  assert.equal(timer.deadlineMs, 106_900);
  assert.equal(remainingMs(timer, 100_100), 6_800);
  assert.equal(pauseTimer(timer, 106_900).phase, 'finished');
  let state = reduceIsland(createIslandState(), { type: 'timer-start', durationMs: 1_000, now: 0 });
  state = reduceIsland(state, { type: 'timer-cancel', now: 500 });
  state = reduceIsland(state, { type: 'advance', now: 20_000 });
  assert.equal(state.timer.phase, 'idle');
  assert.equal(state.notification, null);
});

test('pausing on a completed deadline emits completion and repeated timer runs have distinct IDs', () => {
  let state = reduceIsland(createIslandState(), { type: 'timer-start', durationMs: 1_000, now: 0 });
  state = reduceIsland(state, { type: 'timer-pause', now: 1_000 });
  assert.equal(state.timer.phase, 'finished');
  assert.equal(state.notification.notification.id, 'timer:1');
  state = reduceIsland(state, { type: 'dismiss-notification', now: 1_000 });
  state = reduceIsland(state, { type: 'timer-start', durationMs: 1_000, now: 0 });
  state = reduceIsland(state, { type: 'advance', now: 1_000 });
  assert.equal(state.notification.notification.id, 'timer:2');
});

test('timer clock corrections have explicit semantics and invalid durations fail', () => {
  let timer = advanceTimer(startTimer(10_000, 10_000), 15_000);
  assert.equal(remainingMs(timer, 12_000), 5_000, 'backward clock cannot increase observed remaining time');
  assert.equal(advanceTimer(timer, 12_000), timer);
  assert.equal(advanceTimer(timer, 50_000).phase, 'finished', 'forward clock correction includes the jump');
  for (const duration of [-1, 0, 999, 86_400_001, 1_000.5, NaN, Infinity]) {
    assert.throws(() => startTimer(duration, 0), RangeError);
  }
  assert.throws(() => startTimer(1_000, NaN), RangeError);
  assert.throws(() => startTimer(1_000, 0.5), RangeError);
  assert.throws(() => startTimer(1_000, Number.MAX_SAFE_INTEGER), RangeError);
  assert.deepEqual(cancelTimer(), { phase: 'idle' });
});

test('active timers round-trip through JSON and expired restored deadlines stay silent', () => {
  const timer = advanceTimer(startTimer(10_000, 1_000), 3_000);
  const snapshot = exportTimer(timer);
  const restored = restoreTimer(JSON.parse(JSON.stringify(snapshot)), 6_000);
  assert.equal(restored.phase, 'running');
  assert.equal(remainingMs(restored, 6_000), 5_000);
  assert.equal(snapshot.deadline_ms, 11_000);
  const elapsed = restoreTimer(snapshot, 40_000);
  assert.equal(elapsed.phase, 'finished');
  assert.equal(elapsed.finishedAtMs, 11_000);
  const state = reduceIsland({ ...createIslandState(), timer: elapsed }, { type: 'advance', now: 40_001 });
  assert.equal(state.notification, null, 'restoration does not invent a new completion event');
  assert.equal(exportTimer(elapsed), null);
  assert.equal(exportTimer(cancelTimer()), null);
});

test('paused timer restoration does not count down while the application is closed', () => {
  const paused = pauseTimer(startTimer(10_000, 1_000), 3_000);
  const snapshot = exportTimer(paused);
  const restored = restoreTimer(snapshot, 200_000);
  assert.equal(restored.phase, 'paused');
  assert.equal(remainingMs(restored, 500_000), 8_000);
  assert.equal(resumeTimer(restored, 500_000).deadlineMs, 508_000);
  const backwards = restoreTimer(exportTimer(startTimer(10_000, 10_000)), 9_000);
  assert.equal(remainingMs(backwards, 9_000), 10_000);
});

test('timer restore rejects corrupt, oversized, unknown-version and impossible snapshots', () => {
  const valid = exportTimer(startTimer(10_000, 1_000));
  for (const value of [
    null, [], 'invalid', {}, { ...valid, schema_version: 2 },
    { ...valid, duration_ms: 1e15 }, { ...valid, deadline_ms: Infinity },
    { ...valid, observed_at_ms: -1 }, { ...valid, deadline_ms: 500 },
    { ...valid, deadline_ms: 12_000 }, { ...valid, remaining_ms: 1_000 },
    { ...valid, phase: 'paused', deadline_ms: null, remaining_ms: 0 },
    { ...valid, phase: 'paused', deadline_ms: null, remaining_ms: 10_001 },
    { ...valid, phase: 'finished' },
  ]) assert.equal(restoreTimer(value, 5_000).phase, 'idle');
  assert.throws(() => restoreTimer(valid, NaN), RangeError);
});
