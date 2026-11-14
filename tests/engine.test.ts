import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENTS, Team, EXAMPLES, allBricks, createPlan, loadAIMission, parseBrief, restoreSnapshot, validateSpec, type World } from '../src/engine';
import { worldExample } from '../src/world-examples';

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

test('what-if damage removes a deterministic third of actual bricks and inspection counts identities', () => {
  const plan = createPlan(parseBrief('jurassic', EXAMPLES.jurassic[0]).spec);
  const first = new Team(plan), second = new Team(plan);
  finish(first);
  finish(second);
  const expected = new Set(allBricks(plan).map(brick => brick.id));
  const removeCount = Math.max(1, Math.ceil(expected.size / 3));

  first.damage();
  second.damage();
  const missing = [...expected].filter(id => !first.bricks.has(id)).sort();
  assert.equal(missing.length, removeCount);
  assert.deepEqual(missing, [...expected].filter(id => !second.bricks.has(id)).sort());
  assert.equal(first.status, 'damaged');
  assert.equal(first.checks[0].pass, false);
  assert.match(first.checks[0].detail, new RegExp(`${removeCount} planned bricks? missing`));
  assert.ok(first.events.some(e => e.agent === 'check' && e.message.includes(`found ${removeCount} missing brick`)));
});

test('damage, save/reload and repair restore every mixed-size named-object identity', () => {
  const spec = validateSpec({
    world: 'space', model: 'custom', color: 'blue', longTail: false, wideWings: false, budget: 20,
    design: { name: 'Two named builds', objects: [
      { name: 'Tower', bricks: [
        { x: 0, y: 0, z: 0, width: 2, height: 1, depth: 1, color: 'blue', part: 'frame' },
        { x: 0, y: 1, z: 0, width: 1, height: 1, depth: 1, color: 'blue', part: 'frame' },
        { x: 1, y: 1, z: 0, width: 1, height: 1, depth: 1, color: 'orange', part: 'detail' },
        { x: 0, y: 2, z: 0, width: 1, height: 1, depth: 1, color: 'orange', part: 'detail' },
      ] },
      { name: 'Beacon', bricks: [
        { x: 20, y: 0, z: 0, width: 2, height: 1, depth: 1, color: 'blue', part: 'frame' },
        { x: 20, y: 1, z: 0, width: 1, height: 1, depth: 1, color: 'orange', part: 'detail' },
      ] },
    ] },
  }, 'space');
  const plan = createPlan(spec);
  const team = new Team(plan);
  finish(team);
  const planned = new Map(allBricks(plan).map(brick => [brick.id, brick]));
  assert.equal(team.status, 'complete', JSON.stringify(team.checks));
  assert.ok(allBricks(plan).some(brick => brick.width! > 1));
  team.damage();
  const missingBeforeSave = [...planned.keys()].filter(id => !team.bricks.has(id)).sort();
  assert.equal(missingBeforeSave.length, Math.ceil(planned.size / 3));
  assert.ok(missingBeforeSave.some(id => planned.get(id)!.width! > 1), 'the damage sample includes a multi-cell brick identity');

  const damagedSave = JSON.parse(JSON.stringify(team.snapshot('named mixed-size scene')));
  const loaded = restoreSnapshot(damagedSave);
  assert.equal(loaded.prompt, 'named mixed-size scene');
  assert.equal(loaded.team.status, 'damaged');
  assert.deepEqual([...planned.keys()].filter(id => !loaded.team.bricks.has(id)).sort(), missingBeforeSave);
  assert.match(loaded.team.checks[0].detail, new RegExp(`${missingBeforeSave.length} planned bricks? missing`));
  loaded.team.repair();
  finish(loaded.team);
  assert.equal(loaded.team.status, 'complete', JSON.stringify(loaded.team.checks));
  assert.deepEqual([...loaded.team.bricks.keys()].sort(), [...planned.keys()].sort());
  assert.deepEqual([...loaded.team.bricks.values()].sort((a, b) => a.id.localeCompare(b.id)),
    [...planned.values()].sort((a, b) => a.id.localeCompare(b.id)));
  assert.match(loaded.team.checks.find(check => check.label === 'Connected objects')!.detail, /Tower.*Beacon/);
  const reloaded = restoreSnapshot(JSON.parse(JSON.stringify(loaded.team.snapshot('named mixed-size scene'))));
  assert.equal(reloaded.team.status, 'complete');
  assert.deepEqual([...reloaded.team.bricks.keys()].sort(), [...planned.keys()].sort());
});

