import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { request } from 'node:http';

test('local API rejects cross-origin, wrong-host, malformed and unapproved model requests', async t => {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const child = spawn(process.execPath, ['server.mjs', '--production'], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), BRICKLAB_COPILOT: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 3000);
    await exited;
    clearTimeout(force);
  });
  await once(child.stdout, 'data');
  const base = `http://127.0.0.1:${port}`;
  const status = await (await fetch(`${base}/api/status`)).json() as { sessionKey: string; calls: number };
  assert.equal(status.calls, 0);
  const common = { 'Content-Type': 'application/json', 'X-Bricklab-Key': status.sessionKey };
  const post = (body: string, extra: Record<string, string> = {}) => fetch(`${base}/api/plan`, {
    method: 'POST', headers: { ...common, Origin: base, ...extra }, body,
  });
  assert.equal((await post('{}', { Origin: 'https://unrelated.example' })).status, 403);
  const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(`${base}/api/status`, { headers: { Host: `unrelated.example:${port}` } }, res => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(wrongHost, 403);
  assert.equal((await post('{}', { 'X-Bricklab-Key': 'wrong' })).status, 403);
  assert.equal((await post('not json')).status, 400);
  assert.equal((await post(JSON.stringify({ world: 'castle', brief: 'test' }))).status, 400);
  assert.equal((await post(JSON.stringify({ world: 'space', brief: '' }))).status, 400);
  assert.equal((await post('x'.repeat(5000))).status, 413);
  const unchanged = await (await fetch(`${base}/api/status`)).json() as { calls: number };
  assert.equal(unchanged.calls, 0, 'Invalid requests must not incur model calls');
});
