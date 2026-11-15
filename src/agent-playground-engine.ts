export type PlaygroundAgent = 'coordinator' | 'verifier' | 'structure' | 'detail' | 'inspector' | 'repair';
export type PlaygroundScenario = 'robot' | 'missing' | 'dependency';
export type PlaygroundTool = 'create_plan' | 'recall_lesson' | 'check_dependencies' | 'place_bricks'
  | 'inspect_build' | 'repair_brick' | 'replan_build' | 'restock_part' | 'revise_plan';
export type PlaygroundPhase = 'ready' | 'recall' | 'verify' | 'build' | 'inspect' | 'repair' | 'reinspect' | 'blocked' | 'complete';
export type PlaygroundResult = 'planned' | 'recalled' | 'ready' | 'placed' | 'missing' | 'cycle'
  | 'defect' | 'repaired' | 'passed' | 'replanned' | 'restocked' | 'revised';

export interface PlaygroundPart {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export interface PlaygroundTask {
  id: string;
  agent: 'structure' | 'detail';
  parts: string[];
  depends: string[];
}

export interface PlaygroundEvent {
  id: number;
  agent: PlaygroundAgent;
  tool: PlaygroundTool;
  result: PlaygroundResult;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  affected: string[];
  placed: PlaygroundPart[];
  inventory: Record<string, number>;
  phase: PlaygroundPhase;
  tasks: PlaygroundTask[];
  task?: string;
}

export const PLAYGROUND_AGENTS: PlaygroundAgent[] = [
  'coordinator', 'verifier', 'structure', 'detail', 'inspector', 'repair',
];

export const PLAYGROUND_TOOLS: Record<PlaygroundAgent, PlaygroundTool[]> = {
  coordinator: ['create_plan', 'recall_lesson', 'replan_build', 'restock_part', 'revise_plan'],
  verifier: ['check_dependencies'],
  structure: ['place_bricks'],
  detail: ['place_bricks'],
  inspector: ['inspect_build'],
  repair: ['repair_brick'],
};

export const ROBOT_BLUEPRINT: readonly PlaygroundPart[] = [
  { id: 'left-foot', x: 87, y: 284, width: 62, height: 24, color: '#254f75' },
  { id: 'right-foot', x: 171, y: 284, width: 62, height: 24, color: '#254f75' },
  { id: 'left-leg', x: 105, y: 234, width: 35, height: 50, color: '#527b94' },
  { id: 'right-leg', x: 180, y: 234, width: 35, height: 50, color: '#527b94' },
  { id: 'torso', x: 96, y: 144, width: 128, height: 90, color: '#e5ad30' },
  { id: 'left-arm', x: 55, y: 153, width: 37, height: 68, color: '#527b94' },
  { id: 'right-arm', x: 228, y: 153, width: 37, height: 68, color: '#527b94' },
  { id: 'head', x: 107, y: 75, width: 106, height: 65, color: '#e5ad30' },
  { id: 'left-eye', x: 126, y: 94, width: 18, height: 18, color: '#23384c' },
  { id: 'right-eye', x: 176, y: 94, width: 18, height: 18, color: '#23384c' },
  { id: 'antenna', x: 151, y: 48, width: 18, height: 27, color: '#bc5b47' },
];

function robotTasks(): PlaygroundTask[] {
  return [
    { id: 'feet', agent: 'structure', parts: ['left-foot', 'right-foot'], depends: [] },
    { id: 'legs', agent: 'structure', parts: ['left-leg', 'right-leg'], depends: ['feet'] },
    { id: 'torso', agent: 'structure', parts: ['torso'], depends: ['legs'] },
    { id: 'arms', agent: 'structure', parts: ['left-arm', 'right-arm'], depends: ['torso'] },
    { id: 'head', agent: 'detail', parts: ['head'], depends: ['torso'] },
    { id: 'eyes', agent: 'detail', parts: ['left-eye', 'right-eye'], depends: ['head'] },
    { id: 'antenna', agent: 'detail', parts: ['antenna'], depends: ['head'] },
  ];
}

export function validPlaygroundDependencies(tasks: readonly PlaygroundTask[]): boolean {
  const byId = new Map(tasks.map(task => [task.id, task]));
  if (byId.size !== tasks.length) return false;
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id) || !byId.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    if (!byId.get(id)!.depends.every(visit)) return false;
    visiting.delete(id);
    visited.add(id);
    return true;
  };
  return tasks.every(task => visit(task.id));
}

