import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep, isAbsolute } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { GeneratedDesignError, validateGeneratedDesign, designCorrectionPrompt, exhaustedDesignCorrection } from './generated-design.mjs';
import { planningPrompt } from './planning-prompt.mjs';
import { resolveSceneSize } from './src/scene-size.mjs';
import { readCopilotResponse, copilotAuthenticationFailed } from './copilot-output.mjs';
import { createLocalPlanner } from './local-planner.mjs';
import { createPlanningCapacity } from './planning-capacity.mjs';
import { createPlanningQuota } from './planning-quota.mjs';
import { createAzurePlanner, getAzurePlannerDiagnostic } from './azure-planner.mjs';
import { createAzureAccessTokenVerifier, getAzureAuthConfig } from './azure-auth.mjs';
import { createAzureUsageGate } from './azure-usage.mjs';
import { createOpenAICompatiblePlanner } from './openai-compatible-planner.mjs';
import { MAX_IMAGE_BYTES, validatePlanningImage } from './planning-image.mjs';
import { createWindowsCopilotJobRunner } from './src/windows-copilot-job-runner.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const production = process.argv.includes('--production');
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const hosted = process.env.BRICKLAB_HOSTED === '1';
const hostedOrigin = process.env.BRICKLAB_HOSTED_ORIGIN ?? 'https://bricklab.liberatetheinnerchild.net';
if (hosted) {
  let validOrigin = false;
  try {
    const url = new URL(hostedOrigin);
    const labels = url.hostname.split('.');
    validOrigin = url.protocol === 'https:' && url.origin === hostedOrigin && !url.port
      && !url.username && !url.password && !isIP(url.hostname) && labels.length >= 2
      && labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
      && !/^\d+$/.test(labels.at(-1));
  } catch { /* Invalid URL is rejected below. */ }
  if (!validOrigin) throw new Error('BRICKLAB_HOSTED_ORIGIN must be an exact HTTPS DNS origin without a port, path, credentials or trailing slash.');
}
if (hosted && (!production || process.env.BRICKLAB_CODESPACES === '1'
    || !Number.isInteger(port) || port < 1 || port > 65535))
  throw new Error('BRICKLAB_HOSTED=1 requires production, a valid PORT and no Codespace mode. Hosted mode serves public static/offline content only.');
if (hosted && process.env.BRICKLAB_COMPATIBLE_AI === '1')
  throw new Error('Compatible AI cannot be enabled in public hosted mode.');
const compatibleVisionEnabled = process.env.BRICKLAB_COMPATIBLE_VISION === '1';
const compatiblePlanner = createOpenAICompatiblePlanner(process.env.BRICKLAB_COMPATIBLE_AI === '1'
  ? { enabled: true, endpoint: process.env.BRICKLAB_COMPATIBLE_ENDPOINT,
    model: process.env.BRICKLAB_COMPATIBLE_MODEL, apiKey: process.env.BRICKLAB_COMPATIBLE_API_KEY,
    vision: compatibleVisionEnabled }
  : {});
const azureEnabled = process.env.BRICKLAB_AZURE_AI === '1';
const planningQuota = createPlanningQuota({ hosted });
if (azureEnabled && !production) throw new Error('BRICKLAB_AZURE_AI=1 requires production serving.');
const azureAuthConfig = azureEnabled && !hosted ? getAzureAuthConfig() : null;
const verifyAzureAccessToken = azureAuthConfig
  ? createAzureAccessTokenVerifier(azureAuthConfig) : null;
const planAzure = azureEnabled ? createAzurePlanner({
  endpoint: process.env.AZURE_OPENAI_ENDPOINT, deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
}) : null;
const azureUsage = azureEnabled && planningQuota.enabled ? createAzureUsageGate({
  account: process.env.AZURE_STORAGE_ACCOUNT,
  container: process.env.BRICKLAB_AZURE_BUDGET_CONTAINER || process.env.BRICKLAB_AZURE_USAGE_CONTAINER,
  ...(process.env.BRICKLAB_AZURE_BUDGET_CONTAINER ? { blobName: 'daily-budget.json' } : {}),
  limit: planningQuota.dailyCallLimit,
}) : null;
const azurePlannerStatus = azureEnabled
  ? { enabled: true, state: 'configured', authentication: hosted ? 'anonymous' : 'entra',
    message: `Azure planning uses the server managed identity.${hosted ? ' No visitor sign-in is required. Shared daily submission limits apply.' : ' Private Azure planning requires Entra sign-in.'} An explicit submission makes at most two model requests: one initial design and, only if invalid, one correction. No transport retries.` }
  : { enabled: false, state: 'off', message: hosted
    ? 'Azure planning is off; only static/offline mode is available.'
    : 'Azure planning is off. Server configuration and BRICKLAB_AZURE_AI=1 are required to opt in.' };
