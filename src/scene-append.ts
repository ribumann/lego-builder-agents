import {
  COLORS, Team, allBricks, createPlan, restoreSnapshot, validateSpec,
  type Brick, type Color, type CustomBrick, type Plan, type Snapshot, type Spec,
} from './engine';

type Source = Plan['source'];

export interface SceneContribution {
  source: Source;
  objects: string[];
}

export interface SceneAppendProvenance {
  version: 1;
  contributions: SceneContribution[];
  offsets: { x: number; z: number }[];
}

export interface SceneAppendResult {
  team: Team;
  provenance: SceneAppendProvenance;
  /** Translation applied to the newly appended Plan. */
  offset: { x: number; z: number };
}

export type SceneAppendSnapshot = Snapshot & {
  sceneAppend: SceneAppendProvenance;
  sceneAppendAppearance: {
    version: 1;
    bricks: Pick<Brick, 'id' | 'color' | 'part'>[];
  };
};

export interface RestoredSceneAppend {
  team: Team;
  prompt: string;
  provenance: SceneAppendProvenance;
}

const sources: Source[] = ['local', 'copilot', 'local-ai', 'github-models', 'azure'];
const colorNames = Object.keys(COLORS) as Color[];
const sceneProvenance = new WeakMap<Team, SceneAppendProvenance>();
const cellKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

interface ObjectGeometry {
  name: string;
  bricks: Brick[];
}

function assertPlan(plan: Plan): void {
  if (!plan || !plan.spec || !sources.includes(plan.source))
    throw new Error('Cannot append a scene with an invalid Plan or source.');
  validateSpec(plan.spec, plan.spec.world);
}

function defaultObjectName(spec: Spec): string {
  if (spec.model === 'custom') return spec.design!.name;
  return spec.model[0].toUpperCase() + spec.model.slice(1);
}

function objectGroups(plan: Plan): ObjectGeometry[] {
  const bricks = allBricks(plan);
  if (!bricks.length) throw new Error('Cannot append an empty scene.');
  const declaredObjects = plan.spec.model === 'custom' ? plan.spec.design?.objects : undefined;
  const fallbackName = defaultObjectName(plan.spec);
  const groups = new Map<string, Brick[]>();

  if (declaredObjects) {
    for (const object of declaredObjects) groups.set(object.name, []);
  } else {
    groups.set(fallbackName, []);
  }

  const ids = new Set<string>();
  for (const brick of bricks) {
    if (!brick || typeof brick.id !== 'string'
        || ![brick.x, brick.y, brick.z].every(Number.isInteger)
        || brick.id !== cellKey(brick.x, brick.y, brick.z)
        || !['frame', 'detail'].includes(brick.agent)
        || !Number.isInteger(brick.width ?? 1) || !Number.isInteger(brick.height ?? 1)
        || !Number.isInteger(brick.depth ?? 1)
        || (brick.width ?? 1) < 1 || (brick.height ?? 1) < 1 || (brick.depth ?? 1) < 1
        || (brick.width ?? 1) > 8 || (brick.height ?? 1) > 8 || (brick.depth ?? 1) > 8
        || typeof brick.color !== 'string' || !/^#[\da-f]{6}$/i.test(brick.color))
      throw new Error('Cannot append a Plan with invalid or non-canonical brick geometry.');
    if (ids.has(brick.id)) throw new Error('Cannot append a Plan containing duplicate brick IDs.');
    ids.add(brick.id);
    const name = brick.object ?? fallbackName;
    const group = groups.get(name);
    if (!group) throw new Error(`Cannot append a brick assigned to unknown object "${name}".`);
    group.push(brick);
  }
  if ([...groups.values()].some(group => !group.length))
    throw new Error('Cannot append a scene containing an empty named object.');
  return [...groups].map(([name, group]) => ({ name, bricks: group }));
}

function paletteColor(value: string): Color {
  const rgb = (hex: string) => [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16));
  const requested = rgb(value);
  return colorNames.reduce((best, color) => {
    const distance = (hex: string) => rgb(hex).reduce((sum, channel, i) => sum + (channel - requested[i]) ** 2, 0);
    return distance(COLORS[color]) < distance(COLORS[best]) ? color : best;
  }, 'white');
}

