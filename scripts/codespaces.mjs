import { spawn, execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, lstat, open, readFile, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline/promises';
import { request } from 'node:http';

const script = fileURLToPath(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const exec = promisify(execFile);
const cliVersion = '1.0.112';
const versionArgs = ['--version', '--no-auto-update', '--disable-client-telemetry'];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export function configuration(env = process.env, workspace = root, home = homedir()) {
  const port = Number(env.PORT || 4173);
  if (env.CODESPACES !== 'true' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(env.CODESPACE_NAME || '')
      || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Run inside your Codespace with a valid CODESPACE_NAME and PORT.');
  const key = createHash('sha256').update(`${resolve(workspace)}:${port}`).digest('hex').slice(0, 20);
  return { port, workspace, state: join(home, '.local', 'state', `bricklab-${key}`),
    env: { ...env, HOST: '127.0.0.1', PORT: String(port), BRICKLAB_CODESPACES: '1',
      BRICKLAB_COPILOT: '1', BRICKLAB_CODESPACES_STARTUP: '1' } };
}

async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()
      || (process.platform !== 'win32' && ((stat.mode & 0o077) || stat.uid !== process.getuid())))
    throw new Error('Startup state directory must be owned by you and accessible only to you (0700).');
}

async function save(config, name, value) {
  const path = join(config.state, name);
  const temp = `${path}.${randomUUID()}.tmp`;
  const file = await open(temp, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value)); } finally { await file.close(); }
  try {
    for (let attempt = 0; ; attempt++) {
      try { await rename(temp, path); break; }
      catch (error) {
        // Windows fixture readers/scanners can briefly hold the rename target open.
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt === 10)
          throw error;
        await delay(50);
      }
    }
  }
  finally { await rm(temp, { force: true }); }
}

