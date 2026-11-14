import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandCustomBricks, validateCustomSpec } from '../src/custom-design.mjs';
import { Team, allBricks, createPlan, restoreSnapshot, validateSpec } from '../src/engine';
import { worldExample } from '../src/world-examples';
import { BrickBatch, MAX_DECORATIVE_STUDS } from '../src/brick-batch';
import * as THREE from 'three';

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
  for (let i = 0; i < 8192 && restored.team.step(20); i++) {}
  assert.equal(restored.team.status, 'complete');
  const again = restoreSnapshot(JSON.parse(JSON.stringify(restored.team.snapshot(fixture.design.name))));
  assert.deepEqual(again.team.plan.spec, spec);
  assert.deepEqual([...again.team.bricks.values()], [...restored.team.bricks.values()]);
});

test('custom input rejects overlaps, out-of-bounds, unsafe values and excessive volume', () => {
  assert.throws(() => validateCustomSpec(design('overlap', [brick(0, 0, 0, 2, 2, 2), brick(1, 1, 1, 1, 1, 1)])), /overlap/);
  assert.throws(() => validateCustomSpec(design('bounds', [brick(63, 0, 0, 2, 1, 1)])), /bounds/);
  assert.throws(() => validateCustomSpec(design('bounds', [brick(0, 63, 0, 1, 2, 1)])), /bounds/);
  assert.throws(() => validateCustomSpec(design('size', [brick(0, 0, 0, 9, 1, 1)])), /dimensions/);
  assert.throws(() => validateCustomSpec(design('unsafe\u0000name', [brick(0, 0, 0, 1, 1, 1)])), /name/);
  assert.throws(() => validateCustomSpec(design('bad color', [{ ...brick(0, 0, 0, 1, 1, 1), color: 'url(evil)' }])), /color/);
  assert.throws(() => validateCustomSpec({ ...fixtures[0], budget: 1 }), /budget/);
  assert.throws(() => validateSpec(fixtures[0], 'jurassic'), /world/);
});

test('repeat expansion is bounded, non-overlapping and canonical', () => {
  const b = brick(0, 0, 0, 2, 1, 1);
  const repeat = (count: number, dx: number, dy = 0, dz = 0) => ({ ...b, repeat: { count, dx, dy, dz } });
  const input = { ...design('repetition', [repeat(3, 2)]), budget: 3 };
  const spec = validateCustomSpec(input);
  assert.deepEqual(expandCustomBricks(spec.design!.bricks!).map(b => b.x), [0, 2, 4]);
  assert.deepEqual(validateCustomSpec(JSON.parse(JSON.stringify(spec))), spec);
  assert.throws(() => validateCustomSpec(design('overlap', [repeat(3, 1)])), /overlap/);
  assert.throws(() => validateCustomSpec(design('zero', [repeat(3, 0)])), /repeat/);
  assert.throws(() => validateCustomSpec(design('negative bounds', [{ ...repeat(3, -40), x: 0 }])), /bounds/);
  assert.throws(() => validateCustomSpec(design('positive bounds', [repeat(40, 2)])), /bounds/);
  assert.throws(() => validateCustomSpec(design('fraction', [repeat(2.5, 2)])), /repeat/);
  assert.throws(() => validateCustomSpec({ ...design('budget', [repeat(3, 2)]), budget: 2 }), /budget/);
  assert.throws(() => validateCustomSpec({ ...design('limit', Array.from({ length: 65 }, () => ({ ...repeat(128, 1), x: -64, width: 1 }))), budget: 8192 }), /8192/);
  assert.throws(() => validateCustomSpec(design('between records', [repeat(3, 2), brick(4, 0, 0, 1, 1, 1)])), /overlap/);
});