function customRecords(objects: ObjectGeometry[], parts: Map<string, Brick['agent']>): { name: string; bricks: CustomBrick[] }[] {
  return objects.map(object => {
    const records: CustomBrick[] = [];
    const rows = new Map<string, Brick[]>();
    for (const brick of object.bricks) {
      const part = parts.get(brick.id);
      if (!part) throw new Error('Cannot append geometry that differs from its canonical specification.');
      if ((brick.width ?? 1) !== 1 || (brick.height ?? 1) !== 1 || (brick.depth ?? 1) !== 1) {
        records.push({
          x: brick.x, y: brick.y, z: brick.z,
          width: brick.width ?? 1, height: brick.height ?? 1, depth: brick.depth ?? 1,
          color: paletteColor(brick.color), part,
        });
        continue;
      }
      const color = paletteColor(brick.color);
      const key = `${brick.y}:${brick.z}:${color}:${part}`;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key)!.push(brick);
    }
    for (const row of rows.values()) {
      row.sort((a, b) => a.x - b.x);
      for (let i = 0; i < row.length;) {
        let end = i + 1;
        while (end < row.length && row[end].x === row[end - 1].x + 1) end++;
        const record: CustomBrick = {
          x: row[i].x, y: row[i].y, z: row[i].z, width: 1, height: 1, depth: 1,
          color: paletteColor(row[i].color), part: parts.get(row[i].id)!,
        };
        if (end - i > 1) record.repeat = { count: end - i, dx: 1, dy: 0, dz: 0 };
        records.push(record);
        i = end;
      }
    }
    return { name: object.name, bricks: records };
  });
}

function uniqueAddedNames(objects: ObjectGeometry[], used: Set<string>): ObjectGeometry[] {
  return objects.map(object => {
    const original = object.name;
    let name = original;
    for (let suffix = 2; used.has(name); suffix++) {
      const ending = ` (${suffix})`;
      name = `${original.slice(0, 60 - ending.length)}${ending}`;
    }
    used.add(name);
    return { name, bricks: object.bricks };
  });
}

function occupiedCells(bricks: Brick[]): Set<string> {
  const occupied = new Set<string>();
  for (const brick of bricks) {
    for (let x = brick.x; x < brick.x + (brick.width ?? 1); x++)
      for (let y = brick.y; y < brick.y + (brick.height ?? 1); y++)
        for (let z = brick.z; z < brick.z + (brick.depth ?? 1); z++)
          occupied.add(cellKey(x, y, z));
  }
  return occupied;
}

function findOffset(existing: Brick[], added: Brick[]): { x: number; z: number } {
  const minX = Math.min(...added.map(brick => brick.x));
  const maxX = Math.max(...added.map(brick => brick.x + (brick.width ?? 1) - 1));
  const minZ = Math.min(...added.map(brick => brick.z));
  const maxZ = Math.max(...added.map(brick => brick.z + (brick.depth ?? 1) - 1));
  const occupied = occupiedCells(existing);
  const hasCollision = (dx: number, dz: number) => {
    for (const brick of added)
      for (let x = brick.x + dx; x < brick.x + dx + (brick.width ?? 1); x++)
        for (let y = brick.y; y < brick.y + (brick.height ?? 1); y++)
          for (let z = brick.z + dz; z < brick.z + dz + (brick.depth ?? 1); z++)
            if (occupied.has(cellKey(x, y, z))) return true;
    return false;
  };
  // Search translations by increasing Manhattan distance with a fixed tie order.
  for (let radius = 0; radius <= 254; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const dzMagnitude = radius - Math.abs(dx);
      const dzValues = dzMagnitude ? [dzMagnitude, -dzMagnitude] : [0];
      for (const dz of dzValues) {
        if (minX + dx < -64 || maxX + dx > 63 || minZ + dz < -64 || maxZ + dz > 63) continue;
        if (!hasCollision(dx, dz)) return { x: Object.is(dx, -0) ? 0 : dx, z: Object.is(dz, -0) ? 0 : dz };
      }
    }
  }
  throw new Error('Cannot append the new geometry: no collision-free offset fits within scene bounds.');
}

