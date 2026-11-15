import { spawn } from 'node:child_process';
import { lstatSync, readlinkSync, writeFileSync } from 'node:fs';
import { access, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, win32 } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { validatePlanningImage } from '../planning-image.mjs';

export const MAX_COPILOT_JOB_OUTPUT_BYTES = 1_048_576;
export const MAX_COPILOT_JOB_DURATION_MS = 300_000;

const HOST_SCRIPT = fileURLToPath(new URL('../scripts/windows-copilot-job-host.ps1', import.meta.url));
const RESULT_PREFIX = 'BRICKLAB_JOB_RESULT:';
const MAX_PROTOCOL_BYTES = 2_500_000;

const failure = (message, cleanupConfirmed = false) => Object.assign(new Error(message), { cleanupConfirmed });
const invalid = () => failure('Copilot planning request is invalid.', true);
const unsupported = () => failure('Copilot planning requires verified Windows process containment.', true);

function validateOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)
      || Object.keys(options).some(key => ![
        'executable', 'args', 'cwd', 'image', 'imageConsent', 'signal', 'timeoutMs', 'maxOutputBytes',
      ].includes(key)))
    throw invalid();
  const {
    executable, args, cwd, image, imageConsent, signal,
    timeoutMs = 120_000, maxOutputBytes = MAX_COPILOT_JOB_OUTPUT_BYTES,
  } = options;
  if (typeof executable !== 'string' || !isAbsolute(executable) || !executable.toLowerCase().endsWith('.exe')
      || typeof cwd !== 'string' || !isAbsolute(cwd)
      || !Array.isArray(args) || args.length > 128
      || args.some(arg => typeof arg !== 'string' || arg.includes('\0') || Buffer.byteLength(arg, 'utf8') > 8192)
      || args.reduce((total, arg) => total + Buffer.byteLength(arg, 'utf8'), 0) > 16_000
      || (signal !== undefined && !(signal instanceof AbortSignal))
      || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_COPILOT_JOB_DURATION_MS
      || !Number.isInteger(maxOutputBytes) || maxOutputBytes < 1024
      || maxOutputBytes > MAX_COPILOT_JOB_OUTPUT_BYTES)
    throw invalid();
  let validatedImage;
  try { validatedImage = validatePlanningImage(image, imageConsent); }
  catch { throw invalid(); }
  return { executable, args, cwd, signal, timeoutMs, maxOutputBytes, image: validatedImage };
}

function decodeResult(stdout) {
  const lines = stdout.split(/\r?\n/).filter(line => line.startsWith(RESULT_PREFIX));
  if (lines.length !== 1) throw new Error('Copilot process cleanup could not be confirmed.');
  try {
    return JSON.parse(Buffer.from(lines[0].slice(RESULT_PREFIX.length), 'base64').toString('utf8'));
  } catch {
    throw new Error('Copilot process cleanup could not be confirmed.');
  }
}

function findTrustedPowerShell() {
  const localAppData = process.env.LOCALAPPDATA;
  const programFiles = process.env.ProgramFiles;
  if (typeof localAppData !== 'string' || !win32.isAbsolute(localAppData)
      || typeof programFiles !== 'string' || !win32.isAbsolute(programFiles))
    throw failure('Windows Copilot process containment is unavailable.', true);
  // Resolve the registered Microsoft app alias instead of trusting PATH lookup.
  const alias = win32.join(localAppData, 'Microsoft', 'WindowsApps',
    'Microsoft.PowerShell_8wekyb3d8bbwe', 'pwsh.exe');
  let executable;
  try {
    if (!lstatSync(alias).isSymbolicLink()) throw new Error();
    executable = win32.resolve(readlinkSync(alias));
  } catch {
    throw failure('A trusted PowerShell 7 runtime is unavailable.', true);
  }
  const packageDirectory = win32.dirname(executable);
  const packageName = win32.basename(packageDirectory);
  const windowsAppsRoot = `${win32.resolve(programFiles, 'WindowsApps')}${win32.sep}`;
  if (!win32.isAbsolute(executable) || win32.basename(executable).toLowerCase() !== 'pwsh.exe'
      || win32.basename(win32.dirname(packageDirectory)).toLowerCase() !== 'windowsapps'
      || !win32.resolve(executable).toLowerCase().startsWith(windowsAppsRoot.toLowerCase())
      || !/^Microsoft\.PowerShell_[\d.]+_(?:x86|x64|arm64|neutral)__8wekyb3d8bbwe$/i.test(packageName))
    throw failure('A trusted PowerShell 7 runtime is unavailable.', true);
  return executable;
}

