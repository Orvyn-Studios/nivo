import test from 'node:test';
import assert from 'node:assert/strict';
import { hookEvent } from '../integrations/codex-hook.mjs';
import { downloadProgress, IntegrationInbox, parseIntegrationEvent } from '../src/integration-state.ts';
const download = (patch = {}) => ({ kind: 'download', id: 'fixture', source: 'browser', name: 'fixture.zip', state: 'active', received: 42, total: null, bytesPerSecond: null, ...patch });

test('Codex hook discards private fields and forwards only documented lifecycle states', () => {
  const value = hookEvent({ hook_event_name: 'UserPromptSubmit', session_id: 'fixture', turn_id: 'turn', prompt: 'secret', transcript_path: 'private', cwd: 'private' });
  assert.equal(value.status, 'working'); assert.match(value.taskId, /^[a-f0-9]{32}$/);
  assert.deepEqual(Object.keys(value).sort(), ['kind', 'status', 'taskId']);
  assert.equal(hookEvent({ hook_event_name: 'Stop', session_id: 'fixture', stop_hook_active: true }), null);
  assert.equal(hookEvent({ hook_event_name: 'PostToolUse', session_id: 'fixture', tool_response: 'secret' }), null);
});
test('downloads require known positive totals for percentages and folder activity cannot claim completion', () => {
  assert.equal(downloadProgress(download()), undefined);
  assert.equal(downloadProgress(download({ total: 0 })), undefined);
  assert.equal(downloadProgress(download({ total: 100 })), .42);
  assert.equal(downloadProgress(download({ total: 10 })), undefined);
  assert.equal(downloadProgress(download({ source: 'folder', state: 'activity', total: 100 })), undefined);
  assert.equal(parseIntegrationEvent(download({ received: Infinity })).received, null);
  assert.equal(parseIntegrationEvent({ kind: 'shell', command: 'anything' }), null);
});
test('completion deduplicates within a turn; a new working hook starts a distinct turn in the same session', () => {
  const inbox = new IntegrationInbox();
  assert.deepEqual(inbox.receive({ kind: 'agent', taskId: 'a', status: 'working' }), []);
  assert.equal(inbox.receive({ kind: 'agent', taskId: 'a', status: 'review' })[0].priority, 'critical');
  const first=inbox.receive({ kind: 'agent', taskId: 'a', status: 'complete' })[0];assert.equal(first.reaction, 'complete');
  assert.deepEqual(inbox.receive({ kind: 'agent', taskId: 'a', status: 'complete' }), []);
  assert.deepEqual(inbox.receive({ kind: 'agent', taskId: 'a', status: 'waiting' }), []);
  assert.deepEqual(inbox.receive({ kind: 'agent', taskId: 'a', status: 'working' }), []);
  assert.equal(inbox.agents.get('a'), 'working');
  const second=inbox.receive({kind:'agent',taskId:'a',status:'complete'})[0];assert.notEqual(first.id,second.id);assert.match(second.title,/Turno/);
  assert.equal(inbox.receive(download({ state: 'complete' }))[0].reaction, 'download');
  assert.deepEqual(inbox.receive(download({ state: 'active' })), []);
  for (let index = 0; index < 100; index++) inbox.receive(download({ id: `fixture:${index}` }));
  assert.equal(inbox.downloads.size, 32); inbox.clear(); assert.equal(inbox.agents.size, 0); assert.equal(inbox.downloads.size, 0);
});
