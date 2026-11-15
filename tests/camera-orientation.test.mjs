import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planningPrompt } from '../planning-prompt.mjs';
import { DEFAULT_CAMERA_OFFSET } from '../src/camera-view.mjs';
import { allBricks, createPlan, parseBrief } from '../src/engine.ts';

test('default camera faces the built-in asymmetric models from their +X front', () => {
  assert.ok(DEFAULT_CAMERA_OFFSET.x > DEFAULT_CAMERA_OFFSET.z);

  const ship = allBricks(createPlan(parseBrief('space', 'blue explorer spaceship with wide wings and two engines').spec));
  const nose = ship.filter(brick => brick.part === 'nose');
  const engines = ship.filter(brick => brick.part === 'engines');
  assert.ok(nose.length && engines.length);
  assert.ok(Math.min(...nose.map(brick => brick.x)) > Math.max(...engines.map(brick => brick.x)));

  const dinosaur = allBricks(createPlan(parseBrief('jurassic', 'green stegosaurus with a long tail').spec));
  const head = dinosaur.filter(brick => brick.part === 'head');
  const tail = dinosaur.filter(brick => brick.part === 'tail');
  assert.ok(head.length && tail.length);
  assert.ok(Math.min(...head.map(brick => brick.x)) > Math.max(...tail.map(brick => brick.x)));
});

test('custom planning aligns distinct fronts with the default camera without overriding explicit direction', () => {
  const prompt = planningPrompt('space', 'Build a custom exploration ship.');
  assert.match(prompt, /orient it toward \+X, the default camera side/);
  assert.match(prompt, /unless the brief explicitly requests otherwise/);
});