export function createWindowsCopilotJobRunner({ tempRoot } = {}) {
  if (tempRoot !== undefined && (typeof tempRoot !== 'string' || !win32.isAbsolute(tempRoot)))
    throw new TypeError('Temporary root must be an absolute Windows path.');

  const run = async options => {
    if (process.platform !== 'win32') throw unsupported();
    const request = validateOptions(options);
    const cleanupLabel = request.image ? 'attachment cleanup' : 'process and temporary-storage cleanup';
    if (request.signal?.aborted) throw failure('Copilot planning was cancelled.', true);
    const root = tempRoot ?? tmpdir();
    const requestId = randomUUID().replaceAll('-', '');
    const directoryName = `bricklab-copilot-${requestId}`;
    const cancelSignalName = `bricklab-copilot-cancel-${requestId}.signal`;
    const cancelSignalPath = join(root, cancelSignalName);
    const probePath = join(root, `bricklab-copilot-probe-${requestId}`);
    let probeCreated = false;
    try { await Promise.all([access(HOST_SCRIPT), access(request.executable), access(request.cwd)]); }
    catch { throw failure('Windows Copilot process containment is unavailable.', true); }
    try {
      await access(root);
      await writeFile(probePath, '', { flag: 'wx', mode: 0o600 });
      probeCreated = true;
      await rm(probePath);
      probeCreated = false;
    } catch {
      if (probeCreated) {
        try { await rm(probePath, { force: true }); }
        catch { throw failure('Temporary storage cleanup could not be confirmed.'); }
      }
      throw failure('Private temporary storage is unavailable.', true);
    }

    const env = {
      ...process.env,
      COPILOT_ALLOW_ALL: 'false',
      COPILOT_PLUGIN_DIR_ONLY: 'true',
      TEMP: root,
      TMP: root,
    };

    const powerShell = findTrustedPowerShell();
    try { await access(powerShell); }
    catch { throw failure('A trusted PowerShell 7 runtime is unavailable.', true); }
    if (request.signal?.aborted) throw failure('Copilot planning was cancelled.', true);
    let child;
    try {
      child = spawn(powerShell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', HOST_SCRIPT], {
        cwd: request.cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      throw failure('Windows Copilot process containment is unavailable.', true);
    }

    return await new Promise((resolvePromise, reject) => {
      let output = '';
      let outputBytes = 0;
      let overflow = false;
      let settled = false;
      let cancelSent = false;
      let cancelSignalOwned = false;
      let cancelSignalError = false;
      let inputFailed = false;

      const cancel = () => {
        if (cancelSent) return;
        cancelSent = true;
        try {
          writeFileSync(cancelSignalPath, 'cancel', { flag: 'wx', mode: 0o600 });
          cancelSignalOwned = true;
        } catch (error) {
          if (error.code !== 'EEXIST') cancelSignalError = true;
        }
      };
      const onAbort = () => cancel();
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        request.signal?.removeEventListener('abort', onAbort);
        error ? reject(error) : resolvePromise(value);
      };

      child.stdout.on('data', chunk => {
        outputBytes += chunk.length;
        if (outputBytes <= MAX_PROTOCOL_BYTES) output += chunk.toString('utf8');
        else overflow = true;
      });
      child.stderr.on('data', () => {});
      child.stdin.on('error', () => { inputFailed = true; cancel(); });
      child.on('error', () => finish(failure('Windows Copilot process containment is unavailable.', !child.pid)));
      child.on('close', async () => {
        try { if (cancelSignalOwned) await rm(cancelSignalPath); }
        catch { finish(failure('Cancellation signal cleanup could not be confirmed.')); return; }
        if (overflow) {
          finish(failure('Copilot process cleanup could not be confirmed.'));
          return;
        }
        let result;
        try { result = decodeResult(output); }
        catch { finish(failure('Copilot process cleanup could not be confirmed.')); return; }
        if (result.cleanupConfirmed !== true) {
          finish(failure('Copilot process cleanup could not be confirmed.'));
          return;
        }
        if (result.status === 'cancelled') {
          finish(failure(`Copilot planning was cancelled; ${cleanupLabel} is confirmed.`, true));
          return;
        }
        if (request.signal?.aborted || cancelSignalError || inputFailed) {
          finish(failure(`Copilot cancellation could not be confirmed; ${cleanupLabel} is confirmed.`, true));
          return;
        }
        if (result.status === 'timeout') {
          finish(failure(`Copilot planning timed out; ${cleanupLabel} is confirmed.`, true));
          return;
        }
        if (result.status === 'output-limit') {
          finish(failure(`Copilot response exceeded its output limit; ${cleanupLabel} is confirmed.`, true));
          return;
        }
        if (result.ok !== true || result.privateAclVerified !== true
            || !Number.isInteger(result.exitCode)
            || typeof result.stdoutBase64 !== 'string' || typeof result.stderrBase64 !== 'string') {
          finish(failure('Windows Copilot process containment failed closed.', true));
          return;
        }
        const stdout = Buffer.from(result.stdoutBase64, 'base64').toString('utf8');
        const stderr = Buffer.from(result.stderrBase64, 'base64').toString('utf8');
        if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > request.maxOutputBytes) {
          finish(failure(`Copilot response exceeded its output limit; ${cleanupLabel} is confirmed.`, true));
          return;
        }
        finish(null, {
          exitCode: result.exitCode,
          stdout,
          stderr,
          cleanupConfirmed: true,
          privateAclVerified: true,
        });
      });

      request.signal?.addEventListener('abort', onAbort, { once: true });
      try {
        child.stdin.write(JSON.stringify({
          executable: request.executable,
          args: request.args,
          cwd: request.cwd,
          timeoutMs: request.timeoutMs,
          maxOutputBytes: request.maxOutputBytes,
          ...(request.image ? { imageMimeType: request.image.mimeType,
            imageBase64: request.image.bytes.toString('base64') } : {}),
          directoryName,
          cancelSignalName,
        }) + '\n');
        child.stdin.end();
      } catch {
        inputFailed = true;
        cancel();
      }
      if (request.signal?.aborted) cancel();
    });
  };

  return Object.freeze({ run });
}
