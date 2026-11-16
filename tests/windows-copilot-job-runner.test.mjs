import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createWindowsCopilotJobRunner } from '../src/windows-copilot-job-runner.mjs';

const imageBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);
const image = { mimeType: 'image/png', data: imageBytes.toString('base64') };
const windowsOnly = process.platform !== 'win32';

async function createRunner(t, withImage = true) {
  const tempRoot = await mkdtemp(join(tmpdir(), 'bricklab-job-test-'));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const runner = createWindowsCopilotJobRunner({ tempRoot });
  const run = (args, options = {}) => runner.run({
    executable: process.execPath,
    args,
    cwd: process.cwd(),
    ...(withImage ? { image, imageConsent: true } : {}),
    timeoutMs: 15_000,
    ...options,
  });
  return { tempRoot, run };
}

async function assertEmpty(path) {
  assert.deepEqual(await readdir(path), []);
}

async function assertProcessExited(pid) {
  for (let attempt = 0; attempt < 250; attempt++) {
    try { process.kill(pid, 0); }
    catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    await delay(20);
  }
  assert.fail(`Probe process ${pid} remained alive.`);
}

test('Windows job runner fails closed on unsupported platforms', { skip: !windowsOnly }, async () => {
  const runner = createWindowsCopilotJobRunner();
  await assert.rejects(runner.run({}), error =>
    /verified Windows process containment/.test(error.message) && error.cleanupConfirmed === true);
});

test('Windows host never modifies or removes an existing attachment directory', { skip: windowsOnly }, async t => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'bricklab-existing-job-test-'));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const directoryName = `bricklab-copilot-${'a'.repeat(32)}`;
  const existing = join(tempRoot, directoryName);
  await mkdir(existing);
  await writeFile(join(existing, 'marker.txt'), 'preserve synthetic fixture');
  const runtime = join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps',
    'Microsoft.PowerShell_8wekyb3d8bbwe', 'pwsh.exe');
  const hostScript = new URL('../scripts/windows-copilot-job-host.ps1', import.meta.url);
  const { fileURLToPath } = await import('node:url');
  const result = spawnSync(runtime, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', fileURLToPath(hostScript)], {
    encoding: 'utf8', timeout: 30_000, windowsHide: true,
    env: { ...process.env, TEMP: tempRoot, TMP: tempRoot },
    input: JSON.stringify({
      executable: process.execPath, args: ['-e', 'process.exit(51)', '--'], cwd: process.cwd(),
      timeoutMs: 1000, maxOutputBytes: 4096, imageMimeType: image.mimeType,
      imageBase64: image.data, directoryName,
      cancelSignalName: `bricklab-copilot-cancel-${'a'.repeat(32)}.signal`,
    }) + '\n',
  });
  assert.ifError(result.error);
  const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('BRICKLAB_JOB_RESULT:'));
  assert.ok(line, 'Host must report a structured result');
  const response = JSON.parse(Buffer.from(line.slice('BRICKLAB_JOB_RESULT:'.length), 'base64').toString('utf8'));
  assert.equal(response.ok, false);
  assert.equal(response.failureStage, 'create-directory');
  assert.equal(response.cleanupConfirmed, true);
  assert.deepEqual(await readdir(existing), ['marker.txt'], 'No attachment may be created in an existing path');
  assert.equal(await readFile(join(existing, 'marker.txt'), 'utf8'), 'preserve synthetic fixture');
});

test('Windows job contains detached descendants after their leader exits and verifies private storage',
  { skip: windowsOnly }, async t => {
    const { tempRoot, run } = await createRunner(t);
    const descendantMarker = join(tempRoot, 'descendant.done');
    const childScript = `const fs=require('node:fs');setTimeout(()=>fs.writeFileSync(${JSON.stringify(descendantMarker)},'done'),1300);`;
    const script = [
      "const fs = require('node:fs');",
      `const attachmentIndex = process.argv.indexOf('--attachment'); if (attachmentIndex < 0 || fs.readFileSync(process.argv[attachmentIndex + 1]).toString('base64') !== ${JSON.stringify(image.data)}) process.exit(51);`,
      "const { spawn } = require('node:child_process');",
      `const child = spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], { detached: true, stdio: 'ignore' });`,
      'child.unref();',
      "setTimeout(() => process.stdout.write('leader-exited'), 60);",
    ].join('');
    const started = Date.now();
    const result = await run(['-e', script, '--']);
    assert.ok(Date.now() - started >= 800);
    assert.equal(await readFile(descendantMarker, 'utf8'), 'done');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, 'leader-exited');
    assert.equal(result.cleanupConfirmed, true);
    assert.equal(result.privateAclVerified, true);
    assert.deepEqual((await readdir(tempRoot)), ['descendant.done']);
  });

