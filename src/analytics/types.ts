export type PeriodId = "today" | "7d" | "30d" | "all";

export const PERIODS: readonly { id: PeriodId; label: string; short: string }[] = [
  { id: "today", label: "Today", short: "today" },
  { id: "7d", label: "7 days", short: "7d" },
  { id: "30d", label: "30 days", short: "30d" },
  { id: "all", label: "All time", short: "all" },
];

export type UsageKind = "assistant" | "usage" | "compaction" | "branch_summary";

export interface UsageRecord {
  /** Stable entry id inside the session, when the transcript provides one. */
  entryId?: string;
  kind: UsageKind;
  timestamp: number;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUSD: number;
  requestCount: number;
  durationMs?: number;
  stopReason?: string;
}

export interface SessionUsage {
  id: string;
  file: string;
  cwd: string;
  name?: string;
  parentSession?: string;
  startedAt: number;
  lastActivityAt: number;
  records: UsageRecord[];
}

export interface ScanWarning {
  file?: string;
  message: string;
}

export interface ScanResult {
  sessions: SessionUsage[];
  roots: string[];
  scannedAt: number;
  durationMs: number;
  filesScanned: number;
  filesReused: number;
  warnings: ScanWarning[];
}

export interface Totals {
  costUSD: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  requests: number;
  sessions: number;
  projects: number;
  errors: number;
  durationMs: number;
  durationSamples: number;
}

export interface GroupBucket {
  key: string;
  label: string;
  detail?: string;
  totals: Totals;
  models: string[];
  firstUsed: number;
  lastUsed: number;
}

export interface DayPoint {
  key: string;
  date: Date;
  costUSD: number;
  tokens: number;
  requests: number;
}

export interface HourPoint {
  hour: number;
  costUSD: number;
  tokens: number;
  requests: number;
}

export interface Report {
  period: PeriodId;
  start: number;
  end: number;
  totals: Totals;
  cacheHitRate: number;
  avgCostPerRequest: number;
  avgDurationMs: number | undefined;
  activeDays: number;
  providers: GroupBucket[];
  models: GroupBucket[];
  projects: GroupBucket[];
  sessions: GroupBucket[];
  daily: DayPoint[];
  hourly: HourPoint[];
  peakDay: DayPoint | undefined;
  topModel: GroupBucket | undefined;
  generatedAt: number;
}