function translated(bricks: Brick[], offset: { x: number; z: number }, object: string): Brick[] {
  return bricks.map(brick => ({
    ...brick,
    id: cellKey(brick.x + offset.x, brick.y, brick.z + offset.z),
    x: brick.x + offset.x,
    z: brick.z + offset.z,
    object,
  }));
}

function cloneProvenance(value: SceneAppendProvenance): SceneAppendProvenance {
  return {
    version: 1,
    contributions: value.contributions.map(item => ({ source: item.source, objects: [...item.objects] })),
    offsets: value.offsets.map(offset => ({ ...offset })),
  };
}

/**
 * Atomically compose a Team and a generated Plan. Neither input is mutated.
 * The old geometry stays at its exact coordinates; only the new Plan is translated.
 */
export function appendScene(previous: Team, addition: Plan): SceneAppendResult {
  assertPlan(previous.plan);
  assertPlan(addition);
  if (previous.plan.spec.world !== addition.spec.world)
    throw new Error('Cannot append scenes from different worlds.');

  const previousObjects = objectGroups(previous.plan);
  const addedObjects = objectGroups(addition);
  const usedNames = new Set(previousObjects.map(object => object.name));
  if (usedNames.size !== previousObjects.length)
    throw new Error('Cannot append a scene with duplicate existing object names.');
  const namedAddition = uniqueAddedNames(addedObjects, usedNames);
  const priorBricks = previousObjects.flatMap(object => object.bricks);
  const addedBricks = namedAddition.flatMap(object => object.bricks);
  const offset = findOffset(priorBricks, addedBricks);
  const shiftedObjects = namedAddition.map(object => ({
    name: object.name,
    bricks: translated(object.bricks, offset, object.name),
  }));
  // Structural roles belong to the canonical spec, not the current builder
  // assignment or presentation label. This also survives repeated appends.
  const canonicalParts = new Map<string, Brick['agent']>();
  for (const [input, translation] of [
    [previous.plan, { x: 0, z: 0 }], [addition, offset],
  ] as const) {
    for (const brick of allBricks(createPlan(input.spec))) {
      const part = brick.part === 'frame' || brick.part === 'detail' ? brick.part : brick.agent;
      canonicalParts.set(cellKey(brick.x + translation.x, brick.y, brick.z + translation.z), part);
    }
  }
  const combinedObjects = [
    ...previousObjects.map(object => ({ name: object.name, bricks: object.bricks })),
    ...shiftedObjects,
  ];
  if (combinedObjects.length > 32)
    throw new Error('Cannot append more than 32 named objects to a scene.');

  const budget = Math.min(8192, previous.plan.spec.budget + addition.spec.budget);
  const designName = 'Appended scene';
  const spec = validateSpec({
    world: previous.plan.spec.world,
    model: 'custom',
    color: previous.plan.spec.color,
    longTail: false,
    wideWings: false,
    budget,
    design: { name: designName, objects: customRecords(combinedObjects, canonicalParts) },
  }, previous.plan.spec.world);
  const plan = createPlan(spec, [...previous.plan.assumptions, ...addition.assumptions], previous.plan.source);

  const originals = new Map<string, Brick>();
  for (const object of previousObjects)
    for (const brick of object.bricks) originals.set(brick.id, { ...brick, object: object.name });
  for (const object of shiftedObjects)
    for (const brick of object.bricks) originals.set(brick.id, brick);
  for (const task of plan.tasks)
    task.bricks = task.bricks.map(brick => {
      const original = originals.get(brick.id);
      if (!original) throw new Error('Combined validation changed a brick ID; append was cancelled.');
      // Keep canonical ownership from createPlan (which may split frame-only
      // geometry across builders), while retaining the source identity and geometry.
      return { ...original, agent: brick.agent };
    });

  const expectedPrevious = new Map(priorBricks.map(brick => [brick.id, brick]));
  for (const [id, placed] of previous.bricks) {
    const expected = expectedPrevious.get(id);
    // Retained work can predate canonical object naming or builder reassignment.
    // Those metadata changes do not move or replace a placed brick. Compare the
    // immutable identity/geometry and appearance instead of serializing metadata.
    if (!expected || id !== placed.id
        || placed.x !== expected.x || placed.y !== expected.y || placed.z !== expected.z
        || (placed.width ?? 1) !== (expected.width ?? 1)
        || (placed.height ?? 1) !== (expected.height ?? 1)
        || (placed.depth ?? 1) !== (expected.depth ?? 1)
        || placed.color !== expected.color || placed.part !== expected.part)
      throw new Error('Cannot append a Team whose placed bricks differ from its Plan.');
  }

  const team = new Team(plan);
  const combined = new Map(allBricks(plan).map(brick => [brick.id, brick]));
  // Retain the exact set of placed identities and their geometry/appearance,
  // but use the new plan's object membership and canonical builder ownership.
  team.bricks = new Map([...previous.bricks.keys()].map(id => [id, combined.get(id)!]));
  team.events = previous.events.map(event => ({ ...event }));
  team.tick = previous.tick;
  team.status = previous.status === 'damaged' ? 'damaged' : 'paused';
  team.log('build', 'observe', `Appended ${addedObjects.map(object => object.name).join(', ')} at offset ${offset.x},${offset.z}.`);

  const inherited = sceneProvenance.get(previous) ?? {
    version: 1 as const,
    contributions: [{ source: previous.plan.source, objects: previousObjects.map(object => object.name) }],
    offsets: [],
  };
  const provenance: SceneAppendProvenance = {
    version: 1,
    contributions: [
      ...inherited.contributions.map(item => ({ source: item.source, objects: [...item.objects] })),
      { source: addition.source, objects: namedAddition.map(object => object.name) },
    ],
    offsets: [...inherited.offsets.map(item => ({ ...item })), { ...offset }],
  };
  sceneProvenance.set(team, provenance);
  return { team, provenance: cloneProvenance(provenance), offset };
}

