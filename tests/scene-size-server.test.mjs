import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';

test('all planning endpoints validate scene size before provider access', async t => {
  const reservation = createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['server.mjs', '--production'], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), BRICKLAB_HOSTED: '0',
      BRICKLAB_CODESPACES: '0', BRICKLAB_COPILOT: '0',
      BRICKLAB_AZURE_AI: '0', BRICKLAB_COMPATIBLE_AI: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  });
  let output = '';
  for await (const chunk of child.stdout.iterator({ destroyOnReturn: false })) {
    output += chunk;
    if (output.includes('Daily calls per process:')) break;
  }
  assert.match(output, /BrickLab:/);
  const base = `http://127.0.0.1:${port}`;
  const status = await (await fetch(`${base}/api/status`)).json();
  for (const route of ['/api/plan', '/api/azure-plan', '/api/compatible-plan']) {
    const post = body => fetch(base + route, { method: 'POST',
      headers: { origin: base, 'content-type': 'application/json', 'x-bricklab-key': status.sessionKey },
      body: JSON.stringify({ world: 'space', brief: 'A tower', ...body }) });
    for (const body of [{ sceneSize: '1000' }, { sceneSize: 9000 }, { sceneSize: 1000, brief: '9000 bricks' },
      { sceneSize: 1000, brief: 'build -5 bricks' }, { sceneSize: 1000, brief: 'build −5 bricks' }]) {
      const response = await post(body);
      assert.equal(response.status, route === '/api/azure-plan' ? 403 : 400, route);
    }
    assert.equal((await post({ sceneSize: 1000 })).status, 403, route);
    assert.equal((await post({})).status, 403, `${route} accepts legacy requests`);
  }
});
