import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { PassThrough } from 'node:stream';
import { configuration, assertPortFree, serve, start, probeSession, offerLogin, connect } from '../scripts/codespaces.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const env = { CODESPACES: 'true', CODESPACE_NAME: 'fixture-space', GH_TOKEN: 'private-token', GITHUB_TOKEN: 'other-private-token' };

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'bricklab-startup-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const config = configuration(env, undefined, home);
  await mkdir(config.state, { recursive: true, mode: 0o700 });
  return config;
}

async function state(config, expected) {
  for (let i = 0; i < 1000; i++) {
    let value;
    try { value = JSON.parse(await readFile(join(config.state, 'status.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (value?.state === expected) return value;
    await delay(10);
  }
  assert.fail(`Startup state never became ${expected}`);
}

test('Codespace configuration preserves token precedence and forces private production settings only', () => {
  const config = configuration({ ...env, HOST: '0.0.0.0', BRICKLAB_COPILOT: '0' });
  assert.equal(config.env.HOST, '127.0.0.1');
  assert.equal(config.env.BRICKLAB_COPILOT, '1');
  assert.equal(config.env.GH_TOKEN, env.GH_TOKEN);
  assert.equal(config.env.GITHUB_TOKEN, env.GITHUB_TOKEN);
  assert.equal(config.env.BRICKLAB_CODESPACES_STARTUP, '1');
  assert.notEqual(configuration(env, 'one').state, configuration(env, 'two').state);
  assert.notEqual(configuration(env).state, configuration({ ...env, PORT: '4174' }).state);
  for (const invalid of [{ CODESPACES: 'false' }, { CODESPACE_NAME: '../no' }, { PORT: '0' }])
    assert.throws(() => configuration({ ...env, ...invalid }));
});

test('occupied ports fail before install/build and no process is replaced', async t => {
  const config = await fixture(t);
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  config.port = server.address().port;
  await assert.rejects(assertPortFree(config.port), /occupied or unavailable/);
  await assert.rejects(serve(config, { run: () => assert.fail('No install allowed') }), /checking-port/);
  assert.equal((await state(config, 'failed')).phase, 'checking-port');
  assert.equal(server.listening, true);
});

test('startup installs a missing CLI, builds, persists private IPC credentials, and reports server exit', async t => {
  const config = await fixture(t);
  const calls = [];
  const child = new EventEmitter();
  child.pid = 123;
  let checked = false;
  const running = serve(config, { checkPort: async () => {}, run: async (_config, file, args) => {
    calls.push([file, ...args]);
    assert.equal(_config.env.GH_TOKEN, env.GH_TOKEN);
    if (file === 'copilot' && !checked) { checked = true; throw { code: 'ENOENT' }; }
  }, launch: (file, args, options) => {
    assert.equal(file, process.execPath);
    assert.equal(args.at(-1), '--production');
    assert.deepEqual(options.stdio, ['ignore', 'inherit', 'inherit', 'ipc']);
    queueMicrotask(() => child.emit('message', { type: 'bricklab-listening', port: config.port, password: 'private-app-password' }));
    return child;
  } });
  const completion = assert.rejects(running, /server-listening/);
  await state(config, 'listening');
  assert.deepEqual(calls, [
    ['npm', 'ci', '--no-audit', '--no-fund'], ['copilot', '--version', '--no-auto-update', '--disable-client-telemetry'],
    ['npm', 'install', '-g', '@github/copilot@1.0.112', '--no-audit', '--no-fund'],
    ['copilot', '--version', '--no-auto-update', '--disable-client-telemetry'], ['npm', 'run', 'build'],
  ]);
  assert.deepEqual(JSON.parse(await readFile(join(config.state, 'session.json'), 'utf8')),
    { password: 'private-app-password', pid: 123 });
  assert.doesNotMatch(await readFile(join(config.state, 'status.json'), 'utf8'), /password|token/);
  if (process.platform !== 'win32') {
    assert.equal((await stat(config.state)).mode & 0o777, 0o700);
    assert.equal((await stat(join(config.state, 'session.json'))).mode & 0o777, 0o600);
  }
  child.emit('exit', 1);
  await completion;
  assert.equal((await state(config, 'failed')).phase, 'server-listening');
});

test('install, CLI and build errors fail closed without leaking raw command errors or launching a server', async t => {
  for (const fail of ['ci', '--version', 'build']) {
    const config = await fixture(t);
    const running = serve(config, { checkPort: async () => {}, run: async (_config, _file, args) => {
      if (args.includes(fail)) throw new Error('private-token raw output');
      assert.ok(!args.includes('install'), 'An existing but broken CLI must not be overwritten');
    }, launch: () => assert.fail('No server after failed prerequisite') });
    await assert.rejects(running, error => /BrickLab failed during/.test(error.message) && !/private-token/.test(error.message));
    assert.equal((await state(config, 'failed')).state, 'failed');
  }
});

test('user-selected missing CLI is not replaced', async t => {
  const config = await fixture(t);
  config.env.BRICKLAB_COPILOT_BIN = join(config.workspace, 'missing-copilot');
  await assert.rejects(serve(config, { checkPort: async () => {}, run: async (_config, file) => {
    if (file !== 'npm') throw { code: 'ENOENT' };
  }, launch: () => assert.fail('No server') }), /checking-copilot-cli/);
});

test('detached starts use one kernel lock through exec and duplicate lock conflicts are harmless', async t => {
  const config = await fixture(t);
  await start(config, { launch: (file, args, options) => {
    assert.equal(file, 'flock');
    assert.deepEqual(args.slice(0, 4), ['--nonblock', '--conflict-exit-code', '75', '--no-fork']);
    assert.equal(args[4], join(config.state, 'startup.lock'));
    assert.equal(options.detached, true);
    assert.equal(options.stdio[0], 'ignore');
    assert.equal(options.stdio[1], options.stdio[2]);
    assert.equal(options.env.GH_TOKEN, env.GH_TOKEN);
    const child = new EventEmitter();
    child.unref = () => {};
    setImmediate(() => { child.emit('spawn'); setImmediate(() => child.emit('exit', 75)); });
    return child;
  } });
  await assert.rejects(start(config, { launch: () => {
    const child = new EventEmitter();
    setImmediate(() => child.emit('error', new Error('private raw error')));
    return child;
  } }), /flock is required/);
});

test('Linux hook/manual races hold a real flock, install/build once, and reconnect retains the same live server', {
  skip: process.platform !== 'linux' ? 'Real util-linux flock is exercised by Ubuntu CI, not this Windows host' : false,
}, async t => {
  const home = await mkdtemp(join(tmpdir(), 'bricklab-flock-'));
  const config = configuration(env, undefined, home);
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  config.port = reservation.address().port;
  config.env.PORT = String(config.port);
  config.env.BRICKLAB_GH_BIN = process.execPath;
  await new Promise(resolve => reservation.close(resolve));
  const harness = join(home, 'worker.mjs');
  const settings = join(home, 'fixture.json');
  const events = join(home, 'events.jsonl');
  await writeFile(settings, JSON.stringify(config), { mode: 0o600 });
  await writeFile(harness, `
import { serve } from ${JSON.stringify(new URL('../scripts/codespaces.mjs', import.meta.url).href)};
import { readFile, appendFile } from 'node:fs/promises';
const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
try {
  await serve(config, { run: async (_config, file, args) => {
    await appendFile(${JSON.stringify(events)}, JSON.stringify([file, ...args]) + '\\n');
    await new Promise(resolve => setTimeout(resolve, 50));
  } });
} catch { process.exitCode = 1; }
`);
  const workers = [];
  let ownedServer;
  t.after(async () => {
    if (ownedServer) {
      try { process.kill(ownedServer, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    for (const worker of workers) {
      if (worker.exitCode !== null || worker.signalCode !== null) continue;
      const closed = once(worker, 'close');
      worker.kill('SIGKILL');
      await closed;
    }
    await rm(home, { recursive: true, force: true });
  });
  const launch = (file, args, options) => {
    // Keep actual flock/spawn/serve/server IPC; replace only install/build with a bounded fixture.
    const worker = spawn(file, [...args.slice(0, 6), harness, settings], options);
    workers.push(worker);
    return worker;
  };
  await Promise.all([start(config, { launch }), start(config, { launch }), start(config, { launch })]);
  const listening = await state(config, 'listening');
  ownedServer = listening.pid;
  const first = await probeSession(config, listening);
  assert.equal(first.privatePortVerified, false, 'The fixture must not claim live port verification');
  await start(config, { launch });
  const reconnected = await probeSession(config, await state(config, 'listening'));
  assert.deepEqual(reconnected.session, first.session);
  assert.deepEqual((await readFile(events, 'utf8')).trim().split('\n').map(line => JSON.parse(line)), [
    ['npm', 'ci', '--no-audit', '--no-fund'], ['copilot', '--version', '--no-auto-update', '--disable-client-telemetry'], ['npm', 'run', 'build'],
  ]);
  const logs = await readFile(join(config.state, 'startup.log'), 'utf8');
  assert.doesNotMatch(logs, /Temporary app password|private-token|other-private-token/);
  assert.ok(!logs.includes(first.session.password));
  for (const name of ['session.json', 'status.json', 'startup.log', 'startup.lock'])
    assert.equal((await stat(join(config.state, name))).mode & 0o777, 0o600);
});

test('a real isolated production child transfers its password over IPC, never stdout, and probes use that live session', async t => {
  const config = await fixture(t);
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  config.port = reservation.address().port;
  config.env.PORT = String(config.port);
  await new Promise(resolve => reservation.close(resolve));
  // Node is a deliberately invalid gh fixture: port inspection fails closed, without network or model calls.
  Object.assign(config.env, { ...process.env, ...config.env, BRICKLAB_GH_BIN: process.execPath,
    BRICKLAB_HOSTED: '0', BRICKLAB_LOCAL_AI: '0', BRICKLAB_AZURE_AI: '0', BRICKLAB_COMPATIBLE_AI: '0' });
  let child;
  let output = '';
  const running = serve(config, { run: async () => {}, launch: (file, args, options) => {
    child = spawn(file, args, { ...options, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
    return child;
  } });
  const completion = assert.rejects(running, /server-listening/);
  const listening = await state(config, 'listening');
  const result = await probeSession(config, listening);
  assert.equal(result.privatePortVerified, false);
  assert.equal(result.session.password.length, 48);
  assert.doesNotMatch(output, /Temporary app password/);
  assert.ok(!output.includes(result.session.password));
  await writeFile(join(config.state, 'session.json'), JSON.stringify({ ...result.session, password: 'stale-password' }));
  await assert.rejects(probeSession(config, listening), /not confirmed/);
  await assert.rejects(probeSession(config, { pid: -1 }), /No matching server/);
  child.kill('SIGTERM');
  await completion;
});

test('login is TTY-only, defaults to skip and preserves all token overrides when explicitly authorized', async t => {
  const config = await fixture(t);
  await assert.rejects(connect(config, { input: { isTTY: false }, output: { isTTY: false } }), /interactive/);
  await assert.rejects(offerLogin(config, { input: { isTTY: false }, output: { isTTY: false } }), /interactive/);
  for (const [answer, code] of [['', 0], ['y', 0], ['yes', 1]]) {
    const input = new PassThrough();
    const output = new PassThrough();
    input.isTTY = output.isTTY = true;
    let launched = false;
    const result = offerLogin(config, { input, output, launch: (file, args, options) => {
      launched = true;
      assert.equal(file, 'copilot');
      assert.deepEqual(args, ['login', '--device-code']);
      assert.equal(options.stdio, 'inherit');
      assert.equal(options.env.GH_TOKEN, env.GH_TOKEN);
      assert.equal(options.env.GITHUB_TOKEN, env.GITHUB_TOKEN);
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', code));
      return child;
    } });
    const completion = code ? assert.rejects(result, /failed or was cancelled/) : result;
    setImmediate(() => input.write(`${answer}\n`));
    await completion;
    assert.equal(launched, Boolean(answer));
    input.destroy();
    output.destroy();
  }
});
