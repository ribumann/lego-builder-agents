// Shared by the browser and the Node planner endpoint. Coordinates identify
// the lower corner cell; dimensions count whole grid cells.
export const CUSTOM_DESIGN_PROMPT = `For an original design, return a JSON build spec with:
{"world":"jurassic" or "space","model":"custom","color":"green"|"orange"|"blue"|"purple"|"red"|"white","longTail":false,"wideWings":false,"budget":1..1000,"design":{"name":"readable name (1-80 characters)","bricks":[{"x":integer,"y":integer,"z":integer,"width":integer,"height":integer,"depth":integer,"color":"green"|"orange"|"blue"|"purple"|"red"|"white","part":"frame"|"detail"}]}}.
Use 1-256 non-overlapping rectangular bricks, no more than budget, with dimensions 1-8 cells each and at most 4096 occupied cells total. x and z occupied cells must be within -24..24 and y within 0..32, inclusive. Coordinates are the lower corner of each brick. Make all bricks face-connected; frame is structural, detail is finishing work. The result is a static model. Do not copy a template unless the brief asks for it.`;

const colors = ['green', 'orange', 'blue', 'purple', 'red', 'white'];
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

export function validateCustomSpec(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Custom specification must be an object.');
  const s = value;
  if (!['jurassic', 'space'].includes(s.world) || s.model !== 'custom' || !colors.includes(s.color)
      || s.longTail !== false || s.wideWings !== false || !integer(s.budget, 1, 1000))
    throw new Error('Custom specification has invalid world, color, flags, or budget.');
  const d = s.design;
  if (!d || typeof d !== 'object' || Array.isArray(d) || typeof d.name !== 'string'
      || !d.name.trim() || d.name.length > 80 || /[\p{C}]/u.test(d.name))
    throw new Error('Custom design needs a readable name of 1–80 characters.');
  if (!Array.isArray(d.bricks) || d.bricks.length < 1 || d.bricks.length > 256)
    throw new Error('Custom designs need 1–256 bricks.');
  if (d.bricks.length > s.budget) throw new Error('Custom design exceeds its brick budget.');
  const occupied = new Set();
  const bricks = d.bricks.map((b, index) => {
    if (!b || typeof b !== 'object' || Array.isArray(b)
        || !integer(b.x, -24, 24) || !integer(b.y, 0, 32) || !integer(b.z, -24, 24)
        || !integer(b.width, 1, 8) || !integer(b.height, 1, 8) || !integer(b.depth, 1, 8)
        || b.x + b.width - 1 > 24 || b.y + b.height - 1 > 32 || b.z + b.depth - 1 > 24
        || !colors.includes(b.color) || !['frame', 'detail'].includes(b.part))
      throw new Error(`Custom brick ${index + 1} has invalid dimensions, bounds, color, or part.`);
    for (let x = b.x; x < b.x + b.width; x++)
      for (let y = b.y; y < b.y + b.height; y++)
        for (let z = b.z; z < b.z + b.depth; z++) {
          const key = `${x},${y},${z}`;
          if (occupied.has(key)) throw new Error(`Custom brick ${index + 1} overlaps another brick.`);
          occupied.add(key);
          if (occupied.size > 4096) throw new Error('Custom design exceeds 4096 occupied cells.');
        }
    return { x: b.x, y: b.y, z: b.z, width: b.width, height: b.height, depth: b.depth, color: b.color, part: b.part };
  });
  return { world: s.world, model: 'custom', color: s.color, longTail: false, wideWings: false,
    budget: s.budget, design: { name: d.name.trim(), bricks } };
}
