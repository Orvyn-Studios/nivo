import test from 'node:test';
import assert from 'node:assert/strict';
import { companionGaze, companionPose } from '../src/companion-state.ts';

test('local gaze is bounded at extreme coordinates and ignores invalid or hidden geometry', () => {
  assert.deepEqual(companionGaze(12, 12, 24, 24), { x: 0, y: 0 });
  for (const coordinate of [-1e12, 1e12]) {
    const value = companionGaze(coordinate, coordinate, 24, 24);
    assert.ok(Math.abs(value.x) <= 1.6 && Math.abs(value.y) <= 1.1);
  }
  assert.deepEqual(companionGaze(NaN, 0, 24, 24), { x: 0, y: 0 });
  assert.deepEqual(companionGaze(10, 10, 0, 0), { x: 0, y: 0 });
});

test('coordinator reactions take priority over playback and attention', () => {
  assert.equal(companionPose(undefined), 'quiet');
  assert.equal(companionPose(undefined, { hovered: true }), 'hover');
  assert.equal(companionPose(undefined, { expanded: true }), 'focus');
  assert.equal(companionPose('playing', { expanded: true }), 'music');
  assert.equal(companionPose('playing', { reaction: 'working' }), 'working');
  assert.equal(companionPose('playing', { reaction: 'complete' }), 'complete');
  assert.equal(companionPose(undefined, { reaction: 'device' }), 'hover');
  assert.equal(companionPose(undefined, { reaction: 'download' }), 'complete');
  assert.equal(companionPose('playing', { reaction: 'error' }), 'unavailable');
});
