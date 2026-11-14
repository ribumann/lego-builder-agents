export interface LocalPlannerOptions {
  enabled: boolean;
  model: string;
  url?: string;
  timeoutMs?: number;
}

export interface LocalPlanner {
  status(): {
    enabled: boolean;
    model: string;
    state: 'off' | 'missing-model' | 'configured';
    message: string;
  };
  plan(prompt: string): Promise<string>;
}

export function createLocalPlanner(options: LocalPlannerOptions): LocalPlanner;
