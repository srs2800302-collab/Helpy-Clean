import assert from 'node:assert/strict';
import test from 'node:test';
import { preview } from 'vite';

test('built Admin has a real HTTP entry point with loadable JS and CSS', async (t) => {
  const server = await preview({
    logLevel: 'silent',
    preview: { host: '127.0.0.1', port: 0, open: false },
  });
  t.after(() => new Promise((resolve, reject) => {
    server.httpServer.close((error) => error ? reject(error) : resolve());
    server.httpServer.closeAllConnections();
  }));
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const response = await fetch(base);
  assert.equal(response.status, 200);
  const html = await response.text();
  const script = html.match(/src="([^"]+\.js)"/);
  const style = html.match(/href="([^"]+\.css)"/);
  assert.ok(script, 'A built JavaScript entry point must exist');
  assert.ok(style, 'A built stylesheet must exist');
  for (const asset of [script[1], style[1]]) {
    const result = await fetch(new URL(asset, base));
    assert.equal(result.status, 200);
    assert.ok((await result.text()).length > 0);
  }
});
