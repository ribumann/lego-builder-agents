import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAzurePlanner, getAzurePlannerDiagnostic } from '../azure-planner.mjs';
import { validateCustomSpec, expandCustomBricks } from '../src/custom-design.mjs';
import { planningPrompt } from '../planning-prompt.mjs';

const endpoint = 'https://bricklab-example.openai.azure.com';
const contentFilterPolicy = 'bricklab-public-safe';
const credential = { async getToken() { return { token: 'test-token' }; } };
const envelope = (content, reason = 'stop') => JSON.stringify({
  choices: [{ finish_reason: reason, message: { content } }],
});
const createPlanner = options => createAzurePlanner({ contentFilterPolicy, ...options });

test('Azure planner sends a bounded authenticated request and returns parsed JSON', async () => {
  let request;
  const plan = createPlanner({ endpoint, deployment: 'small-model', credential,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(envelope('{"model":"custom"}'));
    } });
  assert.deepEqual(await plan({ prompt: 'design a lighthouse' }), { model: 'custom' });
  assert.match(request.url, /\/deployments\/small-model\/chat\/completions\?/);
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.headers.Authorization, 'Bearer test-token');
  assert.equal(request.options.headers['x-policy-id'], undefined, 'Native deployment policy is not selected by a custom header');
  assert.equal(JSON.parse(request.options.body).max_completion_tokens, 12000);
  assert.equal(JSON.parse(request.options.body).max_tokens, undefined);
});

test('Azure requests strict custom-design output for the selected world without weakening local validation', async () => {
  let requests = 0;
  const plan = createPlanner({ endpoint, deployment: 'model', credential,
    fetchImpl: async (_url, options) => {
      requests++;
      const format = JSON.parse(options.body).response_format;
      assert.equal(format.type, 'json_schema');
      assert.equal(format.json_schema.strict, true);
      const schema = format.json_schema.schema;
      assert.deepEqual(schema.properties.world.enum, ['space']);
      assert.deepEqual(schema.properties.model.enum, ['custom']);
      assert.deepEqual(schema.properties.longTail.enum, [false]);
      assert.deepEqual(schema.properties.wideWings.enum, [false]);
      assert.equal(schema.properties.budget.type, 'integer');
      assert.ok(schema.properties.color.enum.includes('blue'));
      const inspect = value => {
        if (!value || typeof value !== 'object') return;
        if (value.type === 'object') {
          assert.equal(value.additionalProperties, false);
          assert.deepEqual(value.required, Object.keys(value.properties));
        }
        for (const nested of Object.values(value)) inspect(nested);
      };
      inspect(schema);
      return new Response(envelope(JSON.stringify({
        world: 'space', model: 'custom', color: 'blue', longTail: false, wideWings: false, budget: 1,
        design: { name: 'Unsafe fixture', bricks: [
          { x: 63, y: 0, z: 0, width: 2, height: 1, depth: 1, color: 'blue', part: 'frame' },
        ] },
      })));
    } });
  const spec = await plan({ world: 'space', prompt: planningPrompt('space', 'Synthetic fixture') });
  assert.throws(() => validateCustomSpec(spec), /bounds/);
  assert.equal(requests, 1, 'Invalid output never triggers an adapter retry');
  await assert.rejects(plan({ world: 'invalid', prompt: 'Synthetic fixture' }), /world is invalid/);
  assert.equal(requests, 1);
});

test('expanded budget counts repeated and single bricks across all objects', async () => {
  const brick = (x, repeat) => ({
    x, y: 0, z: 0, width: 1, height: 1, depth: 1, color: 'blue', part: 'frame',
    ...(repeat ? { repeat: { count: repeat, dx: 0, dy: 1, dz: 0 } } : {}),
  });
  const spec = { world: 'space', model: 'custom', color: 'blue', longTail: false, wideWings: false, budget: 10,
    design: { name: 'Two towers', objects: [
      { name: 'First', bricks: [brick(0, 6)] },
      { name: 'Second', bricks: [brick(2, 4), { ...brick(2), y: 4 }] },
    ] } };
  let prompt;
  const plan = createPlanner({ endpoint, deployment: 'model', credential,
    fetchImpl: async (_url, options) => {
      prompt = JSON.parse(options.body).messages[0].content;
      return new Response(envelope(JSON.stringify(spec)));
    } });
  const result = await plan({ prompt: planningPrompt('space', 'Two towers, budget 10 bricks') });
  assert.match(prompt, /count expanded bricks across ALL objects/);
  assert.match(prompt, /repeat\.count 6, repeat\.count 4, and no repeat contribute 11 bricks/);
  assert.throws(() => validateCustomSpec(result), /expanded brick budget/);
  spec.budget = 11;
  assert.equal(validateCustomSpec(spec).budget, 11);
});