const liveEnabled = !hosted && process.env.BRICKLAB_COPILOT === '1';
const planningCapacity = createPlanningCapacity({
  total: process.env.BRICKLAB_PLANNING_CONCURRENCY === undefined
    ? hosted ? 20 : 8 : Number(process.env.BRICKLAB_PLANNING_CONCURRENCY),
  perProvider: process.env.BRICKLAB_PROVIDER_CONCURRENCY === undefined
    ? hosted ? 20 : 2 : Number(process.env.BRICKLAB_PROVIDER_CONCURRENCY),
});
const localPlanner = createLocalPlanner({
  enabled: !hosted && process.env.BRICKLAB_LOCAL_AI === '1',
  model: process.env.BRICKLAB_LOCAL_MODEL || '',
  url: process.env.BRICKLAB_LOCAL_URL,
  concurrency: planningCapacity.status().perProvider,
});
const copilotExecutable = process.env.BRICKLAB_COPILOT_BIN || 'copilot';
if (process.env.BRICKLAB_COPILOT_BIN
    && (!isAbsolute(copilotExecutable) || /\.(?:cmd|bat)$/i.test(copilotExecutable)))
  throw new Error('BRICKLAB_COPILOT_BIN must be an absolute path to the standalone Copilot executable (native .exe on Windows), not a shell script launcher.');
const copilotModel = liveEnabled ? process.env.BRICKLAB_COPILOT_MODEL : undefined;
if (copilotModel !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(copilotModel))
  throw new Error('BRICKLAB_COPILOT_MODEL must be a nonempty model identifier of at most 128 characters.');
const copilotImagesEnabled = liveEnabled && process.platform === 'win32'
  && process.env.BRICKLAB_COPILOT_IMAGES === '1'
  && isAbsolute(copilotExecutable) && /\.exe$/i.test(copilotExecutable);
const windowsCopilotRunner = liveEnabled && process.platform === 'win32'
  && isAbsolute(copilotExecutable) && /\.exe$/i.test(copilotExecutable)
  ? createWindowsCopilotJobRunner() : null;
const windowsContainmentMessage = 'Windows Copilot planning requires BRICKLAB_COPILOT_BIN to name an absolute native .exe and a trusted PowerShell 7 runtime for process containment. No brief was sent.';
let planningQuarantined = false;
const copilotImageLockMessage = 'Copilot image cleanup could not be confirmed. Planning is locked; the server operator must verify cleanup before restarting.';
let planningQuarantineMessage = copilotImageLockMessage;
const activeControllers = new Set();
function quarantinePlanning(message = copilotImageLockMessage) {
  if (planningQuarantined) return;
  planningQuarantined = true;
  planningQuarantineMessage = message;
  console.error(message);
  // Quarantine is independent of slot release; no late completion may unlock it
  // or send a new provider call after an ambiguous image cleanup.
  for (const controller of activeControllers)
    controller.abort(new Error(message));
}
const codespaces = process.env.BRICKLAB_CODESPACES === '1';
const codespaceName = process.env.CODESPACE_NAME;
if (codespaces && (!production || process.env.CODESPACES !== 'true'
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(codespaceName || '')
    || host !== '127.0.0.1' || !Number.isInteger(port) || port < 1 || port > 65535))
  throw new Error('BRICKLAB_CODESPACES=1 requires a Codespace, npm start, a valid PORT, and HOST=127.0.0.1.');
const forwardedOrigin = codespaces ? `https://${codespaceName}-${port}.app.github.dev` : null;
const allowedHosts = new Set(hosted ? [new URL(hostedOrigin).host] : codespaces
  ? [new URL(forwardedOrigin).host] : [`localhost:${port}`, `127.0.0.1:${port}`]);