test('Windows job cancellation kills the contained descendant and removes its attachment',
  { skip: windowsOnly }, async t => {
    const { tempRoot, run } = await createRunner(t);
    const marker = join(tempRoot, 'child.pid');
    const script = [
      "const fs = require('node:fs');",
      "const { spawn } = require('node:child_process');",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });",
      'child.unref();',
      `fs.writeFileSync(${JSON.stringify(marker)}, String(child.pid));`,
      'setInterval(() => {}, 1000);',
    ].join('');
    const controller = new AbortController();
    const pending = run(['-e', script, '--'], { signal: controller.signal });
    let childPid;
    for (let attempt = 0; attempt < 200; attempt++) {
      try { childPid = Number(await readFile(marker, 'utf8')); break; }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await delay(20);
      }
    }
    assert.ok(Number.isInteger(childPid) && childPid > 0, 'detached child started');
    controller.abort();
    await assert.rejects(pending, /cancelled; attachment cleanup is confirmed/);
    await assertProcessExited(childPid);
    assert.deepEqual((await readdir(tempRoot)).filter(name => name !== 'child.pid'), []);
  });

test('Windows job timeout kills its descendants and removes the attachment', { skip: windowsOnly }, async t => {
  const { tempRoot, run } = await createRunner(t);
  const marker = join(tempRoot, 'timeout-child.pid');
  const script = [
    "const fs = require('node:fs');",
    "const { spawn } = require('node:child_process');",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });",
    'child.unref();',
    `fs.writeFileSync(${JSON.stringify(marker)}, String(child.pid));`,
    'setInterval(() => {}, 1000);',
  ].join('');
  await assert.rejects(
    run(['-e', script, '--'], { timeoutMs: 1200 }),
    /timed out; attachment cleanup is confirmed/,
  );
  const childPid = Number(await readFile(marker, 'utf8'));
  await assertProcessExited(childPid);
  assert.deepEqual((await readdir(tempRoot)).filter(name => name !== 'timeout-child.pid'), []);
});

test('Windows text jobs contain detached descendants after leader exit on completion, cancellation and timeout',
  { skip: windowsOnly, timeout: 30_000 }, async t => {
    for (const outcome of ['complete', 'cancel', 'timeout']) await t.test(outcome, async t => {
      const { tempRoot, run } = await createRunner(t, false);
      const marker = join(tempRoot, 'text-tree.json');
      const prompt = 'Synthetic "quoted brief" with spaces and a trailing \\';
      const childScript = outcome === 'complete' ? 'setTimeout(() => {}, 700)' : 'setInterval(() => {}, 1000)';
      const script = `
        const fs = require('node:fs');
        const child = require('node:child_process').spawn(process.execPath,
          ['-e', ${JSON.stringify(childScript)}], { detached: true, stdio: 'ignore' });
        child.unref();
        fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ leader: process.pid, child: child.pid }));
        process.stdout.write(JSON.stringify({ args: process.argv.slice(1),
          allowAll: process.env.COPILOT_ALLOW_ALL, pluginsOnly: process.env.COPILOT_PLUGIN_DIR_ONLY }));
      `;
      const controller = new AbortController();
      const work = run(['-e', script, '--', prompt], { signal: controller.signal, timeoutMs: 1500 });
      const terminal = outcome === 'complete' ? work : assert.rejects(work, error =>
        error.cleanupConfirmed === true && (outcome === 'cancel' ? /cancelled/ : /timed out/).test(error.message));
      let tree;
      for (let attempt = 0; attempt < 250; attempt++) {
        try { tree = JSON.parse(await readFile(marker, 'utf8')); break; }
        catch (error) { if (error.code !== 'ENOENT') throw error; await delay(20); }
      }
      assert.ok(tree, 'Synthetic text leader and detached child started inside the job');
      await assertProcessExited(tree.leader);
      if (outcome === 'cancel') controller.abort();
      const result = await terminal;
      await assertProcessExited(tree.child);
      if (outcome === 'complete') {
        assert.equal(result.cleanupConfirmed, true);
        assert.equal(result.privateAclVerified, true);
        assert.deepEqual(JSON.parse(result.stdout), { args: [prompt], allowAll: 'false', pluginsOnly: 'true' });
        assert.equal(result.stderr, '');
      }
      assert.deepEqual(await readdir(tempRoot), ['text-tree.json'], 'Text creates no image and removes its private job storage');
    });
  });

