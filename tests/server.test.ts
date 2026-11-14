import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { request, createServer as createHttpServer } from 'node:http';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';

function fetchWithHost(url: string, options: { method?: string; headers: Record<string, string>; body?: string }) {
  return new Promise<Response>((resolve, reject) => {
    const req = request(url, { method: options.method, headers: options.headers }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          if (Array.isArray(value)) value.forEach(item => headers.append(name, item));
          else if (value !== undefined) headers.set(name, value);
        }
        resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers }));
      });
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

async function startServer(t: TestContext, env: NodeJS.ProcessEnv = {}) {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const child = spawn(process.execPath, ['server.mjs', '--production'], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port),
      BRICKLAB_COPILOT: '1', BRICKLAB_CODESPACES: '0', BRICKLAB_COPILOT_BIN: '',
      BRICKLAB_LOCAL_AI: '0', ...env },
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
  let output = '';
  for await (const chunk of child.stdout.iterator({ destroyOnReturn: false })) {
    output += chunk;
    if (output.includes('Daily calls per process:') && (env.BRICKLAB_CODESPACES !== '1'
        || output.includes('Temporary app password:'))) break;
  }
  assert.ok(output.includes('BrickLab:'), 'Server must start');
  const base = `http://127.0.0.1:${port}`;
  return { port, base, output };
}

test('local API rejects cross-origin, wrong-host, malformed and unapproved model requests', async t => {
  const { port, base } = await startServer(t);
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
  assert.equal((await post('{}', { 'X-Bricklab-Key': 'é'.repeat(status.sessionKey.length) })).status, 403);
  assert.equal((await post('not json')).status, 400);
  assert.equal((await post(JSON.stringify({ world: 'castle', brief: 'test' }))).status, 400);
  assert.equal((await post(JSON.stringify({ world: 'space', brief: '' }))).status, 400);
  assert.equal((await post('x'.repeat(5000))).status, 413);
  const unchanged = await (await fetch(`${base}/api/status`)).json() as { calls: number };
  assert.equal(unchanged.calls, 0, 'Invalid requests must not incur model calls');
  const forwarded = await fetchWithHost(`${base}/api/status`, {
    headers: { Host: `example-${port}.app.github.dev`, 'X-Forwarded-Host': `localhost:${port}` },
  });
  assert.equal(forwarded.status, 403, 'Forwarding is not implicitly enabled');
});

const posixExecutableFixtures = {
  skip: process.platform === 'win32' ? 'These subprocess fixtures require POSIX shebang execution; native Windows CLI execution is not simulated.' : false,
};