/**
 * Extend Team.snapshot with provenance and every planned brick's appearance.
 * Use restoreSceneAppend, not bare restoreSnapshot, to retain these extensions.
 */
export function snapshotSceneAppend(team: Team, prompt: string): SceneAppendSnapshot {
  if (typeof prompt !== 'string' || prompt.length > 1000)
    throw new Error('Scene snapshot prompt must be a string of at most 1,000 characters.');
  const provenance = sceneProvenance.get(team);
  if (!provenance) throw new Error('This Team has no scene-append provenance to save.');
  const snapshot: SceneAppendSnapshot = {
    ...team.snapshot(prompt), sceneAppend: cloneProvenance(provenance),
    sceneAppendAppearance: {
      version: 1,
      bricks: allBricks(team.plan).map(({ id, color, part }) => ({ id, color, part })),
    },
  };
  readAppearance(snapshot.sceneAppendAppearance, team.plan);
  return snapshot;
}

function readAppearance(value: unknown, plan: Plan): Map<string, Pick<Brick, 'color' | 'part'>> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Scene snapshot has no valid appearance metadata.');
  const raw = value as Record<string, unknown>;
  const expected = new Set(allBricks(plan).map(brick => brick.id));
  if (raw.version !== 1 || Object.keys(raw).some(key => key !== 'version' && key !== 'bricks')
      || !Array.isArray(raw.bricks) || raw.bricks.length > 8192 || raw.bricks.length !== expected.size)
    throw new Error('Scene appearance metadata must describe every planned brick exactly once.');
  const appearance = new Map<string, Pick<Brick, 'color' | 'part'>>();
  for (const item of raw.bricks) {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error('Scene brick appearance metadata is invalid.');
    const brick = item as Record<string, unknown>;
    if (Object.keys(brick).length !== 3 || Object.keys(brick).some(key => !['id', 'color', 'part'].includes(key))
        || typeof brick.id !== 'string' || !expected.has(brick.id) || appearance.has(brick.id)
        || typeof brick.color !== 'string' || !/^#[\da-f]{6}$/i.test(brick.color)
        || typeof brick.part !== 'string' || !brick.part.trim() || brick.part.length > 80
        || /[\p{C}]/u.test(brick.part))
      throw new Error('Scene brick appearance metadata has an invalid ID, color, or part.');
    appearance.set(brick.id, { color: brick.color, part: brick.part });
  }
  return appearance;
}

