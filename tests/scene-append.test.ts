import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Team, allBricks, createPlan, validateSpec, type Brick, type Plan, type Spec,
} from '../src/engine';
import { worldExample } from '../src/world-examples';
import { appendScene, restoreSceneAppend, snapshotSceneAppend } from '../src/scene-append';

function finish(team: Team) {
  for (let i = 0; i < 5000 && team.status !== 'complete' && team.status !== 'damaged'; i++) team.step(20);
  assert.equal(team.status, 'complete', JSON.stringify(team.checks));
}

function cells(bricks: Brick[]) {
  const result = new Set<string>();
  for (const brick of bricks)
    for (let x = brick.x; x < brick.x + (brick.width ?? 1); x++)
      for (let y = brick.y; y < brick.y + (brick.height ?? 1); y++)
        for (let z = brick.z; z < brick.z + (brick.depth ?? 1); z++) {
          const key = `${x},${y},${z}`;
          assert.ok(!result.has(key), `overlapping cell ${key}`);
          result.add(key);
        }
  return result;
}

function customPlan(name: string, source: Plan['source'], objects: NonNullable<Spec['design']>['objects']): Plan {
  const spec = validateSpec({
    world: 'space', model: 'custom', color: 'blue', longTail: false, wideWings: false, budget: 100,
    design: { name, objects },
  }, 'space');
  return createPlan(spec, [], source);
}

test('appends overlapping template Plans deterministically and preserves existing work', () => {
  const template = createPlan(validateSpec({
    world: 'space', model: 'explorer', color: 'blue', longTail: false, wideWings: false, budget: 700,
  }, 'space'));
  const previous = new Team(template);
  previous.step(12);
  const oldBricks = allBricks(previous.plan).map(brick => ({ ...brick }));
  const placed = [...previous.bricks.values()].map(brick => ({ ...brick }));
  const first = appendScene(previous, template);
  const repeated = appendScene(previous, template);

  assert.deepEqual(first.offset, repeated.offset);
  assert.notDeepEqual(first.offset, { x: 0, z: 0 });
  assert.equal(previous.bricks.size, placed.length, 'the input Team is not mutated');
  for (const brick of placed) {
    const retained = first.team.bricks.get(brick.id)!;
    const { object: _object, agent: _agent, ...geometry } = retained;
    const { object: _oldObject, agent: _oldAgent, ...oldGeometry } = brick;
    assert.deepEqual(geometry, oldGeometry);
    assert.equal(retained.object, 'Explorer');
    assert.equal(retained.agent, allBricks(first.team.plan).find(item => item.id === brick.id)!.agent);
  }
  assert.deepEqual([...previous.bricks.values()], placed);
  for (const brick of oldBricks) {
    const retained = allBricks(first.team.plan).find(candidate => candidate.id === brick.id);
    assert.ok(retained);
    assert.equal(retained.x, brick.x);
    assert.equal(retained.y, brick.y);
    assert.equal(retained.z, brick.z);
  }
  assert.equal(new Set(allBricks(first.team.plan).map(brick => brick.id)).size, allBricks(first.team.plan).length);
  const canonical = allBricks(createPlan(first.team.plan.spec));
  assert.deepEqual(allBricks(first.team.plan).map(brick => [brick.id, brick.agent]),
    canonical.map(brick => [brick.id, brick.agent]));
  cells(allBricks(first.team.plan));
  finish(first.team);
  assert.equal(first.team.checks.at(-1)?.label, 'Within budget');
});

