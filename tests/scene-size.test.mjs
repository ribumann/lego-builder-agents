import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_SIZES, resolveSceneSize } from '../src/scene-size.mjs';
import { planningPrompt } from '../planning-prompt.mjs';

test('scene targets use a single unambiguous brick count, otherwise the selected size', () => {
  for (const size of SCENE_SIZES)
    assert.deepEqual(resolveSceneSize('A tower', size), { target: size, source: 'selection' });
  for (const [brief, target] of [['Build 500 bricks', 500], ['A 2,000-brick garden', 2000], ['8192 bricks', 8192], ['Build +500 bricks', 500]])
    assert.deepEqual(resolveSceneSize(brief, 1000), { target, source: 'brief' });
  for (const brief of ['500 Steine', '500 briques', '500 mattoncini', '500 bloques', '500 blocos'])
    assert.deepEqual(resolveSceneSize(brief, 1000), { target: 500, source: 'brief' });
  assert.deepEqual(resolveSceneSize('Build a castle using 500 bricks on a 32-stud base', 1000),
    { target: 500, source: 'brief' });
  for (const brief of ['500 bricks and 100 bricks', '3 towers with 500 bricks on a 32-stud base',
    '500 bricks each on a 32-stud base'])
    assert.deepEqual(resolveSceneSize(brief, 1000), { target: 1000, source: 'selection' });
  for (const brief of ['3 towers with 500 bricks', 'between 20 and 100 bricks', 'up to 500 bricks',
    'not 500 bricks', '1.5 bricks', '5000 studs', 'not -5 bricks', '3 towers with -5 bricks',
    '500 bricks wide', '500-brick-wide wall', '500-brick-tall tower', '-5-brick-wide wall', '−5-brick-tall tower', '500 bricks each'])
    assert.deepEqual(resolveSceneSize(brief, 1000), { target: 1000, source: 'selection' }, brief);
});

test('invalid selections and clear out-of-range counts fail without clamping', () => {
  for (const value of [0, 1001, 8193, '1000', null])
    assert.throws(() => resolveSceneSize('A tower', value), /supported approximate scene size/);
  for (const brief of ['0 bricks', '8193 bricks', '999999999999999999999 bricks',
    'build -5 bricks', 'build −5 bricks', '-20 bricks', '−20 bricks', '-0 bricks', '+8193 bricks'])
    assert.throws(() => resolveSceneSize(brief, 1000), /between 1 and 8192/);
});

test('prompt retains the brief and communicates the effective rough target', () => {
  const brief = 'Build 500 bricks, with a café 🌱';
  const { target } = resolveSceneSize(brief, 2000);
  const prompt = planningPrompt('space', brief, false, target);
  assert.match(prompt, /roughly 500 expanded bricks.*not an exact count/);
  assert.ok(prompt.endsWith(`User brief: ${JSON.stringify(brief)}`));
  assert.match(planningPrompt('space', 'A tower'), /normal target is up to 1000/);
});
