import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createOpenAICompatiblePlanner } from '../openai-compatible-planner.mjs';

const endpoint = 'https://private.example:8443/custom/chat/completions';
const secret = 'server-only-secret';
const envelope = (content = '{"model":"custom"}', reason = 'stop') => ({
  choices: [{ index: 0, finish_reason: reason, message: { role: 'assistant', content } }],
});
const response = value => new Response(JSON.stringify(value));
const planner = fetchImpl => createOpenAICompatiblePlanner({ enabled: true, endpoint, model: 'org/model:version', fetchImpl });

test('construction and status are inert, opt-in and disclose no connection secrets', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return response(envelope()); };
  const off = createOpenAICompatiblePlanner({ fetchImpl });
  assert.equal(off.status().state, 'off');
  await assert.rejects(off.plan({ prompt: 'brief' }), /is off/);
  const configured = createOpenAICompatiblePlanner({ enabled: true, endpoint, model: 'model', apiKey: secret, fetchImpl });
  assert.deepEqual(configured.status(), { enabled: true, state: 'configured',
    destination: 'https://private.example:8443', vision: false,
    message: 'Compatible AI is configured. Availability and authentication are unverified; only explicit planning sends a prompt.' });
  assert.equal(calls, 0);
});

test('one exact bounded request forwards authentication and signal and returns a JSON object', async () => {
  let calls = 0;
  const controller = new AbortController();
  const plan = createOpenAICompatiblePlanner({ enabled: true, endpoint, model: 'org/model:version', apiKey: secret,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, endpoint);
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      assert.equal(options.signal, controller.signal);
      assert.deepEqual(options.headers, { Accept: 'application/json', 'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}` });
      assert.deepEqual(JSON.parse(options.body), { model: 'org/model:version',
        messages: [{ role: 'user', content: 'bounded prompt' }], stream: false, max_tokens: 12000,
        response_format: { type: 'json_object' } });
      return response(envelope());
    } });
  assert.deepEqual(await plan.plan({ prompt: 'bounded prompt', signal: controller.signal }), { model: 'custom' });
  assert.equal(calls, 1);
});

test('unauthenticated requests omit Authorization and prompt byte limit is exact', async () => {
  let calls = 0;
  const plan = planner(async (_url, options) => {
    calls++;
    assert.equal(Object.hasOwn(options.headers, 'Authorization'), false);
    return response(envelope());
  });
  await plan.plan({ prompt: 'a'.repeat(32_000) });
  await assert.rejects(plan.plan({ prompt: 'a'.repeat(32_001) }), /invalid or too large/);
  await assert.rejects(plan.plan({ prompt: '\u00e9'.repeat(16_001) }), /invalid or too large/);
  assert.equal(calls, 1);
});

test('rejects unsafe configuration without echoing configuration values', () => {
  for (const value of [
    undefined, null, '', 'http://private.example/chat/completions', 'http://localhost/v1/chat/completions',
    'http://127.1/v1/chat/completions', 'http://2130706433/v1/chat/completions',
    'http://127.0.0.2/v1/chat/completions', 'https://user:server-only-secret@private.example/path',
    `${endpoint}#`, `${endpoint}#${secret}`, `${endpoint}?key=${secret}`, `${endpoint}?`,
    'https://private.example/a/../b', 'https://private.example/%2e%2e/b',
    'https://private.example\\path', ' https://private.example/path',
    'https://private.example:0/path', 'https://private.example:65536/path',
    'https://[:::]/path', 'https://127.1/path', 'https://-private.example/path',
    'https://private..example/path', 'https://private.example./path',
  ]) {
    assert.throws(() => createOpenAICompatiblePlanner({ enabled: true, endpoint: value, model: 'model' }),
      error => !error.message.includes(secret));
  }
  for (const config of [null, [], { enabled: 'true' }, { unexpected: true },
    { enabled: true, endpoint, model: '' }, { enabled: true, endpoint, model: 'bad model' },
    { enabled: true, endpoint, model: 'a'.repeat(257) }, { apiKey: '' },
    { enabled: true, endpoint, model: 'model\n' },
    { apiKey: `${secret}\r\ninjected: value` }, { apiKey: 'a'.repeat(4097) }, { fetchImpl: null }])
    assert.throws(() => createOpenAICompatiblePlanner(config));
  for (const url of ['https://private.example/v1/chat/completions', 'http://127.0.0.1:8080/v1/chat/completions',
    'http://[::1]:8080/v1/chat/completions'])
    assert.equal(createOpenAICompatiblePlanner({ enabled: true, endpoint: url, model: 'model' }).status().state, 'configured');
});

test('invalid requests cannot supply endpoint, model, key, history or fake signals', async () => {
  let calls = 0;
  const plan = planner(async () => { calls++; return response(envelope()); });
  for (const request of [undefined, null, [], {}, { prompt: '' }, { prompt: ' \n' },
    { prompt: 42 }, { prompt: 'brief', endpoint: 'https://attacker.example' },
    { prompt: 'brief', model: 'override' }, { prompt: 'brief', apiKey: secret },
    { prompt: 'brief', messages: [] }, { prompt: 'brief', signal: {} }, { prompt: 'brief', signal: null }])
    await assert.rejects(plan.plan(request), /invalid or too large/);
  assert.equal(calls, 0);
});

