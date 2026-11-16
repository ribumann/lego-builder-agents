import { execFile } from 'node:child_process';
import { request } from 'node:http';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { isAbsolute } from 'node:path';

const exec = promisify(execFile);

function failure(error) {
  if (error?.code === 'ENOENT') return 'missing-cli';
  if (error?.killed) return 'timeout';
  const detail = String(error?.stderr ?? '');
  if (/codespace[^\n]*scope|scope[^\n]*codespace/i.test(detail)) return 'codespaces-scope-required';
  if (/HTTP 401|authentication|not logged/i.test(detail)) return 'authentication-required';
  if (/HTTP 403|HTTP 404/i.test(detail)) return 'access-denied';
  return 'command-or-network-failure';
}

function probe(port, headers) {
  return new Promise(resolve => {
    const req = request({
      hostname: '127.0.0.1', port, path: '/api/status', method: 'GET', headers,
    }, res => {
      res.resume();
      resolve(res.statusCode);
    });
    const timer = setTimeout(() => req.destroy(new Error('Probe timeout')), 2000);
    req.once('close', () => clearTimeout(timer));
    req.once('error', () => resolve('unreachable'));
    req.end();
  });
}

export async function diagnoseCodespaces({ env = process.env, run = exec, httpProbe = probe } = {}) {
  const name = env.CODESPACE_NAME;
  const port = Number(env.PORT || 4173);
  if (env.CODESPACES !== 'true' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name ?? '')
      || !Number.isInteger(port) || port < 1 || port > 65535)
    return { context: 'run-inside-codespace-with-valid-port' };
  const ghExecutable = env.BRICKLAB_GH_BIN ?? 'gh';
  if (env.BRICKLAB_GH_BIN !== undefined
      && (!isAbsolute(ghExecutable) || /\.(?:cmd|bat)$/i.test(ghExecutable)))
    return { context: 'invalid-github-cli-path' };

  const host = `${name}-${port}.app.github.dev`;
  const origin = `https://${host}`;
  const report = { context: 'codespace', github: 'not-checked', codespace: 'not-checked', ports: 'not-checked' };
  const options = {
    timeout: 15_000, maxBuffer: 64_000,
    env: { ...env, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1', GH_DEBUG: '', GH_PAGER: 'cat' },
  };
  try {
    await run(ghExecutable, ['api', '--hostname', 'github.com', 'user', '--silent'], options);
    report.github = 'reachable-and-authenticated';
  } catch (error) { report.github = failure(error); }
  if (report.github === 'reachable-and-authenticated') {
    try {
      await run(ghExecutable, ['api', '--hostname', 'github.com', `user/codespaces/${name}`, '--silent'], options);
      report.codespace = 'metadata-accessible';
    } catch (error) { report.codespace = failure(error); }
  }
  if (report.codespace === 'metadata-accessible') {
    try {
      const { stdout } = await run(ghExecutable, ['codespace', 'ports', '--codespace', name,
        '--json', 'sourcePort,visibility,browseUrl'], options);
      let ports;
      try { ports = JSON.parse(stdout); } catch { /* Report malformed CLI output below. */ }
      if (!Array.isArray(ports)) report.ports = 'invalid-cli-data';
      else {
        const entry = ports.find(entry => entry?.sourcePort === port);
        report.ports = !entry ? 'port-not-forwarded' : entry.browseUrl !== origin ? 'unexpected-port-url'
          : entry.visibility === 'private' ? 'verified-private'
          : ['public', 'org'].includes(entry.visibility) ? 'not-private' : 'unknown-visibility';
      }
    } catch (error) { report.ports = failure(error); }
  }
  report.http = {};
  for (const [label, headers] of [
    ['expectedHost', { Host: host }],
    ['expectedOrigin', { Host: host, Origin: origin }],
    ['foreignOrigin', { Host: host, Origin: 'https://diagnostic.invalid' }],
    ['spoofedForwarding', { Host: 'diagnostic.invalid', 'X-Forwarded-Host': host, 'X-Forwarded-Proto': 'https' }],
    ['loopbackHost', { Host: `127.0.0.1:${port}` }],
    ['proxyShape', { Host: `127.0.0.1:${port}`, 'X-Forwarded-Host': host, 'X-Forwarded-Proto': 'https' }],
    ['proxyRewrittenOrigin', { Host: `127.0.0.1:${port}`, 'X-Forwarded-Host': host,
      'X-Forwarded-Proto': 'https', Origin: `http://localhost:${port}` }],
    ['proxyForeignOrigin', { Host: `127.0.0.1:${port}`, 'X-Forwarded-Host': host,
      'X-Forwarded-Proto': 'https', Origin: 'https://diagnostic.invalid' }],
    ['proxyNullOrigin', { Host: `127.0.0.1:${port}`, 'X-Forwarded-Host': host,
      'X-Forwarded-Proto': 'https', Origin: 'null' }],
  ]) report.http[label] = await httpProbe(port, headers);
  report.server = report.http.expectedHost === 401 && report.http.expectedOrigin === 401
    && report.http.foreignOrigin === 403 && report.http.spoofedForwarding === 403
    && report.http.loopbackHost === 403 && report.http.proxyShape === 401
    && report.http.proxyRewrittenOrigin === 401 && report.http.proxyForeignOrigin === 403
    && report.http.proxyNullOrigin === 403 ? 'private-app-guard-observed'
    : report.http.expectedHost === 'unreachable' ? 'server-unreachable' : 'unexpected-guard-check-startup-mode';
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await diagnoseCodespaces();
  console.log(JSON.stringify(report, null, 2));
  console.log('Read-only local probes, not a live browser/proxy test. No credentials, port settings or sign-ins changed.');
  process.exitCode = report.ports === 'verified-private' && report.server === 'private-app-guard-observed' ? 0 : 1;
}