test('named objects may be separated but cannot overlap or conceal internal disconnection', () => {
  const object = (name: string, bricks: ReturnType<typeof brick>[]) => ({ name, bricks });
  const base = { world: 'space', model: 'custom', color: 'blue', longTail: false, wideWings: false, budget: 50 };
  const separated = { ...base, design: { name: 'Fleet', objects: [
    object('Explorer', [brick(0, 0, 0, 2, 1, 1), brick(2, 0, 0, 1, 1, 1, 'detail')]),
    object('Cargo', [brick(20, 0, 0, 1, 1, 1)]),
  ] } };
  const team = new Team(createPlan(validateCustomSpec(separated)));
  for (let i = 0; i < 10 && team.status !== 'complete'; i++) team.step(20);
  assert.equal(team.status, 'complete');
  assert.match(team.checks[1].detail, /Explorer.*Cargo/);
  assert.ok(team.plan.tasks.some(t => t.label === 'Explorer · details' && t.depends.includes('frame:object-0')));
  const overlapping = { ...separated, design: { ...separated.design, objects: [separated.design.objects[0], object('Cargo', [brick(1, 0, 0, 1, 1, 1)])] } };
  assert.throws(() => validateCustomSpec(overlapping), /overlap/);
  const repeatedBrick = { ...brick(0, 0, 0, 1, 1, 1), repeat: { count: 3, dx: 2, dy: 0, dz: 0 } };
  const repeatedOverlap = { ...separated, design: { ...separated.design, objects: [
    object('Explorer', [repeatedBrick]),
    object('Cargo', [brick(4, 0, 0, 1, 1, 1)]),
  ] } };
  assert.throws(() => validateCustomSpec(repeatedOverlap), /overlap/);
  const disconnected = { ...separated, design: { ...separated.design, objects: [
    object('Explorer', [brick(0, 0, 0, 1, 1, 1), brick(2, 0, 0, 1, 1, 1)]),
    object('Bridge', [brick(1, 0, 0, 1, 1, 1)]),
  ] } };
  const invalid = new Team(createPlan(validateCustomSpec(disconnected)));
  for (let i = 0; i < 10 && invalid.status !== 'damaged'; i++) invalid.step(20);
  assert.equal(invalid.status, 'damaged');
  assert.match(invalid.checks[1].detail, /Explorer: 1\/2/);
  assert.throws(() => validateCustomSpec({ ...separated, design: { name: 'Duplicate', objects: [object('A', [brick(0, 0, 0, 1, 1, 1)]), object('A', [brick(2, 0, 0, 1, 1, 1)])] } }), /unique/);
});

test('8192 expanded bricks execute and survive a bounded save', () => {
  const rows = Array.from({ length: 64 }, (_, i) => ({
    ...brick(-64, 0, -32 + i, 1, 1, 1), repeat: { count: 128, dx: 1, dy: 0, dz: 0 },
  }));
  const spec = validateCustomSpec({ ...design('Advanced count', rows), budget: 8192 });
  const team = new Team(createPlan(spec));
  team.step(20);
  assert.match(team.checks[1].detail, /checked when all planned bricks/);
  while (team.status !== 'complete' && team.status !== 'damaged') team.step(20);
  assert.equal(team.status, 'complete');
  const snapshot = JSON.stringify(team.snapshot('Advanced count'));
  assert.ok(Buffer.byteLength(snapshot) < 4_000_000);
  const restored = restoreSnapshot(JSON.parse(snapshot));
  assert.equal(restored.team.bricks.size, 8192);
  assert.equal(restored.team.status, 'complete');
});

test('advanced 262144 occupied-cell limit accepts the boundary and rejects one extra cell', () => {
  const rows = Array.from({ length: 64 }, (_, i) => ({
    ...brick(-32, Math.floor(i / 8) * 8, -32 + (i % 8) * 8, 8, 8, 8),
    repeat: { count: 8, dx: 8, dy: 0, dz: 0 },
  }));
  const spec = { ...design('Advanced', rows), budget: 8192 };
  const validated = validateCustomSpec(spec);
  const expanded = expandCustomBricks(validated.design!.bricks!);
  assert.equal(expanded.length, 512);
  assert.equal(expanded.reduce((n, b) => n + b.width * b.height * b.depth, 0), 262144);
  assert.throws(() => validateCustomSpec({ ...spec, design: { ...spec.design, bricks: [...rows, brick(32, 0, -32, 1, 1, 1)] } }), /262144/);
});

for (const world of ['jurassic', 'space'] as const) test(`${world} example builds, inspects objects, repairs and restores`, () => {
  const spec = validateCustomSpec(worldExample(world));
  assert.equal(spec.design!.objects!.length, 3);
  const team = new Team(createPlan(spec));
  assert.match(team.events.find(e => e.agent === 'plan')!.message, /Each planned object is face-connected/);
  while (team.status !== 'complete' && team.status !== 'damaged') team.step(20);
  assert.equal(team.status, 'complete', JSON.stringify(team.checks));
  for (const object of spec.design!.objects!) {
    assert.ok(team.plan.tasks.some(t => t.label.includes(object.name)));
    assert.ok(team.checks.find(c => c.label === 'Connected objects')!.detail.includes(object.name));
  }
  team.damage();
  const saved = JSON.parse(JSON.stringify(team.snapshot('Original local world example')));
  const restored = restoreSnapshot(saved);
  assert.equal(restored.team.status, 'damaged');
  restored.team.repair();
  for (let i = 0; i < 8192 && restored.team.step(20); i++) {}
  assert.equal(restored.team.status, 'complete');
  assert.deepEqual(allBricks(restored.team.plan), allBricks(team.plan));
  assert.deepEqual(restored.team.plan.spec, spec);
});

