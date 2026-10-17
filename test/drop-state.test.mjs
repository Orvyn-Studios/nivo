import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDroppedFiles } from '../src/drop-state.ts';

test('drop accepts bounded native file capabilities without exposing arbitrary paths', () => {
  const files = [{ id: 'drop:1:0', name: 'example.txt', size: 12, path: 'private' }];
  assert.deepEqual(parseDroppedFiles(files), [{ id: 'drop:1:0', name: 'example.txt', size: 12 }]);
  for (const malformed of [null, {}, Array(17).fill(files[0]), [files[0], files[0]],
    [{ ...files[0], id: 'C:\\source.txt' }], [{ ...files[0], name: '../secret.txt' }],
    [{ ...files[0], size: Infinity }], [{ ...files[0], size: -1 }]]) assert.equal(parseDroppedFiles(malformed), null);
});
