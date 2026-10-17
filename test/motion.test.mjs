import test from 'node:test';
import assert from 'node:assert/strict';
import { IslandMotion } from '../src/motion.ts';
import { transitionMetrics } from '../src/metrics.ts';

function fixture() {
  const originals = new Map(['document', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const scheduled = new Map();
  let counter = 0;
  globalThis.document = { hidden: false };
  globalThis.requestAnimationFrame = callback => { const id = ++counter; scheduled.set(id, callback); return id; };
  globalThis.cancelAnimationFrame = id => scheduled.delete(id);
  globalThis.getComputedStyle = target => ({ opacity:target.style?.opacity??'1',transform:target.style?.transform??'none',borderRadius: '23px', clipPath: island.renderedClip ?? style.clipPath ?? 'none', getPropertyValue: () => '280' });
  const animations = [];
  const animate = (keyframes, options) => {
    let resolve, reject;
    const finished = new Promise((yes, no) => { resolve = yes; reject = no; });
    const result = { keyframes, options, finished, finish: resolve, cancel: () => reject(new Error('cancelled')) };
    animations.push(result); return result;
  };
  const makeStyle=()=>({setProperty(key,value){this[key]=value},removeProperty(key) { delete this[key === 'clip-path' ? 'clipPath' : key === 'border-radius' ? 'borderRadius' : key]; }});
  const style=makeStyle();
  const island = {
    dataset: { expanded: 'false' }, style, animate, rendered: null,
    getBoundingClientRect() { return this.rendered ?? { width: Number.parseFloat(style.width) || (this.dataset.expanded === 'true' ? 388 : 112), height: Number.parseFloat(style.height) || (this.dataset.expanded === 'true' ? 320 : 34) }; },
  };
  return {
    island, animations, scheduled, motion: new IslandMotion(island, { animate,style:makeStyle() }),
    restore() { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } },
  };
}

test('reduced motion changes geometry immediately with no animation frame work', async () => {
  const f = fixture();
  try {
    await f.motion.to(true, true);
    assert.equal(f.island.dataset.expanded, 'true');
    assert.equal(f.animations.length, 0);
    assert.equal(f.scheduled.size, 0);
  } finally { f.restore(); }
});

test('interrupt preserves current geometry; reduced-motion settling clears the intermediate size', async () => {
  const f = fixture();
  try {
    const opening = f.motion.to(true, false);
    assert.equal(f.animations.length, 2);
    assert.equal(f.scheduled.size, 1, 'diagnostics sample only the running transition');
    f.island.renderedClip = 'inset(0px 89px 220px round 23px)';
    f.motion.cancel();
    assert.equal(f.island.style.clipPath, f.island.renderedClip);
    assert.equal(f.scheduled.size, 0);
    await opening;
    f.island.renderedClip = null;
    const closing = f.motion.to(false, false);
    assert.equal(f.animations[2].keyframes[0].clipPath, 'inset(0px 0px 0px 0px round 23px)');
    assert.equal(f.animations[2].keyframes.at(-1).clipPath, 'inset(0px 49px 66px 49px round 17px)');
    f.motion.settle();
    await closing;
    assert.equal(f.island.style.width, undefined, 'no permanently frozen inline dimensions');
    assert.equal(f.island.style.height, undefined);
    assert.equal(f.island.style.clipPath, undefined);
    assert.equal(f.island.getBoundingClientRect().width, 112);
    assert.equal(f.scheduled.size, 0, 'no idle diagnostics frame loop');
    assert.equal(transitionMetrics().at(-1).interrupted, true);
  } finally { f.restore(); }
});

test('geometry uses a mask without animating layout dimensions or scaling text', async () => {
  const f = fixture();
  try {
    const pending = f.motion.to(true, false);
    for (const animation of f.animations) {
      for (const frame of animation.keyframes) {
        assert.equal('width' in frame || 'height' in frame || 'left' in frame || 'top' in frame, false);
        assert.equal(String(frame.transform ?? '').includes('scale'), false);
      }
      animation.finish();
    }
    await pending;
    assert.equal(f.island.style.clipPath, undefined);
    assert.equal(f.island.getBoundingClientRect().width, 388);
    assert.equal(f.scheduled.size, 0);
  } finally { f.restore(); }
});

test('completed animation diagnostics are bounded and stop sampling when hidden', async () => {
  const f = fixture();
  try {
    for (let index = 0; index < 35; index++) {
      const pending = f.motion.to(index % 2 === 0, false);
      f.animations.at(-2).finish(); f.animations.at(-1).finish();
      await pending;
    }
    assert.equal(transitionMetrics().length, 32);
    assert.equal(f.scheduled.size, 0);
    globalThis.document.hidden = true;
    const count = f.animations.length;
    await f.motion.to(false, false);
    assert.equal(f.animations.length, count);
    assert.equal(f.scheduled.size, 0);
  } finally { f.restore(); }
});
