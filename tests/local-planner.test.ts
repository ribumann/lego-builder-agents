import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { createLocalPlanner } from '../local-planner.mjs';

const model = 'team/model.v1_Q4-K:latest';
const privateText = 'private-provider-or-prompt-fixture';
const localTags = { models: [{ name: model, model }] };
const answer = { done: true, response: 'arbitrary output; parent validates original custom geometry' };
type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

async function fakeOllama(t: TestContext, handler?: Handler, host = '127.0.0.1') {
  const calls: { path: string; method: string; body: string; headers: IncomingMessage['headers'] }[] = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    calls.push({ path: req.url!, method: req.method!, body, headers: req.headers });
    if (handler) await handler(req, res);
    else {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(req.url === '/api/tags' ? localTags : answer));
    }
  });
  server.listen(0, host);
  await once(server, 'listening');
  t.after(async () => {
    if (!server.listening) return;
    const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await closed;
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://${host === '::1' ? '[::1]' : host}:${address.port}`;
  return { calls, url, server };
}

function assertPrivate(error: unknown, pattern: RegExp) {
  assert.ok(error instanceof Error);
  assert.match(error.message, pattern);
  assert.equal(error.message.includes(privateText), false);
  assert.match(error.message, /OLLAMA_NO_CLOUD=1/);
  assert.match(error.message, /cannot prove/);
  assert.equal(error.cause, undefined, 'Do not attach raw transport/provider errors');
  return true;
}

test('construction and status are configuration-only; disabled and missing model never request', async t => {
  const service = await fakeOllama(t);
  const configured = createLocalPlanner({ enabled: true, model, url: service.url });
  assert.deepEqual(Object.keys(configured).sort(), ['plan', 'status']);
  const status = configured.status();
  assert.equal(status.enabled, true);
  assert.equal(status.model, model);
  assert.equal(status.state, 'configured');
  assert.match(status.message, /availability and authentication are unverified/);
  assert.match(status.message, /OLLAMA_NO_CLOUD=1/);
  assert.match(status.message, /cannot prove/);
  assert.equal(createLocalPlanner({ enabled: true, model }).status().state, 'configured', 'Default URL is valid without connecting');
  const off = createLocalPlanner({ enabled: false, model, url: service.url });
  const missing = createLocalPlanner({ enabled: true, model: '', url: service.url });
  assert.equal(off.status().state, 'off');
  assert.equal(missing.status().state, 'missing-model');
  await assert.rejects(off.plan(privateText), /BRICKLAB_LOCAL_AI=1/);
  await assert.rejects(missing.plan(privateText), /BRICKLAB_LOCAL_MODEL/);
  await delay(20);
  assert.equal(service.calls.length, 0);
});

test('explicit plan preflights without a prompt and preserves exact prompt, model and bounded options', async t => {
  const service = await fakeOllama(t);
  const planner = createLocalPlanner({ enabled: true, model, url: `${service.url}/` });
  const prompt = ` \n${privateText} 🧱\u0000\r\n{"arbitrary":"no adapter rewriting"}\t`;
  assert.equal(await planner.plan(prompt), answer.response);
  assert.equal(service.calls.length, 2);
  assert.deepEqual(service.calls.map(({ path, method, body }) => ({ path, method, body })), [
    { path: '/api/tags', method: 'GET', body: '' },
    { path: '/api/generate', method: 'POST', body: JSON.stringify({
      model, prompt, stream: false, format: 'json', options: { num_predict: 12000 }, keep_alive: 0,
    }) },
  ]);
  for (const call of service.calls) {
    for (const name of ['authorization', 'cookie', 'proxy-authorization', 'x-api-key'])
      assert.equal(call.headers[name], undefined);
  }
  assert.equal(planner.status().state, 'configured', 'Status never claims verified availability');
  assert.equal(await planner.plan('second explicit request'), answer.response);
  assert.equal(service.calls.length, 4, 'Fresh metadata check per request, no hidden retries');
});

test('loopback transport ignores environment proxies and global transports without forwarding the prompt', async t => {
  const service = await fakeOllama(t);
  const proxy = await fakeOllama(t, (_req, res) => {
    res.writeHead(502);
    res.end('Proxy use is forbidden in this fixture.');
  });
  let proxyConnections = 0;
  proxy.server.on('connection', () => { proxyConnections++; });
  const proxyEnvironment = {
    NODE_USE_ENV_PROXY: '1',
    HTTP_PROXY: proxy.url, HTTPS_PROXY: proxy.url, ALL_PROXY: proxy.url,
    http_proxy: proxy.url, https_proxy: proxy.url, all_proxy: proxy.url,
    NO_PROXY: '', no_proxy: '',
  };
  const originalEnvironment = Object.fromEntries(
    Object.keys(proxyEnvironment).map(key => [key, process.env[key]]),
  );
  // Set proxy variables at process startup (when Node can initialize its global
  // proxy agent). Child-only overrides leave the parent's environment unchanged.
  const script = `
    import assert from 'node:assert/strict';
    import http from 'node:http';
    import { createLocalPlanner } from ${JSON.stringify(new URL('../local-planner.mjs', import.meta.url).href)};
    http.globalAgent.addRequest = () => { throw new Error('Global HTTP agent must not be used.'); };
    globalThis.fetch = () => { throw new Error('Global fetch must not be used.'); };
    const planner = createLocalPlanner({ enabled: true, model: ${JSON.stringify(model)}, url: ${JSON.stringify(service.url)} });
    assert.equal(planner.status().state, 'configured');
    assert.equal(await planner.plan(${JSON.stringify(privateText)}), ${JSON.stringify(answer.response)});
    process.stdout.write('ok');
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, ...proxyEnvironment },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const [code] = await once(child, 'close');
  assert.equal(code, 0, stderr);
  assert.equal(stdout, 'ok');
  assert.equal(service.calls.length, 2);
  assert.equal(JSON.parse(service.calls[1].body).prompt, privateText);
  assert.equal(proxyConnections, 0, 'No socket may connect to the configured proxy');
  assert.equal(proxy.calls.length, 0, 'No prompt or metadata request reaches the proxy');
  assert.deepEqual(Object.fromEntries(
    Object.keys(proxyEnvironment).map(key => [key, process.env[key]]),
  ), originalEnvironment, 'Parent environment stays unchanged');
});

test('IPv6 literal loopback is supported', async t => {
  assert.equal(createLocalPlanner({ enabled: true, model, url: 'http://[::1]:11434/' }).status().state, 'configured');
  let service;
  try {
    service = await fakeOllama(t, undefined, '::1');
  } catch (error) {
    if (['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      t.skip('Host does not support IPv6 loopback sockets; literal configuration validation passed.');
      return;
    }
    throw error;
  }
  assert.equal(await createLocalPlanner({ enabled: true, model, url: service.url }).plan('IPv6'), answer.response);
  assert.equal(service.calls.length, 2);
});

test('enabled URL validation rejects hosts, alternate numeric spellings and normalization tricks', async t => {
  const service = await fakeOllama(t);
  for (const url of [
    'https://127.0.0.1', 'http://localhost:11434', 'http://example.invalid',
    'http://192.168.1.1', 'http://127.0.0.2', 'http://127.1', 'http://2130706433',
    'http://0x7f000001', 'http://0177.0.0.1', 'http://[::ffff:127.0.0.1]',
    'http://[0:0:0:0:0:0:0:1]', `http://${privateText}@127.0.0.1`,
    `${service.url}/${privateText}`, `${service.url}/..`, `${service.url}/%2e`,
    `${service.url}?${privateText}`, `${service.url}#${privateText}`,
    `${service.url}?`, `${service.url}#`, `${service.url}\n`, `${service.url}\r\n`,
    `${service.url}\\`, ' http://127.0.0.1', 'http://127.0.0.1:0',
    'http://127.0.0.1:65536', 'http://127.0.0.1:', 'file:///api/generate',
  ]) {
    assert.throws(() => createLocalPlanner({ enabled: true, model, url }), error => assertPrivate(error, /URL/));
  }
  assert.equal(service.calls.length, 0);
});