async function load(config, name) {
  try { return JSON.parse(await readFile(join(config.state, name), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function assertPortFree(port) {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', () => reject(new Error('Port is occupied or unavailable. No existing process was stopped.')));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}

async function command(config, file, args, timeout) {
  try {
    await exec(file, args, { cwd: config.workspace, env: config.env, timeout, maxBuffer: 8 * 1024 * 1024 });
  } catch (error) {
    // The worker's stderr goes only to its owner-only diagnostic log.
    console.error(error.stdout || '', error.stderr || '', `Command failed (${error.code || 'unknown'}).`);
    throw error;
  }
}

// Called only under flock. The lock lasts through installation, build and server lifetime.
export async function serve(config, { run = command, launch = spawn, checkPort = assertPortFree } = {}) {
  await privateDirectory(config.state);
  let phase = 'checking-port';
  const status = (state, extra = {}) => save(config, 'status.json', { state, phase, ...extra });
  try {
    await rm(join(config.state, 'session.json'), { force: true });
    await status('starting');
    await checkPort(config.port);
    phase = 'installing-dependencies';
    await status('starting');
    await run(config, 'npm', ['ci', '--no-audit', '--no-fund'], 600_000);
    phase = 'checking-copilot-cli';
    await status('starting');
    try {
      await run(config, config.env.BRICKLAB_COPILOT_BIN || 'copilot', versionArgs, 15_000);
    } catch (error) {
      // Do not replace a broken/existing executable or a user-selected installation.
      if (error.code !== 'ENOENT' || config.env.BRICKLAB_COPILOT_BIN) throw error;
      phase = 'installing-copilot-cli';
      await status('starting');
      await run(config, 'npm', ['install', '-g', `@github/copilot@${cliVersion}`, '--no-audit', '--no-fund'], 300_000);
      await run(config, 'copilot', versionArgs, 15_000);
    }
    phase = 'building';
    await status('starting');
    await run(config, 'npm', ['run', 'build'], 600_000);
    phase = 'starting-server';
    await status('starting');
    const child = launch(process.execPath, [join(config.workspace, 'server.mjs'), '--production'], {
      cwd: config.workspace, env: config.env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    await new Promise((_resolve, reject) => {
      let failed = false;
      const timer = setTimeout(() => {
        failed = true;
        // This is only the new child we just launched, never a pre-existing server.
        child.kill('SIGKILL');
        reject(new Error('Server did not confirm listening. Inspect private startup state.'));
      }, 30_000);
      let writes = Promise.resolve();
      child.on('message', message => {
        if (failed || message?.type !== 'bricklab-listening' || message.port !== config.port
            || typeof message.password !== 'string') return;
        writes = writes.then(async () => {
          await save(config, 'session.json', { password: message.password, pid: child.pid });
          phase = 'server-listening';
          await status('listening', { pid: child.pid });
          clearTimeout(timer);
        });
        writes.catch(error => {
          failed = true;
          clearTimeout(timer);
          child.kill('SIGKILL');
          reject(error);
        });
      });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => {
        clearTimeout(timer);
        writes.then(() => reject(new Error('Server exited. No automatic restart or process replacement was attempted.')), reject);
      });
    });
  } catch {
    // Never copy raw npm/CLI errors, tokens, or server output into lifecycle/task output.
    await status('failed');
    throw new Error(`BrickLab failed during ${phase}. Run npm run codespace:status in your private terminal.`);
  }
}

export async function start(config, { launch = spawn } = {}) {
  await privateDirectory(config.state);
  // The protected directory prevents other users from planting symlinks for these files.
  const log = await open(join(config.state, 'startup.log'), 'a', 0o600);
  const lock = await open(join(config.state, 'startup.lock'), 'a', 0o600);
  await lock.close();
  try {
    const child = launch('flock', ['--nonblock', '--conflict-exit-code', '75', '--no-fork',
      join(config.state, 'startup.lock'), process.execPath, script, 'serve'], {
      cwd: config.workspace, env: config.env, detached: true,
      stdio: ['ignore', log.fd, log.fd],
    });
    await new Promise((resolve, reject) => {
      child.once('error', () => reject(new Error('Cannot launch startup worker. Linux util-linux flock is required.')));
      child.once('spawn', resolve);
    });
    // Catch immediate flock failures without waiting for dependency installation/build.
    const code = await Promise.race([
      new Promise(resolve => child.once('exit', code => resolve(code))),
      delay(500).then(() => null),
    ]);
    child.unref();
    if (code !== null && code !== 75 && code !== 0)
      throw new Error('Startup worker failed. Run npm run codespace:status in your private terminal.');
    console.log('BrickLab startup queued or already running. Open the BrickLab Codespace terminal task, or run npm run codespace:connect. Login and app password are never printed here.');
  } finally { await log.close(); }
}

export async function report(config) {
  const state = await load(config, 'status.json');
  console.log(state ? `BrickLab: ${state.state} (${state.phase}).` : 'No startup state. Run npm run codespace:start.');
  if (state?.state === 'listening') {
    try {
      const result = await probeSession(config, state);
      console.log(result.privatePortVerified ? 'Live private-port check passed; Copilot access remains unverified.'
        : 'Live server found, but private-port verification FAILED; browser access stays denied.');
    }
    catch { console.log('Live session not confirmed. Saved listening state may be stale; run npm run codespace:connect.'); }
  }
  console.log(`Private diagnostics: ${join(config.state, 'startup.log')}. Do not share raw logs.`);
  return state;
}

export async function probeSession(config, state) {
  const session = await load(config, 'session.json');
  if (!session || session.pid !== state.pid)
    throw new Error('No matching server session. Run npm run codespace:status.');
  const code = await new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: config.port, path: '/api/status',
      headers: { Host: `${config.env.CODESPACE_NAME}-${config.port}.app.github.dev`,
        Authorization: `Basic ${Buffer.from(`bricklab:${session.password}`).toString('base64')}` },
      signal: AbortSignal.timeout(20_000),
    }, response => { response.resume(); resolve(response.statusCode); });
    req.once('error', () => reject(new Error('Server session is unreachable; no password displayed.')));
    req.end();
  });
  if (code !== 200 && code !== 503)
    throw new Error('Live authenticated session not confirmed. Inspect startup status; no password displayed.');
  return { session, privatePortVerified: code === 200 };
}

export async function offerLogin(config, { input = process.stdin, output = process.stdout, launch = spawn } = {}) {
  if (!input.isTTY || !output.isTTY) throw new Error('Copilot login requires an interactive private terminal.');
  console.log('Copilot credentials/access are not verified. Login can update stored credentials; skip if already signed in.');
  console.log('Token priority: COPILOT_GITHUB_TOKEN > GH_TOKEN > GITHUB_TOKEN > saved login > gh fallback.');
  console.log('Codespaces-injected GITHUB_TOKEN has a CLI exception for saved login; explicitly exported tokens still override it. No variables will be removed.');
  const readline = createInterface({ input, output });
  let answer;
  try { answer = await readline.question('Start GitHub Copilot device login now? [y/N] '); }
  finally { readline.close(); }
  if (!/^y(?:es)?$/i.test(answer.trim())) {
    console.log('Login skipped. To sign in later, rerun npm run codespace:connect or copilot login --device-code.');
    return;
  }
  await new Promise((resolve, reject) => {
    const child = launch(config.env.BRICKLAB_COPILOT_BIN || 'copilot', ['login', '--device-code'], {
      cwd: config.workspace, env: config.env, stdio: 'inherit',
    });
    child.once('error', () => reject(new Error('Copilot login could not start.')));
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('Copilot login failed or was cancelled. No readiness claimed.')));
  });
  console.log('Login command completed. Account, entitlement, policy and model access remain unverified until an explicit app submission; no model call was made here.');
}