test('Windows text host loss kills its job but never claims confirmed cleanup', { skip: windowsOnly }, async t => {
  const { tempRoot, run } = await createRunner(t, false);
  const marker = join(tempRoot, 'text-host.json');
  const script = `require('node:fs').writeFileSync(${JSON.stringify(marker)},
    JSON.stringify({ host: process.ppid, child: process.pid })); setInterval(() => {}, 1000);`;
  const work = run(['-e', script, '--']);
  const failure = assert.rejects(work, error =>
    error.cleanupConfirmed === false && /cleanup could not be confirmed/.test(error.message));
  let tree;
  for (let attempt = 0; attempt < 250; attempt++) {
    try { tree = JSON.parse(await readFile(marker, 'utf8')); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; await delay(20); }
  }
  assert.ok(tree && tree.host > 0 && tree.host !== process.pid && tree.host !== tree.child);
  const runtime = join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps',
    'Microsoft.PowerShell_8wekyb3d8bbwe', 'pwsh.exe');
  const stopped = spawnSync(runtime, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    `Stop-Process -Id ${tree.host} -ErrorAction Stop`], { windowsHide: true, timeout: 10_000 });
  assert.ifError(stopped.error);
  assert.equal(stopped.status, 0, 'Only the identified synthetic job host was stopped');
  await failure;
  await assertProcessExited(tree.child);
});

test('concurrent Windows jobs isolate attachments and cancellation from another active job',
  { skip: windowsOnly, timeout: 20_000 }, async t => {
    const { tempRoot, run } = await createRunner(t);
    const marker = id => join(tempRoot, `${id}.json`);
    const gate = join(tempRoot, 'release-second');
    const script = id => `
      const fs = require('node:fs');
      const attachment = process.argv[process.argv.indexOf('--attachment') + 1];
      fs.writeFileSync(${JSON.stringify(marker(id))}, JSON.stringify({
        pid: process.pid, attachment, data: fs.readFileSync(attachment).toString('base64')
      }));
      const timer = setInterval(() => {
        if (fs.existsSync(${JSON.stringify(gate)})) {
          clearInterval(timer);
          process.stdout.write(${JSON.stringify(id)});
        }
      }, 20);
    `;
    const controller = new AbortController();
    // Observe the rejection immediately so a failed fixture cannot leave an unhandled promise.
    const first = run(['-e', script('first'), '--'], { signal: controller.signal });
    const firstFailure = assert.rejects(first, /cancelled; attachment cleanup is confirmed/);
    const second = run(['-e', script('second'), '--']);
    const readMarker = async id => {
      for (let attempt = 0; attempt < 250; attempt++) {
        try { return JSON.parse(await readFile(marker(id), 'utf8')); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          await delay(20);
        }
      }
      assert.fail('Both jobs must start before either is released.');
    };
    const [one, two] = await Promise.all([readMarker('first'), readMarker('second')]);
    assert.notEqual(one.attachment, two.attachment);
    assert.equal(one.data, image.data);
    assert.equal(two.data, image.data);
    controller.abort();
    await firstFailure;
    await assertProcessExited(one.pid);
    await assert.rejects(readFile(one.attachment), error => error.code === 'ENOENT');
    assert.equal((await readFile(two.attachment)).toString('base64'), image.data,
      'First cleanup cannot remove the other job attachment');
    process.kill(two.pid, 0);
    await writeFile(gate, 'release fixture');
    const result = await second;
    assert.equal(result.stdout, 'second');
    assert.equal(result.cleanupConfirmed, true);
    assert.equal(result.privateAclVerified, true);
    await rm(marker('first'));
    await rm(marker('second'));
    await rm(gate);
    await assertEmpty(tempRoot);
  });

test('Windows job enforces aggregate output limits and confirms cleanup', { skip: windowsOnly }, async t => {
  const { tempRoot, run } = await createRunner(t);
  const script = "process.stdout.write(Buffer.alloc(2 * 1024 * 1024, 65));";
  await assert.rejects(
    run(['-e', script, '--'], { maxOutputBytes: 4096 }),
    /exceeded its output limit; attachment cleanup is confirmed/,
  );
  await assertEmpty(tempRoot);
});

test('Windows job fails closed when the private temp parent is not a directory', { skip: windowsOnly }, async t => {
  const parent = await mkdtemp(join(tmpdir(), 'bricklab-job-permission-test-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const blockedRoot = join(parent, 'not-a-directory');
  await writeFile(blockedRoot, 'synthetic');
  const runner = createWindowsCopilotJobRunner({ tempRoot: blockedRoot });
  await assert.rejects(runner.run({
    executable: process.execPath,
    args: ['-e', 'process.exit(0)', '--'],
    cwd: process.cwd(),
    image,
    imageConsent: true,
    timeoutMs: 5000,
  }), /Private temporary storage is unavailable/);
  assert.equal(await readFile(blockedRoot, 'utf8'), 'synthetic');
});
