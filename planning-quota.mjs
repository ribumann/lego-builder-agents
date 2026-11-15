export function createPlanningQuota({ hosted, env = process.env }) {
  if (!hosted) return { enabled: false, dailyCallLimit: null, dailyClientLimit: null };
  const dailyCallLimit = env.BRICKLAB_AZURE_DAILY_CALLS === undefined
    ? 12 : Number(env.BRICKLAB_AZURE_DAILY_CALLS);
  const dailyClientLimit = env.BRICKLAB_AZURE_DAILY_CLIENT_CALLS === undefined
    ? 3 : Number(env.BRICKLAB_AZURE_DAILY_CLIENT_CALLS);
  if (!Number.isInteger(dailyCallLimit) || dailyCallLimit < 1 || dailyCallLimit > 100
      || !Number.isInteger(dailyClientLimit) || dailyClientLimit < 1 || dailyClientLimit > 3)
    throw new Error('Public Azure daily quotas require 1-100 global calls and 1-3 calls per principal.');
  return { enabled: true, dailyCallLimit, dailyClientLimit };
}
