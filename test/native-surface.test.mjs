import test from 'node:test';
import assert from 'node:assert/strict';
import { createSurfaceWriter } from '../src/native-surface.ts';

test('surface IPC has one in-flight operation and keeps only the latest frame', async () => {
  const calls = [], releases = [];
  const writer = createSurfaceWriter((shape, epoch) => {
    calls.push([shape.width, epoch]); return new Promise(resolve => releases.push(resolve));
  }, error => assert.fail(error));
  for (let width = 112; width <= 388; width++) writer.submit({ width }, 1);
  assert.deepEqual(calls, [[112, 1]]);
  releases.shift()(); await Promise.resolve();
  assert.deepEqual(calls, [[112, 1], [388, 1]]);
  writer.cancel();
  writer.submit({ width: 200 }, 2);
  releases.shift()(); await Promise.resolve();
  assert.deepEqual(calls.at(-1), [200, 2]);
  writer.cancel(); releases.shift()(); await Promise.resolve();
});

test('cancellation discards queued frames and ignores errors from an obsolete epoch', async () => {
  let reject; const errors = [];
  const writer = createSurfaceWriter(() => new Promise((_, fail) => { reject = fail; }), error => errors.push(error));
  writer.submit({ width: 112 }, 1); writer.submit({ width: 300 }, 1);
  writer.cancel(); reject(new Error('stale')); await Promise.resolve();
  assert.deepEqual(errors, []);
});