export class AgentPlayground {
  readonly scenario: PlaygroundScenario;
  readonly lessonAtStart: boolean;
  readonly tasks = robotTasks();
  readonly placed = new Map<string, PlaygroundPart>();
  readonly inventory = new Map(ROBOT_BLUEPRINT.map(part => [part.id, 1]));
  readonly events: PlaygroundEvent[] = [];
  phase: PlaygroundPhase = 'ready';
  blocker: 'inventory' | 'dependency' | null = null;
  pendingTask: string | null = null;
  postponedTask: string | null = null;
  lessonApplied = false;
  repairPerformed = false;

  constructor(scenario: PlaygroundScenario = 'robot', lessonAtStart = false) {
    this.scenario = scenario;
    this.lessonAtStart = lessonAtStart;
    if (scenario === 'missing') this.inventory.set('right-arm', 0);
    if (scenario === 'dependency') this.tasks[0].depends = ['eyes'];
  }

  private record(
    agent: PlaygroundAgent, tool: PlaygroundTool, result: PlaygroundResult,
    input: Record<string, unknown>, output: Record<string, unknown>, affected: string[] = [], task?: string,
  ): PlaygroundEvent {
    const event: PlaygroundEvent = {
      id: this.events.length + 1, agent, tool, result, input, output, affected: [...affected], task,
      placed: [...this.placed.values()].map(part => ({ ...part })),
      inventory: Object.fromEntries(this.inventory),
      phase: this.phase,
      tasks: this.tasks.map(item => ({ ...item, parts: [...item.parts], depends: [...item.depends] })),
    };
    this.events.push(event);
    return event;
  }

  taskDone(task: PlaygroundTask): boolean {
    return task.parts.every(id => this.placed.has(id));
  }

  get completedTasks(): number { return this.tasks.filter(task => this.taskDone(task)).length; }

  get canReplan(): boolean {
    return this.blocker === 'inventory' && this.tasks.some(task => task.id !== this.pendingTask
      && !this.taskDone(task) && task.depends.every(id => this.taskDone(this.tasks.find(item => item.id === id)!))
      && task.parts.every(id => (this.inventory.get(id) ?? 0) > 0));
  }

  get defects(): string[] {
    return ROBOT_BLUEPRINT.filter(expected => {
      const actual = this.placed.get(expected.id);
      return !actual || actual.x !== expected.x || actual.y !== expected.y
        || actual.width !== expected.width || actual.height !== expected.height || actual.color !== expected.color;
    }).map(part => part.id);
  }