test('HTTP failures and transport errors are sanitized with no retries', async () => {
  for (const [status, pattern] of [[301, /redirects/], [307, /redirects/], [401, /denied access/],
    [403, /denied access/], [429, /rate or quota/], [400, /rejected the request/],
    [404, /rejected the request/], [422, /rejected the request/], [503, /HTTP failure/]]) {
    let calls = 0;
    const plan = planner(async () => { calls++; return new Response(secret, { status }); });
    await assert.rejects(plan.plan({ prompt: 'brief' }), error => pattern.test(error.message)
      && !JSON.stringify(error, Object.getOwnPropertyNames(error)).includes(secret));
    assert.equal(calls, 1);
  }
  const plan = planner(async () => { throw new Error(`${secret} ${endpoint}`); });
  await assert.rejects(plan.plan({ prompt: 'brief' }), error => /could not be reached/.test(error.message)
    && !error.message.includes(secret) && !error.message.includes(endpoint) && !error.cause);
});

test('response validation rejects incomplete envelopes, non-object content, tools and refusals', async () => {
  const cases = [null, [], {}, { error: secret, ...envelope() }, { choices: [] },
    { choices: [...envelope().choices, ...envelope().choices] },
    ...['length', 'content_filter', 'tool_calls', null].map(reason => envelope('{}', reason)),
    ...['not JSON', '```json\n{}\n```', 'null', '[]', '1', 'true', '"string"', '{"broken":']
      .map(content => envelope(content)),
    ...[null, [], 42].map(content => envelope(content)),
    { choices: [{ ...envelope().choices[0], index: 1 }] },
    ...[{ role: 'user' }, { refusal: secret }, { tool_calls: [] }, { function_call: {} }]
      .map(change => ({ choices: [{ ...envelope().choices[0],
        message: { ...envelope().choices[0].message, ...change } }] })),
  ];
  for (const value of cases)
    await assert.rejects(planner(async () => response(value)).plan({ prompt: 'brief' }), /malformed or incomplete/);
  for (const value of ['{', new Uint8Array([0xff])])
    await assert.rejects(planner(async () => new Response(value)).plan({ prompt: 'brief' }), /malformed or incomplete/);
  await assert.rejects(planner(async () => new Response(null, { status: 204 })).plan({ prompt: 'brief' }), /HTTP failure/);
  await assert.rejects(planner(async () => ({ ok: true, redirected: true, status: 200, body: response(envelope()).body }))
    .plan({ prompt: 'brief' }), /redirects/);
});

test('response and content byte caps stop oversized streams and accept exact limits', async () => {
  const content = JSON.stringify({ text: 'a'.repeat(128_000 - 11) });
  assert.equal(Buffer.byteLength(content), 128_000);
  assert.equal((await planner(async () => response(envelope(content))).plan({ prompt: 'brief' })).text.length, 127_989);
  await assert.rejects(planner(async () => response(envelope(content + ' '))).plan({ prompt: 'brief' }), /malformed or incomplete/);
  const json = JSON.stringify(envelope());
  await planner(async () => new Response(json + ' '.repeat(1_048_576 - json.length))).plan({ prompt: 'brief' });
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(1_048_577)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(planner(async () => new Response(body)).plan({ prompt: 'brief' }), /oversized/);
  assert.equal(cancelled, true);
  const broken = new ReadableStream({ start(controller) { controller.error(new Error(secret)); } });
  await assert.rejects(planner(async () => new Response(broken)).plan({ prompt: 'brief' }), /could not be reached/);
});

async function localService(t, handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await closed;
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('real loopback service receives exact path and a single authenticated request', async t => {
  let calls = 0;
  const base = await localService(t, async (req, res) => {
    calls++;
    assert.equal(req.url, '/private/chat/completions');
    assert.equal(req.headers.authorization, `Bearer ${secret}`);
    let body = '';
    for await (const chunk of req) body += chunk;
    assert.equal(JSON.parse(body).messages[0].content, 'brief');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(envelope()));
  });
  const plan = createOpenAICompatiblePlanner({ enabled: true, endpoint: `${base}/private/chat/completions`,
    model: 'model', apiKey: secret });
  assert.deepEqual(await plan.plan({ prompt: 'brief' }), { model: 'custom' });
  assert.equal(calls, 1);
});

test('real HTTP redirects never send prompt or credential to their target', async t => {
  let targetCalls = 0;
  let sourceCalls = 0;
  const target = await localService(t, (_req, res) => { targetCalls++; res.end(JSON.stringify(envelope())); });
  const source = await localService(t, (_req, res) => {
    sourceCalls++;
    res.writeHead(307, { Location: `${target}/steal` });
    res.end(secret);
  });
  const plan = createOpenAICompatiblePlanner({ enabled: true, endpoint: `${source}/chat/completions`,
    model: 'model', apiKey: secret });
  await assert.rejects(plan.plan({ prompt: 'brief' }), /could not be reached|redirects/);
  assert.equal(sourceCalls, 1);
  assert.equal(targetCalls, 0);
});

test('pre-aborted signals make no calls and live cancellation interrupts body reading', async t => {
  let calls = 0;
  const pre = new AbortController();
  pre.abort();
  await assert.rejects(planner(async () => { calls++; return response(envelope()); })
    .plan({ prompt: 'brief', signal: pre.signal }), /cancelled/);
  assert.equal(calls, 0);
  const controller = new AbortController();
  const base = await localService(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"choices":[');
  });
  let headersReceived = false;
  const plan = createOpenAICompatiblePlanner({ enabled: true, endpoint: `${base}/chat/completions`, model: 'model',
    fetchImpl: async (...args) => {
      const result = await fetch(...args);
      headersReceived = true;
      setImmediate(() => controller.abort());
      return result;
    } });
  await assert.rejects(plan.plan({ prompt: 'brief', signal: controller.signal }), /cancelled/);
  assert.equal(headersReceived, true);
});
