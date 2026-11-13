export type World = 'jurassic' | 'space';
export type AgentId = 'build' | 'frame' | 'detail';
export type Color = 'green' | 'orange' | 'blue' | 'purple' | 'red' | 'white';
export type Model = 'stegosaurus' | 'brachiosaurus' | 'explorer' | 'cargo';
export type Status = 'ready' | 'planned' | 'building' | 'paused' | 'complete' | 'damaged';
export interface Spec {
  world: World;
  model: Model;
  color: Color;
  longTail: boolean;
  wideWings: boolean;
  budget: number;
}
export interface Brick {
  id: string;
  x: number;
  y: number;
  z: number;
  color: string;
  part: string;
  agent: 'frame' | 'detail';
}
export interface BuildTask {
  id: string;
  label: string;
  agent: 'frame' | 'detail';
  depends: string[];
  bricks: Brick[];
}
export interface Plan {
  spec: Spec;
  tasks: BuildTask[];
  assumptions: string[];
  source: 'local' | 'copilot' | 'github-models';
}
export interface AgentDecision {
  agent: AgentId;
  explanation: string;
  taskOrder: string[];
}
export interface AIMission {
  kind: 'bricklab-ai-mission';
  version: 1;
  brief: string;
  spec: Spec;
  model: string;
  decisions: AgentDecision[];
}
export interface AgentEvent {
  agent: AgentId;
  kind: 'plan' | 'delegate' | 'observe' | 'place' | 'verify' | 'repair';
  message: string;
  tick: number;
}
export interface Check { label: string; pass: boolean; detail: string }
export interface Snapshot {
  version: 1;
  world: World;
  prompt: string;
  spec: Spec;
  bricks: Brick[];
  status: Status;
  events: AgentEvent[];
  tick: number;
  source: Plan['source'];
  taskOrder: string[];
}
export const COLORS: Record<Color, string> = {
  green: '#57a95d', orange: '#f6a137', blue: '#4d91d4',
  purple: '#a184d4', red: '#e66553', white: '#e7edf0',
};
export const EXAMPLES: Record<World, string[]> = {
  jurassic: [
    'Build a green stegosaurus with orange plates and a long tail.',
    'Build a purple brachiosaurus with a tall neck.',
    'Build an orange stegosaurus with a short tail.',
  ],
  space: [
    'Build a blue explorer spaceship with wide wings and two engines.',
    'Build a white cargo spaceship with two engines.',
    'Build a red explorer spaceship with narrow wings.',
  ],
};
export const AGENTS = {
  build: { name: 'BuildBot', role: 'Coordinator', short: 'B', color: '#e6a51a' },
  frame: { name: 'FrameBot', role: 'Structure specialist', short: 'F', color: '#427cbd' },
  detail: { name: 'DetailBot', role: 'Finishing specialist', short: 'D', color: '#c36570' },
} as const;
const models: Model[] = ['stegosaurus', 'brachiosaurus', 'explorer', 'cargo'];
const colorNames = Object.keys(COLORS) as Color[];
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

export function parseBrief(world: World, prompt: string): { spec: Spec; assumptions: string[] } {
  if (!prompt.trim()) throw new Error('Give the team a brief first. Try one of the example ideas.');
  if (prompt.length > 1000) throw new Error('Keep your brief under 1,000 characters.');
  const text = prompt.toLowerCase();
  if (world === 'jurassic' && /\b(spaceship|spacecraft|shuttle)\b/.test(text))
    throw new Error('This is the dinosaur mission. Switch to Space dock to build a spaceship.');
  if (world === 'space' && /\b(dinosaur|stegosaurus|brachiosaurus)\b/.test(text))
    throw new Error('This is the spaceship mission. Switch to Jurassic valley to build a dinosaur.');
  if (/\b(t[ -]?rex|tyrannosaurus|triceratops)\b/.test(text))
    throw new Error('Those dinosaurs lived in the Cretaceous. Our Jurassic builders know stegosaurus and brachiosaurus.');
  const assumptions: string[] = [];
  let model: Model;
  if (world === 'jurassic') {
    model = /brachiosaurus|long.neck|tall.neck/.test(text) ? 'brachiosaurus' : 'stegosaurus';
    if (!/stegosaurus|brachiosaurus|long.neck|tall.neck/.test(text))
      assumptions.push('No species specified: I chose a stegosaurus. Try naming a brachiosaurus.');
  } else {
    model = /cargo|freight/.test(text) ? 'cargo' : 'explorer';
    if (!/cargo|explorer/.test(text)) assumptions.push('No ship type specified: I chose an explorer.');
  }
  const color = colorNames.find(c => new RegExp(`\\b${c}\\b`).test(text)) ?? (world === 'jurassic' ? 'green' : 'blue');
  if (!colorNames.some(c => new RegExp(`\\b${c}\\b`).test(text)))
    assumptions.push(`No body color specified: I chose ${color}.`);
  if (/fly|flying|laser|weapon|walk|roar|animate/.test(text))
    assumptions.push('I can build a static brick model, but cannot simulate walking, flying, sounds, or weapons.');
  const budgetMatch = text.match(/(?:under|within|max(?:imum)?|budget(?: of)?)\s*(\d+)\s*(?:bricks)?/);
  const budget = budgetMatch ? Number(budgetMatch[1]) : 700;
  if (budget < 1 || budget > 1000) throw new Error('Choose a brick budget between 1 and 1,000.');
  if (/\b(yellow|pink|black|brown|cyan)\b/.test(text))
    assumptions.push('Body palette: green, orange, blue, purple, red, or white. Other requested colors are not supported.');
  return {
    spec: { world, model, color, longTail: /long.tail/.test(text), wideWings: /wide|broad/.test(text), budget },
    assumptions,
  };
}

