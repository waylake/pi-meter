import { dayKey, dayPointsBetween, formatShortDate, periodRange, projectLabel, startOfLocalDay } from "./format.ts";
import type {
  DayPoint,
  GroupBucket,
  HourPoint,
  PeriodId,
  Report,
  SessionUsage,
  Totals,
  UsageRecord,
} from "./types.ts";

interface MutableTotals {
  costUSD: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  requests: number;
  errors: number;
  durationMs: number;
  durationSamples: number;
  sessionIds: Set<string>;
  projectKeys: Set<string>;
}

interface MutableGroup {
  key: string;
  label: string;
  detail?: string;
  totals: MutableTotals;
  models: Set<string>;
  firstUsed: number;
  lastUsed: number;
}

export type SortMetric = "cost" | "tokens" | "requests";

export function buildReport(
  sessions: SessionUsage[],
  period: PeriodId,
  now: Date = new Date(),
  sortMetric: SortMetric = "cost",
): Report {
  const range = periodRange(period, now);
  const totals = mutableTotals();
  const providerGroups = new Map<string, MutableGroup>();
  const modelGroups = new Map<string, MutableGroup>();
  const projectGroups = new Map<string, MutableGroup>();
  const sessionGroups = new Map<string, MutableGroup>();
  const daily = new Map<string, DayPoint>();
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    costUSD: 0,
    tokens: 0,
    requests: 0,
  }));
  const activeDays = new Set<string>();
  let earliest = Number.POSITIVE_INFINITY;

  for (const session of sessions) {
    for (const record of session.records) {
      if (record.timestamp < range.start || record.timestamp > range.end) continue;

      earliest = Math.min(earliest, record.timestamp);
      activeDays.add(dayKey(record.timestamp));
      addToTotals(totals, record, session, session.cwd);

      const provider = groupFor(providerGroups, record.provider, record.provider, undefined);
      addToGroup(provider, record, session, `${record.provider}/${record.model}`);

      const modelKey = `${record.provider}/${record.model}`;
      const model = groupFor(modelGroups, modelKey, record.model, record.provider);
      addToGroup(model, record, session, record.model);

      const projectKey = session.cwd || "unknown";
      const project = groupFor(projectGroups, projectKey, projectLabel(projectKey), projectKey);
      addToGroup(project, record, session, `${record.provider}/${record.model}`);

      const sessionKey = session.id;
      const sessionLabel =
        session.name ||
        `${projectLabel(session.cwd)} · ${formatShortDate(session.startedAt)} ${new Date(session.startedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
      const sessionGroup = groupFor(sessionGroups, sessionKey, sessionLabel, session.cwd);
      addToGroup(sessionGroup, record, session, `${record.provider}/${record.model}`);

      const key = dayKey(record.timestamp);
      const point = daily.get(key) ?? {
        key,
        date: startOfLocalDay(record.timestamp),
        costUSD: 0,
        tokens: 0,
        requests: 0,
      };
      point.costUSD += record.costUSD;
      point.tokens += record.totalTokens;
      point.requests += record.requestCount;
      daily.set(key, point);

      const hour = new Date(record.timestamp).getHours();
      const hourPoint = hourly[hour];
      if (hourPoint) {
        hourPoint.costUSD += record.costUSD;
        hourPoint.tokens += record.totalTokens;
        hourPoint.requests += record.requestCount;
      }
    }
  }

  const chartDays = chartDates(period, range.start, range.end, now);
  const dailyPoints = chartDays.map((date) => {
    const key = dayKey(date.getTime());
    return daily.get(key) ?? { key, date, costUSD: 0, tokens: 0, requests: 0 };
  });

  const finishedTotals = finishTotals(totals);
  const cacheDenominator =
    finishedTotals.inputTokens + finishedTotals.cacheReadTokens + finishedTotals.cacheWriteTokens;
  const cacheHitRate = cacheDenominator > 0 ? (finishedTotals.cacheReadTokens / cacheDenominator) * 100 : 0;
  const avgCostPerRequest =
    finishedTotals.requests > 0 ? finishedTotals.costUSD / finishedTotals.requests : 0;
  const avgDurationMs =
    finishedTotals.durationSamples > 0 ? finishedTotals.durationMs / finishedTotals.durationSamples : undefined;

  const providers = finalizeGroups(providerGroups, sortMetric);
  const models = finalizeGroups(modelGroups, sortMetric);
  const projects = finalizeGroups(projectGroups, sortMetric);
  const sessionRows = finalizeGroups(sessionGroups, "cost").sort((a, b) => b.lastUsed - a.lastUsed);
  const peakDay = dailyPoints.reduce<DayPoint | undefined>(
    (best, point) => (!best || point.costUSD > best.costUSD ? point : best),
    undefined,
  );

  return {
    period,
    start: Number.isFinite(earliest) ? earliest : range.start,
    end: range.end,
    totals: finishedTotals,
    cacheHitRate,
    avgCostPerRequest,
    avgDurationMs,
    activeDays: activeDays.size,
    providers,
    models,
    projects,
    sessions: sessionRows,
    daily: dailyPoints,
    hourly,
    peakDay,
    topModel: models[0],
    generatedAt: now.getTime(),
  };
}

function chartDates(period: PeriodId, start: number, end: number, now: Date): Date[] {
  if (period === "all") return dayPointsBetween(startOfLocalDay(new Date(now.getTime() - 29 * 86_400_000)).getTime(), end);
  return dayPointsBetween(start, end);
}

export function sortGroups(groups: GroupBucket[], metric: SortMetric): GroupBucket[] {
  return [...groups].sort((a, b) => {
    if (metric === "tokens") {
      if (b.totals.tokens !== a.totals.tokens) return b.totals.tokens - a.totals.tokens;
    } else if (metric === "requests") {
      if (b.totals.requests !== a.totals.requests) return b.totals.requests - a.totals.requests;
    } else {
      if (b.totals.costUSD !== a.totals.costUSD) return b.totals.costUSD - a.totals.costUSD;
      if (b.totals.tokens !== a.totals.tokens) return b.totals.tokens - a.totals.tokens;
    }
    return a.label.localeCompare(b.label);
  });
}

function mutableTotals(): MutableTotals {
  return {
    costUSD: 0,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    requests: 0,
    errors: 0,
    durationMs: 0,
    durationSamples: 0,
    sessionIds: new Set(),
    projectKeys: new Set(),
  };
}

function addToTotals(
  totals: MutableTotals,
  record: UsageRecord,
  session: SessionUsage,
  projectKey: string,
): void {
  totals.costUSD += record.costUSD;
  totals.tokens += record.totalTokens;
  totals.inputTokens += record.inputTokens;
  totals.outputTokens += record.outputTokens;
  totals.cacheReadTokens += record.cacheReadTokens;
  totals.cacheWriteTokens += record.cacheWriteTokens;
  totals.reasoningTokens += record.reasoningTokens;
  totals.requests += record.requestCount;
  if (record.stopReason === "error") totals.errors++;
  if (record.durationMs !== undefined && Number.isFinite(record.durationMs)) {
    totals.durationMs += record.durationMs;
    totals.durationSamples++;
  }
  totals.sessionIds.add(session.id);
  totals.projectKeys.add(projectKey);
}

function finishTotals(totals: MutableTotals): Totals {
  return {
    costUSD: totals.costUSD,
    tokens: totals.tokens,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens,
    reasoningTokens: totals.reasoningTokens,
    requests: totals.requests,
    sessions: totals.sessionIds.size,
    projects: totals.projectKeys.size,
    errors: totals.errors,
    durationMs: totals.durationMs,
    durationSamples: totals.durationSamples,
  };
}

function groupFor(
  map: Map<string, MutableGroup>,
  key: string,
  label: string,
  detail: string | undefined,
): MutableGroup {
  const existing = map.get(key);
  if (existing) return existing;
  const group: MutableGroup = {
    key,
    label,
    ...(detail ? { detail } : {}),
    totals: mutableTotals(),
    models: new Set(),
    firstUsed: Number.POSITIVE_INFINITY,
    lastUsed: 0,
  };
  map.set(key, group);
  return group;
}

function addToGroup(group: MutableGroup, record: UsageRecord, session: SessionUsage, model: string): void {
  addToTotals(group.totals, record, session, session.cwd);
  group.models.add(model);
  group.firstUsed = Math.min(group.firstUsed, record.timestamp);
  group.lastUsed = Math.max(group.lastUsed, record.timestamp);
}

function finalizeGroups(groups: Map<string, MutableGroup>, metric: SortMetric): GroupBucket[] {
  const rows: GroupBucket[] = [];
  for (const group of groups.values()) {
    rows.push({
      key: group.key,
      label: group.label,
      ...(group.detail ? { detail: group.detail } : {}),
      totals: finishTotals(group.totals),
      models: [...group.models].sort(),
      firstUsed: Number.isFinite(group.firstUsed) ? group.firstUsed : group.lastUsed,
      lastUsed: group.lastUsed,
    });
  }
  return sortGroups(rows, metric);
}
