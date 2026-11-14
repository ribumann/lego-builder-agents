import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENTS, Team, EXAMPLES, allBricks, createPlan, loadAIMission, parseBrief, restoreSnapshot, validateSpec, type World } from '../src/engine';

function finish(team: Team) {
  for (let i = 0; i < 2000 && team.status !== 'complete' && team.status !== 'damaged'; i++) team.step(16);
  assert.equal(team.status, 'complete', JSON.stringify(team.checks));
}
for (const world of ['jurassic', 'space'] as World[]) {
  for (const prompt of EXAMPLES[world]) {
    test(`build, inspect, damage, repair and restore: ${prompt}`, () => {
      const { spec, assumptions } = parseBrief(world, prompt);
      const plan = createPlan(spec, assumptions);
      const team = new Team(plan);
      finish(team);
      assert.equal(team.checks.filter(c => c.pass).length, 4);
      assert.equal(new Set(allBricks(plan).map(b => b.id)).size, allBricks(plan).length);
      team.damage();
      assert.equal(team.status, 'damaged');
      assert.equal(team.checks[0].pass, false);
      const damaged = restoreSnapshot(JSON.parse(JSON.stringify(team.snapshot(prompt))));
      assert.equal(damaged.team.status, 'damaged');
      damaged.team.repair();
      finish(damaged.team);
      assert.ok(damaged.team.events.some(e => e.kind === 'repair'));
      const restored = restoreSnapshot(JSON.parse(JSON.stringify(damaged.team.snapshot(prompt))));
      assert.equal(restored.team.status, 'complete');
      assert.equal(restored.team.bricks.size, allBricks(plan).length);
      assert.equal(restored.prompt, prompt);
    });
  }
}
test('specialists act concurrently, but no detail violates its dependency', () => {
  const team = new Team(createPlan(parseBrief('jurassic', EXAMPLES.jurassic[0]).spec));
  let concurrent = false;
  for (let i = 0; i < 1000 && team.status !== 'complete'; i++) {
    const before = team.bricks.size;
    team.step(1);
    const placed = [...team.bricks.values()].slice(before);
    if (new Set(placed.map(b => b.agent)).size === 2) concurrent = true;
    for (const b of placed) {
      const task = team.plan.tasks.find(t => t.bricks.some(brick => brick.id === b.id))!;
      for (const dependency of task.depends)
        assert.ok(team.taskDone(team.plan.tasks.find(t => t.id === dependency)!));
    }
  }
  assert.ok(concurrent, 'Specialists should share at least one turn');
});
test('vague brief exposes assumptions; supported inputs actually change geometry', () => {
  const vague = parseBrief('jurassic', 'Build a dinosaur.');
  assert.equal(vague.assumptions.length, 2);
  const long = createPlan(parseBrief('jurassic', 'green stegosaurus with long tail').spec);
  const short = createPlan(parseBrief('jurassic', 'green stegosaurus').spec);
  assert.ok(allBricks(long).length > allBricks(short).length);
  const wide = createPlan(parseBrief('space', 'blue explorer with wide wings').spec);
  const narrow = createPlan(parseBrief('space', 'blue explorer').spec);
  assert.ok(Math.max(...allBricks(wide).map(b => b.z)) > Math.max(...allBricks(narrow).map(b => b.z)));
});
test('invalid input, mismatched worlds, wrong era and budgets produce explicit errors', () => {
  assert.throws(() => parseBrief('space', ''), /brief/);
  assert.throws(() => parseBrief('jurassic', 'spaceship'), /Switch to Space/);
  assert.throws(() => parseBrief('space', 'dinosaur'), /Switch to Jurassic/);
  assert.throws(() => parseBrief('jurassic', 'T rex'), /Cretaceous/);
  assert.throws(() => createPlan(parseBrief('space', 'spaceship under 20 bricks').spec), /above your 20-brick budget/);
  assert.throws(() => parseBrief('space', 'budget 9999'), /between/);
  assert.throws(() => validateSpec({ world: 'space', model: 'stegosaurus' }, 'space'), /invalid/);
});
test('untrusted saves cannot introduce arbitrary bricks, duplicates or out-of-range specs', () => {
  const team = new Team(createPlan(parseBrief('space', 'blue explorer').spec));
  team.step(2);
  const snapshot = team.snapshot('blue explorer');
  assert.throws(() => restoreSnapshot({ ...snapshot, bricks: [{ id: '<script>bad</script>' }] }), /unknown/);
  assert.throws(() => restoreSnapshot({ ...snapshot, bricks: [snapshot.bricks[0], snapshot.bricks[0]] }), /duplicate/);
  assert.throws(() => restoreSnapshot({ ...snapshot, spec: { ...snapshot.spec, budget: Infinity } }), /invalid/);
  const paused = restoreSnapshot(snapshot);
  assert.equal(paused.team.status, 'paused');
  finish(paused.team);
});
test('fast-forward produces exactly the same model as single-step execution', () => {
  const plan = createPlan(parseBrief('space', 'white cargo spaceship').spec);
  const slow = new Team(plan);
  const fast = new Team(plan);
  while (slow.status !== 'complete') slow.step(1);
  finish(fast);
  assert.deepEqual([...slow.bricks.keys()].sort(), [...fast.bricks.keys()].sort());
  assert.ok(slow.tick > fast.tick);
});