test('native enum bounds reject oversized primitives while preserving requested nontrivial multi-object sizes', async () => {
  for (const size of [100, 1000, 2048, 8192]) {
    const objects = [0, 1].map(object => {
      const bricks = [];
      for (let remaining = size / 2, column = 0; remaining > 0; column++) {
        const count = Math.min(64, remaining);
        bricks.push({ x: column - 64, y: 0, z: object * 2,
          width: 1, height: 1, depth: 1, color: 'blue', part: 'frame',
          ...(count > 1 ? { repeat: { count, dx: 0, dy: 1, dz: 0 } } : {}),
        });
        remaining -= count;
      }
      return { name: `Object ${object + 1}`, bricks };
    });
    const plan = createPlanner({ endpoint, deployment: 'model', credential,
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        assert.ok(body.messages[0].content.includes(`roughly ${size} expanded bricks`));
        assert.match(body.messages[0].content, /Large bases and walls MUST be tiled/);
        const schema = body.response_format.json_schema.schema;
        const record = schema.properties.design.anyOf[1].properties.objects.items.properties.bricks.items.anyOf[1];
        for (const object of objects)
          for (const brick of object.bricks)
            for (const field of ['x', 'y', 'z', 'width', 'height', 'depth']) {
              const definition = record.properties[field].$ref.split('/').at(-1);
              assert.ok(schema.$defs[definition].enum.includes(brick[field]), `${size} retains valid ${field}`);
            }
        assert.deepEqual(schema.$defs.dimension.enum, [1, 2, 3, 4, 5, 6, 7, 8]);
        assert.equal(schema.$defs.horizontal.enum.includes(-65), false);
        assert.equal(schema.$defs.horizontal.enum.includes(64), false);
        assert.equal(schema.$defs.vertical.enum.includes(-1), false);
        assert.ok(schema.$defs.repeatCount.enum.includes(128));
        assert.equal(schema.$defs.repeatCount.enum.includes(129), false);
        let enumValues = 0;
        const inspect = value => {
          if (!value || typeof value !== 'object') return;
          if (Array.isArray(value.enum)) enumValues += value.enum.length;
          assert.equal(Object.hasOwn(value, 'minimum'), false);
          assert.equal(Object.hasOwn(value, 'maximum'), false);
          for (const child of Object.values(value)) inspect(child);
        };
        inspect(schema);
        assert.ok(enumValues <= 500, 'Shared definitions avoid duplicating large enums');
        return new Response(envelope(JSON.stringify({
          world: 'space', model: 'custom', color: 'blue', longTail: false, wideWings: false, budget: size,
          design: { name: 'Representative repeated columns', objects },
        })));
      } });
    const spec = validateCustomSpec(await plan({ world: 'space',
      prompt: planningPrompt('space', 'Two connected towers', false, size) }));
    assert.equal(spec.budget, size);
    assert.equal(spec.design.objects.flatMap(object => expandCustomBricks(object.bricks)).length, size);
  }
});

test('expanded budget errors distinguish the declared budget from the absolute ceiling', () => {
  const record = (x, count = 64) => ({
    x, y: 0, z: 0, width: 1, height: 1, depth: 1, color: 'blue', part: 'frame',
    repeat: { count, dx: 0, dy: 1, dz: 0 },
  });
  const spec = { world: 'space', model: 'custom', color: 'blue', longTail: false, wideWings: false, budget: 10,
    design: { name: 'Budget fixture', bricks: [record(0, 11)] } };
  assert.throws(() => validateCustomSpec(spec), /exceeds its expanded brick budget\./);
  spec.budget = 8192;
  spec.design.bricks = Array.from({ length: 128 }, (_, i) => record(i - 64));
  spec.design.bricks.push({ x: 0, y: 0, z: 1, width: 1, height: 1, depth: 1, color: 'blue', part: 'frame' });
  assert.throws(() => validateCustomSpec(spec), /exceeds the 8192-brick limit\./);
  spec.budget = 10;
  assert.throws(() => validateCustomSpec(spec), /exceeds the 8192-brick limit\./);
});

