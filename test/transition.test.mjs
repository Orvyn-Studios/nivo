import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransitionController } from '../src/transition.ts';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };

function adapter(overrides = {}) {
  const events = [], errors = [];
  const dependencies = {
    resize: async expanded => { events.push(['resize', expanded]); },
    animate: async expanded => { events.push(['animate', expanded]); },
    cancelAnimation: () => { events.push(['cancel']); },
    setInteractive: expanded => { events.push(['interactive', expanded]); },
    commit: expanded => { events.push(['commit', expanded]); },
    onError: error => { errors.push(error); },
    ...overrides,
  };
  return { dependencies, events, errors };
}

test('opening enlarges the native window before content; closing shrinks it after animation', async () => {
  const { dependencies, events } = adapter();
  const controller = createTransitionController(dependencies);
  assert.equal(await controller.set(true), true);
  assert.equal(controller.expanded, true);
  assert.equal(await controller.set(false), false);
  assert.equal(controller.expanded, false);
  const operations = events.filter(([name]) => ['resize', 'animate', 'commit'].includes(name));
  assert.deepEqual(operations, [
    ['resize', true], ['commit', true], ['animate', true],
    ['animate', false], ['resize', false], ['commit', false],
  ]);
  assert.deepEqual(events.at(-1), ['interactive', false]);
});

test('latest intent immediately interrupts a slow animation without waiting for its promise', async () => {
  const firstAnimation = deferred();
  const { dependencies, events } = adapter({
    animate: async expanded => {
      events.push(['animate', expanded]);
      if (expanded) await firstAnimation.promise;
    },
  });
  const controller = createTransitionController(dependencies);
  const opening = controller.set(true);
  await tick();
  const closing = controller.set(false);
  assert.deepEqual(events.at(-1), ['cancel'], 'cancellation happens synchronously');
  assert.equal(await closing, false);
  assert.equal(await opening, false, 'all callers observe the stable latest intent');
  assert.equal(controller.expanded, false);
  firstAnimation.reject(Error('Late cancelled animation rejection'));
  await tick();
});

test('native resizes stay serialized when the desired state changes during resize', async () => {
  const firstResize = deferred();
  let active = 0, peak = 0;
  const calls = [];
  const { dependencies } = adapter({
    resize: async expanded => {
      calls.push(expanded);
      peak = Math.max(peak, ++active);
      if (calls.length === 1) await firstResize.promise;
      active--;
    },
  });
  const controller = createTransitionController(dependencies);
  const pending = controller.set(true);
  controller.set(false); controller.set(true); controller.set(false);
  firstResize.resolve();
  assert.equal(await pending, false);
  assert.deepEqual(calls, [true, false]);
  assert.equal(peak, 1);
});

test('repeated sets during slow IPC share one promise instead of accumulating waiters', async () => {
  const hold = deferred();
  const { dependencies } = adapter({ resize: async () => hold.promise });
  const controller = createTransitionController(dependencies);
  const first = controller.set(true);
  for (let index = 0; index < 10_000; index++) assert.equal(controller.set(true), first);
  assert.equal(controller.set(false), first);
  assert.equal(controller.set(true), first);
  hold.resolve();
  assert.equal(await first, true);
  assert.equal(controller.expanded, true);
});

test('intent arriving in the old queue finalization microtask is never lost', async () => {
  const { dependencies, events } = adapter();
  const controller = createTransitionController(dependencies);
  const opening = controller.set(true);
  Promise.resolve().then(() => controller.set(false));
  assert.equal(await opening, false);
  assert.equal(controller.expanded, false);
  assert.deepEqual(events.filter(([name]) => name === 'resize'), [['resize', true], ['resize', false]]);
  assert.equal(await controller.set(true).then(() => controller.set(false)), false);
});

test('a failed native expansion preserves compact state and can be retried', async () => {
  let fail = true;
  const { dependencies, events, errors } = adapter({
    resize: async expanded => {
      events.push(['resize', expanded]);
      if (fail) throw Error('Native expansion denied');
    },
  });
  const controller = createTransitionController(dependencies);
  assert.equal(await controller.set(true), false);
  assert.equal(controller.expanded, false);
  assert.equal(controller.desired, false);
  assert.equal(errors.length, 1);
  assert.equal(events.some(([name]) => name === 'animate'), false);
  fail = false;
  assert.equal(await controller.set(true), true);
});

test('failed native shrink restores the expanded presentation and interactive controls', async () => {
  let fail = true;
  const { dependencies, events, errors } = adapter({
    resize: async expanded => {
      events.push(['resize', expanded]);
      if (!expanded && fail) throw Error('Native shrink denied');
    },
  });
  const controller = createTransitionController(dependencies, true);
  assert.equal(await controller.set(false), true);
  assert.equal(controller.expanded, true);
  assert.equal(controller.desired, true);
  assert.equal(errors.length, 1);
  assert.deepEqual(events.filter(([name]) => name === 'animate'), [['animate', false], ['animate', true]]);
  assert.deepEqual(events.at(-1), ['interactive', true]);
  fail = false;
  assert.equal(await controller.set(false), false);
});

test('toggle reflects pending intent and an idle duplicate performs no work', async () => {
  const hold = deferred();
  const { dependencies, events } = adapter({ resize: async () => hold.promise });
  const controller = createTransitionController(dependencies);
  assert.equal(await controller.set(false), false);
  assert.deepEqual(events, []);
  const opening = controller.toggle();
  assert.equal(controller.desired, true);
  const closing = controller.toggle();
  assert.equal(controller.desired, false);
  hold.resolve();
  assert.equal(await closing, false);
  assert.equal(await opening, false);
});

test('a failed close animation preserves the native expanded state instead of clipping content', async () => {
  const { dependencies, events, errors } = adapter({ animate: async () => { throw Error('Animation unavailable'); } });
  const controller = createTransitionController(dependencies, true);
  assert.equal(await controller.set(false), true);
  assert.equal(errors.length, 1);
  assert.equal(events.some(([name]) => name === 'resize'), false);
  assert.equal(controller.expanded, true);
});
