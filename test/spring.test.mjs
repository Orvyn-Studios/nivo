import test from 'node:test';
import assert from 'node:assert/strict';
import { stepSpring, springTrack, trackVelocity } from '../src/spring.ts';

test('spring converges and remains stable after a long frame without unbounded substeps', () => {
  let point = { value: 112, velocity: 0 };
  for (let index = 0; index < 120; index++) point = stepSpring(point, 388, 1 / 60);
  assert.ok(Math.abs(point.value - 388) < .001);
  assert.ok(Math.abs(point.velocity) < .001);
  assert.deepEqual(stepSpring({ value: 112, velocity: 0 }, 388, 30), stepSpring({ value: 112, velocity: 0 }, 388, .05));
});

test('retargeting preserves sampled position and velocity instead of restarting from rest', () => {
  const opening = springTrack(112, 388, 280);
  const middle = opening[5];
  assert.ok(middle.velocity > 0);
  const closing = springTrack(middle.value, 112, 200, middle.velocity);
  assert.deepEqual(closing[0], middle);
  assert.equal(trackVelocity(opening, 280 * 5 / (opening.length - 1), 280), middle.velocity);
  assert.deepEqual(closing.at(-1), { value: 112, velocity: 0 });
  assert.ok(closing.length <= 28);
});

test('invalid physics parameters cannot create NaN animation tracks or long loops', () => {
  for (const delta of [-1, NaN, Infinity]) assert.throws(() => stepSpring({ value: 0, velocity: 0 }, 1, delta));
  for (const duration of [0, -1, Infinity, 451]) assert.throws(() => springTrack(0, 1, duration));
  assert.throws(() => springTrack(NaN, 1, 200));
});