test('five agents review, build, inspect and coordinate repair', () => {
  assert.deepEqual(Object.keys(AGENTS), ['build', 'plan', 'frame', 'detail', 'check']);
  const team = new Team(createPlan(parseBrief('jurassic', EXAMPLES.jurassic[0]).spec));
  assert.ok(team.events.some(e => e.agent === 'plan' && /dependencies: no missing tasks or cycles/.test(e.message)));
  finish(team);
  for (const agent of ['build', 'plan', 'frame', 'detail', 'check']) assert.ok(team.events.some(e => e.agent === agent));
  assert.ok(team.events.some(e => e.agent === 'check' && e.kind === 'verify' && /passed inspection/.test(e.message)));
  team.damage();
  assert.ok(team.events.some(e => e.agent === 'check' && /found 1 missing brick/.test(e.message)));
  team.repair();
  assert.ok(team.events.some(e => e.agent === 'check' && /owning builder/.test(e.message)));
  finish(team);
  assert.equal(restoreSnapshot(JSON.parse(JSON.stringify(team.snapshot('old save compatible')))).team.status, 'complete');
});

test('PlanBot blocks unresolved and cyclic task graphs before execution', () => {
  const plan = createPlan(parseBrief('space', 'blue explorer').spec);
  const invalid = { ...plan, tasks: plan.tasks.map(task => ({ ...task, depends: [...task.depends] })) };
  invalid.tasks[0].depends.push('frame:does-not-exist');
  assert.throws(() => new Team(invalid), /PlanBot.*unknown task dependency/);
  invalid.tasks[0].depends = [invalid.tasks[0].id];
  assert.throws(() => new Team(invalid), /PlanBot.*cycle/);
});

test('legacy three-decision AI mission still uses local PlanBot and CheckBot', () => {
  const spec = parseBrief('space', 'blue explorer').spec;
  const plan = createPlan(spec);
  const mission = {
    kind: 'bricklab-ai-mission', version: 1, brief: 'blue explorer', model: 'fixture-only', spec,
    decisions: ['build', 'frame', 'detail'].map(agent => ({
      agent, explanation: 'Fixture decision.', taskOrder: plan.tasks.filter(task => task.agent === agent).map(task => task.id),
    })),
  };
  const { team } = loadAIMission(mission);
  assert.ok(team.events.some(e => e.agent === 'plan' && e.kind === 'verify'));
  finish(team);
  assert.ok(team.events.some(e => e.agent === 'check' && e.kind === 'verify'));
  assert.equal(team.events.filter(e => e.message.includes('AI mission decision:')).length, 3);
});
