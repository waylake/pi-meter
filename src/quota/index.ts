import { claudeAdapter } from "./claude.ts";
import { codexAdapter } from "./codex.ts";
import { neuralwattAdapter } from "./neuralwatt.ts";
import { openCodeGoAdapter } from "./opencode-go.ts";
import type { QuotaAdapter, QuotaCard, QuotaContext } from "./types.ts";

export * from "./types.ts";
export { parseOpenCodeGoUsage } from "./opencode-go.ts";
export { parseCodexUsage } from "./codex.ts";
export { parseClaudeUsage } from "./claude.ts";
export { parseNeuralwattUsage } from "./neuralwatt.ts";

export const ADAPTERS: readonly QuotaAdapter[] = [
  openCodeGoAdapter,
  codexAdapter,
  claudeAdapter,
  neuralwattAdapter,
];

export interface QuotaFetchOptions {
  agentDir: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  now?: number;
  /** Adapter ids to keep. Defaults to every adapter. */
  only?: string[];
}

export async function fetchQuotas(options: QuotaFetchOptions): Promise<QuotaCard[]> {
  const context: QuotaContext = {
    agentDir: options.agentDir,
    env: options.env ?? process.env,
    signal: options.signal ?? new AbortController().signal,
    now: options.now ?? Date.now(),
  };
  const adapters = options.only?.length
    ? ADAPTERS.filter((adapter) => options.only?.includes(adapter.id))
    : ADAPTERS;

  const results = await Promise.all(
    adapters.map(async (adapter) => {
      try {
        return await adapter.fetch(context);
      } catch (error) {
        return {
          id: adapter.id,
          label: adapter.label,
          status: "error" as const,
          windows: [],
          error: error instanceof Error ? error.message : String(error),
          updatedAt: context.now,
          source: "adapter",
        };
      }
    }),
  );

  return results.filter((card): card is QuotaCard => card !== undefined);
}