test('compact mixed-size repeated geometry stays appendable and survives save and restore', () => {
  const spec = validateSpec({
    world: 'space', model: 'custom', color: 'blue', longTail: false, wideWings: false, budget: 300,
    design: { name: 'Four rows', objects: [{ name: 'Four rows', bricks: [0, 1, 2, 3].map(z => ({
      x: -64, y: 0, z, width: 2, height: 1, depth: 1,
      color: z % 2 ? 'orange' : 'blue', part: z % 2 ? 'detail' : 'frame',
      repeat: { count: 64, dx: 2, dy: 0, dz: 0 },
    })) }] },
  }, 'space');
  const previous = new Team(createPlan(spec, [], 'copilot'));
  previous.step(12);
  assert.ok(previous.bricks.size > 0);
  const added = customPlan('Marker', 'local', [{
    name: 'Marker', bricks: [{ x: 0, y: 0, z: 8, width: 1, height: 1, depth: 1, color: 'white', part: 'frame' }],
  }]);
  const result = appendScene(previous, added);
  const objects = result.team.plan.spec.design!.objects!;
  assert.equal(objects.reduce((count, object) => count + object.bricks.length, 0), 5);
  assert.deepEqual(result.offset, { x: 0, z: 0 });
  assert.equal(allBricks(result.team.plan).length, 257);
  assert.equal(cells(allBricks(result.team.plan)).size, 513);
  const appearance = (brick: Brick) => {
    const { id, x, y, z, width, height, depth, color, part } = brick;
    return { id, x, y, z, width, height, depth, color, part };
  };
  const original = new Map(allBricks(previous.plan).map(brick => [brick.id, appearance(brick)]));
  const restored = restoreSceneAppend(JSON.parse(JSON.stringify(snapshotSceneAppend(result.team, 'Rows'))));
  for (const brick of allBricks(restored.team.plan).filter(item => item.object === 'Four rows'))
    assert.deepEqual(appearance(brick), original.get(brick.id));
  assert.deepEqual([...restored.team.bricks.keys()].sort(), [...previous.bricks.keys()].sort());
  assert.deepEqual(restored.provenance, result.provenance);
});

for (const model of ['explorer', 'custom'] as const) {
  test(`fully built original ${model} retains named membership and completes after append and reload`, () => {
    const spec = validateSpec(model === 'explorer' ? {
      world: 'space', model, color: 'blue', longTail: false, wideWings: false, budget: 700,
    } : {
      world: 'space', model, color: 'blue', longTail: false, wideWings: false, budget: 100,
      design: { name: 'Original support', bricks: [
        { x: 0, y: 0, z: 0, width: 2, height: 2, depth: 2, color: 'blue', part: 'frame' },
      ] },
    }, 'space');
    const previous = new Team(createPlan(spec, [], 'local-ai'));
    finish(previous);
    const before = JSON.parse(JSON.stringify(previous.snapshot('Original')));
    const addition = customPlan('Beacon', 'copilot', [{
      name: 'Beacon', bricks: [
        { x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, color: 'orange', part: 'frame' },
      ],
    }]);
    const result = appendScene(previous, addition);
    const originals = new Map(allBricks(previous.plan).map(brick => [brick.id, brick]));
    const membership = new Map(allBricks(result.team.plan).map(brick => [brick.id, brick.object]));
    assert.equal(result.team.bricks.size, previous.bricks.size);
    for (const [id, brick] of result.team.bricks) {
      const { object: _object, agent: _agent, ...geometry } = brick;
      const { object: _oldObject, agent: _oldAgent, ...oldGeometry } = originals.get(id)!;
      assert.deepEqual(geometry, oldGeometry);
      assert.ok(brick.object);
      assert.equal(brick.object, membership.get(id));
    }
    assert.deepEqual(previous.snapshot('Original'), before, 'input remains unchanged');
    finish(result.team);
    const connectivity = result.team.checks.find(check => check.label === 'Connected objects')!;
    assert.equal(connectivity.pass, true);
    assert.ok(connectivity.detail.includes(`${originals.size}/${originals.size}`));
    const restored = restoreSceneAppend(JSON.parse(JSON.stringify(snapshotSceneAppend(result.team, 'Appended'))));
    assert.equal(restored.team.status, 'complete');
    assert.deepEqual(restored.provenance, result.provenance);
  });
}

