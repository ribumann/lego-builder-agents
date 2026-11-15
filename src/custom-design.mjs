import { COLOR_NAMES } from './brick-colors.mjs';

const colorChoices = COLOR_NAMES.map(color => `"${color}"`).join('|');
const colors = COLOR_NAMES;

// Shared by the browser and the Node planner endpoint. Coordinates identify
// the lower corner cell; dimensions count whole grid cells.
export const CUSTOM_DESIGN_PROMPT = `For an original design, return a JSON build spec with:
{"world":"jurassic" or "space","model":"custom","color":${colorChoices},"longTail":false,"wideWings":false,"budget":1..8192,"design":{"name":"readable name (1-80 characters)","objects":[{"name":"unique object name (1-60 characters)","bricks":[{"x":integer,"y":integer,"z":integer,"width":integer,"height":integer,"depth":integer,"color":${colorChoices},"part":"frame"|"detail","repeat":{"count":integer,"dx":integer,"dy":integer,"dz":integer}}]}]}}.
Use named objects for separate subjects; each must be internally face-connected, though objects may be separated. For one object, design.bricks is supported instead of objects. repeat is optional; count includes the first brick and each next is offset by dx,dy,dz. count 2..128 (a straight stride cannot fit more positions), dx/dz -127..127, dy -63..63; stride cannot be all zero. Use multiple bounded records for larger designs. Use 1-32 objects and 1-256 records total. Hard limits: 8192 expanded bricks, 262144 occupied cells, no overlap, and no more bricks than budget. Dimensions 1-8 cells each; occupied x/z -64..63 and y 0..63. Coordinates are lower corners. Frame is structural; detail is finishing work. Static geometry only.
Large bases and walls MUST be tiled from bricks whose width, height and depth are EACH 1..8; never use one oversized brick. Example: x=-64, width=8, repeat.count=16, dx=8 tiles x=-64..63, whereas width=16 is invalid. For every brick, x+width-1<=63, y+height-1<=63 and z+depth-1<=63. For repeats, check BOTH the first and last brick at start+(count-1)*stride on EACH axis; their complete occupied extents must stay in bounds. Count bricks, not occupied cells, toward the requested scene size.
Before responding, count expanded bricks across ALL objects: each record contributes repeat.count or 1; dimensions do not multiply this count. Records with repeat.count 6, repeat.count 4, and no repeat contribute 11 bricks. Set budget at least to this total, at most 8192. Respect any smaller requested brick budget. Check the arithmetic before returning JSON.`;

const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const integerReason = (value, min, max) => !Number.isInteger(value) ? 'integer-required'
  : value < min ? 'below-minimum' : value > max ? 'above-maximum' : undefined;

