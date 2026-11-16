import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';

test('all planning endpoints validate scene size before provider access', async t => {
  const reservation = createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['server.mjs', '--production'], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), BRICKLAB_HOSTED: '0',
      BRICKLAB_CODESPACES: '0', BRICKLAB_COPILOT: '0', BRICKLAB_LOCAL_AI: '0',
      BRICKLAB_AZURE_AI: '0', BRICKLAB_COMPATIBLE_AI: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  });
  await t.test('local provider receives the resolved target in one model request', async t => {
    const prompts = [];
    const spec = { world: 'space', model: 'custom', color: 'blue', longTail: false, wideWings: false, budget: 1,
      design: { name: 'Tower', bricks: [{ x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, color: 'blue', part: 'frame' }] } };
    const ollama = createHttpServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/tags') res.end(JSON.stringify({ models: [{ name: 'fixture', model: 'fixture' }] }));
      else {
        prompts.push(JSON.parse(body).prompt);
        res.end(JSON.stringify({ done: true, response: JSON.stringify(spec) }));
      }
    }).listen(0, '127.0.0.1');
    await once(ollama, 'listening');
    t.after(() => new Promise(resolve => { ollama.close(resolve); ollama.closeAllConnections(); }));
    const reservation = createServer().listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    const child = spawn(process.execPath, ['server.mjs', '--production'], {
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), BRICKLAB_HOSTED: '0',
        BRICKLAB_CODESPACES: '0', BRICKLAB_COPILOT: '0', BRICKLAB_LOCAL_AI: '1',
        BRICKLAB_LOCAL_MODEL: 'fixture', BRICKLAB_LOCAL_URL: `http://127.0.0.1:${ollama.address().port}`,
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
    const brief = 'A 500-brick tower';
    const response = await fetch(`${base}/api/local-plan`, { method: 'POST',
      headers: { origin: base, 'content-type': 'application/json', 'x-bricklab-key': status.sessionKey },
      body: JSON.stringify({ world: 'space', brief, sceneSize: 2000 }) });
    assert.equal(response.status, 200);
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /roughly 500 expanded bricks/);
    assert.ok(prompts[0].endsWith(`User brief: ${JSON.stringify(brief)}`));
  });
  let output = '';
  for await (const chunk of child.stdout.iterator({ destroyOnReturn: false })) {
    output += chunk;
    if (output.includes('Daily calls per process:')) break;
  }
  assert.match(output, /BrickLab:/);
  const base = `http://127.0.0.1:${port}`;
  const status = await (await fetch(`${base}/api/status`)).json();
  for (const route of ['/api/plan', '/api/local-plan', '/api/azure-plan', '/api/compatible-plan']) {
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
