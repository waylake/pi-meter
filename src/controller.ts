import { scanSessions, resolveAgentDir, type ScanOptions } from "./analytics/scanner.ts";
import type { ScanResult } from "./analytics/types.ts";
import { fetchQuotas } from "./quota/index.ts";
import type { QuotaCard } from "./quota/types.ts";
import type { MeterData } from "./ui/state.ts";

export interface MeterControllerOptions {
  agentDir?: string;
  env?: NodeJS.ProcessEnv;
  useCache?: boolean;
  quotaTtlMs?: number;
  scanOptions?: ScanOptions;
}

export class MeterController {
  readonly agentDir: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly useCache: boolean;
  private readonly quotaTtlMs: number;
  private readonly scanOptions: ScanOptions;
  private scanResult: ScanResult | undefined;
  private quotaCards: QuotaCard[] = [];
  private quotasUpdatedAt: number | undefined;
  private quotasError: string | undefined;
  private inflight: Promise<MeterData> | undefined;
  private quotaInflight: Promise<QuotaCard[]> | undefined;

  constructor(options: MeterControllerOptions = {}) {
    this.agentDir = options.agentDir ?? resolveAgentDir();
    this.env = options.env ?? process.env;
    this.useCache = options.useCache !== false;
    this.quotaTtlMs = options.quotaTtlMs ?? 60_000;
    this.scanOptions = options.scanOptions ?? {};
  }

  data(): MeterData | undefined {
    if (!this.scanResult) return undefined;
    return {
      scan: this.scanResult,
      quotas: this.quotaCards,
      ...(this.quotasUpdatedAt !== undefined ? { quotasUpdatedAt: this.quotasUpdatedAt } : {}),
      ...(this.quotasError ? { quotasError: this.quotasError } : {}),
    };
  }

  async scan(): Promise<ScanResult> {
    this.scanResult = await scanSessions({
      agentDir: this.agentDir,
      useCache: this.useCache,
      ...this.scanOptions,
    });
    return this.scanResult;
  }

  async refresh(options: { signal?: AbortSignal; refreshQuotas?: boolean; forceQuotas?: boolean } = {}): Promise<MeterData> {
    if (this.inflight) return this.inflight;
    const run = (async () => {
      const scan = await this.scan();
      const shouldRefreshQuotas =
        options.refreshQuotas !== false &&
        (options.forceQuotas === true ||
          this.quotasUpdatedAt === undefined ||
          Date.now() - this.quotasUpdatedAt > this.quotaTtlMs);
      if (shouldRefreshQuotas) {
        await this.refreshQuotas(options.signal);
      }
      return {
        scan,
        quotas: this.quotaCards,
        ...(this.quotasUpdatedAt !== undefined ? { quotasUpdatedAt: this.quotasUpdatedAt } : {}),
        ...(this.quotasError ? { quotasError: this.quotasError } : {}),
      };
    })().finally(() => {
      this.inflight = undefined;
    });
    this.inflight = run;
    return run;
  }

  async refreshQuotas(signal?: AbortSignal): Promise<QuotaCard[]> {
    if (this.quotaInflight) return this.quotaInflight;
    const run = fetchQuotas({
      agentDir: this.agentDir,
      env: this.env,
      ...(signal ? { signal } : {}),
    })
      .then((cards) => {
        this.quotaCards = cards;
        this.quotasUpdatedAt = Date.now();
        this.quotasError = undefined;
        return cards;
      })
      .catch((error: unknown) => {
        this.quotasError = error instanceof Error ? error.message : String(error);
        this.quotasUpdatedAt = Date.now();
        return this.quotaCards;
      })
      .finally(() => {
        this.quotaInflight = undefined;
      });
    this.quotaInflight = run;
    return run;
  }
}