test('retained single-object islands remain visible to partial and final connectivity inspection', () => {
  const previous = new Team(createPlan(validateSpec({
    world: 'space', model: 'custom', color: 'blue', longTail: false, wideWings: false, budget: 100,
    design: { name: 'Original islands', bricks: [0, 1, 5, 6].map(x => ({
      x, y: 0, z: 0, width: 1, height: 1, depth: 1, color: 'blue', part: 'frame',
    })) },
  }, 'space')));
  // Two legitimately planned, but disconnected, placed islands with no object metadata.
  for (const brick of allBricks(previous.plan).filter(brick => brick.x === 0 || brick.x === 5))
    previous.bricks.set(brick.id, brick);
  previous.status = 'paused';
  const addition = customPlan('Beacon', 'copilot', [{
    name: 'Beacon', bricks: [
      { x: 20, y: 0, z: 0, width: 1, height: 1, depth: 1, color: 'orange', part: 'frame' },
    ],
  }]);
  const result = appendScene(previous, addition);
  const planned = allBricks(result.team.plan);
  // Add a canonical member of the first island and finish the other object;
  // omitting the retained island at x=5 would now falsely pass connectivity.
  for (const brick of planned.filter(brick => brick.x === 1 || brick.object === 'Beacon'))
    result.team.bricks.set(brick.id, brick);
  assert.ok(result.team.progress < 1);
  const partial = result.team.checks.find(check => check.label === 'Connected objects')!;
  assert.equal(partial.pass, false);
  assert.match(partial.detail, /Original islands: 2\/3/);
  const restored = restoreSceneAppend(JSON.parse(JSON.stringify(snapshotSceneAppend(result.team, 'Islands'))));
  assert.equal(restored.team.checks.find(check => check.label === 'Connected objects')!.pass, false);
  for (let i = 0; i < 10 && result.team.status !== 'damaged'; i++) result.team.step(20);
  assert.equal(result.team.status, 'damaged');
  assert.match(result.team.checks.find(check => check.label === 'Connected objects')!.detail,
    /Original islands: 2\/4/);
});

test('keeps named multi-object scenes and ordered source provenance through save and restore', () => {
  const previous = new Team(createPlan(validateSpec(worldExample('space'), 'space'), [], 'local-ai'));
  finish(previous);
  const addition = customPlan('New observation objects', 'copilot', [
    { name: 'Beacon', bricks: [
      { x: -8, y: 0, z: 0, width: 1, height: 1, depth: 1, color: 'orange', part: 'frame' },
      { x: -7, y: 0, z: 0, width: 1, height: 1, depth: 1, color: 'orange', part: 'detail' },
    ] },
    { name: 'Relay', bricks: [
      { x: 8, y: 0, z: 0, width: 1, height: 2, depth: 1, color: 'white', part: 'frame' },
    ] },
  ]);
  const appended = appendScene(previous, addition);
  finish(appended.team);

  assert.deepEqual(appended.provenance.contributions, [
    { source: 'local-ai', objects: ['Blue explorer', 'White cargo ship', 'Orbital station'] },
    { source: 'copilot', objects: ['Beacon', 'Relay'] },
  ]);
  const snapshot = JSON.parse(JSON.stringify(snapshotSceneAppend(appended.team, 'Combined scene')));
  const restored = restoreSceneAppend(snapshot);
  assert.equal(restored.prompt, 'Combined scene');
  assert.deepEqual(restored.provenance, appended.provenance);
  assert.deepEqual(allBricks(restored.team.plan).map(({ id, x, y, z, object }) => ({ id, x, y, z, object })),
    allBricks(appended.team.plan).map(({ id, x, y, z, object }) => ({ id, x, y, z, object })));
  assert.equal(restored.team.status, 'complete');
  assert.ok(restored.team.plan.spec.design?.objects?.some(object => object.name === 'Orbital station'));
  assert.ok(restored.team.plan.spec.design?.objects?.some(object => object.name === 'Beacon'));
});

test('combines multiple append sources without replacing root or earlier provenance', () => {
  const first = new Team(createPlan(validateSpec({
    world: 'space', model: 'cargo', color: 'white', longTail: false, wideWings: false, budget: 700,
  }, 'space'), [], 'github-models'));
  const one = appendScene(first, createPlan(validateSpec({
    world: 'space', model: 'explorer', color: 'blue', longTail: false, wideWings: false, budget: 700,
  }, 'space'), [], 'copilot'));
  const two = appendScene(one.team, createPlan(validateSpec({
    world: 'space', model: 'explorer', color: 'red', longTail: false, wideWings: false, budget: 700,
  }, 'space'), [], 'local'));
  assert.deepEqual(two.provenance.contributions.map(item => item.source), ['github-models', 'copilot', 'local']);
  const restored = restoreSceneAppend(JSON.parse(JSON.stringify(snapshotSceneAppend(two.team, 'fleet'))));
  assert.deepEqual(restored.provenance.contributions.map(item => item.source), ['github-models', 'copilot', 'local']);
});