  step(): PlaygroundEvent | undefined {
    if (this.phase === 'complete' || this.phase === 'blocked') return;
    if (this.phase === 'ready') {
      this.phase = this.lessonAtStart ? 'recall' : 'verify';
      return this.record('coordinator', 'create_plan', 'planned', { subject: 'robot' },
        { tasks: this.tasks.length, parts: ROBOT_BLUEPRINT.length, sharedPlan: true });
    }
    if (this.phase === 'recall') {
      this.lessonApplied = true;
      this.phase = 'verify';
      return this.record('coordinator', 'recall_lesson', 'recalled',
        { lesson: 'align-eyes', source: 'browser-memory' }, { constraint: 'eyes-share-blueprint-row' }, ['left-eye', 'right-eye']);
    }
    if (this.phase === 'verify') {
      const valid = validPlaygroundDependencies(this.tasks);
      this.phase = valid ? 'build' : 'blocked';
      this.blocker = valid ? null : 'dependency';
      return this.record('verifier', 'check_dependencies', valid ? 'ready' : 'cycle',
        { tasks: this.tasks.map(task => ({ id: task.id, depends: [...task.depends] })) },
        { valid, cycle: !valid }, valid ? [] : ['left-foot', 'right-foot', 'head', 'left-eye', 'right-eye']);
    }
    if (this.phase === 'inspect' || this.phase === 'reinspect') {
      const defects = this.defects;
      this.phase = defects.length ? 'repair' : 'complete';
      return this.record('inspector', 'inspect_build', defects.length ? 'defect' : 'passed',
        { compare: 'actual-positions-to-blueprint' },
        { checked: ROBOT_BLUEPRINT.length, defects: [...defects], passed: defects.length === 0 }, defects);
    }
    if (this.phase === 'repair') {
      const defects = this.defects;
      const before = defects.map(id => ({ ...this.placed.get(id)! }));
      for (const id of defects) this.placed.set(id, { ...ROBOT_BLUEPRINT.find(part => part.id === id)! });
      this.repairPerformed = true;
      this.phase = 'reinspect';
      return this.record('repair', 'repair_brick', 'repaired', { parts: defects, before },
        { positions: defects.map(id => ({ ...this.placed.get(id)! })), requiresIndependentInspection: true }, defects);
    }
    const pending = this.tasks.find(task => task.id === this.pendingTask);
    if (pending) {
      const missing = pending.parts.filter(id => (this.inventory.get(id) ?? 0) < 1);
      if (missing.length) {
        this.phase = 'blocked';
        this.blocker = 'inventory';
        return this.record(pending.agent, 'place_bricks', 'missing', { task: pending.id, parts: [...pending.parts] },
          { placed: 0, missing, requiresCoordinator: true }, missing, pending.id);
      }
      for (const id of pending.parts) {
        const part = { ...ROBOT_BLUEPRINT.find(item => item.id === id)! };
        if (id === 'right-eye' && !this.lessonApplied) part.y += 10;
        this.placed.set(id, part);
        this.inventory.set(id, this.inventory.get(id)! - 1);
      }
      this.pendingTask = null;
      if (this.tasks.every(task => this.taskDone(task))) this.phase = 'inspect';
      return this.record(pending.agent, 'place_bricks', 'placed', { task: pending.id, parts: [...pending.parts] },
        { positions: pending.parts.map(id => ({ ...this.placed.get(id)! })) }, pending.parts, pending.id);
    }
    const unfinished = this.tasks.filter(task => !this.taskDone(task)
      && task.depends.every(id => this.taskDone(this.tasks.find(item => item.id === id)!)));
    const next = unfinished.find(task => task.id !== this.postponedTask) ?? unfinished[0];
    if (!next) return;
    this.pendingTask = next.id;
    return this.record('verifier', 'check_dependencies', 'ready',
      { task: next.id, requires: [...next.depends] }, { ready: true, assignedTo: next.agent }, next.parts, next.id);
  }

  replan(): PlaygroundEvent | undefined {
    if (!this.canReplan) return;
    this.postponedTask = this.pendingTask;
    this.pendingTask = null;
    this.blocker = null;
    this.phase = 'build';
    const next = this.tasks.find(task => !this.taskDone(task) && task.id !== this.postponedTask
      && task.depends.every(id => this.taskDone(this.tasks.find(item => item.id === id)!)));
    return this.record('coordinator', 'replan_build', 'replanned',
      { blockedTask: this.postponedTask }, { continueWith: next?.id, existingBricksPreserved: true }, next?.parts);
  }

  restock(): PlaygroundEvent | undefined {
    if (this.scenario !== 'missing' || this.inventory.get('right-arm') !== 0 || this.placed.has('right-arm')) return;
    this.inventory.set('right-arm', 1);
    if (this.blocker === 'inventory') {
      this.blocker = null;
      this.phase = 'build';
    }
    return this.record('coordinator', 'restock_part', 'restocked', { part: 'right-arm', quantity: 1 },
      { available: 1, placedAutomatically: false }, ['right-arm']);
  }

  revisePlan(): PlaygroundEvent | undefined {
    if (this.blocker !== 'dependency') return;
    this.tasks[0].depends = [];
    this.blocker = null;
    this.phase = 'verify';
    return this.record('coordinator', 'revise_plan', 'revised',
      { task: 'feet', removeDependency: 'eyes' }, { depends: [], requiresVerification: true }, ['left-foot', 'right-foot']);
  }

  canRememberRepair(): boolean {
    return this.phase === 'complete' && this.repairPerformed && !this.lessonAtStart;
  }
}
