import { COLORS, allBricks, createPlan, parseBrief, type Color, type CustomBrick, type Spec, type World } from './engine';

// These examples reuse this project's own deterministic template geometry, never a model response.
function templateObject(name: string, world: World, brief: string, offsetX: number) {
  const voxels = allBricks(createPlan(parseBrief(world, brief).spec));
  const nearest = (hex: string): Color => {
    const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const c = rgb(hex);
    return (Object.keys(COLORS) as Color[]).reduce((best, color) => {
      const distance = (x: string) => rgb(x).reduce((sum, n, i) => sum + (n - c[i]) ** 2, 0);
      return distance(COLORS[color]) < distance(COLORS[best]) ? color : best;
    }, 'white');
  };
  const rows = new Map<string, { y: number; z: number; color: Color; part: 'frame' | 'detail'; xs: number[] }>();
  for (const b of voxels) {
    const color = nearest(b.color);
    const key = `${b.y}:${b.z}:${color}:${b.agent}`;
    if (!rows.has(key)) rows.set(key, { y: b.y, z: b.z, color, part: b.agent, xs: [] });
    rows.get(key)!.xs.push(b.x + offsetX);
  }
  const bricks: CustomBrick[] = [];
  for (const row of rows.values()) {
    row.xs.sort((a, b) => a - b);
    for (let i = 0; i < row.xs.length;) {
      let end = i + 1;
      while (end < row.xs.length && row.xs[end] === row.xs[end - 1] + 1) end++;
      const b: CustomBrick = { x: row.xs[i], y: row.y, z: row.z, width: 1, height: 1, depth: 1, color: row.color, part: row.part };
      if (end - i > 1) b.repeat = { count: end - i, dx: 1, dy: 0, dz: 0 };
      bricks.push(b);
      i = end;
    }
  }
  return { name, bricks };
}

export function worldExample(world: World): Spec {
  const objects = world === 'jurassic'
    ? [
      templateObject('Mossback stegosaurus', world, 'green stegosaurus', -18),
      templateObject('Violet brachiosaurus', world, 'purple brachiosaurus', 18),
      { name: 'Valley tree', bricks: [
        { x: -1, y: 0, z: -13, width: 2, height: 6, depth: 2, color: 'orange', part: 'frame' },
        { x: -3, y: 6, z: -15, width: 6, height: 2, depth: 6, color: 'green', part: 'detail' },
      ] as CustomBrick[] },
    ]
    : [
      templateObject('Blue explorer', world, 'blue explorer', -15),
      templateObject('White cargo ship', world, 'white cargo', 15),
      { name: 'Orbital station', bricks: [
        { x: -4, y: 0, z: -19, width: 8, height: 2, depth: 6, color: 'white', part: 'frame' },
        { x: -2, y: 2, z: -18, width: 4, height: 3, depth: 4, color: 'blue', part: 'frame' },
        { x: -3, y: 5, z: -19, width: 6, height: 1, depth: 6, color: 'orange', part: 'detail' },
      ] as CustomBrick[] },
    ];
  return { world, model: 'custom', color: world === 'jurassic' ? 'green' : 'blue', longTail: false, wideWings: false, budget: 1000,
    design: { name: world === 'jurassic' ? 'Jurassic herd · local example' : 'Space fleet · local example', objects } };
}
