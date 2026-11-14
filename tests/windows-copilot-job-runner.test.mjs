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

async function createRunner(t) {
  const tempRoot = await mkdtemp(join(tmpdir(), 'bricklab-job-test-'));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const runner = createWindowsCopilotJobRunner({ tempRoot });
  const run = (args, options = {}) => runner.run({
    executable: process.execPath,
    args,
    cwd: process.cwd(),
    image,
    imageConsent: true,
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