export async function connect(config, { input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || !output.isTTY)
    throw new Error('An interactive private terminal is required. Run npm run codespace:connect there.');
  await start(config);
  console.log('Waiting for install/build/start (up to 30 minutes). Ctrl+C only closes this terminal helper.');
  let state;
  for (let attempt = 0; attempt < 1800; attempt++) {
    state = await load(config, 'status.json');
    if (state?.state === 'listening' || state?.state === 'failed') break;
    await delay(1000);
  }
  if (state?.state !== 'listening') {
    await report(config);
    throw new Error('Startup is not confirmed. Resolve the reported failure before retrying.');
  }
  const { session, privatePortVerified } = await probeSession(config, state);
  console.log(`Server listening (not proof of Copilot access). Keep port ${config.port} Private in Ports.`);
  console.log(privatePortVerified ? 'Private-port check passed for this request.'
    : 'Private-port verification FAILED. Browser access remains denied. Check Ports and gh access; run npm run codespace:status.');
  console.log(`Open https://${config.env.CODESPACE_NAME}-${config.port}.app.github.dev`);
  console.log(`App username: bricklab\nTemporary app password: ${session.password}\nPrivate terminal only: do not share, record, or paste this password or device codes into chat.`);
  console.log('Each authenticated request still verifies private port visibility. No model request has been made.');
  await offerLogin(config, { input, output });
}

if (process.argv[1] && resolve(process.argv[1]) === script
    && !(process.argv.includes('--if-codespace') && process.env.CODESPACES !== 'true')) {
  try {
    if (process.platform !== 'linux') throw new Error('Codespaces automation requires Linux inside your own Codespace.');
    const config = configuration();
    const action = process.argv[2];
    if (action === 'start') await start(config);
    else if (action === 'serve') await serve(config);
    else if (action === 'connect') await connect(config);
    else if (action === 'status') {
      const state = await report(config);
      if (!state || state.state === 'failed') process.exitCode = 1;
    }
    else throw new Error('Use start, connect or status.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
