import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

test('current Vite frontend serves TypeScript over loopback and denies native sources and foreign hosts', { timeout: 20000 }, async () => {
  const server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    logLevel: 'silent',
    server: { port: 0, strictPort: false },
  });
  try {
    await server.listen();
    const address = server.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    assert.equal(address.address, '127.0.0.1');
    const origin = `http://127.0.0.1:${address.port}`;
    const document = await fetch(origin);
    assert.equal(document.status, 200);
    assert.match(document.headers.get('content-type'), /text\/html/);
    assert.match(await document.text(), /src="\/src\/main.ts"/);
    const entry = await fetch(`${origin}/src/main.ts`);
    assert.equal(entry.status, 200);
    assert.match(entry.headers.get('content-type'), /javascript/);
    assert.match(await entry.text(), /createIslandState/);
    for (const route of ['/src-tauri/Cargo.toml?raw', '/.git/config?raw']) {
      const response = await fetch(origin + route);
      assert.equal(response.status, 403, `private source must be denied: ${route}`);
    }
    const foreignHost = await new Promise((resolve, reject) => {
      const request = http.get(origin, { headers: { Host: 'untrusted.example' } }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject);
    });
    assert.equal(foreignHost, 403);
  } finally { await server.close(); }
});