export function validateSpec(value: unknown, world: World): Spec {
  if (!value || typeof value !== 'object') throw new Error('The model returned no build specification.');
  const s = value as Record<string, unknown>;
  if (s.world !== world || !models.includes(s.model as Model) || !colorNames.includes(s.color as Color)
      || typeof s.longTail !== 'boolean' || typeof s.wideWings !== 'boolean'
      || !Number.isInteger(s.budget) || Number(s.budget) < 1 || Number(s.budget) > 1000)
    throw new Error('The model returned an invalid specification. No build was started.');
  if ((world === 'jurassic') !== ['stegosaurus', 'brachiosaurus'].includes(String(s.model)))
    throw new Error('The model chose an object outside this mission.');
  return { world, model: s.model as Model, color: s.color as Color,
    longTail: s.longTail, wideWings: s.wideWings, budget: Number(s.budget) };
}

export function createPlan(spec: Spec, assumptions: string[] = [], source: Plan['source'] = 'local'): Plan {
  const voxels = new Map<string, Brick>();
  const main = COLORS[spec.color];
  const add = (x: number, y: number, z: number, part: string, agent: Brick['agent'], color = main) => {
    const id = key(x, y, z);
    voxels.set(id, { id, x, y, z, part, agent, color });
  };
  const box = (x1: number, x2: number, y1: number, y2: number, z1: number, z2: number,
    part: string, agent: Brick['agent'], color = main) => {
    for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++)
      for (let z = z1; z <= z2; z++) add(x, y, z, part, agent, color);
  };
  if (spec.world === 'jurassic') {
    for (const x of [-3, 2]) for (const z of [-2, 2])
      box(x, x + 1, 0, 3, z, z, 'legs', 'frame');
    for (let y = 3; y <= 6; y++) {
      const length = y === 6 ? 2 : 3;
      box(-length, length, y, y, -2, 2, 'body', 'frame');
    }
    box(-2, 2, 3, 3, -1, 1, 'body', 'frame', '#c4d48a');
    const tailLength = spec.longTail ? 8 : 5;
    for (let i = 0; i < tailLength; i++)
      box(-4 - i, -4 - i, 5, 5,
        i < 2 ? -1 : 0, i < 2 ? 1 : 0, 'tail', 'frame');
    if (spec.model === 'brachiosaurus') {
      box(2, 3, 6, 11, -1, 1, 'neck', 'frame');
      box(3, 5, 11, 12, -1, 1, 'head', 'frame');
      for (const z of [-1, 1]) add(4, 12, z, 'eyes', 'detail', '#182d42');
      box(5, 5, 11, 11, -1, 1, 'muzzle', 'detail', '#c4d48a');
    } else {
      box(3, 4, 4, 5, -1, 1, 'neck', 'frame');
      box(5, 6, 4, 5, -1, 1, 'head', 'frame');
      for (const z of [-1, 1]) add(6, 5, z, 'eyes', 'detail', '#182d42');
      for (const x of [-2, 0, 2]) {
        add(x, 7, 0, 'plates', 'detail', '#f7ad3d');
        add(x, 8, 0, 'plates', 'detail', '#f7ad3d');
      }
    }
    for (const x of [-3, 2]) for (const z of [-2, 2])
      add(x + 1, 0, z, 'feet', 'detail', '#e4dab3');
  } else {
    for (const x of [-2, 2]) for (const z of [-2, 2])
      box(x, x, 0, 1, z, z, 'landing gear', 'frame', '#627489');
    box(-4, 3, 2, 3, -2, 2, 'hull', 'frame');
    box(-3, 2, 4, 4, -1, 1, 'hull', 'frame');
    for (let x = 4; x <= 6; x++)
      box(x, x, 2, 3, x === 4 ? -1 : 0, x === 4 ? 1 : 0, 'nose', 'frame');
    const width = spec.wideWings ? 7 : 5;
    for (const sign of [-1, 1]) for (let z = 3; z <= width; z++)
      box(-4, 2 - Math.floor((z - 2) / 2), 2, 2, z * sign, z * sign, 'wings', 'frame');
    box(-3, -2, 4, 6, 0, 0, 'fin', 'frame');
    for (const z of [-2, 2]) {
      box(-5, -5, 2, 3, z, z, 'engines', 'detail', '#75879d');
      box(-6, -6, 2, 3, z, z, 'thrusters', 'detail', '#ffb34e');
    }
    box(1, 3, 4, 4, -1, 1, 'cockpit', 'detail', '#66d5e0');
    add(2, 5, 0, 'cockpit', 'detail', '#66d5e0');
    if (spec.model === 'cargo') box(-2, 0, 5, 6, -1, 1, 'cargo', 'detail', '#e8b44c');
    for (const z of [-3, 3]) box(-3, 0, 2, 2, z, z, 'stripes', 'detail', '#eff0e5');
  }
  // Details can replace surface voxels. Group after replacement so no brick occupies another brick's cell.
  const groups = new Map<string, Brick[]>();
  for (const brick of voxels.values()) {
    const id = `${brick.agent}:${brick.part}`;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(brick);
  }
  const tasks: BuildTask[] = [];
  const supportFrame: Record<string, string> = {
    body: 'legs', tail: 'body', neck: 'body', head: 'neck',
    hull: 'landing gear', nose: 'hull', wings: 'hull', fin: 'hull',
  };
  for (const [id, bricks] of groups) {
    const agent = bricks[0].agent;
    if (agent !== 'frame') continue;
    const support = supportFrame[bricks[0].part];
    tasks.push({ id, label: bricks[0].part, agent, depends: support ? [`frame:${support}`] : [], bricks: sortBricks(bricks) });
  }
  const supportPart: Record<string, string> = {
    eyes: 'head', muzzle: 'head', plates: 'body', feet: 'legs',
    engines: 'hull', thrusters: 'hull', cockpit: 'nose', cargo: 'hull', stripes: 'wings',
  };
  for (const [id, bricks] of groups) {
    if (bricks[0].agent !== 'detail') continue;
    const support = `frame:${supportPart[bricks[0].part]}`;
    tasks.push({ id, label: bricks[0].part, agent: 'detail',
      depends: tasks.some(t => t.id === support) ? [support] : tasks.filter(t => t.agent === 'frame').map(t => t.id),
      bricks: sortBricks(bricks) });
  }
  const total = voxels.size;
  if (total > spec.budget) throw new Error(`This design needs ${total} bricks, above your ${spec.budget}-brick budget. Increase the budget or simplify the brief.`);
  return { spec, tasks, assumptions, source };
}
const sortBricks = (bricks: Brick[]) => bricks.sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z);
export const allBricks = (plan: Plan) => plan.tasks.flatMap(t => t.bricks);

