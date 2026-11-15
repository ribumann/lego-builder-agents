import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeneratedDesignError, validateGeneratedDesign, designCorrectionPrompt } from '../generated-design.mjs';

const brick = { x: 0, y: 0, z: 0, width: 2, height: 1, depth: 1, color: 'blue', part: 'frame' };
const spec = { world: 'space', model: 'custom', color: 'blue', longTail: false, wideWings: false,
  budget: 100, design: { name: 'Synthetic design', bricks: [brick] } };

test('only completed parsed design validation failures carry transient correction data', () => {
  for (const invalid of [
    { ...spec, world: 'jurassic' },
    { ...spec, design: { ...spec.design, bricks: [brick, { ...brick, x: 1 }] } },
    { ...spec, design: { ...spec.design, bricks: [{ ...brick, x: 63 }] } },
    { ...spec, design: { ...spec.design, bricks: [{ ...brick, width: 16 }] } },
  ]) {
    let failure;
    try { validateGeneratedDesign(invalid, 'space', 'Azure'); }
    catch (error) { failure = error; }
    assert.ok(failure instanceof GeneratedDesignError);
    const prompt = designCorrectionPrompt('Original synthetic request', failure);
    assert.ok(prompt.includes(JSON.stringify(invalid)));
    assert.ok(prompt.includes(failure.message));
    assert.match(prompt, /ALL objects/);
    if (failure.message.includes('overlap')) assert.match(prompt, /object 1, brick 2, repeat 1 intersects object 1, brick 1, repeat 1/);
    assert.doesNotMatch(JSON.stringify(failure), /Synthetic design|"bricks"/);
    assert.deepEqual(invalid, JSON.parse(JSON.stringify(invalid)), 'Correction must not mutate geometry');
  }
  assert.deepEqual(validateGeneratedDesign(spec, 'space'), spec);
});

test('oversized invalid results cannot expand the bounded correction prompt', () => {
  let failure;
  try { validateGeneratedDesign({ ...spec, extra: 'private'.repeat(5000), budget: 0 }, 'space'); }
  catch (error) { failure = error; }
  assert.throws(() => designCorrectionPrompt('Synthetic request', failure), /too large for one bounded correction/);
});
