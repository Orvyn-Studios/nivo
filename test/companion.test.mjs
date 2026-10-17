import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompanion } from '../src/components/companion.ts';

function fixture() {
  const saved = new Map(['requestAnimationFrame', 'cancelAnimationFrame'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const frames = new Map(); let serial = 0;
  globalThis.requestAnimationFrame = callback => { frames.set(++serial, callback); return serial; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  const animations = [];
  const animate = () => {
    let resolve; const finished = new Promise(yes => { resolve = yes; });
    const value = { finished, cancel() { this.cancelled = true; resolve(); }, finish: resolve };
    animations.push(value); return value;
  };
  const style = { removeProperty(key) { delete this[key]; } };
  const blinkStyle = { removeProperty(key) { delete this[key]; } };
  const attributes = new Map();
  const face = { animate, setAttribute(key, value) { attributes.set(key, value); }, querySelector: selector => ({ style: selector === '.companion-eyes' ? blinkStyle : style, animate }), getBoundingClientRect: () => ({ x: 10, y: 10, width: 24, height: 24 }) };
  const target = new EventTarget();
  const companion = createCompanion(face, target);
  const send = (type, x = 22, y = 22) => target.dispatchEvent(Object.assign(new Event(type), { clientX: x, clientY: y }));
  return { frames, animations, style, blinkStyle, attributes, companion, send, restore() {
    companion.dispose();
    for (const [key, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
  } };
}

test('local pointer input coalesces into one frame and never starts an idle loop', () => {
  const f = fixture();
  try {
    f.companion.update({ enabled: true, visible: true, reduced: false, pose: 'quiet' });
    assert.equal(f.frames.size, 0);
    f.send('pointerenter');
    for (let index = 0; index < 100; index++) f.send('pointermove', 30, 18);
    assert.equal(f.frames.size, 1);
    const callback = [...f.frames.values()][0]; f.frames.clear(); callback();
    assert.equal(f.frames.size, 0);
    assert.match(f.style.transform, /^translate\(/);
    f.send('pointerleave');
    assert.equal(f.style.transform, undefined);
  } finally { f.restore(); }
});

test('hiding, opting out and reduced motion cancel frames and finite reactions', async () => {
  for (const patch of [{ visible: false }, { enabled: false }, { reduced: true }]) {
    const f = fixture();
    try {
      const value = { enabled: true, visible: true, reduced: false, pose: 'quiet' };
      f.companion.update(value); f.send('pointerenter'); f.send('pointermove'); f.send('click');
      assert.equal(f.frames.size, 1);
      f.companion.update({ ...value, ...patch });
      assert.equal(f.frames.size, 0);
      assert.ok(f.animations.every(animation => animation.cancelled));
      const count = f.animations.length;
      f.send('pointermove'); f.send('click');
      assert.equal(f.frames.size, 0); assert.equal(f.animations.length, count);
    } finally { f.restore(); }
  }
});

test('completion reacts once; repeated renders and disposed listeners do no work', async () => {
  const f = fixture();
  try {
    const value = { enabled: true, visible: true, reduced: false, pose: 'complete' };
    f.companion.update(value);
    for (let index = 0; index < 100; index++) f.companion.update(value);
    assert.equal(f.animations.length, 1);
    f.companion.dispose(); f.send('pointerenter'); f.send('pointermove'); f.send('click');
    assert.equal(f.frames.size, 0); assert.equal(f.animations.length, 1);
  } finally { f.restore(); }
});

test('pose changes cancel stale gaze and reactions; reduced motion retains static expression', () => {
  const f = fixture();
  try {
    const value = { enabled: true, visible: true, reduced: false, pose: 'music' };
    f.companion.update(value);
    f.send('pointerenter'); f.send('pointermove');
    f.companion.update({ ...value, pose: 'working' });
    assert.equal(f.frames.size, 0);
    assert.ok(f.animations.every(animation => animation.cancelled));
    f.companion.update({ ...value, reduced: true, pose: 'complete' });
    assert.equal(f.attributes.get('data-pose'), 'complete');
    assert.equal(f.animations.length, 1);
    assert.equal(f.blinkStyle.transform, undefined);
  } finally { f.restore(); }
});
