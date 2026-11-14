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
  plan(prompt: string, options?: {
    image?: { mimeType: 'image/png' | 'image/jpeg'; data: string };
    imageConsent?: boolean;
    signal?: AbortSignal;
  }): Promise<string>;
}

export function createLocalPlanner(options: LocalPlannerOptions): LocalPlanner;
