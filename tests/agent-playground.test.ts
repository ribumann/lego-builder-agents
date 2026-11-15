import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentPlayground, ROBOT_BLUEPRINT, validPlaygroundDependencies } from '../src/agent-playground-engine';

function finish(lab: AgentPlayground) {
  for (let steps = 0; steps < 80 && !['blocked', 'complete'].includes(lab.phase); steps++) {
    assert.ok(lab.step(), `A live ${lab.phase} phase must produce a tool event`);
  }
}

test('robot tools cause actual placement, independent defect detection and verified repair', () => {
  const lab = new AgentPlayground();
  finish(lab);
  assert.equal(lab.phase, 'complete');
  assert.deepEqual(lab.defects, []);
  assert.equal(lab.placed.size, ROBOT_BLUEPRINT.length);
  const inspect = lab.events.find(event => event.result === 'defect')!;
  const repair = lab.events.find(event => event.tool === 'repair_brick')!;
  assert.equal(inspect.agent, 'inspector');
  assert.deepEqual(inspect.output.defects, ['right-eye']);
  assert.equal(repair.agent, 'repair');
  assert.ok(repair.id > inspect.id);
  assert.equal(repair.placed.find(part => part.id === 'right-eye')!.y, 94);
  assert.equal(inspect.placed.find(part => part.id === 'right-eye')!.y, 104);
  assert.equal(lab.events.at(-1)!.agent, 'inspector');
  assert.equal(lab.events.at(-1)!.result, 'passed');
  assert.equal(lab.canRememberRepair(), true);
  assert.equal(lab.step(), undefined);
});

test('missing stock blocks atomically, replanning does independent work, restock resumes', () => {
  const lab = new AgentPlayground('missing');
  finish(lab);
  assert.equal(lab.blocker, 'inventory');
  assert.equal(lab.placed.has('left-arm'), false, 'A partial failed task must not mutate the build');
  assert.equal(lab.placed.has('right-arm'), false);
  const before = [...lab.placed.values()];
  assert.equal(lab.canReplan, true);
  assert.equal(lab.replan()!.output.continueWith, 'head');
  assert.deepEqual([...lab.placed.values()], before);
  finish(lab);
  assert.equal(lab.blocker, 'inventory');
  assert.equal(lab.placed.has('head'), true);
  assert.equal(lab.placed.has('antenna'), true);
  assert.equal(lab.canReplan, false);
  assert.equal(lab.replan(), undefined);
  assert.equal(lab.restock()!.output.placedAutomatically, false);
  assert.equal(lab.placed.has('right-arm'), false);
  finish(lab);
  assert.equal(lab.phase, 'complete');
  assert.deepEqual(lab.defects, []);
  assert.equal(lab.restock(), undefined);
});

test('a dependency cycle prevents all placement until the revised graph is verified', () => {
  const lab = new AgentPlayground('dependency');
  finish(lab);
  assert.equal(lab.blocker, 'dependency');
  assert.equal(lab.placed.size, 0);
  assert.equal(lab.step(), undefined);
  assert.equal(validPlaygroundDependencies(lab.tasks), false);
  const rejected = lab.events.at(-1)!;
  lab.revisePlan();
  assert.equal(lab.phase, 'verify');
  assert.equal(lab.placed.size, 0);
  assert.equal(lab.step()!.result, 'ready');
  assert.equal(rejected.tasks[0].depends[0], 'eyes', 'Replay keeps the rejected graph, not the later edit');
  finish(lab);
  assert.equal(lab.phase, 'complete');
});

test('an explicitly retained lesson changes the next build rather than fabricating memory', () => {
  const first = new AgentPlayground();
  finish(first);
  assert.equal(first.lessonApplied, false);
  assert.ok(first.events.some(event => event.result === 'defect'));
  const next = new AgentPlayground('robot', first.canRememberRepair());
  finish(next);
  assert.equal(next.lessonApplied, true);
  assert.ok(next.events.some(event => event.tool === 'recall_lesson'));
  assert.equal(next.events.some(event => event.result === 'defect'), false);
  assert.equal(next.events.some(event => event.agent === 'repair'), false);
  assert.equal(next.canRememberRepair(), false);
  assert.equal(first.events[0].placed.length, 0);
  assert.equal(first.events[0].inventory['left-foot'], 1);
});

test('dependency validation rejects missing references and duplicated task identities', () => {
  assert.equal(validPlaygroundDependencies([{ id: 'a', agent: 'structure', parts: [], depends: ['missing'] }]), false);
  assert.equal(validPlaygroundDependencies([
    { id: 'a', agent: 'structure', parts: [], depends: [] },
    { id: 'a', agent: 'detail', parts: [], depends: [] },
  ]), false);
});
