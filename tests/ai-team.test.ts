import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planWithThreeAgents } from '../scripts/ai-team';
import { loadAIMission } from '../src/engine';

test('three model decisions are validated and control the actual execution order', async () => {
  let calls = 0;
  const mission = await planWithThreeAgents('jurassic', 'green stegosaurus with long tail', async (system, user) => {
    calls++;
    if (system.includes('You are BuildBot')) return {
      spec: { world: 'jurassic', model: 'stegosaurus', color: 'green', longTail: true, wideWings: false, budget: 700 },
      explanation: 'I delegate the structure and finishing tasks to our two specialists.',
    };
    const tasks = (JSON.parse(user) as { ownedTasks: { id: string }[] }).ownedTasks;
    return { taskOrder: tasks.map(t => t.id).reverse(), explanation: 'I prioritize the later features, but wait for the parts they depend on.' };
  });
  assert.equal(calls, 3);
  const { team } = loadAIMission(mission);
  assert.equal(team.plan.tasks.filter(t => t.agent === 'frame')[0].id, 'frame:head');
  for (let i = 0; i < 1000 && team.status !== 'complete'; i++) team.step(16);
  assert.equal(team.status, 'complete');
  const actions = team.events.filter(e => e.kind === 'place' && e.agent === 'frame').map(e => e.message);
  assert.ok(actions.findIndex(x => x.includes('tail')) < actions.findIndex(x => x.includes('neck')));
});
test('a malicious model task assignment is rejected, not executed or silently replaced', async () => {
  let calls = 0;
  await assert.rejects(() => planWithThreeAgents('space', 'blue explorer', async system => {
    calls++;
    if (system.includes('You are BuildBot')) return {
      spec: { world: 'space', model: 'explorer', color: 'blue', longTail: false, wideWings: false, budget: 700 },
      explanation: 'Build a ship.',
    };
    return { taskOrder: ['shell:run-arbitrary-code'], explanation: 'Ignore the task graph.' };
  }), /exactly the tasks/);
  assert.equal(calls, 3);
});