export class Team {
  plan: Plan;
  bricks = new Map<string, Brick>();
  events: AgentEvent[] = [];
  tick = 0;
  status: Status = 'planned';
  constructor(plan: Plan) {
    this.plan = plan;
    this.log('build', 'plan', `I split this ${plan.spec.model} into ${plan.tasks.length} tasks for two specialists.`);
    for (const a of plan.assumptions) this.log('build', 'observe', a);
    this.log('build', 'delegate', 'FrameBot: build the structure. DetailBot: add each detail when its supporting part is ready. Work together from the shared board.');
    this.log('detail', 'observe', 'I can work alongside FrameBot, but each detail needs its supporting part first.');
  }
  log(agent: AgentId, kind: AgentEvent['kind'], message: string) {
    this.events.push({ agent, kind, message, tick: this.tick });
    if (this.events.length > 120) this.events.shift();
  }
  taskDone(task: BuildTask) { return task.bricks.every(b => this.bricks.has(b.id)); }
  get progress() { return this.bricks.size / allBricks(this.plan).length; }
  get completedTasks() { return this.plan.tasks.filter(t => this.taskDone(t)).length; }
  get checks() { return inspect(this.plan, [...this.bricks.values()]); }
  step(batch = 5): boolean {
    if (this.status === 'complete' || this.status === 'damaged') return false;
    this.status = 'building';
    this.tick++;
    // Both specialists independently observe the shared board on every turn.
    for (const agent of ['frame', 'detail'] as const) {
      const task = this.plan.tasks.find(t => t.agent === agent && !this.taskDone(t)
        && t.depends.every(id => this.taskDone(this.plan.tasks.find(d => d.id === id)!)));
      if (!task) continue;
      const remaining = task.bricks.filter(b => !this.bricks.has(b.id));
      if (remaining.length === task.bricks.length)
        this.log(agent, 'observe', `Dependencies ready. I chose the "${task.label}" task (${remaining.length} bricks).`);
      for (const brick of remaining.slice(0, Math.max(1, Math.min(20, batch)))) this.bricks.set(brick.id, brick);
      if (this.taskDone(task)) this.log(agent, 'place', `Finished ${task.label}. Shared board updated.`);
    }
    if (this.plan.tasks.every(t => this.taskDone(t))) {
      const checks = this.checks;
      this.status = checks.every(c => c.pass) ? 'complete' : 'damaged';
      this.log('build', 'verify', `${checks.filter(c => c.pass).length}/${checks.length} checks passed. ${this.status === 'complete' ? 'Mission built. You were the director!' : 'Inspection found a problem. Use repair to investigate.'}`);
    }
    return true;
  }
  damage() {
    if (this.status !== 'complete') return;
    const brick = allBricks(this.plan).find(b => b.part === (this.plan.spec.world === 'space' ? 'cockpit' : 'eyes'));
    if (!brick) return;
    this.bricks.delete(brick.id);
    this.status = 'damaged';
    this.log('build', 'observe', 'A finishing brick was removed for the test. Can the team notice without being told which one?');
  }
  repair() {
    if (this.status !== 'damaged') return;
    const missing = allBricks(this.plan).filter(b => !this.bricks.has(b.id));
    if (!missing.length) {
      this.log('build', 'verify', 'No missing bricks found. This prototype cannot automatically repair a different topology problem.');
      return;
    }
    for (const agent of ['frame', 'detail'] as const) {
      const owned = missing.filter(b => b.agent === agent);
      if (owned.length) this.log(agent, 'repair', `I compared the world with the plan and found ${owned.length} missing ${owned[0].part} brick${owned.length > 1 ? 's' : ''}. Reclaiming my task.`);
    }
    this.status = 'building';
  }
  snapshot(prompt: string): Snapshot {
    return { version: 1, world: this.plan.spec.world, prompt, spec: this.plan.spec,
      bricks: [...this.bricks.values()], status: this.status, events: this.events, tick: this.tick,
      source: this.plan.source, taskOrder: this.plan.tasks.map(t => t.id) };
  }
}

