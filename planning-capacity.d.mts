export function createPlanningCapacity(options?: {
  total?: number;
  perProvider?: number;
}): {
  acquire(provider: string): (() => void) | null;
  status(): {
    active: number;
    total: number;
    perProvider: number;
    providers: Record<string, number>;
  };
};
