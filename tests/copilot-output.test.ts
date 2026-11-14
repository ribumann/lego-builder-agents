import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCopilotResponse, copilotAuthenticationFailed } from '../copilot-output.mjs';

const stream = (...events: unknown[]) => events.map(event => JSON.stringify(event)).join('\r\n') + '\r\n';
const message = (content: string) => ({ type: 'assistant.message', data: { content } });
const success = { type: 'result', exitCode: 0 };

test('machine output preserves a long JSON string without terminal-width wrapping', () => {
  const design = { name: 'Lighthouse with a balcony and lantern '.repeat(5), world: 'space' };
  const content = JSON.stringify(design);
  const wrappedText = content.match(/.{1,100}/g)?.join('\n');
  assert.ok(wrappedText);
  assert.throws(() => JSON.parse(wrappedText), SyntaxError, 'Reproduce terminal wrapping inside a JSON string');
  const extracted = readCopilotResponse(stream(
    { type: 'user.message', data: { content: 'Ignored input, not a plan' } },
    { type: 'assistant.message_delta', data: { deltaContent: 'Ignored partial content' } },
    message(content), { type: 'assistant.turn_end', data: { turnId: 'fixture' } }, success,
  ));
  assert.deepEqual(JSON.parse(extracted), design);
});

test('only the final complete assistant message is used, not deltas or earlier drafts', () => {
  assert.equal(readCopilotResponse(stream(message('draft'), message('final'), success)), 'final');
  assert.throws(() => readCopilotResponse(stream(
    { type: 'assistant.message_delta', data: { deltaContent: '{"name":"not complete"}' } }, success,
  )), /incomplete response/);
});

test('malformed, incomplete and failed event streams fail without exposing their contents', () => {
  const secret = 'private-fixture-content';
  for (const output of [
    secret, `${stream(message('valid'), success)}unexpected`,
    stream(null), stream({}), stream([]), stream(message('valid')),
    stream({ type: 'assistant.message', data: { content: 42 } }, success),
    stream(message('valid'), { type: 'result', exitCode: 1 }),
    stream({ type: 'session.error', data: { message: secret } }, message('valid'), success),
    stream(message('valid'), success, success),
  ]) {
    assert.throws(() => readCopilotResponse(output), error => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(secret), false);
      return true;
    });
  }
});

test('final response byte limit includes multibyte content', () => {
  assert.equal(readCopilotResponse(stream(message('x'.repeat(128_000)), success)).length, 128_000);
  assert.throws(() => readCopilotResponse(stream(message('é'.repeat(64_001)), success)), /size limit/);
});

test('authentication guidance uses actual error events, not echoed briefs or assistant text', () => {
  assert.equal(copilotAuthenticationFailed(stream(
    { type: 'user.message', data: { content: 'Make a tower called copilot login' } },
    message('Authentication museum'), { type: 'result', exitCode: 1 },
  )), false);
  assert.equal(copilotAuthenticationFailed(stream(
    { type: 'session.error', data: { errorType: 'authentication', message: 'Login required' } },
    { type: 'result', exitCode: 1 },
  )), true);
  assert.equal(copilotAuthenticationFailed('copilot login'), false);
});