export function inspect(plan: Plan, bricks: Brick[]): Check[] {
  const expected = allBricks(plan);
  const present = new Set(bricks.map(b => b.id));
  const missing = expected.filter(b => !present.has(b.id));
  const seen = new Set<string>();
  const pending = bricks.length ? [bricks[0]] : [];
  const map = new Map(bricks.map(b => [b.id, b]));
  while (pending.length) {
    const b = pending.pop()!;
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
      const n = map.get(key(b.x + dx, b.y + dy, b.z + dz));
      if (n && !seen.has(n.id)) pending.push(n);
    }
  }
  const symmetric = bricks.every(b => present.has(key(b.x, b.y, -b.z)));
  return [
    { label: 'Brief fulfilled', pass: !missing.length && bricks.length === expected.length,
      detail: missing.length ? `${missing.length} planned brick${missing.length > 1 ? 's' : ''} missing.` : `${expected.length} planned bricks placed.` },
    { label: 'Connected model', pass: bricks.length > 0 && seen.size === bricks.length,
      detail: `${seen.size}/${bricks.length} bricks face-connected. Connectivity check, not a physical clutch or stability simulation.` },
    { label: 'Balanced sides', pass: bricks.length > 0 && symmetric,
      detail: symmetric ? 'Left and right brick positions mirror each other.' : 'The two sides do not match yet.' },
    { label: 'Within budget', pass: bricks.length <= plan.spec.budget,
      detail: `${bricks.length} of ${plan.spec.budget} allowed bricks. No model cost is implied.` },
  ];
}