test('invalid model and timeout configuration fails closed without reflecting supplied values', () => {
  for (const invalid of [' ', 'model name', '\n', 'model\n', 'model\r', 'model\t', 'model\u0000',
    'model\u007f', 'model\u2028', 'é', 'x'.repeat(257), '-option', `token=${privateText}`]) {
    assert.throws(() => createLocalPlanner({ enabled: true, model: invalid }), error => assertPrivate(error, /identifier/));
  }
  for (const timeoutMs of [0, -1, NaN, Infinity, 90_001])
    assert.throws(() => createLocalPlanner({ enabled: true, model, timeoutMs }), /timeout/);
  const off = createLocalPlanner({ enabled: false, model: privateText + '\n', url: `http://${privateText}@example.invalid` });
  assert.equal(off.status().model, '');
  assert.equal(off.status().message.includes(privateText), false);
});

test('untagged names match :latest metadata but generation preserves configured model', async t => {
  const service = await fakeOllama(t, (req, res) => {
    res.end(JSON.stringify(req.url === '/api/tags' ? { models: [{ name: 'team/model:latest' }] } : answer));
  });
  const planner = createLocalPlanner({ enabled: true, model: 'team/model', url: service.url });
  assert.equal(await planner.plan('untagged'), answer.response);
  assert.equal(JSON.parse(service.calls[1].body).model, 'team/model');
});

