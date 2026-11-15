export function createPlanningQuota({ hosted, env = process.env }) {
  if (!hosted) return { enabled: false, dailyCallLimit: null, dailyClientLimit: null };
  const dailyCallLimit = env.BRICKLAB_AZURE_DAILY_CALLS === undefined
    ? 50 : Number(env.BRICKLAB_AZURE_DAILY_CALLS);
  if (!Number.isInteger(dailyCallLimit) || dailyCallLimit < 1 || dailyCallLimit > 100)
    throw new Error('Public Azure daily quota requires 1-100 global calls.');
  return { enabled: true, dailyCallLimit, dailyClientLimit: null };
}
