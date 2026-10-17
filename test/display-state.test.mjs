import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDisplays } from '../src/display-state.ts';

const monitor = { name: 'DISPLAY1', x: -3840, y: -120, width: 3840, height: 2160, work_x: -3840, work_y: -120, work_width: 3840, work_height: 2100, scale_factor: 1.5, primary: false };

test('native displays retain negative physical origins and mixed DPI without rescaling', () => {
  for (const scale_factor of [1, 1.25, 1.5, 2]) {
    const input = { ...monitor, scale_factor, ignored: 'not retained' };
    assert.deepEqual(parseDisplays([input]), [{ ...monitor, scale_factor }]);
  }
  assert.deepEqual(parseDisplays([]), []);
  assert.equal(parseDisplays([{ ...monitor, name: null }])[0].name, null);
});

test('malformed display events cannot replace the confirmed monitor list', () => {
  for (const patch of [{ x: NaN }, { width: 0 }, { height: -1 }, { work_width: Infinity }, { y: 2 ** 31 }, { scale_factor: 0 }, { scale_factor: 17 }, { primary: 1 }, { name: 'bad\0name' }, { name: 'x'.repeat(257) }]) {
    assert.equal(parseDisplays([{ ...monitor, ...patch }]), null);
  }
  for (const value of [null, {}, [null], Array(65).fill(monitor)]) assert.equal(parseDisplays(value), null);
});
