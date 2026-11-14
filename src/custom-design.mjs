// Shared by the browser and the Node planner endpoint. Coordinates identify
// the lower corner cell; dimensions count whole grid cells.
export const CUSTOM_DESIGN_PROMPT = `For an original design, return a JSON build spec with:
{"world":"jurassic" or "space","model":"custom","color":"green"|"orange"|"blue"|"purple"|"red"|"white","longTail":false,"wideWings":false,"budget":1..8192,"design":{"name":"readable name (1-80 characters)","objects":[{"name":"unique object name (1-60 characters)","bricks":[{"x":integer,"y":integer,"z":integer,"width":integer,"height":integer,"depth":integer,"color":"green"|"orange"|"blue"|"purple"|"red"|"white","part":"frame"|"detail","repeat":{"count":integer,"dx":integer,"dy":integer,"dz":integer}}]}]}}.
Use named objects for separate dinosaurs, ships, or scenery; each object must be internally face-connected, but objects may be separated. For one object, design.bricks remains supported instead of objects. repeat is optional; count includes the first brick at x,y,z and each next is offset by dx,dy,dz. count is 2..8192, dx/dz -127..127, dy -63..63; stride cannot be all zero. Use 1-32 objects and 1-256 compact records total. The normal target is up to 1000 expanded bricks and 32768 occupied cells; the advanced hard limits are 8192 expanded bricks and 262144 occupied cells, with no overlap anywhere and no more bricks than budget. Dimensions are 1-8 cells each. Every occupied x/z cell must be within -64..63 and y within 0..63, inclusive. Coordinates are lower corner cells. Frame is structural, detail is finishing work. The result is static. Do not substitute a template for an unrelated brief.`;

const colors = ['green', 'orange', 'blue', 'purple', 'red', 'white'];
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

export function validateCustomSpec(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Custom specification must be an object.');
  const s = value;
  if (!['jurassic', 'space'].includes(s.world) || s.model !== 'custom' || !colors.includes(s.color)
      || s.longTail !== false || s.wideWings !== false || !integer(s.budget, 1, 8192))
    throw new Error('Custom specification has invalid world, color, flags, or budget.');
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
  const canonicalObjects = objects.map(object => ({ name: object.name.trim(), bricks: object.bricks.map((b, index) => {
    if (!b || typeof b !== 'object' || Array.isArray(b)
        || !integer(b.x, -64, 63) || !integer(b.y, 0, 63) || !integer(b.z, -64, 63)
        || !integer(b.width, 1, 8) || !integer(b.height, 1, 8) || !integer(b.depth, 1, 8)
        || b.x + b.width - 1 > 63 || b.y + b.height - 1 > 63 || b.z + b.depth - 1 > 63
        || !colors.includes(b.color) || !['frame', 'detail'].includes(b.part))
      throw new Error(`Custom brick ${index + 1} has invalid dimensions, bounds, color, or part.`);
    const r = b.repeat;
    if (r !== undefined && (!r || typeof r !== 'object' || Array.isArray(r)
        || !integer(r.count, 2, 8192) || !integer(r.dx, -127, 127) || !integer(r.dy, -63, 63)
        || !integer(r.dz, -127, 127) || (!r.dx && !r.dy && !r.dz)))
      throw new Error(`Custom brick ${index + 1} has an invalid repeat.`);
    const n = r?.count ?? 1;
    const endX = b.x + (n - 1) * (r?.dx ?? 0), endY = b.y + (n - 1) * (r?.dy ?? 0), endZ = b.z + (n - 1) * (r?.dz ?? 0);
    if (Math.min(b.x, endX) < -64 || Math.max(b.x, endX) + b.width - 1 > 63
        || Math.min(b.y, endY) < 0 || Math.max(b.y, endY) + b.height - 1 > 63
        || Math.min(b.z, endZ) < -64 || Math.max(b.z, endZ) + b.depth - 1 > 63)
      throw new Error(`Custom brick ${index + 1} repeat exceeds bounds.`);
    count += n;
    volume += n * b.width * b.height * b.depth;
    if (count > 8192 || count > s.budget) throw new Error('Custom design exceeds its expanded brick budget or 8192-brick limit.');
    if (volume > 262144) throw new Error('Custom design exceeds 262144 occupied cells.');
    const result = { x: b.x, y: b.y, z: b.z, width: b.width, height: b.height, depth: b.depth, color: b.color, part: b.part };
    if (r) result.repeat = { count: r.count, dx: r.dx, dy: r.dy, dz: r.dz };
    return result;
  }) }));
  const occupied = new Set();
  for (const b of canonicalObjects.flatMap(object => expandCustomBricks(object.bricks)))
    for (let x = b.x; x < b.x + b.width; x++)
      for (let y = b.y; y < b.y + b.height; y++)
        for (let z = b.z; z < b.z + b.depth; z++) {
          const key = `${x},${y},${z}`;
          if (occupied.has(key)) throw new Error('Custom bricks overlap after expansion.');
          occupied.add(key);
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