test('remote, unknown, malformed and missing model metadata never receives the prompt or generates', async t => {
  const metadata = [
    {}, null, [], { models: {} }, { models: [null] }, { models: [{ name: 7 }] },
    { models: [{ name: 'bad\n' }] }, { models: [] },
    { models: [{ name: 'other:latest' }] },
    { error: privateText, ...localTags },
    { models: [{ name: model, remote_model: 'cloud-provider' }] },
    { models: [{ name: model, remote_host: `https://${privateText}.invalid` }] },
    { models: [{ name: model, remote_host: false }] },
    { models: [{ name: model, remote_model: null }] },
    { models: [{ name: model, model: 'different:latest' }] },
    { models: [{ name: model }, { name: model, remote_model: 'remote' }] },
  ];
  for (const tags of metadata) {
    const service = await fakeOllama(t, (_req, res) => { res.end(JSON.stringify(tags)); });
    const planner = createLocalPlanner({ enabled: true, model, url: service.url });
    await assert.rejects(planner.plan(privateText), error => assertPrivate(error, /metadata|missing/));
    assert.deepEqual(service.calls.map(({ path, body }) => ({ path, body })), [{ path: '/api/tags', body: '' }]);
  }
});

test('malformed or streamed metadata fails before generation without exposing provider output', async t => {
  for (const body of [privateText, '{"models":[', `${JSON.stringify(localTags)}\n${JSON.stringify(localTags)}`]) {
    const service = await fakeOllama(t, (_req, res) => { res.end(body); });
    await assert.rejects(createLocalPlanner({ enabled: true, model, url: service.url }).plan(privateText),
      error => assertPrivate(error, /malformed JSON/));
    assert.deepEqual(service.calls.map(({ path, body }) => ({ path, body })), [{ path: '/api/tags', body: '' }]);
  }
});

test('known cloud model tags are rejected without sending any request', async t => {
  const service = await fakeOllama(t);
  for (const name of ['gpt-oss:cloud', 'gpt-oss:120b-cloud', 'team/model:480b-cloud']) {
    await assert.rejects(createLocalPlanner({ enabled: true, model: name, url: service.url }).plan(privateText),
      error => assertPrivate(error, /Cloud-tagged.*OLLAMA_NO_CLOUD=1/));
  }
  assert.equal(service.calls.length, 0);
});

test('redirects at either stage never transmit to the redirect target', async t => {
  const target = await fakeOllama(t);
  for (const redirectStage of ['/api/tags', '/api/generate']) {
    const service = await fakeOllama(t, (req, res) => {
      if (req.url === redirectStage) {
        res.writeHead(307, { Location: `${target.url}/${privateText}` });
        res.end();
      } else res.end(JSON.stringify(localTags));
    });
    await assert.rejects(createLocalPlanner({ enabled: true, model, url: service.url }).plan(privateText),
      error => assertPrivate(error, /redirects are not allowed/));
    assert.equal(service.calls.length, redirectStage === '/api/tags' ? 1 : 2);
  }
  assert.equal(target.calls.length, 0);
});

