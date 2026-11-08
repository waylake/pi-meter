export type QuotaStatus = "ok" | "warning" | "critical" | "error" | "unavailable";

export interface QuotaWindow {
  id: string;
  label: string;
  usedPercent: number;
  resetsAt?: number;
  windowSeconds?: number;
  detail?: string;
}

export interface QuotaBalance {
  label: string;
  value: string;
}

export interface QuotaCard {
  id: string;
  label: string;
  status: QuotaStatus;
  plan?: string;
  windows: QuotaWindow[];
  balance?: QuotaBalance;
  detail?: string;
  error?: string;
  updatedAt: number;
  source: string;
}

export interface QuotaContext {
  agentDir: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  now: number;
}

export interface Credential {
  type: "api_key" | "oauth";
  value: string;
  accountId?: string;
  source: string;
}

export interface QuotaAdapter {
  id: string;
  label: string;
  fetch(context: QuotaContext): Promise<QuotaCard | undefined>;
}
