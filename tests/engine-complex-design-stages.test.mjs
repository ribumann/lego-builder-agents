import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Team, allBricks, createPlan, restoreSnapshot, validateSpec } from '../src/engine.ts';

function customSpec(design, budget) {
  return validateSpec({
    world: 'space',
    model: 'custom',
    color: 'blue',
    longTail: false,
    wideWings: false,
    budget,
    design,
  }, 'space');
}

function repeatedObject(name, z) {
  return {
    name,
    bricks: [{
      x: -60, y: 0, z, width: 1, height: 1, depth: 1,
      color: 'blue', part: 'frame',
      repeat: { count: 120, dx: 1, dy: 0, dz: 0 },
    }],
  };
}

function unitBrick(x, y, z, height = 1) {
  return { x, y, z, width: 1, height, depth: 1, color: 'blue', part: 'frame' };
}

function assertTaskPartition(plan) {
  const expected = allBricks(plan).map(brick => brick.id).sort();
  const assigned = plan.tasks.flatMap(task => task.bricks.map(brick => brick.id)).sort();
  assert.deepEqual(assigned, expected, 'every planned brick is assigned exactly once');
  assert.ok(plan.tasks.every(task => task.bricks.length > 0), 'staging does not create empty tasks');

  const indexes = new Map(plan.tasks.map((task, index) => [task.id, index]));
  for (const [index, task] of plan.tasks.entries()) {
    for (const dependency of task.depends) {
      assert.ok(indexes.has(dependency), `${task.id} has a known dependency`);
      const dependencyIndex = indexes.get(dependency);
      assert.ok(dependencyIndex !== undefined && dependencyIndex < index, `${task.id} follows ${dependency}`);
    }
  }
}

function finish(team) {
  for (let i = 0; i < 2000 && team.status !== 'complete' && team.status !== 'damaged'; i++)
    team.step(16);
  assert.equal(team.status, 'complete', JSON.stringify(team.checks));
}

test('complex multi-object custom designs stage each object and survive repair and restore', () => {
  const objectNames = ['Explorer', 'Cargo'];
  const spec = customSpec({
    name: 'Two-ship fleet',
    objects: [repeatedObject(objectNames[0], 0), repeatedObject(objectNames[1], 2)],
  }, 240);
  const plan = createPlan(spec);
  assertTaskPartition(plan);
  assert.equal(plan.tasks.length, 8);

  for (const [objectIndex, name] of objectNames.entries()) {
    const tasks = plan.tasks.filter(task => task.bricks.some(brick => brick.object === name));
    assert.equal(tasks.length, 4, `${name} has two structure and two finishing stages`);
    assert.ok(tasks.every(task => task.bricks.every(brick => brick.object === name)));
    assert.ok(tasks.some(task => task.label.includes('structure · 1/2')));
    assert.ok(tasks.some(task => task.label.includes('support assembly & details · 2/2')));
    assert.ok(plan.tasks.some(task => task.id === `frame:object-${objectIndex}:stage-2`));
  }

  const team = new Team(plan);
  finish(team);
  assert.equal(team.bricks.size, 240);
  assert.ok(team.checks.every(check => check.pass), JSON.stringify(team.checks));

  team.damage();
  const damaged = restoreSnapshot(JSON.parse(JSON.stringify(team.snapshot('Two-ship fleet')))).team;
  assert.equal(damaged.status, 'damaged');
  damaged.repair();
  finish(damaged);
  assert.equal(damaged.bricks.size, 240);
  assertTaskPartition(damaged.plan);
});

test('a tiny custom design stays a single substantive task', () => {
  const plan = createPlan(customSpec({
    name: 'Tiny satellite',
    bricks: [unitBrick(0, 0, 0)],
  }, 1));
  assertTaskPartition(plan);
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].bricks.length, 1);
  assert.doesNotMatch(plan.tasks[0].label, /\d+\/\d+/);

  const team = new Team(plan);
  finish(team);
  assert.equal(team.bricks.size, 1);
});

test('an irregular hollow custom design preserves its open center without forced stages', () => {
  const bricks = [];
  for (let x = 0; x < 5; x++) {
    for (let z = 0; z < 5; z++) {
      if (x === 0 || x === 4 || z === 0 || z === 4) bricks.push(unitBrick(x, 0, z, 3));
    }
  }
  for (const [x, z] of [[5, 4], [5, 5], [6, 5]]) bricks.push(unitBrick(x, 0, z, 3));

  const plan = createPlan(customSpec({
    name: 'Irregular hollow habitat',
    bricks,
  }, bricks.length));
  assertTaskPartition(plan);
  assert.equal(allBricks(plan).length, bricks.length);
  assert.ok(allBricks(plan).every(brick => brick.x !== 2 || brick.z !== 2),
    'the ring interior remains open');
  assert.ok(allBricks(plan).some(brick => brick.x === 6 && brick.z === 5),
    'the irregular extension remains in the plan');
  assert.ok(plan.tasks.length < 5, 'small geometry is not split into artificial stages');

  const team = new Team(plan);
  finish(team);
  assert.equal(team.bricks.size, bricks.length);
  assert.ok(team.checks.every(check => check.pass), JSON.stringify(team.checks));
});
