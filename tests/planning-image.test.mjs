import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { dirname } from 'node:path';
import { MAX_IMAGE_BYTES, validatePlanningImage, withCopilotImageAttachment } from '../planning-image.mjs';
import { createLocalPlanner } from '../local-planner.mjs';
import { createOpenAICompatiblePlanner } from '../openai-compatible-planner.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
const image = { mimeType: 'image/png', data: png.toString('base64') };
const jpeg = await readFile(new URL('./fixtures/vision-fixture.jpg', import.meta.url));
const jpegImage = { mimeType: 'image/jpeg', data: jpeg.toString('base64') };
const endpoint = 'https://trusted.example/v1/chat/completions';
const envelope = { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"model":"custom"}' } }] };

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngDimensions(width, height) {
  const data = Buffer.from(png);
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  data.writeUInt32BE(crc32(data.subarray(12, 29)), 29);
  return data.toString('base64');
}

test('image validation requires per-request consent and rejects invalid encodings, dimensions and spoofed MIME', () => {
  assert.equal(validatePlanningImage(undefined, undefined), undefined);
  assert.throws(() => validatePlanningImage(undefined, true), /consent requires an image/);
  assert.throws(() => validatePlanningImage(image, false), /consent/);
  assert.throws(() => validatePlanningImage(image), /consent/);
  const parsed = validatePlanningImage(image, true);
  assert.equal(parsed.width, 1);
  assert.equal(parsed.height, 1);
  assert.deepEqual(parsed.bytes, png);
  assert.equal(validatePlanningImage(jpegImage, true).mimeType, 'image/jpeg');
  assert.equal(validatePlanningImage({ ...image, data: pngDimensions(4096, 1) }, true).width, 4096);
  assert.equal(validatePlanningImage({ ...image, data: pngDimensions(4000, 2000) }, true).height, 2000);
  const badLength = Buffer.from(png);
  badLength.writeUInt32BE(0xffffffff, 33);
  for (const bad of [
    null, [], {}, { ...image, extra: true }, { ...image, mimeType: 'image/svg+xml' },
    { ...image, mimeType: 'image/jpeg' }, { ...jpegImage, mimeType: 'image/png' },
    { ...image, data: `data:image/png;base64,${image.data}` }, { ...image, data: `${image.data}\n` },
    { ...image, data: image.data.slice(0, -1) }, { ...image, data: '!!!!' },
    { ...image, data: Buffer.alloc(MAX_IMAGE_BYTES + 1).toString('base64') },
    { ...image, data: pngDimensions(4097, 1) }, { ...image, data: pngDimensions(4000, 2001) },
    { ...image, data: png.subarray(0, png.length - 1).toString('base64') },
    { ...image, data: badLength.toString('base64') },
    { ...jpegImage, data: jpeg.subarray(0, jpeg.length - 2).toString('base64') },
  ]) assert.throws(() => validatePlanningImage(bad, true), /bounded PNG or JPEG/);
});

test('raw image byte ceiling accepts the exact boundary and rejects one byte over', () => {
  const ancillary = Buffer.alloc(MAX_IMAGE_BYTES - png.length);
  ancillary.writeUInt32BE(ancillary.length - 12, 0);
  ancillary.write('tEXt', 4, 'ascii');
  ancillary.writeUInt32BE(crc32(ancillary.subarray(4, -4)), ancillary.length - 4);
  const exact = Buffer.concat([png.subarray(0, -12), ancillary, png.subarray(-12)]);
  assert.equal(exact.length, MAX_IMAGE_BYTES);
  assert.equal(validatePlanningImage({ ...image, data: exact.toString('base64') }, true).bytes.length, MAX_IMAGE_BYTES);
  assert.throws(() => validatePlanningImage({ ...image,
    data: Buffer.concat([exact, Buffer.from([0])]).toString('base64') }, true), /bounded PNG or JPEG/);
});

test('Copilot attachment exists only during the awaited callback and is removed on success or error', async () => {
  assert.equal(await withCopilotImageAttachment({}, file => file), undefined);
  let file;
  assert.equal(await withCopilotImageAttachment({ image, imageConsent: true }, async path => {
    file = path;
    assert.deepEqual(await readFile(path), png);
    if (typeof process.getuid === 'function') {
      for (const [location, expectedMode] of [[dirname(path), 0o700], [path, 0o600]]) {
        const info = await stat(location);
        assert.equal(info.uid, process.getuid());
        assert.equal(info.mode & 0o777, expectedMode);
      }
    }
    return 'result';
  }), 'result');
  await assert.rejects(access(file), { code: 'ENOENT' });
  await assert.rejects(access(dirname(file)), { code: 'ENOENT' });
  await assert.rejects(withCopilotImageAttachment({ image, imageConsent: true }, async path => {
    file = path;
    throw new Error('test callback failure');
  }), /test callback failure/);
  await assert.rejects(access(file), { code: 'ENOENT' });
  let invoked = false;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(withCopilotImageAttachment({ image, imageConsent: true, signal: controller.signal }, () => {
    invoked = true;
  }), /cancelled/);
  assert.equal(invoked, false);
  await assert.rejects(withCopilotImageAttachment({ image }, () => { invoked = true; }), /consent/);
  assert.equal(invoked, false);
});

