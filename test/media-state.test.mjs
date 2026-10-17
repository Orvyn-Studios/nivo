import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMediaSnapshot, activeMedia, MediaInbox } from '../src/media-state.ts';

const session = (extra = {}) => ({ id: 'real-session', title: 'Metadata supplied by a test adapter', artist: '', playback: 'playing', positionMs: 20, durationMs: 100, canPlayPause: true, canPrevious: false, canNext: true, canSeek: false, ...extra });
const snapshot = (extra = {}) => ({ sequence: 1, status: 'ready', sessions: [session()], activeSessionId: 'real-session', error: null, ...extra });

test('media envelope rejects invalid ordering and oversized session lists', () => {
  for (const sequence of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, '1']) assert.equal(parseMediaSnapshot(snapshot({ sequence })), null);
  for (const value of [null, [], {}, snapshot({ status: 'simulated' }), snapshot({ sessions: Array(9).fill(session()) }), snapshot({ activeSessionId: 'bad\u0000id' })]) assert.equal(parseMediaSnapshot(value), null);
});

test('media sanitizes incomplete data, capabilities and untrusted artwork', () => {
  const result = parseMediaSnapshot(snapshot({ sessions: [session({ title: undefined, artist: undefined, positionMs: 200, artwork: 'https://example.com/art.jpg', canNext: 'true' })], error: { private: 'not a message' } }));
  assert.ok(result);
  assert.equal(activeMedia(result).title, '');
  assert.equal(activeMedia(result).artist, '');
  assert.equal(activeMedia(result).positionMs, 100);
  assert.equal(activeMedia(result).canNext, false);
  assert.equal(activeMedia(result).artwork, undefined);
  assert.equal(result.error, null);
});

test('invalid and duplicate sessions cannot replace an accepted native session', () => {
  const result = parseMediaSnapshot(snapshot({ sessions: [null, session(), session({ title: 'duplicate' }), session({ id: 'bad\u007fid' })] }));
  assert.ok(result);
  assert.equal(result.sessions.length, 1);
  assert.equal(activeMedia(result).title, 'Metadata supplied by a test adapter');
});

test('disabled and unavailable providers discard session metadata immediately', () => {
  for (const status of ['disabled', 'unavailable']) {
    const result = parseMediaSnapshot(snapshot({ status, error: 'Failure\nmessage' }));
    assert.ok(result);
    assert.deepEqual(result.sessions, []);
    assert.equal(result.activeSessionId, null);
    assert.equal(activeMedia(result), null);
    assert.equal(result.error, 'Failure message');
  }
});

test('the UI never guesses an active player or fabricates timeline values', () => {
  const missing = parseMediaSnapshot(snapshot({ activeSessionId: 'closed-session' }));
  assert.ok(missing);
  assert.equal(missing.activeSessionId, null);
  assert.equal(activeMedia(missing), null);
  const result = parseMediaSnapshot(snapshot({ sessions: [session({ positionMs: null, durationMs: null })] }));
  assert.equal(activeMedia(result).positionMs, null);
  assert.equal(activeMedia(result).durationMs, null);
});

test('provider errors are bounded plain text and malformed error objects are ignored', () => {
  const result = parseMediaSnapshot(snapshot({ error: 'x'.repeat(500) }));
  assert.equal(result.error.length, 280);
  assert.equal(parseMediaSnapshot(snapshot({ error: false })).error, null);
});

test('media inbox accepts the initial zero sequence and rejects obsolete events', () => {
  const inbox = new MediaInbox();
  assert.equal(inbox.enabled, true);
  assert.equal(inbox.snapshot.status, 'unavailable');
  assert.equal(inbox.receive(parseMediaSnapshot(snapshot({ sequence: 0 }))), true);
  const fresh = parseMediaSnapshot(snapshot({ sequence: 4, sessions: [session({ title: 'Current metadata' })] }));
  assert.equal(inbox.receive(fresh), true);
  assert.equal(inbox.receive(parseMediaSnapshot(snapshot({ sequence: 3 }))), false);
  assert.equal(inbox.receive(parseMediaSnapshot(snapshot({ sequence: 4 }))), false);
  assert.equal(inbox.snapshot, fresh);
});