test('HTTP errors are explicit, actionable and private, with no retry at either stage', async t => {
  for (const stage of ['/api/tags', '/api/generate']) {
    for (const [status, message] of [[404, /ollama pull MODEL.*manually.*server host/],
      [401, /authentication/], [403, /authentication/], [500, /HTTP error/]] as const) {
      const service = await fakeOllama(t, (req, res) => {
        if (req.url !== stage) res.end(JSON.stringify(localTags));
        else { res.writeHead(status); res.end(privateText); }
      });
      await assert.rejects(createLocalPlanner({ enabled: true, model, url: service.url }).plan(privateText),
        error => assertPrivate(error, message));
      assert.equal(service.calls.length, stage === '/api/tags' ? 1 : 2);
    }
  }
});

test('unavailable loopback service gives ollama serve guidance without raw URLs', async t => {
  const service = await fakeOllama(t);
  await new Promise<void>(resolve => service.server.close(() => resolve()));
  await assert.rejects(createLocalPlanner({ enabled: true, model, url: service.url }).plan(privateText), error => {
    assertPrivate(error, /ollama serve.*server host/);
    assert.equal((error as Error).message.includes(service.url), false);
    return true;
  });
});

test('malformed, incomplete, streamed and provider-error generation envelopes are rejected privately', async t => {
  for (const body of [
    privateText, '{"done":true', JSON.stringify(null), JSON.stringify([]), '{}',
    JSON.stringify({ response: 'partial', done: false }),
    JSON.stringify({ response: 'partial' }),
    JSON.stringify({ response: 12, done: true }),
    JSON.stringify({ response: 'partial', done: 'true' }),
    JSON.stringify({ ...answer, error: privateText }),
    `${JSON.stringify({ response: 'partial', done: false })}\n${JSON.stringify(answer)}\n`,
  ]) {
    const service = await fakeOllama(t, (req, res) => {
      res.end(req.url === '/api/tags' ? JSON.stringify(localTags) : body);
    });
    await assert.rejects(createLocalPlanner({ enabled: true, model, url: service.url }).plan(privateText),
      error => assertPrivate(error, /malformed|incomplete|error response/));
    assert.equal(service.calls.length, 2);
  }
});

test('invalid UTF-8 and truncated transport fail explicitly', async t => {
  for (const truncated of [false, true]) {
    const service = await fakeOllama(t, (req, res) => {
      if (req.url === '/api/tags') { res.end(JSON.stringify(localTags)); return; }
      if (truncated) {
        res.writeHead(200, { 'Content-Length': 1000 });
        res.write('{"done":true,');
        setImmediate(() => res.destroy());
      } else res.end(Buffer.concat([Buffer.from('{"done":true,"response":"'), Buffer.from([0xff]), Buffer.from('"}')]));
    });
    await assert.rejects(createLocalPlanner({ enabled: true, model, url: service.url }).plan(privateText),
      error => assertPrivate(error, /invalid UTF-8|Could not complete/));
  }
});

test('final response byte limit accepts the boundary and rejects multibyte overflow', async t => {
  for (const [response, valid] of [
    ['x'.repeat(128_000), true], ['é'.repeat(64_000), true], ['é'.repeat(64_001), false],
  ] as const) {
    const service = await fakeOllama(t, (req, res) => {
      res.end(JSON.stringify(req.url === '/api/tags' ? localTags : { done: true, response }));
    });
    const result = createLocalPlanner({ enabled: true, model, url: service.url }).plan('boundary');
    if (valid) assert.equal(await result, response);
    else await assert.rejects(result, /128000-byte size limit/);
  }
});

