import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COMPACT, contextGeometry } from '../src/geometry.ts';
test('semantic contexts stay inside the native envelope and short events do not get a dashboard', () => {
  assert.equal(COMPACT.height, 34);
  for (const context of ['summary','music','audio','drop','downloads','agent','volume','microphone','device','keyboard','battery','notice']) {
    for (const count of [0,1,16,10000]) {
      const value = contextGeometry(context, count);
      assert.ok(value.width <= 388 && value.height <= 320 && value.radius <= value.height / 2);
      if (['volume','microphone','keyboard','device','battery'].includes(context)) assert.ok(value.height <= 100);
    }
  }
  assert.ok(contextGeometry('drop', 1).height < contextGeometry('drop', 10).height);
});
test('preferences capability cannot control media, Drop or native surface geometry', () => {
  const capability = JSON.parse(readFileSync(new URL('../src-tauri/capabilities/preferences.json', import.meta.url)));
  assert.deepEqual(capability.windows, ['preferences']);
  for (const permission of capability.permissions) assert.ok(!/drop|media|surface|shell|fs:|quit/.test(permission));
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(!html.includes('id="preferences"') && !html.includes('data-view="preferences"'));
});
