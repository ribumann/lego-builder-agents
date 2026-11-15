import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep, isAbsolute } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { validateCustomSpec } from './src/custom-design.mjs';
import { planningPrompt } from './planning-prompt.mjs';
import { resolveSceneSize } from './src/scene-size.mjs';
import { readCopilotResponse, copilotAuthenticationFailed } from './copilot-output.mjs';
import { createLocalPlanner } from './local-planner.mjs';
import { createPlanningCapacity } from './planning-capacity.mjs';
import { createAzurePlanner } from './azure-planner.mjs';
import { createAzureAccessTokenVerifier, getAzureAuthConfig } from './azure-auth.mjs';
import { createAzureUsageGate } from './azure-usage.mjs';
import { createAzureBudgetGate, createAzurePrincipalKey } from './azure-budget.mjs';
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
if (hosted && process.env.BRICKLAB_AZURE_AI === '1')
  throw new Error('Hosted Azure planning is blocked pending a verified public edge with abuse and quota protections. Leave BRICKLAB_AZURE_AI off for public static/offline serving.');
if (hosted && process.env.BRICKLAB_COMPATIBLE_AI === '1')
  throw new Error('Compatible AI cannot be enabled in public hosted mode.');
const compatibleVisionEnabled = process.env.BRICKLAB_COMPATIBLE_VISION === '1';
const compatiblePlanner = createOpenAICompatiblePlanner(process.env.BRICKLAB_COMPATIBLE_AI === '1'
  ? { enabled: true, endpoint: process.env.BRICKLAB_COMPATIBLE_ENDPOINT,
    model: process.env.BRICKLAB_COMPATIBLE_MODEL, apiKey: process.env.BRICKLAB_COMPATIBLE_API_KEY,
    vision: compatibleVisionEnabled }
  : {});
const azureEnabled = process.env.BRICKLAB_AZURE_AI === '1';
const azureMonetaryBudget = hosted || process.env.BRICKLAB_AZURE_BUDGET === '1';
if (azureEnabled && !production) throw new Error('BRICKLAB_AZURE_AI=1 requires production serving.');
const azureAuthConfig = azureEnabled ? getAzureAuthConfig() : null;
const verifyAzureAccessToken = azureAuthConfig
  ? createAzureAccessTokenVerifier(azureAuthConfig) : null;
const azureLimit = process.env.BRICKLAB_AZURE_DAILY_CALLS === undefined
  ? 12 : Number(process.env.BRICKLAB_AZURE_DAILY_CALLS);
const planAzure = azureEnabled ? createAzurePlanner({
  endpoint: process.env.AZURE_OPENAI_ENDPOINT, deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
  contentFilterPolicy: process.env.BRICKLAB_AZURE_CONTENT_FILTER_POLICY,
}) : null;
const azureUsage = azureEnabled && !azureMonetaryBudget ? createAzureUsageGate({
  account: process.env.AZURE_STORAGE_ACCOUNT,
  container: process.env.BRICKLAB_AZURE_USAGE_CONTAINER,
  limit: azureLimit,
}) : null;
const azureBudget = azureEnabled && azureMonetaryBudget ? createAzureBudgetGate({
  account: process.env.AZURE_STORAGE_ACCOUNT,
  container: process.env.BRICKLAB_AZURE_BUDGET_CONTAINER,
  endpoint: process.env.AZURE_OPENAI_ENDPOINT,
  deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
  resourceId: process.env.AZURE_OPENAI_RESOURCE_ID,
  contentFilterPolicy: process.env.BRICKLAB_AZURE_CONTENT_FILTER_POLICY,
  dailyCallLimit: azureLimit,
  clientHashSecret: process.env.BRICKLAB_AZURE_CLIENT_HASH_KEY,
  requireClientKey: azureMonetaryBudget,
}) : null;
const azurePlannerStatus = azureEnabled
  ? { enabled: true, state: 'configured', message: `Azure planning, Entra sign-in and ${azureMonetaryBudget ? 'inference budget' : 'durable quota'} are configured, not verified. Only an explicit Azure planning request reserves ${azureMonetaryBudget ? 'budget' : 'quota'} and sends a brief. No retries or refunds.` }
  : { enabled: false, state: 'off', message: hosted
    ? 'Hosted Azure planning is blocked pending verified public edge protections. Only static/offline mode is available.'
    : 'Azure planning is off. Server configuration and BRICKLAB_AZURE_AI=1 are required to opt in.' };