test('raw body cap is applied at both stages and aborts unfinished oversized responses', async t => {
  for (const stage of ['/api/tags', '/api/generate']) {
    let closed!: () => void;
    const disconnected = new Promise<void>(resolve => { closed = resolve; });
    const service = await fakeOllama(t, (req, res) => {
      if (req.url !== stage) { res.end(JSON.stringify(localTags)); return; }
      res.on('close', closed);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write(' '.repeat(1_048_577));
      // Intentionally never end; the adapter must stop reading and abort.
    });
    const planner = createLocalPlanner({ enabled: true, model, url: service.url, timeoutMs: 2000 });
    await assert.rejects(planner.plan(privateText), /1 MiB size limit/);
    await disconnected;
    assert.equal(service.calls.length, stage === '/api/tags' ? 1 : 2);
  }
});

test('raw body accepts exactly 1 MiB at both stages', async t => {
  const service = await fakeOllama(t, (req, res) => {
    const json = JSON.stringify(req.url === '/api/tags' ? localTags : answer);
    res.end(json + ' '.repeat(1_048_576 - Buffer.byteLength(json)));
  });
  assert.equal(await createLocalPlanner({ enabled: true, model, url: service.url }).plan('boundary'), answer.response);
});

test('one request per adapter; concurrency rejection sends nothing and completion releases the lock', async t => {
  let release!: () => void;
  let started!: () => void;
  const received = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const service = await fakeOllama(t, async (req, res) => {
    if (req.url === '/api/tags') {
      started();
      await gate;
      res.end(JSON.stringify(localTags));
    } else res.end(JSON.stringify(answer));
  });

  const planner = createLocalPlanner({ enabled: true, model, url: service.url });
  const first = planner.plan('first');
  await received;
  await assert.rejects(planner.plan(privateText), /already in progress/);
  assert.equal(service.calls.length, 1);
  release();
  assert.equal(await first, answer.response);
  assert.equal(await planner.plan('next'), answer.response);
  assert.equal(service.calls.length, 4);
});

test('failed preflight releases the adapter lock without retrying', async t => {
  let valid = false;
  const service = await fakeOllama(t, (req, res) => {
    res.end(JSON.stringify(req.url === '/api/tags' ? (valid ? localTags : { models: [] }) : answer));
  });
  const planner = createLocalPlanner({ enabled: true, model, url: service.url });
  await assert.rejects(planner.plan(privateText), /model is missing/);
  assert.equal(service.calls.length, 1);
  valid = true;
  assert.equal(await planner.plan('new explicit request'), answer.response);
  assert.equal(service.calls.length, 3);
});

test('timeout aborts stalled headers or bodies at either stage and releases lock for next explicit request', async t => {
  for (const stage of ['/api/tags', '/api/generate']) {
    for (const headers of [false, true]) {
      let stalled = true;
      let closed!: () => void;
      const disconnected = new Promise<void>(resolve => { closed = resolve; });
      const service = await fakeOllama(t, (req, res) => {
        if (stalled && req.url === stage) {
          res.on('close', closed);
          if (headers) { res.writeHead(200); res.write('{'); }
        } else res.end(JSON.stringify(req.url === '/api/tags' ? localTags : answer));
      });
      const planner = createLocalPlanner({ enabled: true, model, url: service.url, timeoutMs: 150 });
      await assert.rejects(planner.plan(privateText), error => assertPrivate(error, /timed out/));
      await disconnected;
      stalled = false;
      assert.equal(await planner.plan('after timeout'), answer.response);
      assert.equal(service.calls.length, (stage === '/api/tags' ? 1 : 2) + 2, 'No automatic retry');
    }
  }
});

test('metadata and generation share a single total timeout budget', async t => {
  const service = await fakeOllama(t, (req, res) => {
    const timer = setTimeout(() => {
      res.end(JSON.stringify(req.url === '/api/tags' ? localTags : answer));
    }, 120);
    res.on('close', () => clearTimeout(timer));
  });
  const planner = createLocalPlanner({ enabled: true, model, url: service.url, timeoutMs: 200 });
  await assert.rejects(planner.plan(privateText), /timed out/);
  assert.equal(service.calls.length, 2, 'The same deadline covers preflight and generation');
});