test('opting out immediately clears artwork, metadata, selected session and provider errors', () => {
  const inbox = new MediaInbox();
  inbox.receive(parseMediaSnapshot(snapshot({ sequence: 5, error: 'Private provider detail', sessions: [session({ artwork: 'data:image/png;base64,YQ==' })] })));
  const cleared = inbox.setEnabled(false);
  assert.equal(inbox.enabled, false);
  assert.deepEqual(cleared, { sequence: 5, status: 'disabled', sessions: [], activeSessionId: null, error: null });
  assert.equal(inbox.snapshot, cleared);
});

test('late events while disabled advance ordering without retaining session references', () => {
  const inbox = new MediaInbox(false);
  const late = parseMediaSnapshot(snapshot({ sequence: 7, error: 'Do not retain', sessions: [session({ artwork: 'data:image/png;base64,YQ==' })] }));
  assert.equal(inbox.receive(late), true);
  late.sessions[0].title = 'Changed after receipt';
  late.sessions.push(session({ id: 'another-session' }));
  assert.notEqual(inbox.snapshot, late);
  assert.notEqual(inbox.snapshot.sessions, late.sessions);
  assert.deepEqual(inbox.snapshot, { sequence: 7, status: 'disabled', sessions: [], activeSessionId: null, error: null });
  assert.equal(inbox.receive(parseMediaSnapshot(snapshot({ sequence: 6 })), true), false);
});

test('opting back in never restores cached sessions and requires fresh provider data', () => {
  const inbox = new MediaInbox();
  inbox.receive(parseMediaSnapshot(snapshot({ sequence: 5 })));
  inbox.setEnabled(false);
  inbox.receive(parseMediaSnapshot(snapshot({ sequence: 6 })));
  assert.deepEqual(inbox.setEnabled(true), { sequence: 6, status: 'unavailable', sessions: [], activeSessionId: null, error: null });
  assert.equal(inbox.receive(parseMediaSnapshot(snapshot({ sequence: 6 }))), false);
  assert.equal(activeMedia(inbox.snapshot), null);
  assert.equal(inbox.receive(parseMediaSnapshot(snapshot({ sequence: 7 }))), true);
  assert.equal(activeMedia(inbox.snapshot).id, 'real-session');
  const current = inbox.snapshot;
  assert.equal(inbox.setEnabled(true), current, 'an unchanged preference does not discard fresh metadata');
});

test('authoritative equal-sequence resync recovers the event received before save confirmation', () => {
  const inbox = new MediaInbox(false);
  const beforeConfirmation = parseMediaSnapshot(snapshot({ sequence: 10 }));
  inbox.receive(beforeConfirmation);
  inbox.setEnabled(true);
  assert.equal(activeMedia(inbox.snapshot), null);
  assert.equal(inbox.receive(beforeConfirmation, true), true);
  assert.equal(activeMedia(inbox.snapshot).id, 'real-session');
  assert.equal(inbox.receive(parseMediaSnapshot(snapshot({ sequence: 9 })), true), false);
  assert.equal(inbox.snapshot.sequence, 10);
});

test('invalid sequence payloads cannot poison inbox ordering through the parser', () => {
  const inbox = new MediaInbox();
  for (const sequence of [NaN, Infinity, -1, 2.5, '8', Number.MAX_SAFE_INTEGER + 1]) {
    const parsed = parseMediaSnapshot(snapshot({ sequence }));
    assert.equal(parsed, null);
    if (parsed) inbox.receive(parsed);
  }
  assert.equal(inbox.snapshot.status, 'unavailable');
  assert.equal(inbox.receive(parseMediaSnapshot(snapshot({ sequence: 0 }))), true);
});