test('five agents review, build, inspect and coordinate repair', () => {
  assert.deepEqual(Object.keys(AGENTS), ['build', 'plan', 'frame', 'detail', 'check']);
  const team = new Team(createPlan(parseBrief('jurassic', EXAMPLES.jurassic[0]).spec));
  assert.ok(team.events.some(e => e.agent === 'plan' && /dependencies: no missing tasks or cycles/.test(e.message)));
  finish(team);
  for (const agent of ['build', 'plan', 'frame', 'detail', 'check']) assert.ok(team.events.some(e => e.agent === agent));
  assert.ok(team.events.some(e => e.agent === 'check' && e.kind === 'verify' && /passed inspection/.test(e.message)));
  team.damage();
  assert.ok(team.events.some(e => e.agent === 'check' && /found \d+ missing bricks?/.test(e.message)));
  team.repair();
  assert.ok(team.events.some(e => e.agent === 'build' && e.kind === 'delegate' && /missing identities/.test(e.message)));
  assert.ok(team.events.some(e => e.agent === 'check' && /owning builder/.test(e.message)));
  finish(team);
  assert.equal(restoreSnapshot(JSON.parse(JSON.stringify(team.snapshot('old save compatible')))).team.status, 'complete');
});

function structuralSpec(count: number, withDetail = false) {
  return validateSpec({
    world: 'space', model: 'custom', color: 'blue', longTail: false, wideWings: false, budget: 20,
    design: { name: 'Structural tower', bricks: [
      ...Array.from({ length: count }, (_, y) => ({
        x: 0, y, z: 0, width: y === 0 ? 2 : 1, height: 1, depth: 1, color: 'blue', part: 'frame',
      })),
      ...(withDetail ? [{ x: 0, y: count, z: 0, width: 1, height: 1, depth: 1, color: 'orange', part: 'detail' }] : []),
    ] },
  }, 'space');
}

for (const [count, withDetail] of [[2, false], [3, false], [7, false], [6, true]] as const) {
  test(`both builders place structural bricks with real dependency handoffs: ${count} frame, ${withDetail ? 1 : 0} detail`, () => {
    const plan = createPlan(structuralSpec(count, withDetail));
    const team = new Team(plan);
    const placedBy = { frame: 0, detail: 0 };
    const structuralBy = { frame: 0, detail: 0 };
    const ticks = new Map<string, number>();
    for (let turn = 0; turn < 30 && team.status !== 'complete'; turn++) {
      const before = new Set(team.bricks.keys());
      team.step(1);
      for (const brick of team.bricks.values()) {
        if (before.has(brick.id)) continue;
        placedBy[brick.agent]++;
        if (brick.part === 'frame') structuralBy[brick.agent]++;
        ticks.set(brick.id, team.tick);
        const task = plan.tasks.find(task => task.bricks.some(item => item.id === brick.id))!;
        for (const dependency of task.depends)
          assert.ok(team.taskDone(plan.tasks.find(task => task.id === dependency)!));
      }
    }
    assert.equal(team.status, 'complete', JSON.stringify(team.checks));
    assert.equal(placedBy.frame + placedBy.detail, count + Number(withDetail));
    for (const agent of ['frame', 'detail'] as const) {
      assert.ok(structuralBy[agent] > 0, `${agent} must actually place frame geometry`);
      assert.ok(team.events.some(event => event.agent === agent && event.kind === 'place'));
      assert.ok(team.events.some(event => event.agent === agent && /accepted.*handoff/.test(event.message)));
      const task = plan.tasks.find(task => task.agent === agent)!;
      const handoff = team.events.find(event => event.agent === 'build' && event.kind === 'delegate'
        && event.message.includes(`"${task.label}"`) && event.message.includes(AGENTS[agent].name))!;
      assert.ok(handoff, `${agent} must receive a routed construction task`);
      assert.ok(team.events.some(event => event.agent === 'plan' && event.kind === 'verify'
        && event.message.includes(`"${task.label}"`) && /may proceed/.test(event.message)));
      assert.ok(task.bricks.every(brick => handoff.tick <= ticks.get(brick.id)!));
    }
    assert.equal(new Set(allBricks(plan).map(brick => brick.id)).size, count + Number(withDetail));
    assert.deepEqual(plan.tasks.find(task => task.agent === 'detail')!.depends, ['frame:frame']);
    const frameTicks = plan.tasks.find(task => task.agent === 'frame')!.bricks.map(brick => ticks.get(brick.id)!);
    const detailTicks = plan.tasks.find(task => task.agent === 'detail')!.bricks.map(brick => ticks.get(brick.id)!);
    assert.ok(Math.max(...frameTicks) <= Math.min(...detailTicks), 'base construction finishes before assembly');
    assert.ok(team.events.some(event => event.agent === 'check' && /passed inspection/.test(event.message)));
  });
}

test('a single structural brick stays a single task without empty or duplicate work', () => {
  const plan = createPlan(structuralSpec(1));
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].agent, 'frame');
  const team = new Team(plan);
  finish(team);
  assert.equal(team.bricks.size, 1);
  assert.ok(!team.events.some(event => event.agent === 'detail' && event.kind === 'place'));
});