export function validateCustomSpec(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Custom specification must be an object.');
  const s = value;
  const invalidFields = [
    !['jurassic', 'space'].includes(s.world) && 'world',
    s.model !== 'custom' && 'model',
    !colors.includes(s.color) && 'color',
    s.longTail !== false && 'longTail',
    s.wideWings !== false && 'wideWings',
    !integer(s.budget, 1, 8192) && 'budget',
  ].filter(Boolean);
  if (invalidFields.length)
    throw new Error(`Custom specification has invalid fields: ${invalidFields.join(', ')}.`);
  const d = s.design;
  if (!d || typeof d !== 'object' || Array.isArray(d) || typeof d.name !== 'string'
      || !d.name.trim() || d.name.length > 80 || /[\p{C}]/u.test(d.name))
    throw new Error('Custom design needs a readable name of 1–80 characters.');
  if ((d.objects === undefined) === (d.bricks === undefined))
    throw new Error('Custom design needs either bricks or named objects, not both.');
  const multi = d.objects !== undefined;
  const objects = multi ? d.objects : [{ name: d.name.trim(), bricks: d.bricks }];
  if (!Array.isArray(objects) || objects.length < 1 || objects.length > 32)
    throw new Error('Custom designs need 1–32 objects.');
  const names = new Set();
  let records = 0;
  for (const object of objects) {
    if (!object || typeof object !== 'object' || Array.isArray(object) || typeof object.name !== 'string'
        || !object.name.trim() || object.name.length > (multi ? 60 : 80) || /[\p{C}]/u.test(object.name)
        || names.has(object.name.trim()) || !Array.isArray(object.bricks) || !object.bricks.length)
      throw new Error('Each object needs a unique readable name of 1–60 characters and at least one brick.');
    names.add(object.name.trim());
    records += object.bricks.length;
    if (records > 256) throw new Error('Custom designs need 1–256 brick records total.');
  }
  let count = 0, volume = 0;
  const canonicalObjects = objects.map((object, objectIndex) => ({ name: object.name.trim(), bricks: object.bricks.map((b, index) => {
    const location = `Custom brick ${index + 1} in object ${objectIndex + 1}`;
    if (!b || typeof b !== 'object' || Array.isArray(b))
      throw new Error(`${location} has invalid dimensions, bounds, color, or part (brick: object-required).`);
    const reasons = [];
    for (const [field, min, max] of [
      ['x', -64, 63], ['y', 0, 63], ['z', -64, 63],
      ['width', 1, 8], ['height', 1, 8], ['depth', 1, 8],
    ]) {
      const reason = integerReason(b[field], min, max);
      if (reason) reasons.push(`${field}: ${reason}`);
    }
    if (!colors.includes(b.color)) reasons.push('color: unsupported');
    if (!['frame', 'detail'].includes(b.part)) reasons.push('part: unsupported');
    if (!reasons.length)
      for (const [axis, dimension] of [['x', 'width'], ['y', 'height'], ['z', 'depth']])
        if (b[axis] + b[dimension] - 1 > 63) reasons.push(`${axis}/${dimension}: occupied-extent-above-maximum`);
    if (reasons.length)
      throw new Error(`${location} has invalid dimensions, bounds, color, or part (${reasons.join('; ')}). No build was started. Try a smaller scene size or ask for tiled parts; no automatic retry.`);
    const r = b.repeat;
    if (r !== undefined) {
      if (!r || typeof r !== 'object' || Array.isArray(r))
        throw new Error(`${location} has an invalid repeat (repeat: object-required).`);
      for (const [field, min, max] of [['count', 2, 8192], ['dx', -127, 127], ['dy', -63, 63], ['dz', -127, 127]]) {
        const reason = integerReason(r[field], min, max);
        if (reason) reasons.push(`repeat.${field}: ${reason}`);
      }
      if (!reasons.length && !r.dx && !r.dy && !r.dz) reasons.push('repeat.stride: zero');
      if (reasons.length) throw new Error(`${location} has an invalid repeat (${reasons.join('; ')}).`);
    }
    const n = r?.count ?? 1;
    const endX = b.x + (n - 1) * (r?.dx ?? 0), endY = b.y + (n - 1) * (r?.dy ?? 0), endZ = b.z + (n - 1) * (r?.dz ?? 0);
    for (const [axis, dimension, end, min] of [['x', 'width', endX, -64], ['y', 'height', endY, 0], ['z', 'depth', endZ, -64]]) {
      if (Math.min(b[axis], end) < min) reasons.push(`repeat.${axis}: occupied-extent-below-minimum`);
      if (Math.max(b[axis], end) + b[dimension] - 1 > 63) reasons.push(`repeat.${axis}/${dimension}: occupied-extent-above-maximum`);
    }
    if (reasons.length) throw new Error(`${location} repeat exceeds bounds (${reasons.join('; ')}).`);
    count += n;
    volume += n * b.width * b.height * b.depth;
    if (count > 8192) throw new Error('Custom design exceeds the 8192-brick limit.');
    if (volume > 262144) throw new Error('Custom design exceeds 262144 occupied cells.');
    const result = { x: b.x, y: b.y, z: b.z, width: b.width, height: b.height, depth: b.depth, color: b.color, part: b.part };
    if (r) result.repeat = { count: r.count, dx: r.dx, dy: r.dy, dz: r.dz };
    return result;
  }) }));
  if (count > s.budget) throw new Error('Custom design exceeds its expanded brick budget.');
  const occupied = new Map();
  for (const [objectIndex, object] of canonicalObjects.entries())
    for (const [recordIndex, record] of object.bricks.entries())
      for (const [repeatIndex, b] of expandCustomBricks([record]).entries()) {
        const location = `object ${objectIndex + 1}, brick ${recordIndex + 1}, repeat ${repeatIndex + 1}`;
        for (let x = b.x; x < b.x + b.width; x++)
          for (let y = b.y; y < b.y + b.height; y++)
            for (let z = b.z; z < b.z + b.depth; z++) {
              const key = `${x},${y},${z}`;
              if (occupied.has(key))
                throw new Error(`Custom bricks overlap after expansion (${location} intersects ${occupied.get(key)}).`);
              occupied.set(key, location);
            }
      }
  return { world: s.world, model: 'custom', color: s.color, longTail: false, wideWings: false,
    budget: s.budget, design: multi ? { name: d.name.trim(), objects: canonicalObjects }
      : { name: d.name.trim(), bricks: canonicalObjects[0].bricks } };
}

// Only call with canonical records returned by validateCustomSpec.
export function expandCustomBricks(records) {
  return records.flatMap(({ repeat, ...brick }) => Array.from({ length: repeat?.count ?? 1 }, (_, i) => ({
    ...brick, x: brick.x + i * (repeat?.dx ?? 0), y: brick.y + i * (repeat?.dy ?? 0), z: brick.z + i * (repeat?.dz ?? 0),
  })));
}
