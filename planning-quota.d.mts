export function createPlanningQuota(options: {
  hosted: boolean;
  env?: Record<string, string | undefined>;
}): {
  enabled: boolean;
  dailyCallLimit: number | null;
  dailyClientLimit: number | null;
};
