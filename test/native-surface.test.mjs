import test from 'node:test';
import assert from 'node:assert/strict';
import { createSurfaceWriter } from '../src/native-surface.ts';
const shape=width=>({left:16,top:16,width,height:34,radius:17});

test('surface IPC has one in-flight operation and keeps only the latest frame', async () => {
  const calls = [], releases = [];
  const writer = createSurfaceWriter((shape, epoch) => {
    calls.push([shape.width, epoch]); return new Promise(resolve => releases.push(resolve));
  }, error => assert.fail(error));
  for (let width = 112; width <= 388; width++) writer.submit(shape(width), 1);
  assert.deepEqual(calls, [[112, 1]]);
  releases.shift()(); await Promise.resolve();
  assert.deepEqual(calls, [[112, 1], [388, 1]]);
  writer.cancel();
  writer.submit(shape(200), 2);
  releases.shift()(); await Promise.resolve();
  assert.deepEqual(calls.at(-1), [200, 2]);
  writer.cancel(); releases.shift()(); await Promise.resolve();
});

test('cancellation discards queued frames and ignores errors from an obsolete epoch', async () => {
  let reject; const errors = [];
  const writer = createSurfaceWriter(() => new Promise((_, fail) => { reject = fail; }), error => errors.push(error));
  writer.submit(shape(112), 1); writer.submit(shape(300), 1);
  writer.cancel(); reject(new Error('stale')); await Promise.resolve();
  assert.deepEqual(errors, []);
});

test('final geometry waits for its acknowledgement, bypasses pixel deduplication and cancels cleanly',async()=>{
  const releases=[],calls=[];
  const writer=createSurfaceWriter((value,epoch)=>{calls.push([value.width,epoch]);return new Promise(resolve=>releases.push(resolve))},assert.fail);
  writer.submit(shape(112),1);writer.submit(shape(112.001),1);
  assert.equal(writer.metrics().duplicates,1);
  let completed=false;
  const final=writer.flush(shape(112),1).then(()=>{completed=true});
  releases.shift()(true);await Promise.resolve();
  assert.equal(completed,false);assert.equal(calls.length,2);
  releases.shift()(true);await final;assert.equal(completed,true);
  const cancelled=writer.flush(shape(300),2);writer.cancel();
  await assert.rejects(cancelled,/cancelled/);releases.shift()(true);
});

test('a rejected epoch cannot complete the final silhouette barrier',async()=>{
  const writer=createSurfaceWriter(async()=>false,assert.fail);
  await assert.rejects(writer.flush(shape(300),3),/Obsolete/);
  assert.equal(writer.metrics().stale,1);
});