test('Azure source is accepted as both root and appended provenance through reload', () => {
  const plan = (source: Plan['source']) => customPlan('Support', source, [{
    name: 'Support', bricks: [
      { x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, color: 'blue', part: 'frame' },
    ],
  }]);
  for (const [root, added] of [['azure', 'copilot'], ['local', 'azure']] as const) {
    const result = appendScene(new Team(plan(root)), plan(added));
    const restored = restoreSceneAppend(JSON.parse(JSON.stringify(snapshotSceneAppend(result.team, 'Azure'))));
    assert.equal(restored.team.plan.source, root);
    assert.deepEqual(restored.provenance.contributions.map(item => item.source), [root, added]);
    finish(restored.team);
  }
});

test('partially built template supports two appends before reload and another after reload', () => {
  const previous = new Team(createPlan(validateSpec({
    world: 'space', model: 'explorer', color: 'blue', longTail: false, wideWings: false, budget: 700,
  }, 'space'), [], 'github-models'));
  previous.step(12);
  assert.ok(previous.bricks.size > 0 && previous.progress < 1);
  const geometry = ({ id, x, y, z, width = 1, height = 1, depth = 1 }: Brick) =>
    ({ id, x, y, z, width, height, depth });
  const capture = (team: Team) => ({
    planned: allBricks(team.plan).map(geometry),
    placed: [...team.bricks.values()].map(geometry),
    objects: team.plan.spec.design?.objects?.map(object => object.name) ?? [],
  });
  const retained = (team: Team, before: ReturnType<typeof capture>) => {
    const planned = new Map(allBricks(team.plan).map(brick => [brick.id, geometry(brick)]));
    for (const brick of before.planned) assert.deepEqual(planned.get(brick.id), brick);
    for (const brick of before.placed) {
      assert.ok(team.bricks.has(brick.id), `retained placed brick ${brick.id}`);
      assert.deepEqual(geometry(team.bricks.get(brick.id)!), brick);
    }
    for (const name of before.objects)
      assert.ok(team.plan.spec.design?.objects?.some(object => object.name === name));
    cells(allBricks(team.plan));
  };
  const addition = (source: Plan['source']) => customPlan('Support', source, [{
    name: 'Support', bricks: [
      { x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, color: 'orange', part: 'frame',
        repeat: { count: 6, dx: 1, dy: 0, dz: 0 } },
    ],
  }]);

  const original = capture(previous);
  const one = appendScene(previous, addition('copilot'));
  retained(one.team, original);
  one.team.step(2);
  // Simulate placed work retaining ownership metadata from an older assignment.
  const [retainedId, retainedBrick] = [...one.team.bricks][0];
  one.team.bricks.set(retainedId, {
    ...retainedBrick, agent: retainedBrick.agent === 'frame' ? 'detail' : 'frame',
  });
  const beforeSecond = capture(one.team);
  const two = appendScene(one.team, addition('local-ai'));
  retained(two.team, beforeSecond);
  retained(two.team, original);
  two.team.step(2);
  const beforeReload = capture(two.team);
  const restored = restoreSceneAppend(JSON.parse(JSON.stringify(snapshotSceneAppend(two.team, 'Growing fleet'))));
  retained(restored.team, beforeReload);
  assert.deepEqual(restored.provenance, two.provenance);
  const three = appendScene(restored.team, addition('local'));
  retained(three.team, beforeReload);
  retained(three.team, original);
  assert.deepEqual(three.provenance.contributions.map(item => item.source),
    ['github-models', 'copilot', 'local-ai', 'local']);
  assert.deepEqual(three.provenance.offsets.slice(0, 2), two.provenance.offsets);
  finish(three.team);
});