export function restoreSnapshot(value: unknown): { team: Team; prompt: string } {
  if (!value || typeof value !== 'object') throw new Error('Saved build is not an object.');
  const s = value as Record<string, unknown>;
  if (s.version !== 1 || (s.world !== 'jurassic' && s.world !== 'space')
    || typeof s.prompt !== 'string' || s.prompt.length > 1000 || !Array.isArray(s.bricks)
    || !Number.isInteger(s.tick) || Number(s.tick) < 0)
    throw new Error('Saved build format is invalid or from a different version.');
  const spec = validateSpec(s.spec, s.world);
  const source = s.source === undefined ? 'local' : s.source;
  if (source !== 'local' && source !== 'copilot' && source !== 'github-models')
    throw new Error('Saved build has an invalid source.');
  const plan = createPlan(spec, [], source);
  if (s.taskOrder !== undefined) {
    if (!Array.isArray(s.taskOrder) || s.taskOrder.length !== plan.tasks.length
      || new Set(s.taskOrder).size !== plan.tasks.length
      || s.taskOrder.some(id => typeof id !== 'string' || !plan.tasks.some(t => t.id === id)))
      throw new Error('Saved task priority order is invalid.');
    const order = s.taskOrder as string[];
    plan.tasks.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }
  const team = new Team(plan);
  const expected = new Map(allBricks(team.plan).map(b => [b.id, b]));
  for (const item of s.bricks) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !expected.has(item.id)
      || team.bricks.has(item.id))
      throw new Error('Saved build contains unknown or duplicate bricks.');
    // Restore only canonical bricks, never executable or arbitrary imported content.
    team.bricks.set(item.id, expected.get(item.id)!);
  }
  team.tick = Number(s.tick);
  team.status = team.checks.every(c => c.pass) ? 'complete' : s.status === 'damaged' ? 'damaged' : 'paused';
  team.log('build', 'observe', 'Restored your saved build. Ready to continue.');
  return { team, prompt: s.prompt };
}

export function loadAIMission(value: unknown): { team: Team; prompt: string } {
  if (!value || typeof value !== 'object') throw new Error('AI mission is not an object.');
  const mission = value as Record<string, unknown>;
  if (mission.kind !== 'bricklab-ai-mission' || mission.version !== 1 || typeof mission.brief !== 'string'
    || !mission.brief.trim() || mission.brief.length > 1000 || typeof mission.model !== 'string'
    || mission.model.length > 100 || !Array.isArray(mission.decisions) || mission.decisions.length !== 3)
    throw new Error('AI mission format is invalid.');
  const inputSpec = mission.spec as Record<string, unknown> | undefined;
  if (!inputSpec || (inputSpec.world !== 'space' && inputSpec.world !== 'jurassic'))
    throw new Error('AI mission has no supported world.');
  const spec = validateSpec(inputSpec, inputSpec.world);
  const plan = createPlan(spec, [`Loaded AI mission attributed to ${mission.model}. Imported files are not proof that a model ran.`], 'github-models');
  const decisions = new Map<AgentId, AgentDecision>();
  for (const raw of mission.decisions) {
    if (!raw || typeof raw !== 'object') throw new Error('Agent decision is invalid.');
    const d = raw as Record<string, unknown>;
    if (!['build','frame','detail'].includes(String(d.agent)) || typeof d.explanation !== 'string'
      || !d.explanation.trim() || d.explanation.length > 1200 || !Array.isArray(d.taskOrder)
      || d.taskOrder.some(id => typeof id !== 'string') || decisions.has(d.agent as AgentId))
      throw new Error('AI mission must have one valid decision per agent.');
    const owned = plan.tasks.filter(t => t.agent === d.agent).map(t => t.id);
    if (new Set(d.taskOrder).size !== owned.length || d.taskOrder.length !== owned.length
      || d.taskOrder.some(id => !owned.includes(id)))
      throw new Error('Agent task priorities must contain exactly the tasks that agent owns.');
    decisions.set(d.agent as AgentId, { agent: d.agent as AgentId, explanation: d.explanation, taskOrder: d.taskOrder as string[] });
  }
  const order = [...decisions.get('frame')!.taskOrder, ...decisions.get('detail')!.taskOrder];
  plan.tasks.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const team = new Team(plan);
  for (const id of ['build', 'frame', 'detail'] as const) {
    team.log(id, 'plan', `AI mission decision: ${decisions.get(id)!.explanation}`);
  }
  return { team, prompt: mission.brief };
}