test('world bodies and studs are instanced by color and retain selection IDs', () => {
  const bricks = allBricks(createPlan(worldExample('space')));
  const cube = new THREE.BoxGeometry(0.94, 0.65, 0.94), stud = new THREE.CylinderGeometry(0.29, 0.29, 0.13, 16);
  const material = new THREE.MeshBasicMaterial();
  const batch = new BrickBatch(bricks, cube, stud, () => material, new Map(), false, 1000);
  assert.equal(batch.group.children.length, new Set(bricks.map(b => b.color)).size * 2);
  const meshes = batch.group.children as THREE.InstancedMesh[];
  assert.equal(meshes.filter((_, i) => i % 2 === 0).reduce((n, m) => n + m.count, 0), bricks.length);
  for (const mesh of meshes) assert.equal(mesh.userData.brickIds.length, mesh.count);
  const body = meshes[0], matrix = new THREE.Matrix4();
  body.getMatrixAt(0, matrix);
  const id = body.userData.brickIds[0], b = bricks.find(b => b.id === id)!;
  assert.ok(Math.abs(matrix.elements[0] * 0.94 - (b.width! - 0.06)) < 0.00001);
  batch.setExploded(true, 1000);
  body.getMatrixAt(0, matrix);
  assert.notEqual(matrix.elements[12], b.x + (b.width! - 1) / 2);
  batch.dispose(); cube.dispose(); stud.dispose(); material.dispose();
});

test('instanced selection and placement animation preserve brick geometry', () => {
  const b = allBricks(createPlan(validateCustomSpec(design('single', [brick(0, 0, 0, 2, 2, 2)]))))[0];
  const cube = new THREE.BoxGeometry(0.94, 0.65, 0.94), stud = new THREE.CylinderGeometry(0.29, 0.29, 0.13, 16);
  const material = new THREE.MeshBasicMaterial();
  const batch = new BrickBatch([b], cube, stud, () => material, new Map([[b.id, 100]]), false, 100);
  const body = batch.group.children[0] as THREE.InstancedMesh, matrix = new THREE.Matrix4();
  body.getMatrixAt(0, matrix);
  assert.ok(Math.abs(matrix.elements[13] - 3.73) < 0.00001);
  batch.animate(420);
  body.getMatrixAt(0, matrix);
  assert.ok(Math.abs(matrix.elements[13] - 0.73) < 0.00001);
  batch.group.updateMatrixWorld(true);
  const hits = new THREE.Raycaster(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0)).intersectObjects(batch.group.children);
  assert.ok(hits.length > 0);
  assert.equal(hits[0].object.userData.brickIds[hits[0].instanceId!], b.id);
  batch.dispose();
  const reduced = new BrickBatch([b], cube, stud, () => material, new Map(), false, 100);
  (reduced.group.children[0] as THREE.InstancedMesh).getMatrixAt(0, matrix);
  assert.ok(Math.abs(matrix.elements[13] - 0.73) < 0.00001);
  reduced.dispose(); cube.dispose(); stud.dispose(); material.dispose();
});

test('advanced decorative stud sampling never drops selectable bodies', () => {
  const sample = allBricks(createPlan(validateCustomSpec(design('single', [brick(0, 0, 0, 1, 1, 1)]))))[0];
  const bricks = Array.from({ length: 256 }, (_, i) => ({ ...sample, id: String(i), x: i * 8, width: 8, depth: 8 }));
  const cube = new THREE.BoxGeometry(), stud = new THREE.CylinderGeometry(), material = new THREE.MeshBasicMaterial();
  const batch = new BrickBatch(bricks, cube, stud, () => material, new Map(), false, 1000);
  const [bodies, studs] = batch.group.children as THREE.InstancedMesh[];
  assert.equal(bodies.count, 256);
  assert.equal(bodies.userData.brickIds.length, 256);
  assert.equal(studs.count, MAX_DECORATIVE_STUDS);
  batch.dispose(); cube.dispose(); stud.dispose(); material.dispose();
});

test('disconnected custom designs are reported instead of pretending repair fixed topology', () => {
  const team = new Team(createPlan(validateCustomSpec(design('two islands', [brick(0, 0, 0, 2, 1, 1), brick(5, 0, 0, 1, 1, 1)]))));
  assert.ok(team.events.some(e => e.agent === 'plan' && /planned bricks are disconnected/.test(e.message)));
  team.step(20);
  assert.equal(team.status, 'damaged');
  assert.equal(team.checks.find(c => c.label === 'Connected model')?.pass, false);
  assert.ok(team.events.some(e => e.agent === 'check' && /Needs attention: Connected model/.test(e.message)));
  team.repair();
  assert.equal(team.status, 'damaged');
  assert.match(team.events.at(-1)!.message, /topology/);
});