test('Azure planner rejects untrusted endpoints and incomplete or oversized responses', async () => {
  assert.throws(() => createAzurePlanner({ endpoint: 'https://evil.example', deployment: 'model', credential }));
  for (const body of [envelope('{"model":"custom"}', 'length'), 'x'.repeat(1_048_577),
    envelope('x'.repeat(128_001)), envelope('not json')]) {
    const plan = createPlanner({ endpoint, deployment: 'model', credential,
      fetchImpl: async () => new Response(body) });
    await assert.rejects(plan({ prompt: 'brief' }), /Azure OpenAI returned/);
  }
});

test('Azure planner forwards cancellation and never exposes provider errors', async () => {
  const controller = new AbortController();
  const plan = createPlanner({ endpoint, deployment: 'model', credential,
    fetchImpl: async (_url, { signal }) => {
      assert.equal(signal, controller.signal);
      controller.abort();
      throw new Error('sensitive provider detail');
    } });
  await assert.rejects(plan({ prompt: 'brief', signal: controller.signal }), /^Error: Azure planning was cancelled\.$/);
  const failing = createPlanner({ endpoint, deployment: 'model', credential,
    fetchImpl: async () => { throw new Error('sensitive provider detail'); } });
  await assert.rejects(failing({ prompt: 'brief' }), error => !error.message.includes('sensitive'));
  const rejected = createPlanner({ endpoint, deployment: 'model', credential,
    fetchImpl: async () => new Response('sensitive provider detail', { status: 403 }) });
  await assert.rejects(rejected({ prompt: 'brief' }), error => !error.message.includes('sensitive'));
});

test('Azure planner rejects native blocked prompt or completion annotations', async () => {
  const blockedResponses = [
    { prompt_filter_results: [{ filtered: true }],
      choices: [{ finish_reason: 'stop', message: { content: '{"model":"custom"}' } }] },
    { prompt_filter_results: [{ content_filter_results: { hate: { filtered: true, severity: 'medium' } } }],
      choices: [{ finish_reason: 'stop', message: { content: '{"model":"custom"}' } }] },
    { choices: [{ finish_reason: 'stop', content_filter_results: { violence: { filtered: true } },
      message: { content: '{"model":"custom"}' } }] },
    { choices: [{ finish_reason: 'content_filter', message: { content: null } }] },
  ];
  for (const body of blockedResponses) {
    const plan = createPlanner({ endpoint, deployment: 'model', credential,
      fetchImpl: async () => new Response(JSON.stringify(body)) });
    await assert.rejects(plan({ prompt: 'brief' }), /content safety filters blocked/);
  }
});

test('Azure image input requires consent and sends one supported multimodal request', async () => {
  const image = { mimeType: 'image/png',
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC' };
  const requests = [];
  const plan = createAzurePlanner({ endpoint, deployment: 'any-supported-vision-model', credential,
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return new Response(envelope('{"model":"custom"}'));
    } });
  for (const request of [
    { image }, { image, imageConsent: false },
    { image: { ...image, mimeType: 'image/jpeg' }, imageConsent: true },
    { image: { ...image, data: 'invalid' }, imageConsent: true },
  ]) await assert.rejects(plan({ prompt: 'A lighthouse', ...request }));
  assert.equal(requests.length, 0);
  assert.deepEqual(await plan({ prompt: 'A lighthouse', image, imageConsent: true }), { model: 'custom' });
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].messages, [{ role: 'user', content: [
    { type: 'text', text: 'A lighthouse' },
    { type: 'image_url', image_url: { url: `data:image/png;base64,${image.data}` } },
  ] }]);
});

test('late managed-identity completion after cancellation cannot start Azure transport', async () => {
  const controller = new AbortController();
  let requests = 0;
  const plan = createAzurePlanner({ endpoint, deployment: 'model',
    credential: { async getToken() { controller.abort(); return { token: 'late' }; } },
    fetchImpl: async () => { requests++; return new Response(envelope()); } });
  await assert.rejects(plan({ prompt: 'A cancelled plan', signal: controller.signal }), /cancelled/);
  assert.equal(requests, 0);
});

