import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCustomSpec } from '../src/custom-design.mjs';
import { Team, allBricks, createPlan, restoreSnapshot, validateSpec } from '../src/engine';

const brick = (x: number, y: number, z: number, width: number, height: number, depth: number, part: 'frame' | 'detail' = 'frame') =>
  ({ x, y, z, width, height, depth, part, color: part === 'frame' ? 'blue' : 'orange' });
const design = (name: string, bricks: ReturnType<typeof brick>[]) => ({
  world: 'space', model: 'custom', color: 'blue', longTail: false, wideWings: false, budget: 50, design: { name, bricks },
});
const fixtures = [
  design('Lighthouse', [brick(0, 0, 0, 3, 1, 3), brick(1, 1, 1, 1, 4, 1), brick(0, 5, 0, 3, 1, 3, 'detail')]),
  design('Garden bench', [brick(-3, 0, 0, 1, 2, 2), brick(1, 0, 0, 1, 2, 2), brick(-3, 2, 0, 5, 1, 2), brick(-3, 3, 1, 5, 2, 1, 'detail')]),
];
for (const fixture of fixtures) test(`${fixture.design.name}: execute, inspect, repair and restore custom geometry`, () => {
  const spec = validateSpec(fixture, 'space');
  const plan = createPlan(spec, [], 'copilot');
  assert.equal(plan.spec.design?.name, fixture.design.name);
  assert.equal(allBricks(plan).length, fixture.design.bricks.length);
  assert.ok(allBricks(plan).some(b => (b.width ?? 1) > 1 || (b.height ?? 1) > 1));
  const team = new Team(plan);
  team.step(20);
  assert.ok(team.plan.tasks.every(t => team.taskDone(t)));
  assert.equal(team.status, 'complete', JSON.stringify(team.checks));
  assert.deepEqual(team.checks.map(c => c.label), ['Brief fulfilled', 'Connected model', 'Within budget']);
  team.damage();
  assert.equal(team.status, 'damaged');
  const restored = restoreSnapshot(JSON.parse(JSON.stringify(team.snapshot(fixture.design.name))));
  restored.team.repair();
  restored.team.step(20);
  assert.equal(restored.team.status, 'complete');
  const again = restoreSnapshot(JSON.parse(JSON.stringify(restored.team.snapshot(fixture.design.name))));
  assert.deepEqual(again.team.plan.spec, spec);
  assert.deepEqual([...again.team.bricks.values()], [...restored.team.bricks.values()]);
});

test('custom input rejects overlaps, out-of-bounds, unsafe values and excessive volume', () => {
  assert.throws(() => validateCustomSpec(design('overlap', [brick(0, 0, 0, 2, 2, 2), brick(1, 1, 1, 1, 1, 1)])), /overlap/);
  assert.throws(() => validateCustomSpec(design('bounds', [brick(24, 0, 0, 2, 1, 1)])), /bounds/);
  assert.throws(() => validateCustomSpec(design('bounds', [brick(0, 32, 0, 1, 2, 1)])), /bounds/);
  assert.throws(() => validateCustomSpec(design('size', [brick(0, 0, 0, 9, 1, 1)])), /dimensions/);
  assert.throws(() => validateCustomSpec(design('unsafe\u0000name', [brick(0, 0, 0, 1, 1, 1)])), /name/);
  assert.throws(() => validateCustomSpec(design('bad color', [{ ...brick(0, 0, 0, 1, 1, 1), color: 'url(evil)' }])), /color/);
  assert.throws(() => validateCustomSpec(design('volume', Array.from({ length: 9 }, (_, i) => brick(-24 + (i % 6) * 8, Math.floor(i / 6) * 8, 0, 8, 8, 8)))), /4096/);
  assert.throws(() => validateCustomSpec({ ...fixtures[0], budget: 1 }), /budget/);
  assert.throws(() => validateSpec(fixtures[0], 'jurassic'), /world/);
});

test('disconnected custom designs are reported instead of pretending repair fixed topology', () => {
  const team = new Team(createPlan(validateCustomSpec(design('two islands', [brick(0, 0, 0, 2, 1, 1), brick(5, 0, 0, 1, 1, 1)]))));
  team.step(20);
  assert.equal(team.status, 'damaged');
  assert.equal(team.checks.find(c => c.label === 'Connected model')?.pass, false);
  team.repair();
  assert.equal(team.status, 'damaged');
  assert.match(team.events.at(-1)!.message, /topology/);
});