const allowedOrigins = new Set(hosted ? [hostedOrigin] : codespaces
  ? [forwardedOrigin] : [`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
const appPassword = codespaces ? randomBytes(24).toString('hex') : null;
const appAuthorization = codespaces ? `Basic ${Buffer.from(`bricklab:${appPassword}`).toString('base64')}` : null;
const codespacesDiagnostics = codespaces && process.env.BRICKLAB_CODESPACES_DIAGNOSTICS === '1';
let diagnosticRequests = 0;
const runFile = promisify(execFile);
const limit = null;
const MAX_TEXT_BODY_BYTES = 4096;
const MAX_REQUEST_BODY_BYTES = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 16_384;
const sessionKey = randomBytes(24).toString('hex');
let day = new Date().toISOString().slice(0, 10);
let calls = 0;
let plannerFailure = null;
const vite = production ? null : await (await import('vite')).createServer({
  root, server: { middlewareMode: true }, appType: 'spa',
});
const send = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};
const sameSecret = (value, expected) => typeof value === 'string'
  && Buffer.byteLength(value) === Buffer.byteLength(expected)
  && timingSafeEqual(Buffer.from(value), Buffer.from(expected));
const sameToken = token => sameSecret(token, sessionKey);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

async function readPlanningBody(req) {
  const declared = req.headers['content-length'];
  if (declared !== undefined && Number(declared) > MAX_REQUEST_BODY_BYTES) {
    req.resume();
    throw new Error('Request too large.');
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.byteLength;
    if (bytes > MAX_REQUEST_BODY_BYTES) {
      req.resume();
      throw new Error('Request too large.');
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks, bytes);
  // Keep the ordinary text-only route at its historical small limit without
  // parsing large non-image bodies. The image field is validated after parse.
  if (bytes > MAX_TEXT_BODY_BYTES && !/"image"\s*:/.test(raw.toString('latin1')))
    throw new Error('Request too large.');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(raw); }
  catch { throw new SyntaxError('Request body is not valid UTF-8.'); }
  const body = JSON.parse(text);
  if (!isRecord(body)) throw new SyntaxError('Request body must be a JSON object.');
  if (bytes > MAX_TEXT_BODY_BYTES && !Object.hasOwn(body, 'image'))
    throw new Error('Request too large.');
  return body;
}

function safePlanningError(error) {
  let message = error instanceof Error ? error.message : 'Planning failed.';
  message = message.replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, '[image omitted]')
    .replace(/[A-Za-z0-9+/]{128,}={0,2}/g, '[payload omitted]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 512);
  return message || 'Planning failed.';
}

async function verifyPrivatePort() {
  let stdout;
  try {
    ({ stdout } = await runFile('gh', ['codespace', 'ports', '--codespace', codespaceName,
      '--json', 'sourcePort,visibility,browseUrl'], {
      timeout: 15_000, maxBuffer: 64_000, env: { ...process.env, GH_PROMPT_DISABLED: '1' },
    }));
  } catch (error) {
    const reason = error?.code === 'ENOENT' ? 'GitHub CLI (gh) was not found.'
      : error?.killed ? 'GitHub CLI timed out after 15 seconds.'
      : 'GitHub CLI failed; authentication, scope, connectivity or command errors may be responsible.';
    throw new Error(`${reason} Cannot verify private port visibility. Run the documented bounded checks in the Codespace terminal; access is denied.`);
  }
  let ports;
  try { ports = JSON.parse(stdout); }
  catch { throw new Error('GitHub CLI returned invalid port data; access is denied.'); }
  if (Array.isArray(ports) && ports.some(entry => entry?.sourcePort === port
      && entry.visibility === 'private' && entry.browseUrl === forwardedOrigin)) return;
  throw new Error(`Port ${port} must be forwarded with Private visibility and its expected HTTPS URL. Public and organization visibility are not supported.`);
}

const missingCliOutput = /not installed|not found|install (?:the )?(?:github )?copilot cli/i;
const missingCliStatus = { state: 'missing-cli', message: 'Copilot CLI is not installed or this command is only a shim. VS Code/app sign-in is separate. Run npm install -g @github/copilot and copilot login in the server terminal, then retry server status. On Windows, BRICKLAB_COPILOT_BIN can select the full native .exe path instead of a shim.' };
async function plannerStatus() {
  if (planningQuarantined) return { state: 'unavailable', message: planningQuarantineMessage };
  if (!liveEnabled) return { state: 'off', message: hosted ? 'Copilot CLI is disabled in hosted mode.'
    : 'Copilot is off. Install with npm install -g @github/copilot, run copilot login in the server terminal, then restart with BRICKLAB_COPILOT=1 (and BRICKLAB_CODESPACES=1 for the private Codespace browser URL).' };
  try {
    const { stdout, stderr } = await runFile(copilotExecutable,
      ['--version', '--no-auto-update', '--disable-client-telemetry'], { timeout: 5000, maxBuffer: 8000 });
    if (missingCliOutput.test(`${stdout}\n${stderr}`)) return missingCliStatus;
  } catch (error) {
    return error.code === 'ENOENT' || missingCliOutput.test(`${error.stdout || ''}\n${error.stderr || ''}`)
      ? missingCliStatus
      : { state: 'unavailable', message: 'Copilot CLI could not report its version. Check copilot --version and copilot login in the server terminal, then retry server status. No brief was sent.' };
  }
  if (process.platform === 'win32' && !windowsCopilotRunner)
    return { state: 'unavailable', message: windowsContainmentMessage };
  return plannerFailure?.state === 'needs-auth' ? plannerFailure
    : { state: 'ready', message: 'Copilot CLI is installed. Account authentication, subscription and live model access are not yet verified. Run copilot login in the server terminal if needed. Pressing Send brief to Copilot sends that brief; loading or selecting a mode sends none.' };
}

export function extractSpec(text, provider = 'Copilot') {
  const clean = text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  let parsed;
  try { parsed = JSON.parse(clean); }
  catch { throw new Error(`${provider} returned invalid JSON in its final response. No build was started and BrickLab did not retry. Revise the brief or explicitly choose offline templates.`); }
  return validateGeneratedDesign(parsed, undefined, provider);
}

const copilotArguments = prompt => ['-p', prompt, '--output-format=json', '--stream=off',
  '--available-tools=', '--disable-builtin-mcps', '--no-custom-instructions',
  '--no-ask-user', '--no-auto-update', '--disable-client-telemetry',
  ...(copilotModel === undefined ? [] : ['--model', copilotModel])];

function parseCopilotPlan(code, stdout, stderr) {
  if (code !== 0) {
    const authentication = /authenticat|not logged|login required|copilot login|unauthorized|401\b/i.test(stderr)
      || copilotAuthenticationFailed(stdout);
    console.error('Copilot planning failed, exit code:', code, authentication ? '(authentication)' : '');
    plannerFailure = authentication
      ? { state: 'needs-auth', message: 'Copilot reported an authentication failure. Run copilot login in the server terminal with a Copilot-enabled account, check token overrides and organization policy, then retry. BrickLab did not retry or fall back.' }
      : { state: 'unavailable', message: 'Copilot CLI failed. Check copilot --version, copilot login, network access, subscription and quota in the server terminal, or select local mode. BrickLab did not retry or fall back.' };
    throw new Error(plannerFailure.message);
  }
  try {
    const spec = extractSpec(readCopilotResponse(stdout));
    plannerFailure = null;
    return spec;
  } catch (error) {
    if (error instanceof GeneratedDesignError) throw error;
    throw new Error(`Could not read the Copilot plan: ${error.message}`);
  }
}

function askCopilot(prompt, signal) {
  const workdir = resolve(root, '.agent-home');
  let release;
  const finished = new Promise(resolvePromise => { release = resolvePromise; });
  const result = new Promise((resolvePromise, reject) => {
    let child;
    let stdout = '';
    let stderr = '';
    let settled = false;
    let closed = false;
    let stopping = false;
    let treeStopped = false;
    const cleanup = () => {
      if (child && (!closed || (stopping && !treeStopped))) return;
      signal.removeEventListener('abort', abort);
      release();
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      error ? reject(error) : resolvePromise(value);
    };
    const stopChild = error => {
      if (settled) return;
      if (child?.pid) {
        stopping = true;
        // A detached POSIX child leads its own process group, including CLI descendants.
        const killGroup = signalName => {
          try { process.kill(-child.pid, signalName); return true; }
          catch (error) {
            if (error.code === 'ESRCH') return true;
            console.error('Could not terminate Copilot process group.');
            quarantinePlanning('Copilot process-tree termination could not be confirmed. Planning is locked; the server operator must verify cleanup before restarting.');
            return false;
          }
        };
        if (error.name === 'TimeoutError') treeStopped = killGroup('SIGKILL');
        else {
          killGroup('SIGTERM');
          setTimeout(() => {
            // Kill the group even if its leader already exited but descendants ignored SIGTERM.
            treeStopped = killGroup('SIGKILL');
            cleanup();
          }, 2000);
        }
      }
      finish(error);
      cleanup();
    };
    const abort = () => stopChild(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    // Aborting during preparation must not start a late CLI invocation.
    mkdir(workdir, { recursive: true }).then(() => {
      if (settled) return;
      // No shell interpolation and no agent tools. Only the brief and fixed schema go to the model.
      child = spawn(copilotExecutable, copilotArguments(prompt), {
        cwd: workdir, env: { ...process.env, COPILOT_ALLOW_ALL: 'false', COPILOT_PLUGIN_DIR_ONLY: 'true' },
        stdio: ['ignore', 'pipe', 'pipe'], detached: true,
      });
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        if (settled) return;
        stdout += chunk;
        if (Buffer.byteLength(stdout) > 1_048_576) {
          stopChild(new Error('Copilot CLI event stream exceeded the size limit.'));
        }
      });
      child.stderr.on('data', chunk => { if (!settled) stderr = (stderr + chunk).slice(-2000); });
      child.on('error', () => {
        if (settled) return;
        plannerFailure = { state: 'missing-cli', message: 'Copilot CLI could not start. Run npm install -g @github/copilot and copilot login in the server terminal, or use local mode.' };
        finish(new Error(plannerFailure.message));
        closed = true;
        cleanup();
      });
      child.on('close', code => {
        closed = true;
        cleanup();
        if (settled) return;
        try { finish(null, parseCopilotPlan(code, stdout, stderr)); }
        catch (error) { finish(error); }
      });
    }).catch(error => { finish(error); cleanup(); });
  });
  // The HTTP result may finish at the deadline, but this slot remains held until cleanup.
  return { result, finished };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (hosted) {
    res.setHeader('Cache-Control', 'no-store');
    // Host/Origin checks are not visitor authentication. Public requests must
    // reserve the shared global budget; forwarded headers never establish identity.
    if (!allowedHosts.has(req.headers.host)
        || (req.headers.origin !== undefined && !allowedOrigins.has(req.headers.origin)))
      return send(res, 403, { error: 'Use the exact hosted HTTPS app host and origin.' });
  }
  // Never derive trusted origins from request or proxy headers.
  let url;
  try { url = new URL(req.url || '/', 'http://localhost'); }
  catch { return send(res, 400, { error: 'Invalid request URL.' }); }
  if (codespaces) {
    res.setHeader('Cache-Control', 'no-store');
    const acceptedHost = allowedHosts.has(req.headers.host);
    const acceptedOrigin = !req.headers.origin || allowedOrigins.has(req.headers.origin);
    if (codespacesDiagnostics && diagnosticRequests++ < 20) {
      const classify = (value, expected) => value === undefined ? 'absent'
        : value === expected ? 'expected' : 'other';
      console.error('Codespace request diagnostics:', JSON.stringify({
        requestKind: url.pathname.startsWith('/api/') ? 'api' : url.pathname === '/' ? 'navigation' : 'asset',
        access: !acceptedHost ? 'host-rejected' : !acceptedOrigin ? 'origin-rejected'
          : !sameSecret(req.headers.authorization, appAuthorization) ? 'app-auth-required' : 'private-port-check',
        host: [`localhost:${port}`, `127.0.0.1:${port}`].includes(req.headers.host)
          ? 'loopback' : classify(req.headers.host, new URL(forwardedOrigin).host),
        origin: classify(req.headers.origin, forwardedOrigin),
        forwardedHost: classify(req.headers['x-forwarded-host'], new URL(forwardedOrigin).host),
        forwardedProto: classify(req.headers['x-forwarded-proto'], 'https'),
        forwarded: req.headers.forwarded === undefined ? 'absent' : 'present',
      }));
    }
    if (!acceptedHost || !acceptedOrigin)
      return send(res, 403, { error: 'Use this Codespace port\'s exact HTTPS URL and origin.' });
    if (!sameSecret(req.headers.authorization, appAuthorization)) {
      res.setHeader('WWW-Authenticate', 'Basic realm="BrickLab private Codespace", charset="UTF-8"');
      return send(res, 401, { error: 'Sign in as bricklab with the temporary app password printed in the server terminal.' });
    }
    // Independent app authentication also protects against a visibility change after this check.
    try { await verifyPrivatePort(); }
    catch (error) { return send(res, 503, { error: error.message }); }
  }
  if (url.pathname.startsWith('/api/')) {
    if (!allowedHosts.has(req.headers.host)) return send(res, 403, { error: 'API is local-only. Open the app on localhost.' });
    if (req.method === 'POST' && !allowedOrigins.has(req.headers.origin))
      return send(res, 403, { error: 'API POST requests require this app\'s exact origin.' });
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const planner = await plannerStatus();
      return send(res, 200, { copilot: liveEnabled && !['missing-cli', 'unavailable'].includes(planner.state),
        calls, limit, sessionKey, mode: 'cloud-first', planner, localPlanner: localPlanner.status(),
        azurePlanner: azurePlannerStatus, compatiblePlanner: compatiblePlanner.status(), hosted,
        planningCapacity: { ...planningCapacity.status(), quarantined: planningQuarantined },
        planningQuota: hosted ? { ...planningQuota, dailyClientLimit: null } : planningQuota,
        ...(hosted && azureUsage ? { publicAllowance: await azureUsage.status() } : {}),
        azureImages: azureEnabled,
        copilotImages: copilotImagesEnabled && !planningQuarantined });
    }
    if (req.method === 'GET' && url.pathname === '/api/azure-auth-config') {
      if (!azureAuthConfig) return send(res, 404, { error: 'Azure sign-in is unavailable.' });
      if (req.headers.origin !== undefined && !allowedOrigins.has(req.headers.origin))
        return send(res, 403, { error: 'Use this app\'s exact origin.' });
      return send(res, 200, {
        tenantId: azureAuthConfig.tenantId,
        apiClientId: azureAuthConfig.apiClientId,
        clientId: azureAuthConfig.spaClientId,
        requiredScope: azureAuthConfig.requiredScope,
        scope: `api://${azureAuthConfig.apiClientId}/${azureAuthConfig.requiredScope}`,
      });
    }
    const localAI = url.pathname === '/api/local-plan';
    const azureAI = url.pathname === '/api/azure-plan';
    const compatibleAI = url.pathname === '/api/compatible-plan';
    const copilotAI = !localAI && !azureAI && !compatibleAI;
    if (req.method !== 'POST' || (copilotAI && url.pathname !== '/api/plan')) return send(res, 404, { error: 'Unknown API route.' });
    const origin = req.headers.origin;
    if (!origin || !allowedOrigins.has(origin)
        || !sameToken(req.headers['x-bricklab-key']))
      return send(res, 403, { error: 'Planning requests must come from this app with its exact origin and request token.' });
    if (azureAI && !azureEnabled) return send(res, 403, { error: azurePlannerStatus.message });
    if (azureAI && !hosted) {
      if (!verifyAzureAccessToken) return send(res, 503, { error: 'Azure sign-in is not configured; no model request was sent.' });
      try { await verifyAzureAccessToken(req.headers.authorization); }
      catch (error) {
        const statusCode = error?.statusCode === 403 ? 403 : 401;
        if (statusCode === 401)
          res.setHeader('WWW-Authenticate', 'Bearer realm="BrickLab Azure planner", error="invalid_token"');
        return send(res, statusCode, { error: statusCode === 403
          ? 'Azure access is not authorized for planning.'
          : 'A valid Azure access token is required; no model request was sent.' });
      }
    }
    if (planningQuarantined) {
      req.resume();
      return send(res, 429, { error: planningQuarantineMessage });
    }
    const provider = azureAI ? 'azure' : compatibleAI ? 'compatible' : localAI ? 'local' : 'copilot';
    const releaseCapacity = planningCapacity.acquire(provider);
    if (!releaseCapacity) {
      req.resume();
      return send(res, 429, { error: 'Planning capacity is shared across all clients of this server. This provider or the server is at capacity; wait for an active request to finish and retry.' });
    }
    // Reserve before reading a potentially large image body, and retain through
    // provider/process cleanup rather than only through the HTTP response.
    try {
      let body;
      try { body = await readPlanningBody(req); }
      catch (error) {
        if (error instanceof SyntaxError) return send(res, 400, { error: 'Request body must be valid JSON.' });
        if (error instanceof Error && error.message === 'Request too large.')
          return send(res, 413, { error: 'Request too large.' });
        return send(res, 400, { error: 'Could not read the planning request.' });
      }
      const imageRequested = Object.hasOwn(body, 'image') || body.imageConsent === true;
      if (hosted && imageRequested && !azureAI)
        return send(res, 403, { error: 'Image planning is unavailable in hosted mode.' });
      let image;
      try { image = validatePlanningImage(body.image, body.imageConsent); }
      catch (error) { return send(res, 400, { error: safePlanningError(error) }); }
      if (compatibleAI && image && !compatibleVisionEnabled)
        return send(res, 403, { error: 'Compatible AI image input requires the separate BRICKLAB_COMPATIBLE_VISION=1 opt-in.' });
      const { world, brief, hollowInterior = false, sceneSize } = body;
      if (!['jurassic', 'space'].includes(world) || typeof brief !== 'string' || !brief.trim() || brief.length > 1000
          || typeof hollowInterior !== 'boolean')
        return send(res, 400, { error: 'Use a valid world and a brief of 1-1,000 characters.' });
      let target;
      if (sceneSize !== undefined) {
        try { target = resolveSceneSize(brief, sceneSize).target; }
        catch (error) { return send(res, 400, { error: error.message }); }
      }
      if (azureAI ? !azureEnabled : compatibleAI ? !compatiblePlanner.status().enabled : localAI ? !localPlanner.status().enabled : !liveEnabled)
        return send(res, 403, { error: azureAI ? azurePlannerStatus.message
          : compatibleAI ? compatiblePlanner.status().message : localAI ? localPlanner.status().message : hosted ? 'Copilot CLI is disabled in hosted mode.'
          : 'Copilot mode is off. Restart with BRICKLAB_COPILOT=1 to opt in.' });
      if (copilotAI && image && !copilotImagesEnabled)
        return send(res, 503, { error: 'Copilot image planning is unavailable without verified process-tree containment. No image was sent.' });
      if (copilotAI && process.platform === 'win32' && !windowsCopilotRunner)
        return send(res, 503, { error: windowsContainmentMessage });
      const today = new Date().toISOString().slice(0, 10);
      if (today !== day) { day = today; calls = 0; }
      if (planningQuarantined) return send(res, 429, { error: planningQuarantineMessage });
      const controller = new AbortController();
      activeControllers.add(controller);
      const interrupted = new Promise(resolvePromise => controller.signal.addEventListener('abort', resolvePromise, { once: true }));
      const disconnect = () => {
        if (!res.writableEnded) controller.abort(new Error('Planning request was cancelled by the client.'));
      };
      res.once('close', disconnect);
      let deadline;
      let heartbeat;
      let streaming = false;
      let finished;
      let azureReservation;
      let copilotCall;
      let providerAttempts = 0;
      let correctionOutcome = 'not-attempted';
      const respond = (code, body) => {
        clearTimeout(heartbeat);
        if (res.destroyed || res.writableEnded) return;
        if (azureAI || providerAttempts > 1)
          body.designCorrection = { providerAttempts, attempted: providerAttempts > 1, outcome: correctionOutcome };
        if (streaming) res.end(JSON.stringify({ type: code === 200 ? 'result' : 'error', ...body }) + '\n');
        else send(res, code, body);
      };
      try {
        if (res.destroyed || controller.signal.aborted) return;
        if (copilotAI) copilotCall = ++calls;
        let spec;
        const originalPrompt = planningPrompt(world, brief, hollowInterior, target);
        let prompt = originalPrompt;
        const timeoutSeconds = localAI ? 90 : 300;
        deadline = setTimeout(() => controller.abort(Object.assign(
          new Error(`Planning took longer than ${timeoutSeconds} seconds. No transport retry or fallback was attempted.`),
          { name: 'TimeoutError' })), timeoutSeconds * 1000);
        {
          streaming = (req.headers.accept || '').split(',').some(entry => {
            const [type, ...parameters] = entry.split(';');
            return type.trim().toLowerCase() === 'application/x-ndjson'
              && !parameters.some(value => /^\s*q\s*=\s*0(?:\.0*)?\s*$/i.test(value));
          });
          if (streaming) {
            res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store',
              'X-Accel-Buffering': 'no' });
            res.flushHeaders();
            const waiting = () => {
              if (res.destroyed || res.writableEnded || controller.signal.aborted) return;
              // Never accumulate heartbeat data behind a slow or stalled client.
              if (!res.writableNeedDrain) res.write('{"type":"waiting"}\n');
              heartbeat = setTimeout(waiting, 15_000);
            };
            waiting();
          }
        }
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            controller.signal.throwIfAborted();
            if (!azureAI) providerAttempts++;
            if (providerAttempts === 2) correctionOutcome = 'failed';
            if (localAI) spec = extractSpec(await localPlanner.plan(prompt, {
              image: body.image, imageConsent: body.imageConsent, signal: controller.signal,
            }), 'Local AI');
            else if (azureAI) {
              const work = (async () => {
                controller.signal.throwIfAborted();
                try {
                  if (planningQuota.enabled && !azureReservation)
                    azureReservation = await azureUsage.reserve({ signal: controller.signal });
                }
                catch (error) {
                  controller.signal.throwIfAborted();
                  const exhausted = error?.message === 'Azure daily planning limit reached.';
                  throw Object.assign(new Error(exhausted ? 'Azure daily planning limit reached.'
                    : 'Azure planning usage could not be reserved; no model request was sent.'),
                  { statusCode: exhausted ? 429 : 503 });
                }
                // A reservation that completes after cancellation must never start a late model call.
                controller.signal.throwIfAborted();
                providerAttempts++;
                if (providerAttempts === 2) correctionOutcome = 'failed';
                const parsed = await planAzure({ prompt, world,
                  image: body.image, imageConsent: body.imageConsent, signal: controller.signal });
                controller.signal.throwIfAborted();
                return validateGeneratedDesign(parsed, world, 'Azure');
              })();
              // Hold this slot until the adapter actually settles, even if it ignores abort.
              finished = work.then(() => {}, () => {});
              spec = await Promise.race([work, interrupted.then(() => { throw controller.signal.reason; })]);
            } else if (compatibleAI) {
              const work = (async () => {
                const parsed = await compatiblePlanner.plan({ prompt,
                  image: body.image, imageConsent: body.imageConsent, signal: controller.signal });
                controller.signal.throwIfAborted();
                return validateGeneratedDesign(parsed, world, 'Compatible AI');
              })();
              finished = work.then(() => {}, () => {});
              spec = await Promise.race([work, interrupted.then(() => { throw controller.signal.reason; })]);
            } else if (image || process.platform === 'win32') {
              let cleanupUnconfirmed = false;
              const quarantine = () => {
                cleanupUnconfirmed = true;
                quarantinePlanning(image ? copilotImageLockMessage
                  : 'Copilot process-tree cleanup could not be confirmed. Planning is locked; the server operator must verify cleanup before restarting.');
              };
              const work = (async () => {
                const workdir = resolve(root, '.agent-home');
                await mkdir(workdir, { recursive: true });
                controller.signal.throwIfAborted();
                let output;
                try {
                  output = await windowsCopilotRunner.run({
                    executable: copilotExecutable,
                    args: copilotArguments(prompt),
                    cwd: workdir, ...(image ? { image: body.image, imageConsent: body.imageConsent } : {}),
                    signal: controller.signal, timeoutMs: 300_000, maxOutputBytes: 1_048_576,
                  });
                } catch (error) {
                  if (error?.cleanupConfirmed !== true) quarantine();
                  throw error;
                }
                if (output?.cleanupConfirmed !== true) {
                  quarantine();
                  throw new Error('Copilot process-tree cleanup could not be confirmed.');
                }
                controller.signal.throwIfAborted();
                if (output.privateAclVerified !== true || !Number.isInteger(output.exitCode)
                    || typeof output.stdout !== 'string' || typeof output.stderr !== 'string'
                    || Buffer.byteLength(output.stdout) + Buffer.byteLength(output.stderr) > 1_048_576)
                  throw new Error('Copilot planning failed closed.');
                return parseCopilotPlan(output.exitCode, output.stdout, output.stderr);
              })();
              // An ambiguous job remains charged to capacity until operator recovery;
              // another job's eventual cleanup cannot free or unquarantine it.
              finished = work.then(() => {}, () => cleanupUnconfirmed ? new Promise(() => {}) : undefined);
              spec = await Promise.race([work, interrupted.then(() => { throw controller.signal.reason; })]);
            } else {
              const invocation = askCopilot(prompt, controller.signal);
              finished = invocation.finished;
              spec = await invocation.result;
            }
            controller.signal.throwIfAborted();
            spec = validateGeneratedDesign(spec, world);
            if (providerAttempts === 2) correctionOutcome = 'succeeded';
            break;
          } catch (error) {
            if (controller.signal.aborted || !(error instanceof GeneratedDesignError)) throw error;
            if (attempt === 1) throw exhaustedDesignCorrection(error);
            // A second invocation must never overlap the first one's real cleanup.
            await Promise.race([finished, interrupted]);
            controller.signal.throwIfAborted();
            if (planningQuarantined) throw new Error(planningQuarantineMessage);
            prompt = designCorrectionPrompt(originalPrompt, error);
            if (streaming && !res.destroyed && !res.writableEnded && !res.writableNeedDrain)
              res.write('{"type":"correcting"}\n');
          }
        }
        respond(200, { spec, ...((azureAI && !planningQuota.enabled) || compatibleAI ? {}
          : { calls: azureAI ? azureReservation.used : copilotCall ?? calls, limit: azureAI ? azureReservation.limit : limit }),
        source: azureAI ? 'azure' : compatibleAI ? 'compatible' : localAI ? 'local-ai' : 'copilot' });
      } catch (error) {
        // Output-limit errors still wait for termination; cancellation/timeout never delays the HTTP result.
        if (!controller.signal.aborted) await Promise.race([finished, interrupted]);
        respond(error instanceof SyntaxError ? 400
          : controller.signal.reason?.name === 'TimeoutError' ? 504 : error?.statusCode === 429 ? 429
          : azureAI && error?.statusCode === 503 ? 503 : 502,
        { error: controller.signal.reason?.name === 'TimeoutError' ? controller.signal.reason.message
          : planningQuarantined ? planningQuarantineMessage
          : image && !(error instanceof GeneratedDesignError) ? 'Image planning failed at the configured provider. Verify image support and server configuration; no image or brief content is included.'
            : safePlanningError(error),
          ...(azureAI && getAzurePlannerDiagnostic(error) ? { providerDiagnostic: getAzurePlannerDiagnostic(error) } : {}),
        });
      } finally {
        clearTimeout(deadline);
        clearTimeout(heartbeat);
        res.removeListener('close', disconnect);
        await finished;
        activeControllers.delete(controller);
      }
      return;
    } finally {
      releaseCapacity();
    }
  }
  if (vite) return vite.middlewares(req, res);
  try {
    const pathname = decodeURIComponent(url.pathname);
    const dist = resolve(root, 'dist');
    let target = resolve(dist, `.${pathname}`);
    if (target !== dist && !target.startsWith(dist + sep)) { res.writeHead(403).end(); return; }
    if (!extname(pathname)) target = resolve(dist, 'index.html');
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
    const data = await readFile(target);
    res.writeHead(200, { 'Content-Type': mime[extname(target)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404).end('Not found'); }
});
server.listen(port, host, () => {
  console.log(`BrickLab: http://${host}:${port} | Copilot planning: ${liveEnabled ? 'opted in' : 'off'} | Daily calls per process: none (local/Codespaces) | Public Azure quota: ${planningQuota.enabled ? planningQuota.dailyCallLimit : 'off'} | Local AI: ${localPlanner.status().state}`);
  if (hosted) console.warn(`Hosted mode: ${azureEnabled ? 'anonymous Azure planning with a shared daily request allowance' : 'static/offline only; Azure planning is off'}.`);
  if (codespaces) console.log(`Private Codespace: ${forwardedOrigin}\nApp username: bricklab\nTemporary app password: ${appPassword}\nKeep this password private. It changes on restart; GitHub port authentication is also required.`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); vite?.close().then(() => process.exit(0)); });
