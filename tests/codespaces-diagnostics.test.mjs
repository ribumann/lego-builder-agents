import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { diagnoseCodespaces } from '../scripts/diagnose-codespaces.mjs';

const env = { CODESPACES: 'true', CODESPACE_NAME: 'fixture-space', PORT: '4173', GH_DEBUG: 'api' };
const origin = 'https://fixture-space-4173.app.github.dev';
const ports = [{ sourcePort: 4173, visibility: 'private', browseUrl: origin }];
const guardedProbe = async (_port, headers) => {
  const acceptedHost = headers.Host === new URL(origin).host
    || (headers.Host === '127.0.0.1:4173' && headers['X-Forwarded-Host'] === new URL(origin).host
      && headers['X-Forwarded-Proto'] === 'https');
  return !acceptedHost || (headers.Origin && headers.Origin !== origin) ? 403 : 401;
};
const run = async () => ({ stdout: JSON.stringify(ports) });

test('Codespace preflight reports private visibility and local guards independently of live browser success', async () => {
  const report = await diagnoseCodespaces({ env, run, httpProbe: guardedProbe });
  assert.equal(report.ports, 'verified-private');
  assert.equal(report.server, 'private-app-guard-observed');
  assert.equal(report.http.proxyShape, 401);
  assert.equal(report.http.proxyForeignOrigin, 403);
});

test('Codespace preflight separates metadata authorization from tunnel inspection and does not expose secrets', async () => {
  const commands = [];
  const report = await diagnoseCodespaces({ env, httpProbe: guardedProbe, run: async (file, args, options) => {
    commands.push(args);
    assert.equal(file, 'gh');
    assert.equal(options.timeout, 15000);
    assert.equal(options.env.GH_PROMPT_DISABLED, '1');
    assert.equal(options.env.GH_DEBUG, '');
    assert.equal(options.env.GH_HOST, 'github.com');
    if (args.includes('user/codespaces/fixture-space'))
      throw { stderr: 'HTTP 403 This API operation needs the "codespace" scope. secret-credential' };
    return { stdout: 'secret-user-output' };
  } });
  assert.equal(report.github, 'reachable-and-authenticated');
  assert.equal(report.codespace, 'codespaces-scope-required');
  assert.equal(report.ports, 'not-checked');
  assert.equal(commands.length, 2);
  assert.equal(report.server, 'private-app-guard-observed');
  assert.doesNotMatch(JSON.stringify(report), /secret|fixture-space|https|GH_DEBUG/);
});

test('Codespace preflight identifies tunnel timeout after REST succeeds', async () => {
  const report = await diagnoseCodespaces({ env, httpProbe: guardedProbe, run: async (_file, args) => {
    if (args[0] === 'codespace') throw { killed: true, stderr: 'private tunnel endpoint and token' };
    return { stdout: '' };
  } });
  assert.equal(report.codespace, 'metadata-accessible');
  assert.equal(report.ports, 'timeout');
  assert.doesNotMatch(JSON.stringify(report), /private tunnel/);
});

test('Codespace preflight fails closed for missing CLI, malformed data and unsafe port results', async () => {
  for (const [output, expected] of [
    ['not json', 'invalid-cli-data'], ['{}', 'invalid-cli-data'], ['[]', 'port-not-forwarded'],
    [JSON.stringify([{ ...ports[0], browseUrl: 'https://attacker.invalid' }]), 'unexpected-port-url'],
    [JSON.stringify([{ ...ports[0], visibility: 'public' }]), 'not-private'],
    [JSON.stringify([{ ...ports[0], visibility: 'org' }]), 'not-private'],
    [JSON.stringify([{ ...ports[0], visibility: 'unknown' }]), 'unknown-visibility'],
  ]) {
    const report = await diagnoseCodespaces({ env, httpProbe: guardedProbe, run: async () => ({ stdout: output }) });
    assert.equal(report.ports, expected);
  }
  const missing = await diagnoseCodespaces({ env, httpProbe: guardedProbe, run: async () => { throw { code: 'ENOENT' }; } });
  assert.equal(missing.github, 'missing-cli');
  assert.equal(missing.ports, 'not-checked');
});

test('Codespace preflight refuses invalid context before making external requests', async () => {
  for (const invalid of [{ CODESPACES: 'false' }, { CODESPACE_NAME: '../unsafe' }, { PORT: '0' }]) {
    const report = await diagnoseCodespaces({ env: { ...env, ...invalid }, run: () => assert.fail('No command allowed') });
    assert.equal(report.context, 'run-inside-codespace-with-valid-port');
  }
});

test('Codespace preflight uses the configured CLI for every check and rejects relative paths', async () => {
  const executable = join(tmpdir(), 'fixture-gh');
  const seen = [];
  const report = await diagnoseCodespaces({ env: { ...env, BRICKLAB_GH_BIN: executable }, httpProbe: guardedProbe,
    run: async (file, args) => { seen.push(file); return { stdout: args[0] === 'codespace' ? JSON.stringify(ports) : '' }; } });
  assert.equal(report.ports, 'verified-private');
  assert.deepEqual(seen, [executable, executable, executable]);
  for (const invalid of ['', 'gh', 'relative/gh', join(tmpdir(), 'gh.cmd')]) {
    const result = await diagnoseCodespaces({ env: { ...env, BRICKLAB_GH_BIN: invalid },
      run: () => assert.fail('No command allowed') });
    assert.equal(result.context, 'invalid-github-cli-path');
  }
});

test('Codespace preflight probes a real local HTTP listener without sending credentials', async t => {
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers['x-bricklab-key'], undefined);
    assert.equal(req.url, '/api/status');
    res.writeHead(403);
    res.end('secret response is never included');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const report = await diagnoseCodespaces({ env: { ...env, PORT: String(server.address().port) }, run });
  assert.equal(report.http.expectedHost, 403);
  assert.equal(report.server, 'unexpected-guard-check-startup-mode');
  assert.doesNotMatch(JSON.stringify(report), /secret response/);
});