for (const world of ['jurassic', 'space'] as const) {
  test(`${world} template appearance and ownership survive multiple appends and reloads for all planned bricks`, () => {
    const original = new Team(createPlan(validateSpec({
      world, model: world === 'jurassic' ? 'stegosaurus' : 'explorer',
      color: world === 'jurassic' ? 'green' : 'blue', longTail: false, wideWings: false, budget: 700,
    }, world), [], 'github-models'));
    original.step(3);
    const appearance = (team: Team) => new Map(allBricks(team.plan)
      .map(({ id, color, part }) => [id, { color, part }]));
    const originalAppearance = appearance(original);
    assert.ok([...originalAppearance.values()].some(brick =>
      world === 'jurassic' ? brick.color === '#c4d48a' : brick.color === '#66d5e0'));
    assert.ok(allBricks(original.plan).some(brick => !original.bricks.has(brick.id)
      && !['#57a95d', '#4d91d4'].includes(brick.color)), 'unplaced accents are covered');
    const addition = () => createPlan(validateSpec({
      world, model: 'custom', color: 'blue', longTail: false, wideWings: false, budget: 100,
      design: { name: 'Frame support', bricks: [
        { x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, color: 'orange', part: 'frame',
          repeat: { count: 6, dx: 1, dy: 0, dz: 0 } },
      ] },
    }, world), [], 'copilot');
    let current = original;
    for (let i = 0; i < 3; i++) {
      const before = appearance(current);
      const appended = appendScene(current, addition());
      const appendedAppearance = appearance(appended.team);
      for (const [id, expected] of before) assert.deepEqual(appendedAppearance.get(id), expected);
      for (const [id, expected] of originalAppearance) assert.deepEqual(appendedAppearance.get(id), expected);
      const restored = restoreSceneAppend(JSON.parse(JSON.stringify(snapshotSceneAppend(appended.team, 'Accents'))));
      assert.deepEqual(appearance(restored.team), appendedAppearance, 'every color/part survives reload');
      assert.deepEqual(restored.provenance, appended.provenance);
      const canonical = new Map(allBricks(createPlan(restored.team.plan.spec)).map(brick => [brick.id, brick.agent]));
      assert.deepEqual(new Map(allBricks(appended.team.plan).map(brick => [brick.id, brick.agent])), canonical);
      for (const brick of allBricks(restored.team.plan)) assert.equal(brick.agent, canonical.get(brick.id));
      const expectedPlaced = new Map(allBricks(restored.team.plan).map(brick => [brick.id, brick]));
      for (const [id, brick] of restored.team.bricks) assert.deepEqual(brick, expectedPlaced.get(id));
      current = restored.team;
      current.step(2);
    }
    finish(current);
  });
}

test('imported appearance metadata is complete, bounded and cannot override geometry or ownership', () => {
  const plan = customPlan('Support', 'local-ai', [{
    name: 'Support', bricks: [
      { x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, color: 'blue', part: 'frame' },
    ],
  }]);
  const result = appendScene(new Team(plan), plan);
  const saved = JSON.parse(JSON.stringify(snapshotSceneAppend(result.team, 'Valid')));
  const attacks: ((raw: typeof saved) => void)[] = [
    raw => { delete raw.sceneAppendAppearance; },
    raw => { raw.sceneAppendAppearance.version = 2; },
    raw => { raw.sceneAppendAppearance.bricks.pop(); },
    raw => { raw.sceneAppendAppearance.bricks.push(raw.sceneAppendAppearance.bricks[0]); },
    raw => { raw.sceneAppendAppearance.bricks[1] = raw.sceneAppendAppearance.bricks[0]; },
    raw => { raw.sceneAppendAppearance.bricks[0].id = 'unknown'; },
    raw => { raw.sceneAppendAppearance.bricks[0].color = 'url(https://example.invalid)'; },
    raw => { raw.sceneAppendAppearance.bricks[0].color = '#12345z'; },
    raw => { raw.sceneAppendAppearance.bricks[0].part = ''; },
    raw => { raw.sceneAppendAppearance.bricks[0].part = 'x'.repeat(81); },
    raw => { raw.sceneAppendAppearance.bricks[0].part = 'unsafe\u0000part'; },
    ...['x', 'width', 'object', 'agent', '__proto__'].map(key => (raw: typeof saved) => {
      Object.defineProperty(raw.sceneAppendAppearance.bricks[0], key, { value: 'injected', enumerable: true });
    }),
    raw => { raw.sceneAppendAppearance.bricks = Array(8193).fill(raw.sceneAppendAppearance.bricks[0]); },
  ];
  for (const attack of attacks) {
    const raw = JSON.parse(JSON.stringify(saved));
    attack(raw);
    const before = JSON.stringify(raw);
    assert.throws(() => restoreSceneAppend(raw), /appearance metadata/);
    assert.equal(JSON.stringify(raw), before, 'failed restore does not mutate imported data');
  }
  assert.deepEqual(snapshotSceneAppend(result.team, 'Valid'), saved);
  assert.deepEqual(restoreSceneAppend(saved).provenance, result.provenance);
});