test('shared structural assembly still finishes before low-lying decorative bricks', () => {
  const tower = structuralSpec(6);
  const spec = validateSpec({ ...tower, design: { ...tower.design, bricks: [
    ...tower.design!.bricks!,
    { x: 2, y: 0, z: 0, width: 1, height: 1, depth: 1, color: 'orange', part: 'detail' },
  ] } }, 'space');
  const team = new Team(createPlan(spec));
  for (let turn = 0; turn < 20 && team.status !== 'complete'; turn++) {
    team.step(1);
    if ([...team.bricks.values()].some(brick => brick.part === 'detail'))
      assert.ok(allBricks(team.plan).filter(brick => brick.part === 'frame').every(brick => team.bricks.has(brick.id)));
  }
  assert.equal(team.status, 'complete');
});

test('legacy frame-only saves migrate task priorities and canonical ownership in every state', () => {
  const plan = createPlan(structuralSpec(6));
  const canonical = allBricks(plan);
  for (const [placed, status] of [[0, 'planned'], [1, 'paused'], [5, 'damaged'], [6, 'complete']] as const) {
    const save = {
      ...new Team(plan).snapshot('legacy frame-only tower'), status,
      bricks: canonical.slice(0, placed).map(brick => ({ ...brick, agent: 'frame' })),
      taskOrder: ['frame:frame'],
    };
    const team = restoreSnapshot(JSON.parse(JSON.stringify(save))).team;
    assert.equal(team.bricks.size, placed);
    for (const brick of team.bricks.values())
      assert.equal(brick.agent, canonical.find(item => item.id === brick.id)!.agent);
    assert.deepEqual(team.plan.tasks.map(task => task.id), ['frame:frame', 'detail:detail']);
    if (status === 'damaged') team.repair();
    finish(team);
    assert.deepEqual([...team.bricks.keys()].sort(), canonical.map(brick => brick.id).sort());
    const reloaded = restoreSnapshot(JSON.parse(JSON.stringify(team.snapshot('new save')))).team;
    assert.equal(reloaded.status, 'complete');
    team.damage();
    const damaged = restoreSnapshot(JSON.parse(JSON.stringify(team.snapshot('damaged new save')))).team;
    damaged.repair();
    finish(damaged);
    assert.deepEqual([...damaged.bricks.keys()].sort(), canonical.map(brick => brick.id).sort());
  }
});

test('named frame-only objects preserve legacy priority order while adding dependent assembly tasks', () => {
  const tower = structuralSpec(4);
  const spec = validateSpec({ ...tower, design: { name: 'Two towers', objects: [
    { name: 'First tower', bricks: tower.design!.bricks! },
    { name: 'Second tower', bricks: tower.design!.bricks!.map(brick => ({ ...brick, x: brick.x + 20 })) },
  ] } }, 'space');
  const plan = createPlan(spec);
  const save = { ...new Team(plan).snapshot('old named scene'),
    taskOrder: ['frame:object-1', 'frame:object-0'] };
  const team = restoreSnapshot(save).team;
  assert.deepEqual(team.plan.tasks.slice(0, 2).map(task => task.id), save.taskOrder);
  for (const index of [0, 1]) {
    const assembly = team.plan.tasks.find(task => task.id === `detail:object-${index}`)!;
    assert.deepEqual(assembly.depends, [`frame:object-${index}`]);
    assert.ok(assembly.bricks.every(brick => brick.agent === 'detail' && brick.part === 'frame'));
  }
  finish(team);
  assert.equal(team.bricks.size, 8);
  for (const agent of ['frame', 'detail'])
    assert.equal([...team.bricks.values()].filter(brick => brick.agent === agent).length, 4);
  assert.match(team.checks[1].detail, /First tower.*Second tower/);
  assert.throws(() => restoreSnapshot({ ...save, taskOrder: ['frame:object-0'] }), /priority order/);
  assert.throws(() => restoreSnapshot({ ...save, taskOrder: [...save.taskOrder, 'detail:object-0'] }), /priority order/);
  assert.throws(() => restoreSnapshot({ ...save, taskOrder: ['frame:object-0', 'frame:object-0'] }), /priority order/);
  assert.throws(() => restoreSnapshot({ ...save, taskOrder: ['frame:object-0', 'frame:unknown'] }), /priority order/);
});

test('legacy AI task priorities also allow newly shared structural assembly', () => {
  const spec = structuralSpec(4);
  const { team } = loadAIMission({
    kind: 'bricklab-ai-mission', version: 1, brief: 'legacy structural tower', model: 'fixture-only', spec,
    decisions: ['build', 'frame', 'detail'].map(agent => ({
      agent, explanation: 'Fixture decision.', taskOrder: agent === 'frame' ? ['frame:frame'] : [],
    })),
  });
  finish(team);
  assert.equal([...team.bricks.values()].filter(brick => brick.agent === 'detail').length, 2);
});

for (const world of ['jurassic', 'space'] as const) {
  test(`shared structural work repairs the complete ${world} scene across incremental turns`, () => {
    const team = new Team(createPlan(worldExample(world)));
    finish(team);
    team.damage();
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(team.snapshot('local scene')))).team;
    restored.repair();
    finish(restored);
    assert.ok(restored.checks.every(check => check.pass));
    assert.deepEqual([...restored.bricks.keys()].sort(), allBricks(team.plan).map(brick => brick.id).sort());
  });
}

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