const liveEnabled = !hosted && process.env.BRICKLAB_COPILOT === '1';
const planningCapacity = createPlanningCapacity({
  total: process.env.BRICKLAB_PLANNING_CONCURRENCY === undefined
    ? 8 : Number(process.env.BRICKLAB_PLANNING_CONCURRENCY),
  perProvider: process.env.BRICKLAB_PROVIDER_CONCURRENCY === undefined
    ? 2 : Number(process.env.BRICKLAB_PROVIDER_CONCURRENCY),
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
const copilotImagesEnabled = liveEnabled && process.platform === 'win32'
  && process.env.BRICKLAB_COPILOT_IMAGES === '1'
  && isAbsolute(copilotExecutable) && /\.exe$/i.test(copilotExecutable);
const windowsCopilotRunner = copilotImagesEnabled ? createWindowsCopilotJobRunner() : null;
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
const runFile = promisify(execFile);
const limit = Math.max(1, Math.min(100, Number(process.env.BRICKLAB_DAILY_CALLS) || 12));
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

function azureClientKey(principal) {
  try {
    return createAzurePrincipalKey({ secret: process.env.BRICKLAB_AZURE_CLIENT_HASH_KEY,
      tenantId: principal.tenantId, objectId: principal.objectId });
  } catch {
    return null;
  }
}

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
  try {
    const { stdout } = await runFile('gh', ['codespace', 'ports', '--codespace', codespaceName,
      '--json', 'sourcePort,visibility,browseUrl'], {
      timeout: 15_000, maxBuffer: 64_000, env: { ...process.env, GH_PROMPT_DISABLED: '1' },
    });
    const ports = JSON.parse(stdout);
    if (Array.isArray(ports) && ports.some(entry => entry?.sourcePort === port
        && entry.visibility === 'private' && entry.browseUrl === forwardedOrigin)) return;
  } catch {
    throw new Error('Cannot verify private port visibility. Check gh authentication and gh codespace ports in the Codespace terminal; access is denied.');
  }
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
  return plannerFailure?.state === 'needs-auth' ? plannerFailure
    : { state: 'ready', message: 'Copilot CLI is installed. Account authentication, subscription and live model access are not yet verified. Run copilot login in the server terminal if needed. Pressing Send brief to Copilot sends that brief; loading or selecting a mode sends none.' };
}

export function extractSpec(text, provider = 'Copilot') {
  const clean = text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  let parsed;
  try { parsed = JSON.parse(clean); }
  catch { throw new Error(`${provider} returned invalid JSON in its final response. No build was started and BrickLab did not retry. Revise the brief or explicitly choose offline templates.`); }
  if (parsed?.model !== 'custom')
    throw new Error(`${provider} returned a template or omitted custom geometry. An original custom design is required. No retry or template fallback was made.`);
  return validateCustomSpec(parsed);
}

const copilotArguments = prompt => ['-p', prompt, '--output-format=json', '--stream=off',
  '--available-tools=', '--disable-builtin-mcps', '--no-custom-instructions',
  '--no-ask-user', '--no-auto-update', '--disable-client-telemetry'];

function askCopilot(world, brief, signal, hollowInterior, target) {
  const workdir = resolve(root, '.agent-home');
  const prompt = planningPrompt(world, brief, hollowInterior, target);
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
        if (process.platform === 'win32') {
          // taskkill is the native tree-termination primitive; never use a shell or PATH lookup.
          execFile(resolve(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
            ['/PID', String(child.pid), '/T', '/F'], { timeout: 5000, windowsHide: true }, error => {
              if (error) {
                quarantinePlanning('Copilot process-tree termination could not be confirmed. Planning is locked; the server operator must verify cleanup before restarting.');
                return;
              }
              treeStopped = true;
              cleanup();
            });
        } else {
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
        stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
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
        if (code !== 0) {
          const authentication = /authenticat|not logged|login required|copilot login|unauthorized|401\b/i.test(stderr)
            || copilotAuthenticationFailed(stdout);
          console.error('Copilot planning failed, exit code:', code, authentication ? '(authentication)' : '');
          plannerFailure = authentication
            ? { state: 'needs-auth', message: 'Copilot reported an authentication failure. Run copilot login in the server terminal with a Copilot-enabled account, check token overrides and organization policy, then retry. BrickLab did not retry or fall back.' }
            : { state: 'unavailable', message: 'Copilot CLI failed. Check copilot --version, copilot login, network access, subscription and quota in the server terminal, or select local mode. BrickLab did not retry or fall back.' };
          finish(new Error(plannerFailure.message));
        } else {
          try { const spec = extractSpec(readCopilotResponse(stdout)); plannerFailure = null; finish(null, spec); }
          catch (error) { finish(new Error(`Could not read the Copilot plan: ${error.message}`)); }
        }
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
    // Host/Origin bounds are NOT authentication. Hosted mode is public static/offline only;
    // no principal or forwarded IP header establishes a trusted paid-planning boundary here.
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
    if (!allowedHosts.has(req.headers.host)
        || (req.headers.origin && !allowedOrigins.has(req.headers.origin)))
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
    let azurePrincipal;
    if (azureAI) {
      if (!verifyAzureAccessToken) return send(res, 503, { error: 'Azure sign-in is not configured; no model request was sent.' });
      try { azurePrincipal = await verifyAzureAccessToken(req.headers.authorization); }
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
      if (hosted && imageRequested)
        return send(res, 403, { error: 'Image planning is unavailable in hosted mode.' });
      if (azureAI && imageRequested)
        return send(res, 400, { error: 'Image input is not supported by Azure planning.' });
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
      const azureClient = azureAI && azureMonetaryBudget ? azureClientKey(azurePrincipal) : undefined;
      if (azureAI && azureMonetaryBudget && !azureClient)
        return send(res, 503, { error: 'Azure planning rate limits could not be verified; no model request was sent.' });
      if (copilotAI && image && !copilotImagesEnabled)
        return send(res, 503, { error: 'Copilot image planning is unavailable without verified process-tree containment. No image was sent.' });
      const today = new Date().toISOString().slice(0, 10);
      if (today !== day) { day = today; calls = 0; }
      if (planningQuarantined) return send(res, 429, { error: planningQuarantineMessage });
      if (copilotAI && calls >= limit) return send(res, 429, { error: `Session daily limit of ${limit} Copilot calls reached. Offline templates and configured Local AI are separate options.` });
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
      const respond = (code, body) => {
        clearTimeout(heartbeat);
        if (res.destroyed || res.writableEnded) return;
        if (streaming) res.end(JSON.stringify({ type: code === 200 ? 'result' : 'error', ...body }) + '\n');
        else send(res, code, body);
      };
      try {
        if (res.destroyed || controller.signal.aborted) return;
        if (copilotAI) copilotCall = ++calls;
        let spec;
        if (localAI) spec = extractSpec(await localPlanner.plan(planningPrompt(world, brief, hollowInterior, target), {
          image: body.image, imageConsent: body.imageConsent, signal: controller.signal,
        }), 'Local AI');
        else {
          deadline = setTimeout(() => controller.abort(Object.assign(
            new Error(`${azureAI ? 'Azure planning' : compatibleAI ? 'Compatible AI' : 'Copilot'} took longer than 300 seconds. BrickLab did not retry or fall back.`),
            { name: 'TimeoutError' })), 300_000);
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
          if (azureAI) {
            const work = (async () => {
              controller.signal.throwIfAborted();
              try { azureReservation = await (azureMonetaryBudget ? azureBudget : azureUsage).reserve({
                signal: controller.signal, ...(azureClient ? { clientKey: azureClient } : {}),
              }); }
              catch (error) {
                controller.signal.throwIfAborted();
                if (azureMonetaryBudget) {
                  const exhausted = error?.code === 'BUDGET_EXHAUSTED';
                  const requestLimit = error?.code === 'BUDGET_CALL_LIMIT';
                  const clientLimit = error?.code === 'BUDGET_CLIENT_LIMIT';
                  const windowClosed = error?.code === 'BUDGET_WINDOW_CLOSED';
                  throw Object.assign(new Error(exhausted ? 'The Azure daily inference budget is exhausted.'
                    : requestLimit ? 'The Azure daily planning request limit is exhausted.'
                    : clientLimit ? 'This client has reached the Azure daily planning limit.'
                    : windowClosed ? 'Azure planning is unavailable near the UTC day boundary.'
                    : 'Azure inference budget or pricing could not be verified; no model request was sent.'),
                  { statusCode: exhausted || requestLimit || clientLimit ? 429 : 503 });
                }
                const exhausted = error?.message === 'Azure daily planning limit reached.';
                throw Object.assign(new Error(exhausted ? 'Azure daily planning limit reached.'
                  : 'Azure planning usage could not be reserved; no model request was sent.'),
                { statusCode: exhausted ? 429 : 503 });
              }
              // A reservation that completes after cancellation must never start a late model call.
              controller.signal.throwIfAborted();
              const parsed = await planAzure({ prompt: planningPrompt(world, brief, hollowInterior, target), signal: controller.signal });
              controller.signal.throwIfAborted();
              if (parsed?.model !== 'custom')
                throw new Error('Azure returned a template or omitted custom geometry. An original custom design is required. No retry or template fallback was made.');
              return validateCustomSpec(parsed);
            })();
            // Hold this slot until the adapter actually settles, even if it ignores abort.
            finished = work.then(() => {}, () => {});
            spec = await Promise.race([work, interrupted.then(() => { throw controller.signal.reason; })]);
          } else if (compatibleAI) {
            const work = (async () => {
              const parsed = await compatiblePlanner.plan({ prompt: planningPrompt(world, brief, hollowInterior, target),
                image: body.image, imageConsent: body.imageConsent, signal: controller.signal });
              controller.signal.throwIfAborted();
              if (parsed?.model !== 'custom') throw new Error('Compatible AI returned a template or omitted custom geometry. No retry or template fallback was made.');
              return validateCustomSpec(parsed);
            })();
            finished = work.then(() => {}, () => {});
            spec = await Promise.race([work, interrupted.then(() => { throw controller.signal.reason; })]);
          } else if (image) {
            const work = (async () => {
              const workdir = resolve(root, '.agent-home');
              await mkdir(workdir, { recursive: true });
              controller.signal.throwIfAborted();
              let output;
              try {
                output = await windowsCopilotRunner.run({
                  executable: copilotExecutable,
                  args: copilotArguments(planningPrompt(world, brief, hollowInterior, target)),
                  cwd: workdir, image: body.image, imageConsent: body.imageConsent,
                  signal: controller.signal, timeoutMs: 300_000, maxOutputBytes: 1_048_576,
                });
              } catch (error) {
                if (error?.cleanupConfirmed !== true) quarantinePlanning();
                throw error;
              }
              if (output?.cleanupConfirmed !== true) {
                quarantinePlanning();
                throw new Error('Copilot image cleanup could not be confirmed.');
              }
              controller.signal.throwIfAborted();
              if (output.privateAclVerified !== true || output.exitCode !== 0
                  || typeof output.stdout !== 'string' || typeof output.stderr !== 'string'
                  || Buffer.byteLength(output.stdout) + Buffer.byteLength(output.stderr) > 1_048_576)
                throw new Error('Copilot image planning failed closed.');
              const parsed = extractSpec(readCopilotResponse(output.stdout));
              plannerFailure = null;
              return parsed;
            })();
            finished = work.then(() => {}, () => {});
            spec = await Promise.race([work, interrupted.then(() => { throw controller.signal.reason; })]);
          } else {
            const invocation = askCopilot(world, brief, controller.signal, hollowInterior, target);
            finished = invocation.finished;
            spec = await invocation.result;
          }
        }
        controller.signal.throwIfAborted();
        if (spec.world !== world) throw new Error('The planner chose the wrong world. No build was started.');
        respond(200, { spec, ...((azureAI && azureMonetaryBudget) || compatibleAI ? {}
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
          : image ? 'Image planning failed at the configured provider. Verify image support and server configuration; no image or brief content is included.'
            : safePlanningError(error) });
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
  console.log(`BrickLab: http://${host}:${port} | Copilot planning: ${liveEnabled ? 'opted in' : 'off'} | Daily calls per process: ${limit} (Copilot) | Local AI: ${localPlanner.status().state}`);
  if (hosted) console.warn('Hosted public static/offline mode only: all planning providers are disabled. Paid Azure planning is blocked pending a verified public edge. Deployment and platform protections have NOT been verified by this server.');
  if (codespaces) console.log(`Private Codespace: ${forwardedOrigin}\nApp username: bricklab\nTemporary app password: ${appPassword}\nKeep this password private. It changes on restart; GitHub port authentication is also required.`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); vite?.close().then(() => process.exit(0)); });
