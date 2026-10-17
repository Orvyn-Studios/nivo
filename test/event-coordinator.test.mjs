import test from 'node:test';
import assert from 'node:assert/strict';
import { createIslandState, reduceIsland, presentation, parseActivityEvent, MAX_QUEUED_NOTIFICATIONS } from '../src/domain/index.ts';
const emit = (state, id, now, patch = {}) => reduceIsland(state, { type: 'notify', now,
  notification: { id, title: id, source: 'Windows fixture', ...patch } });

test('critical events preempt, retain remaining duration and restore current user intent', () => {
  let state = emit(createIslandState(), 'volume', 0, { durationMs: 5000 });
  state = emit(state, 'approval', 1000, { priority: 'critical', reaction: 'attention' });
  assert.equal(state.notification.notification.id, 'approval');
  assert.equal(state.pendingNotifications[0].remainingMs, 4000);
  state = reduceIsland(state, { type: 'expand', view: 'preferences' });
  state = reduceIsland(state, { type: 'dismiss-notification', now: 2000 });
  assert.equal(state.notification.expiresAtMs, 6000);
  state = reduceIsland(state, { type: 'advance', now: 6000 });
  assert.deepEqual(presentation(state, 6000), { kind: 'expanded', view: 'preferences' });
});

test('priority sorting is FIFO, bounded and immutable during an event storm', () => {
  let state = emit(createIslandState(), 'critical', 0, { priority: 'critical' });
  const previous = state;
  for (let index = 0; index < 100; index++) state = emit(state, `normal-${index}`, index);
  state = emit(state, 'high-first', 200, { priority: 'high' });
  state = emit(state, 'high-second', 201, { priority: 'high' });
  assert.deepEqual(state.pendingNotifications.slice(0, 2).map(item => item.notification.id), ['high-first', 'high-second']);
  assert.equal(state.pendingNotifications.length, MAX_QUEUED_NOTIFICATIONS);
  assert.equal(state.seenNotificationIds.length, 64);
  assert.equal(previous.pendingNotifications.length, 0);
});

test('volume updates coalesce and cancellation removes every queued member of a group', () => {
  let state = emit(createIslandState(), 'volume-1', 0, { groupKey: 'volume' });
  for (let index = 2; index < 100; index++) state = emit(state, `volume-${index}`, index, { groupKey: 'volume' });
  assert.equal(state.notification.notification.id, 'volume-99');
  assert.equal(state.pendingNotifications.length, 0);
  state = emit(state, 'done', 100, { priority: 'high' });
  state = reduceIsland(state, { type: 'cancel-event-group', groupKey: 'volume', now: 101 });
  assert.equal(state.pendingNotifications.length, 0);
  assert.equal(state.notification.notification.id, 'done');
});

test('pause and suppression drop transient notices without destroying media or replaying stale events', () => {
  let state = emit(createIslandState(), 'one', 0);
  state = reduceIsland(state, { type: 'pause-events', paused: true });
  assert.equal(emit(state, 'two', 1), state);
  state = reduceIsland(state, { type: 'pause-events', paused: false });
  state = reduceIsland(state, { type: 'visibility', hidden: true });
  assert.equal(emit(state, 'three', 2), state);
  state = reduceIsland(state, { type: 'visibility', hidden: false });
  assert.equal(state.notification, null);
  assert.equal(emit(state, 'passive', 3, { priority: 'passive' }), state);
});

test('unknown priorities/kinds and invalid clocks are rejected; progress never invented', () => {
  const item = { id: 'a', title: 'A', source: 'Windows' };
  assert.equal(parseActivityEvent({ ...item, priority: 'timer' }), null);
  assert.equal(parseActivityEvent({ ...item, kind: 'shell' }), null);
  assert.equal(parseActivityEvent({ ...item, progress: Infinity }).progress, undefined);
  assert.equal(parseActivityEvent({ ...item, progress: -1 }).progress, undefined);
  assert.equal(parseActivityEvent({ ...item, progress: .42 }).progress, .42);
  assert.equal(parseActivityEvent({ ...item, title: '\u0000' }), null);
  const state = createIslandState();
  assert.equal(emit(state, 'bad-clock', NaN), state);
});
