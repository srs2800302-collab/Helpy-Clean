import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { isHealthResponse } from '@helpy/contracts';
import { createNodeServer } from '../dist/infrastructure/node-server.js';
import { handleHttp } from '../dist/transport/http-handler.js';

test('Backend executable starts independently and shuts down on SIGTERM', { timeout: 15000 }, async (t) => {
  const child = spawn(process.execPath, ['dist/main.js'], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: child.stdout });
  t.after(async () => {
    lines.close();
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit');
      child.kill('SIGTERM');
      await stopped;
    }
  });
  const [line] = await Promise.race([
    once(lines, 'line'),
    once(child, 'exit').then(() => { throw new Error('Backend exited before startup'); }),
  ]);
  const match = line.match(/listening on port (\d+)/);
  assert.ok(match, line);
  const response = await fetch(`http://127.0.0.1:${match[1]}/health`);
  assert.equal(response.status, 200);
  assert.equal(isHealthResponse(await response.json()), true);
});

test('transport is executable without any server runtime', () => {
  assert.deepEqual(handleHttp({ method: 'GET', path: '/health' }), {
    status: 200, body: { status: 'ok', contractVersion: 1 },
  });
  assert.equal(handleHttp({ method: 'GET', path: '/missing' }).status, 404);
  assert.equal(handleHttp({ method: 'POST', path: '/health' }).status, 405);
});

test('Node adapter serves real HTTP and preserves the wire contract', async (t) => {
  const server = createNodeServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${base}/health?probe=1`);
  assert.equal(health.status, 200);
  assert.match(health.headers.get('content-type'), /application\/json/);
  assert.equal(isHealthResponse(await health.json()), true);
  assert.equal((await fetch(`${base}/missing`)).status, 404);
  const rejected = await fetch(`${base}/health`, { method: 'POST' });
  assert.equal(rejected.status, 405);
  assert.equal(rejected.headers.get('allow'), 'GET');
});