test('placed-work validation still rejects changed identity or geometry atomically', () => {
  const plan = customPlan('Support', 'local', [{
    name: 'Support', bricks: [
      { x: 0, y: 0, z: 0, width: 2, height: 2, depth: 2, color: 'blue', part: 'frame' },
    ],
  }]);
  for (const change of [
    { id: 'unknown' }, { x: 1 }, { y: 1 }, { z: 1 },
    { width: 1 }, { height: 1 }, { depth: 1 },
  ]) {
    const previous = new Team(plan);
    previous.step(1);
    const [id, brick] = [...previous.bricks][0];
    previous.bricks.set(id, { ...brick, ...change });
    const before = JSON.parse(JSON.stringify(previous.snapshot('before')));
    assert.throws(() => appendScene(previous, plan), /placed bricks differ/);
    assert.deepEqual(previous.snapshot('before'), before);
  }
});

test('combined compact-record limits fail atomically without replacing the prior Team', () => {
  const records = (count: number) => Array.from({ length: count }, (_, i) => ({
    x: -64, y: i % 64, z: Math.floor(i / 64) * 3,
    width: 2, height: 1, depth: 1, color: 'blue' as const, part: 'frame' as const,
  }));
  const createMany = (name: string) => createPlan(validateSpec({
    world: 'space', model: 'custom', color: 'blue', longTail: false, wideWings: false, budget: 200,
    design: { name, bricks: records(130) },
  }, 'space'));
  const previous = new Team(createMany('Prior'));
  previous.step(10);
  const before = JSON.parse(JSON.stringify(previous.snapshot('before')));
  assert.throws(() => appendScene(previous, createMany('Added')), /1–256 brick records|record/i);
  assert.deepEqual(previous.snapshot('before'), before);
});

test('a completely occupied build plane rejects append instead of overwriting bricks', () => {
  const tiles = Array.from({ length: 256 }, (_, i) => ({
    x: -64 + (i % 16) * 8, y: 0, z: -64 + Math.floor(i / 16) * 8,
    width: 8, height: 1, depth: 8, color: 'blue' as const, part: 'frame' as const,
  }));
  const previous = new Team(createPlan(validateSpec({
    world: 'space', model: 'custom', color: 'blue', longTail: false, wideWings: false, budget: 8192,
    design: { name: 'Occupied plane', bricks: tiles },
  }, 'space')));
  const before = JSON.parse(JSON.stringify(previous.snapshot('before')));
  const addition = customPlan('Single brick', 'local', [{
    name: 'New brick', bricks: [
      { x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, color: 'orange', part: 'frame' },
    ],
  }]);
  assert.throws(() => appendScene(previous, addition), /no collision-free offset/);
  assert.deepEqual(previous.snapshot('before'), before);
});

test('world mismatch is an explicit atomic error rather than a template fallback', () => {
  const previous = new Team(createPlan(validateSpec({
    world: 'jurassic', model: 'stegosaurus', color: 'green', longTail: false, wideWings: false, budget: 700,
  }, 'jurassic')));
  const before = JSON.parse(JSON.stringify(previous.snapshot('before')));
  const addition = createPlan(validateSpec({
    world: 'space', model: 'explorer', color: 'blue', longTail: false, wideWings: false, budget: 700,
  }, 'space'));
  assert.throws(() => appendScene(previous, addition), /different worlds/);
  assert.deepEqual(previous.snapshot('before'), before);
});
