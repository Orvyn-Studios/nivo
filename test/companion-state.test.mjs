import test from 'node:test';
import assert from 'node:assert/strict';
import { companionGaze, companionPose } from '../src/companion-state.ts';

test('companion reacts only to real playback or timer states, with completion taking priority', () => {
  assert.equal(companionPose('idle', undefined), 'quiet');
  assert.equal(companionPose('idle', 'playing'), 'music');
  assert.equal(companionPose('paused', 'paused'), 'timer');
  assert.equal(companionPose('running', 'playing'), 'timer');
  assert.equal(companionPose('finished', 'playing'), 'complete');
  assert.equal(companionPose('agent-working', undefined), 'quiet', 'no fictional agent provider');
});

test('local gaze is bounded at extreme coordinates and ignores invalid or hidden geometry', () => {
  assert.deepEqual(companionGaze(12, 12, 24, 24), { x: 0, y: 0 });
  for (const coordinate of [-1e12, 1e12]) {
    const value = companionGaze(coordinate, coordinate, 24, 24);
    assert.ok(Math.abs(value.x) <= 1.6 && Math.abs(value.y) <= 1.1);
  }
  assert.deepEqual(companionGaze(NaN, 0, 24, 24), { x: 0, y: 0 });
  assert.deepEqual(companionGaze(10, 10, 0, 0), { x: 0, y: 0 });
});

test('attention and provider failure have explicit priority without inventing activity', () => {
  assert.equal(companionPose('idle', undefined, { hovered: true }), 'hover');
  assert.equal(companionPose('idle', undefined, { expanded: true, hovered: true }), 'focus');
  assert.equal(companionPose('idle', 'playing', { expanded: true }), 'music');
  assert.equal(companionPose('idle', undefined, { unavailable: true, expanded: true }), 'unavailable');
  assert.equal(companionPose('running', 'playing', { unavailable: true }), 'timer');
  assert.equal(companionPose('finished', undefined, { unavailable: true }), 'complete');
});
