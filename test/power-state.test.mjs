import test from 'node:test';
import assert from 'node:assert/strict';
import { PowerInbox, parsePowerSnapshot } from '../src/power-state.ts';
import { DEFAULT_PREFERENCES, parsePreferences } from '../src/domain/preferences.ts';
const preferences = { ...DEFAULT_PREFERENCES, battery_enabled: true };
const power = (sequence, percent, patch = {}) => ({ sequence, present: true, percent, acOnline: false, charging: false, saving: false, remainingSeconds: null, ...patch });

test('desktop and unknown battery states never acquire fictional charge', () => {
  for (const present of [false, null]) {
    const value = parsePowerSnapshot(power(1, 42, { present, charging: true, remainingSeconds: 300 }));
    assert.equal(value.percent, null); assert.equal(value.charging, null); assert.equal(value.remainingSeconds, null);
  }
  assert.equal(parsePowerSnapshot({}), null);
  assert.equal(parsePowerSnapshot(power(-1, 20)), null);
});
test('battery thresholds are emitted once per discharge cycle, with the strongest crossing winning', () => {
  const inbox = new PowerInbox();
  assert.deepEqual(inbox.receive(power(1, 22), preferences), []);
  assert.equal(inbox.receive(power(2, 19), preferences)[0].priority, 'high');
  assert.deepEqual(inbox.receive(power(3, 18), preferences), []);
  assert.equal(inbox.receive(power(4, 4), preferences)[0].priority, 'critical');
  assert.deepEqual(inbox.receive(power(5, 3), preferences), []);
  inbox.receive(power(6, 4, { acOnline: true, charging: true }), preferences);
  const events = inbox.receive(power(7, 4), preferences);
  assert.ok(events.some(event => event.priority === 'critical'));
});
test('full-charge notice is opt-in and requires both 100% and not charging', () => {
  const inbox = new PowerInbox(); inbox.receive(power(1, 99, { acOnline: true, charging: true }), preferences);
  assert.deepEqual(inbox.receive(power(2, 100, { acOnline: true, charging: true }), { ...preferences, battery_full_notice: true }), []);
  assert.deepEqual(inbox.receive(power(3, 100, { acOnline: true }), preferences), []);
});
test('legacy preferences keep conservative module defaults and invalid thresholds fall back safely', () => {
  const value = parsePreferences({ schema_version: 1, mascot_enabled: false });
  assert.equal(value.mascot_enabled, false); assert.equal(value.audio_enabled, false); assert.equal(value.caps_lock_enabled, false);
  assert.deepEqual(parsePreferences({ schema_version: 1, battery_thresholds: [5, 10, 20] }).battery_thresholds, [20, 10, 5]);
});