function readProvenance(value: unknown, rootSource: unknown): SceneAppendProvenance {
  if (!value || typeof value !== 'object') throw new Error('Scene snapshot has no append provenance.');
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1 || !Array.isArray(raw.contributions) || raw.contributions.length < 2
      || !Array.isArray(raw.offsets) || raw.offsets.length !== raw.contributions.length - 1)
    throw new Error('Scene append provenance is invalid.');
  const contributions: SceneContribution[] = raw.contributions.map(item => {
    if (!item || typeof item !== 'object') throw new Error('Scene append contribution is invalid.');
    const contribution = item as Record<string, unknown>;
    if (!sources.includes(contribution.source as Source) || !Array.isArray(contribution.objects)
        || !contribution.objects.length
        || contribution.objects.some(name => typeof name !== 'string' || !name.trim() || name.length > 60))
      throw new Error('Scene append contribution is invalid.');
    return { source: contribution.source as Source, objects: [...contribution.objects] as string[] };
  });
  if (contributions[0].source !== rootSource)
    throw new Error('Scene provenance does not match the saved Team source.');
  const offsets = raw.offsets.map(item => {
    if (!item || typeof item !== 'object') throw new Error('Scene append offset is invalid.');
    const offset = item as Record<string, unknown>;
    if (!Number.isInteger(offset.x) || !Number.isInteger(offset.z) || Math.abs(Number(offset.x)) > 254
        || Math.abs(Number(offset.z)) > 254)
      throw new Error('Scene append offset is invalid.');
    return { x: Number(offset.x), z: Number(offset.z) };
  });
  return { version: 1, contributions, offsets };
}

/**
 * Restore the engine Team, provenance, and original appearance atomically.
 * Missing/incomplete appearance tables are rejected rather than silently losing
 * accents or part labels. Geometry, object membership, and ownership stay canonical.
 */
export function restoreSceneAppend(value: unknown): RestoredSceneAppend {
  if (!value || typeof value !== 'object') throw new Error('Saved scene is not an object.');
  const raw = value as Record<string, unknown>;
  const provenance = readProvenance(raw.sceneAppend, raw.source);
  const restored = restoreSnapshot(value);
  const appearance = readAppearance(raw.sceneAppendAppearance, restored.team.plan);
  // Validate the entire metadata table before changing the isolated restored Team.
  // Copy only color/part, never imported coordinates, object names, or ownership.
  for (const task of restored.team.plan.tasks)
    task.bricks = task.bricks.map(brick => ({ ...brick, ...appearance.get(brick.id)! }));
  const canonical = new Map(allBricks(restored.team.plan).map(brick => [brick.id, brick]));
  restored.team.bricks = new Map([...restored.team.bricks.keys()].map(id => [id, canonical.get(id)!]));
  sceneProvenance.set(restored.team, provenance);
  return { ...restored, provenance: cloneProvenance(provenance) };
}
