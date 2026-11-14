import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentInsights } from '../src/agent-insights';
import { Team, createPlan, validateSpec } from '../src/engine';

function fixture() {
  return new Team(createPlan(validateSpec({
    world: 'space', model: 'custom', color: 'blue', longTail: false, wideWings: false, budget: 5,
    design: { name: 'User 🚀', bricks: [
      { x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, color: 'blue', part: 'frame',
        repeat: { count: 4, dx: 0, dy: 1, dz: 0 } },
      { x: 0, y: 4, z: 0, width: 1, height: 1, depth: 1, color: 'orange', part: 'detail' },
    ] },
  }, 'space'), [], 'copilot'));
}

test('insights read the same dependency-ready task as construction without changing it', () => {
  const team = fixture();
  const snapshot = structuredClone(team.snapshot('User brief'));
  const initial = agentInsights(team);
  assert.equal(initial.planned, 5);
  assert.equal(initial.missing, 5);
  assert.equal(initial.source, 'copilot');
  assert.equal(initial.dependencies, 1);
  assert.equal(initial.agents.find(agent => agent.id === 'frame')!.ready, team.readyTask('frame'));
  assert.equal(initial.agents.find(agent => agent.id === 'detail')!.ready, undefined);
  assert.deepEqual(team.snapshot('User brief'), snapshot);
  team.step(1);
  assert.equal(agentInsights(team).placed, 1);
  assert.equal(agentInsights(team).agents.find(agent => agent.id === 'detail')!.ready, undefined);
  while (team.step(1)) {}
  const complete = agentInsights(team);
  assert.equal(complete.placed, 5);
  assert.equal(complete.missing, 0);
  assert.equal(complete.completedTasks, complete.totalTasks);
  assert.ok(complete.agents.every(agent => agent.lastAction === team.events.slice().reverse().find(event => event.agent === agent.id)));
});

test('insights show actual missing identities through repair and never invent evicted actions', () => {
  const team = fixture();
  while (team.step(20)) {}
  team.damage();
  const damaged = structuredClone(team.snapshot('User brief'));
  assert.equal(agentInsights(team).missing, 2);
  assert.deepEqual(team.snapshot('User brief'), damaged);
  team.repair();
  while (team.step(20)) {}
  assert.equal(agentInsights(team).missing, 0);
  team.events = team.events.filter(event => event.agent === 'check');
  const view = agentInsights(team);
  assert.equal(view.agents.find(agent => agent.id === 'build')!.lastAction, undefined);
  assert.equal(view.agents.find(agent => agent.id === 'check')!.lastAction, team.events.at(-1));
});