test('Copilot cancellation waits for the callback and cleans attachment after child work settles', async () => {
  const controller = new AbortController();
  let file;
  let cleanupSeen = false;
  await assert.rejects(withCopilotImageAttachment({ image, imageConsent: true, signal: controller.signal }, async path => {
    file = path;
    controller.abort();
    assert.deepEqual(await readFile(path), png);
    cleanupSeen = true;
    throw new Error('child aborted');
  }), /cancelled/);
  assert.equal(cleanupSeen, true);
  await assert.rejects(access(file), { code: 'ENOENT' });
});

test('compatible provider sends image only after per-request consent and server vision opt-in', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(envelope));
  };
  const base = { enabled: true, endpoint, model: 'model', fetchImpl };
  const disabled = createOpenAICompatiblePlanner(base);
  await assert.rejects(disabled.plan({ prompt: 'brief', image, imageConsent: true }), /image input is not enabled/);
  const planner = createOpenAICompatiblePlanner({ ...base, vision: true });
  await assert.rejects(planner.plan({ prompt: 'brief', image }), /consent/);
  assert.equal(calls.length, 0);
  assert.deepEqual(await planner.plan({ prompt: 'brief', image, imageConsent: true }), { model: 'custom' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, endpoint);
  const payload = JSON.parse(calls[0].options.body);
  assert.deepEqual(payload.messages, [{ role: 'user', content: [{ type: 'text', text: 'brief' },
    { type: 'image_url', image_url: { url: `data:image/png;base64,${image.data}` } }] }]);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(JSON.stringify(planner.status()).includes(image.data), false);
  assert.throws(() => createOpenAICompatiblePlanner({ ...base, vision: 'true' }), /vision setting/);
});

test('compatible cancellation and provider failures never expose image contents', async () => {
  const controller = new AbortController();
  let seen;
  const planner = createOpenAICompatiblePlanner({ enabled: true, endpoint, model: 'model', vision: true,
    fetchImpl: async (_url, options) => { seen = options.signal; controller.abort(); throw new Error(image.data); } });
  await assert.rejects(planner.plan({ prompt: 'brief', image, imageConsent: true, signal: controller.signal }),
    error => /cancelled/.test(error.message) && !error.message.includes(image.data));
  assert.equal(seen, controller.signal);
  const failed = createOpenAICompatiblePlanner({ enabled: true, endpoint, model: 'model', vision: true,
    fetchImpl: async () => { throw new Error(image.data); } });
  await assert.rejects(failed.plan({ prompt: 'brief', image, imageConsent: true }),
    error => !error.message.includes(image.data) && !error.cause);
});

async function fakeOllama(t, { capabilities = ['completion', 'vision'], blockShow = false } = {}) {
  const calls = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    calls.push({ path: req.url, body });
    if (blockShow && req.url === '/api/show') return;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.url === '/api/tags' ? { models: [{ name: 'vision-model' }] }
      : req.url === '/api/show' ? { capabilities }
        : { done: true, response: '{"model":"custom"}' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await closed;
  });
  return { calls, url: `http://127.0.0.1:${server.address().port}` };
}

test('local vision checks model metadata before sending one prompt and image', async t => {
  const service = await fakeOllama(t);
  const planner = createLocalPlanner({ enabled: true, model: 'vision-model', url: service.url });
  assert.equal(await planner.plan('brief', { image, imageConsent: true }), '{"model":"custom"}');
  assert.deepEqual(service.calls.map(call => call.path), ['/api/tags', '/api/show', '/api/generate']);
  assert.equal(service.calls[0].body, '');
  assert.deepEqual(JSON.parse(service.calls[1].body), { model: 'vision-model' });
  const payload = JSON.parse(service.calls[2].body);
  assert.equal(payload.prompt, 'brief');
  assert.deepEqual(payload.images, [image.data]);
  assert.equal(JSON.stringify(planner.status()).includes(image.data), false);
});

test('local missing consent, unverified capabilities and cancellation never send image to generation', async t => {
  const service = await fakeOllama(t, { capabilities: ['completion'] });
  const planner = createLocalPlanner({ enabled: true, model: 'vision-model', url: service.url });
  await assert.rejects(planner.plan('brief', { image }), /consent/);
  assert.equal(service.calls.length, 0);
  await assert.rejects(planner.plan('brief', { image, imageConsent: true }), /does not report image vision/);
  assert.deepEqual(service.calls.map(call => call.path), ['/api/tags', '/api/show']);
  assert.ok(service.calls.every(call => !call.body.includes(image.data) && !call.body.includes('brief')));
  const waiting = await fakeOllama(t, { blockShow: true });
  const cancel = new AbortController();
  const cancelled = createLocalPlanner({ enabled: true, model: 'vision-model', url: waiting.url });
  const promise = cancelled.plan('brief', { image, imageConsent: true, signal: cancel.signal });
  for (let i = 0; i < 100 && waiting.calls.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(waiting.calls.length, 2);
  cancel.abort();
  await assert.rejects(promise, /cancelled/);
  assert.deepEqual(waiting.calls.map(call => call.path), ['/api/tags', '/api/show']);
});
