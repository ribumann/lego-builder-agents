import { AGENTS, allBricks, type AgentId, type Team } from './engine';

export function agentInsights(team: Team) {
  const bricks = allBricks(team.plan);
  return {
    source: team.plan.source,
    placed: team.bricks.size,
    planned: bricks.length,
    missing: bricks.filter(brick => !team.bricks.has(brick.id)).length,
    completedTasks: team.completedTasks,
    totalTasks: team.plan.tasks.length,
    dependencies: team.plan.tasks.reduce((count, task) => count + task.depends.length, 0),
    agents: (Object.keys(AGENTS) as AgentId[]).map(id => {
      const tasks = team.plan.tasks.filter(task => task.agent === id);
      return {
        id,
        tasks: tasks.length,
        completed: tasks.filter(task => team.taskDone(task)).length,
        ready: id === 'frame' || id === 'detail' ? team.readyTask(id) : undefined,
        lastAction: team.events.slice().reverse().find(event => event.agent === id),
      };
    }),
  };
}