test('Azure planner exposes sanitized distinct identity, access, quota and service failures', async () => {
  const missingIdentity = createPlanner({ endpoint, deployment: 'model',
    credential: { async getToken() { throw new Error('private token'); } } });
  await assert.rejects(missingIdentity({ prompt: 'brief' }), /managed identity is unavailable/);
  for (const [status, message] of [[401, /denied model access/], [403, /denied model access/],
    [429, /rate or quota limit/], [503, /service is unavailable/]]) {
    const plan = createPlanner({ endpoint, deployment: 'model', credential,
      fetchImpl: async () => new Response('sensitive details', { status }) });
    await assert.rejects(plan({ prompt: 'brief' }), error => message.test(error.message) && !error.message.includes('sensitive'));
  }
});

test('Azure errors expose only allowlisted categories and bounded numeric rate headers without retrying', async () => {
  let requests = 0;
  const plan = createPlanner({ endpoint, deployment: 'model', credential,
    fetchImpl: async () => {
      requests++;
      return new Response(JSON.stringify({ error: {
        code: '429', message: 'private prompt: exceeded token rate limit; private request id',
        innererror: { code: 'private-output' }, token: 'private-credential',
      } }), { status: 429, headers: {
        'retry-after': '60', 'x-ms-retry-after-ms': '60000',
        'x-ratelimit-limit-tokens': '200000', 'x-ratelimit-remaining-tokens': '0',
        'x-ratelimit-limit-requests': '200', 'x-ratelimit-remaining-requests': '199',
        'request-id': 'private-id', 'authorization': 'private-credential',
        'x-unrecognized-header': 'private-output',
      } });
    } });
  await assert.rejects(plan({ prompt: 'Synthetic fixture' }), error => {
    assert.equal(error.statusCode, 429);
    assert.deepEqual(getAzurePlannerDiagnostic(error), {
      status: 429, category: 'token-rate-limit', details: 'parsed', code: '429',
      retryAfterSeconds: 60, retryAfterMs: 60000,
      requestLimit: 200, requestsRemaining: 199, tokenLimit: 200000, tokensRemaining: 0,
    });
    assert.doesNotMatch(JSON.stringify(getAzurePlannerDiagnostic(error)), /private/);
    return true;
  });
  assert.equal(requests, 1);
});

test('Azure diagnostic decoding is byte/time bounded and ignores untrusted codes and header values', async () => {
  for (const [body, details] of [
    ['private invalid JSON', 'invalid-json'],
    ['x'.repeat(16_385), 'too-large'],
    [JSON.stringify({ error: { code: 'private-code', message: 'private-output' } }), 'parsed'],
    [new ReadableStream({ start(controller) { controller.error(new Error('private-error')); } }), 'unavailable'],
    [new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array()); } }), 'too-many-chunks'],
    [new ReadableStream({ start() {} }), 'timeout'],
  ]) {
    const plan = createPlanner({ endpoint, deployment: 'model', credential,
      fetchImpl: async () => new Response(body, { status: 429, headers: {
        'retry-after': 'private-output', 'retry-after-ms': '-1',
        'x-ratelimit-limit-tokens': '1000000001', 'x-ratelimit-remaining-tokens': '1.5',
      } }) });
    await assert.rejects(plan({ prompt: 'Synthetic fixture' }), error => {
      assert.deepEqual(getAzurePlannerDiagnostic(error), { status: 429, category: 'rate-limit', details });
      return true;
    });
  }
});

test('Azure diagnostics distinguish fixed quota and API compatibility codes without reflecting raw messages', async () => {
  for (const [status, code, category] of [
    [429, 'insufficient_quota', 'quota'],
    [400, 'OperationNotSupported', 'unsupported-operation'],
    [400, 'InvalidApiVersionParameter', 'unsupported-api-version'],
  ]) {
    const plan = createPlanner({ endpoint, deployment: 'model', credential,
      fetchImpl: async () => new Response(JSON.stringify({ error: { code, message: 'private-output' } }), { status }) });
    await assert.rejects(plan({ prompt: 'Synthetic fixture' }), error => {
      assert.deepEqual(getAzurePlannerDiagnostic(error), { status, code, category, details: 'parsed' });
      return true;
    });
  }
});