test('Local AI is explicit, uses the same API protections and requires custom local geometry', async t => {
  const generated: { prompt: string }[] = [];
  let metadataRequests = 0;
  let remote = false;
  let reply: unknown = { world: 'jurassic', model: 'custom', color: 'blue', longTail: false, wideWings: false, budget: 10,
    design: { name: 'Local sculpture', bricks: [
      { x: 0, y: 0, z: 0, width: 3, height: 2, depth: 1, color: 'purple', part: 'frame' },
    ] } };
  const provider = createHttpServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/tags') {
      metadataRequests++;
      res.end(JSON.stringify({ models: [{ name: 'fixture:latest', model: 'fixture:latest',
        ...(remote ? { remote_model: 'remote', remote_host: 'https://ollama.com' } : {}) }] }));
      return;
    }
    assert.equal(req.url, '/api/generate');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    generated.push(JSON.parse(raw));
    res.end(JSON.stringify({ done: true, response: JSON.stringify(reply) }));
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  t.after(() => new Promise<void>(resolve => provider.close(() => resolve())));
  const address = provider.address();
  assert.ok(address && typeof address === 'object');
  const { base } = await startServer(t, { BRICKLAB_COPILOT: '0', BRICKLAB_LOCAL_AI: '1',
    BRICKLAB_LOCAL_MODEL: 'fixture:latest', BRICKLAB_LOCAL_URL: `http://127.0.0.1:${address.port}` });
  const status = await (await fetch(`${base}/api/status`)).json() as {
    sessionKey: string; localPlanner: { enabled: boolean }; copilot: boolean;
  };
  assert.equal(status.copilot, false);
  assert.equal(status.localPlanner.enabled, true);
  assert.equal(metadataRequests, 0, 'Page/status requests never probe the local provider');
  const brief = 'An original freestanding abstract sculpture, not a dinosaur or spaceship.';
  const post = (extra: Record<string, string> = {}) => fetch(`${base}/api/local-plan`, {
    method: 'POST', headers: { Origin: base, 'X-Bricklab-Key': status.sessionKey, ...extra },
    body: JSON.stringify({ world: 'jurassic', brief }),
  });
  assert.equal((await post({ Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await post({ 'X-Bricklab-Key': '' })).status, 403);
  assert.equal(metadataRequests, 0);
  const planned = await post();
  assert.equal(planned.status, 200);
  assert.deepEqual(await planned.json(), { spec: reply, calls: 0, limit: 12, source: 'local-ai' });
  assert.equal(generated.length, 1);
  assert.ok(generated[0].prompt.endsWith(`User brief: ${JSON.stringify(brief)}`));
  reply = { world: 'jurassic', model: 'stegosaurus', color: 'blue', longTail: false, wideWings: false, budget: 700 };
  const template = await post();
  assert.equal(template.status, 502);
  assert.match((await template.json() as { error: string }).error, /original custom design is required/i);
  assert.equal(generated.length, 2, 'No retries or alternate-provider/template fallback');
  remote = true;
  const cloudModel = await post();
  assert.equal(cloudModel.status, 502);
  assert.equal(generated.length, 2, 'Remote metadata is rejected before sending a brief');
});

test('private Codespace mode authenticates independently and fails closed on visibility or origin changes', posixExecutableFixtures, async t => {
  const bin = await mkdtemp(join(tmpdir(), 'bricklab-private-test-'));
  t.after(() => rm(bin, { recursive: true, force: true }));
  const visibilityFile = join(bin, 'ports.json');
  const callsFile = join(bin, 'model-calls.json');
  const specFile = join(bin, 'model-spec.json');
  const invocationsFile = join(bin, 'model-invocations.txt');
  const pidFile = join(bin, 'oversized-pid.txt');
  await writeFile(join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify([
  'codespace', 'ports', '--codespace', 'test-codespace',
  '--json', 'sourcePort,visibility,browseUrl'
])) process.exit(2);
process.stdout.write(fs.readFileSync(process.env.TEST_PORTS_FILE, 'utf8'));
`, { mode: 0o700 });
  const spec = { world: 'space', model: 'custom', color: 'blue', longTail: false, wideWings: false, budget: 700,
    design: { name: 'Original fixture', bricks: [
      { x: 0, y: 0, z: 0, width: 3, height: 2, depth: 1, color: 'blue', part: 'frame' },
    ] } };
  await writeFile(specFile, JSON.stringify(spec));
  await writeFile(join(bin, 'copilot'), `#!/usr/bin/env node
if (process.argv[2] === '--version') { console.log('fixture-cli'); process.exit(0); }
require('node:fs').writeFileSync(process.env.TEST_CALLS_FILE, JSON.stringify(process.argv.slice(2)));
require('node:fs').appendFileSync(process.env.TEST_INVOCATIONS_FILE, 'call\\n');
const content = require('node:fs').readFileSync(process.env.TEST_SPEC_FILE, 'utf8');
if (Buffer.byteLength(content) > 1048576) {
  require('node:fs').writeFileSync(process.env.TEST_PID_FILE, String(process.pid));
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
}
const events = [
  { type: 'session.start', data: {} },
  { type: 'assistant.message', data: { content } },
  { type: 'result', exitCode: 0 }
].map(event => JSON.stringify(event)).join('\\n') + '\\n';
const bytes = Buffer.from(events);
const split = bytes.indexOf(Buffer.from('é')) + 1;
process.stdout.write(bytes.subarray(0, split));
setTimeout(() => process.stdout.write(bytes.subarray(split)), 5);
`, { mode: 0o700 });
  const { port, base, output } = await startServer(t, {
    BRICKLAB_CODESPACES: '1', CODESPACES: 'true', CODESPACE_NAME: 'test-codespace',
    PATH: `${bin}${delimiter}${process.env.PATH}`, TEST_PORTS_FILE: visibilityFile,
    TEST_CALLS_FILE: callsFile, TEST_SPEC_FILE: specFile,
    TEST_INVOCATIONS_FILE: invocationsFile, TEST_PID_FILE: pidFile,
  });
  const origin = `https://test-codespace-${port}.app.github.dev`;
  const password = /Temporary app password: ([a-f0-9]+)/.exec(output)?.[1];
  assert.ok(password);
  const headers = { Host: new URL(origin).host, Authorization: `Basic ${Buffer.from(`bricklab:${password}`).toString('base64')}` };
  const statusRequest = (extra: Record<string, string> = {}) => fetchWithHost(`${base}/api/status`, { headers: { ...headers, ...extra } });
  const setVisibility = (visibility: string, browseUrl = origin, sourcePort = port) =>
    writeFile(visibilityFile, JSON.stringify([{ sourcePort, visibility, browseUrl }]));
  await setVisibility('private');
  const unauthorized = await statusRequest({ Authorization: '' });
  assert.equal(unauthorized.status, 401);
  assert.match(unauthorized.headers.get('www-authenticate') || '', /Basic/);
  assert.equal('sessionKey' in await unauthorized.json(), false);
  assert.equal((await statusRequest({ Authorization: 'Basic wrong' })).status, 401);
  assert.equal((await fetchWithHost(`${base}/`, { headers: { Host: headers.Host } })).status, 401);
  assert.equal((await statusRequest({ Host: `localhost:${port}` })).status, 403, 'No localhost-host bypass in forwarded mode');
  assert.equal((await statusRequest({ Host: 'attacker.example', 'X-Forwarded-Host': headers.Host })).status, 403);
  assert.equal((await statusRequest({ Origin: 'https://attacker.example' })).status, 403);
  const response = await statusRequest();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  const status = await response.json() as { sessionKey: string; calls: number; copilot: boolean };
  assert.equal(status.copilot, true);
  const post = (extra: Record<string, string> = {}, brief = 'A blue ship with wide wings') => fetchWithHost(`${base}/api/plan`, {
    method: 'POST', headers: { ...headers, Origin: origin, 'X-Bricklab-Key': status.sessionKey, ...extra },
    body: JSON.stringify({ world: 'space', brief }),
  });
  for (const invalid of ['', 'http://' + headers.Host, origin + '.attacker.example', 'https://other-4173.app.github.dev'])
    assert.equal((await post({ Origin: invalid })).status, 403);
  assert.equal((await post({ 'X-Bricklab-Key': '' })).status, 403);
  assert.equal((await post({ Authorization: '' })).status, 401);
  await assert.rejects(readFile(callsFile), { code: 'ENOENT' });
  const arbitraryBrief = 'An original observatory with a spiral bridge and a separate sculpture, not a spaceship.';
  const planned = await post({}, arbitraryBrief);
  assert.equal(planned.status, 200);
  assert.deepEqual(await planned.json(), { spec, calls: 1, limit: 12, source: 'copilot' });
  const args = JSON.parse(await readFile(callsFile, 'utf8')) as string[];
  assert.ok(args.includes('--available-tools='));
  assert.ok(args.includes('--disable-builtin-mcps'));
  assert.ok(args.includes('--output-format=json'));
  assert.equal(args.includes('--silent'), false, 'Use machine events, not wrapped terminal rendering');
  assert.ok(args[args.indexOf('-p') + 1].endsWith(`User brief: ${JSON.stringify(arbitraryBrief)}`), 'The complete arbitrary brief reaches the model unchanged');
  const custom = { ...spec, model: 'custom', wideWings: false, design: {
    name: 'Moon café tower',
    bricks: [
      { x: 0, y: 0, z: 0, width: 4, height: 1, depth: 4, color: 'blue', part: 'frame' },
      { x: 1, y: 1, z: 1, width: 2, height: 4, depth: 2, color: 'white', part: 'frame' },
      { x: 0, y: 5, z: 0, width: 4, height: 1, depth: 4, color: 'orange', part: 'detail' },
    ],
  } };
  await writeFile(specFile, JSON.stringify(custom));
  const customPlan = await post();
  assert.equal(customPlan.status, 200);
  assert.deepEqual((await customPlan.json() as { spec: unknown }).spec, custom);
  const beforeTemplate = (await readFile(invocationsFile, 'utf8')).trim().split('\n').length;
  await writeFile(specFile, JSON.stringify({ world: 'space', model: 'explorer', color: 'blue', longTail: false, wideWings: true, budget: 700 }));
  const templatePlan = await post();
  assert.equal(templatePlan.status, 502);
  assert.match((await templatePlan.json() as { error: string }).error, /original custom design is required/i);
  assert.equal((await readFile(invocationsFile, 'utf8')).trim().split('\n').length, beforeTemplate + 1, 'Template rejection does not retry or fall back');
  await writeFile(specFile, JSON.stringify({ ...custom, design: { ...custom.design,
    bricks: [custom.design.bricks[0], custom.design.bricks[0]] } }));
  const overlappingPlan = await post();
  assert.equal(overlappingPlan.status, 502, 'Invalid generated geometry fails without a template fallback');
  const beforeInvalid = (await readFile(invocationsFile, 'utf8')).trim().split('\n').length;
  await writeFile(specFile, '{"world":"space","model":"custom","design":{"name":"private\nfixture"}}');
  const malformedPlan = await post();
  assert.equal(malformedPlan.status, 502, 'The machine envelope never repairs malformed model JSON');
  const malformedBody = await malformedPlan.json() as { error: string };
  assert.match(malformedBody.error, /invalid JSON in its final response/);
  assert.equal(malformedBody.error.includes('private'), false, 'Do not expose raw parser/model excerpts');
  const afterInvalid = (await readFile(invocationsFile, 'utf8')).trim().split('\n').length;
  assert.equal(afterInvalid, beforeInvalid + 1, 'Malformed responses do not trigger another model invocation');
  await writeFile(specFile, 'x'.repeat(1_048_577));
  const oversizedStream = await post();
  assert.equal(oversizedStream.status, 502);
  assert.match((await oversizedStream.json() as { error: string }).error, /event stream exceeded the size limit/);
  const oversizedPid = Number(await readFile(pidFile, 'utf8'));
  assert.throws(() => process.kill(oversizedPid, 0), { code: 'ESRCH' }, 'An over-limit CLI that ignores termination must exit before the request releases its planning slot');
  await writeFile(specFile, JSON.stringify(spec));
  for (const visibility of ['public', 'org', 'unknown']) {
    await setVisibility(visibility);
    assert.equal((await statusRequest()).status, 503);
    assert.equal((await post()).status, 503, 'Recheck visibility on every plan, not only startup');
    assert.equal((await statusRequest({ Authorization: '' })).status, 401, 'App authentication survives public visibility');
  }
  await setVisibility('private', 'https://other-4173.app.github.dev');
  assert.equal((await statusRequest()).status, 503);
  await setVisibility('private', origin, port + 1);
  assert.equal((await statusRequest()).status, 503);
  for (const invalid of ['[]', 'not json', '{}']) {
    await writeFile(visibilityFile, invalid);
    assert.equal((await statusRequest()).status, 503);
  }
  await rm(visibilityFile);
  assert.equal((await statusRequest()).status, 503, 'CLI failure denies access');
  await setVisibility('private');
  assert.equal((await statusRequest()).status, 200, 'A corrected private port recovers without weakening checks');
  await writeFile(join(bin, 'copilot'), `#!/usr/bin/env node
if (process.argv[2] === '--version') { console.log('fixture-cli'); process.exit(0); }
console.error('Authentication required. Run copilot login. secret fixture detail');
process.exit(1);
`, { mode: 0o700 });
  const authFailure = await post();
  assert.equal(authFailure.status, 502);
  const authBody = await authFailure.json() as { error: string };
  assert.match(authBody.error, /copilot login/);
  assert.equal(authBody.error.includes('secret fixture detail'), false, 'Raw provider stderr stays private');
  const failedStatus = await (await statusRequest()).json() as { planner: { state: string }; copilot: boolean };
  assert.equal(failedStatus.planner.state, 'needs-auth');
  assert.equal(failedStatus.copilot, true, 'User can retry after authenticating');
  const disabled = await startServer(t, {
    BRICKLAB_CODESPACES: '1', BRICKLAB_COPILOT: '0',
    CODESPACES: 'true', CODESPACE_NAME: 'test-codespace',
    PATH: `${bin}${delimiter}${process.env.PATH}`, TEST_PORTS_FILE: visibilityFile,
  });
  const disabledOrigin = `https://test-codespace-${disabled.port}.app.github.dev`;
  const disabledPassword = /Temporary app password: ([a-f0-9]+)/.exec(disabled.output)?.[1];
  assert.ok(disabledPassword);
  await setVisibility('private', disabledOrigin, disabled.port);
  const disabledStatus = await fetchWithHost(`${disabled.base}/api/status`, {
    headers: { Host: new URL(disabledOrigin).host,
      Authorization: `Basic ${Buffer.from(`bricklab:${disabledPassword}`).toString('base64')}` },
  });
  const disabledBody = await disabledStatus.json() as { copilot: boolean; planner: { state: string } };
  assert.equal(disabledBody.copilot, false, 'Codespace access alone does not enable model use');
  assert.equal(disabledBody.planner.state, 'off');
});

test('missing CLI is detected without submitting a brief', async t => {
  const bin = await mkdtemp(join(tmpdir(), 'bricklab-missing-cli-'));
  t.after(() => rm(bin, { recursive: true, force: true }));
  const { base } = await startServer(t, { PATH: bin });
  const status = await (await fetch(`${base}/api/status`)).json() as { copilot: boolean; calls: number; planner: { state: string; message: string } };
  assert.equal(status.copilot, false);
  assert.equal(status.calls, 0);
  assert.equal(status.planner.state, 'missing-cli');
  assert.match(status.planner.message, /npm install -g @github\/copilot/);
});

test('an explicit executable avoids PATH shims and detects a misleading installed command', posixExecutableFixtures, async t => {
  const bin = await mkdtemp(join(tmpdir(), 'bricklab-shim-test-'));
  t.after(() => rm(bin, { recursive: true, force: true }));
  const executable = join(bin, 'copilot native fixture');
  await writeFile(executable, '#!/usr/bin/env node\nconsole.error("GitHub Copilot CLI is not installed"); process.exit(1);\n', { mode: 0o700 });
  const { base } = await startServer(t, { BRICKLAB_COPILOT_BIN: executable });
  const getStatus = async () => await (await fetch(`${base}/api/status`)).json() as {
    copilot: boolean; calls: number; planner: { state: string; message: string };
  };
  const shim = await getStatus();
  assert.equal(shim.copilot, false);
  assert.equal(shim.planner.state, 'missing-cli');
  assert.match(shim.planner.message, /VS Code\/app sign-in is separate/);
  await writeFile(executable, '#!/usr/bin/env node\nconsole.log("1.0.0-fixture");\n', { mode: 0o700 });
  const installed = await getStatus();
  assert.equal(installed.copilot, true);
  assert.equal(installed.calls, 0);
  assert.match(installed.planner.message, /not yet verified/);
});

test('planner stays off without explicit model opt-in', async t => {
  const { base } = await startServer(t, { BRICKLAB_COPILOT: '0' });
  const status = await (await fetch(`${base}/api/status`)).json() as { sessionKey: string; copilot: boolean };
  assert.equal(status.copilot, false);
  const response = await fetch(`${base}/api/plan`, {
    method: 'POST', headers: { Origin: base, 'X-Bricklab-Key': status.sessionKey },
    body: JSON.stringify({ world: 'space', brief: 'A ship' }),
  });
  assert.equal(response.status, 403);
  assert.match((await response.json() as { error: string }).error, /BRICKLAB_COPILOT=1/);
});

test('Codespace mode rejects missing context, unsafe binding and development serving at startup', () => {
  const cases: [NodeJS.ProcessEnv, string[]][] = [
    [{ CODESPACES: 'false' }, ['--production']],
    [{ CODESPACE_NAME: '' }, ['--production']],
    [{ CODESPACE_NAME: 'name.attacker.example/path' }, ['--production']],
    [{ HOST: '0.0.0.0' }, ['--production']],
    [{ PORT: '0' }, ['--production']],
    [{}, []],
  ];
  for (const [extra, args] of cases) {
    const result = spawnSync(process.execPath, ['server.mjs', ...args], {
      env: { ...process.env, HOST: '127.0.0.1', PORT: '4173', BRICKLAB_CODESPACES: '1',
        CODESPACES: 'true', CODESPACE_NAME: 'test-codespace', ...extra },
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires a Codespace/);
  }
});
