export function createPlanningCapacity({ total = 8, perProvider = 2 } = {}) {
  if (!Number.isInteger(total) || total < 1 || total > 32
      || !Number.isInteger(perProvider) || perProvider < 1 || perProvider > 8
      || perProvider > total)
    throw new Error('Planning capacity requires total 1-32 and per-provider 1-8, not exceeding total.');
  const active = new Map();
  let count = 0;
  return {
    acquire(provider) {
      const used = active.get(provider) ?? 0;
      if (count >= total || used >= perProvider) return null;
      count++;
      active.set(provider, used + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        count--;
        const remaining = active.get(provider) - 1;
        if (remaining) active.set(provider, remaining);
        else active.delete(provider);
      };
    },
    status() {
      return { active: count, total, perProvider, providers: Object.fromEntries(active) };
    },
  };
}
