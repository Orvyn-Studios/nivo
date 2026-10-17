import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyAudio, parseAudioSnapshot, audioActivity } from '../src/audio-state.ts';
const endpoint = { id: 'endpoint-fixture', name: 'Windows fixture', volume: .5, muted: false };
const snapshot = (patch = {}) => ({ ...emptyAudio('ready', 1), output: endpoint, ...patch });

test('audio contract rejects malformed envelopes and never retains data while disabled', () => {
  for (const value of [null, {}, snapshot({ sequence: -1 }), snapshot({ sessions: Array(25).fill(endpoint) }), snapshot({ devices: Array(17).fill(endpoint) })]) assert.equal(parseAudioSnapshot(value), null);
  const disabled = parseAudioSnapshot(snapshot({ status: 'disabled', sessions: [{ ...endpoint, active: true }] }));
  assert.equal(disabled.output, null); assert.deepEqual(disabled.sessions, []);
  assert.equal(parseAudioSnapshot(snapshot({ output: { ...endpoint, volume: NaN } })).output, null);
  assert.equal(parseAudioSnapshot(snapshot({ output: { ...endpoint, volume: 1.1 } })).output, null);
  assert.equal(parseAudioSnapshot(snapshot({ output: { ...endpoint, muted: 'false' } })).output, null);
});

test('initial audio enumeration and duplicate levels never invent notifications', () => {
  const value = snapshot();
  assert.deepEqual(audioActivity(undefined, value), []);
  assert.deepEqual(audioActivity(emptyAudio('disabled'), value), []);
  assert.deepEqual(audioActivity(value, snapshot({ sequence: 2 })), []);
  const changes = audioActivity(value, snapshot({ sequence: 2, output: { ...endpoint, volume: .42 } }));
  assert.equal(changes[0].title, '42 %'); assert.equal(changes[0].progress, .42);
  assert.equal(changes[0].groupKey, 'audio:volume'); assert.equal(changes[0].compact, true);
});

test('microphone silence is distinct from availability and never claims recording', () => {
  const previous = snapshot({ input: endpoint });
  const muted = audioActivity(previous, snapshot({ sequence: 2, input: { ...endpoint, muted: true } }));
  assert.equal(muted[0].kind, 'microphone'); assert.equal(muted[0].title, 'Micrófono silenciado');
  const absent = audioActivity(previous, snapshot({ sequence: 3, input: null }));
  assert.equal(absent[0].title, 'Entrada de audio no disponible');
});

test('loss of an active output gets high priority; a default change uses only the system name', () => {
  const previous = snapshot({ sessions: [{ ...endpoint, active: true }] });
  const removed = audioActivity(previous, snapshot({ sequence: 2, output: null }));
  assert.equal(removed[0].priority, 'high');
  const changed = audioActivity(previous, snapshot({ sequence: 3, output: { ...endpoint, id: 'new', name: 'Native device name' } }));
  assert.equal(changed[0].body, 'Native device name'); assert.equal(changed[0].kind, 'device');
});
