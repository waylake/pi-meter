import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReport } from "../src/analytics/aggregate.ts";
import type { SessionUsage, UsageRecord } from "../src/analytics/types.ts";

function record(overrides: Partial<UsageRecord> & { timestamp: number }): UsageRecord {
  return {
    kind: "assistant",
    provider: "opencode-go",
    model: "deepseek-v4.1-flash",
    inputTokens: 1000,
    outputTokens: 100,
    cacheReadTokens: 4000,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 5100,
    costUSD: 0.01,
    requestCount: 1,
    ...overrides,
  };
}

function session(id: string, cwd: string, records: UsageRecord[], startedAt = records[0]?.timestamp ?? Date.now()): SessionUsage {
  return {
    id,
    file: `/sessions/${id}.jsonl`,
    cwd,
    startedAt,
    lastActivityAt: records.at(-1)?.timestamp ?? startedAt,
    records,
  };
}

const now = new Date("2026-11-08T12:00:00.000Z");

test("filters by period and aggregates totals", () => {
  const sessions = [
    session("s1", "/work/alpha", [
      record({ timestamp: now.getTime() - 60_000, costUSD: 0.5, totalTokens: 1000 }),
      record({ timestamp: now.getTime() - 2 * 86_400_000, costUSD: 0.25, totalTokens: 2000 }),
    ]),
    session("s2", "/work/beta", [
      record({ timestamp: now.getTime() - 10 * 86_400_000, costUSD: 2, totalTokens: 4000 }),
    ]),
  ];

  const today = buildReport(sessions, "today", now);
  assert.ok(Math.abs(today.totals.costUSD - 0.5) < 1e-9);
  assert.equal(today.totals.sessions, 1);
  assert.equal(today.totals.projects, 1);

  const week = buildReport(sessions, "7d", now);
  assert.ok(Math.abs(week.totals.costUSD - 0.75) < 1e-9);
  assert.equal(week.totals.requests, 2);

  const all = buildReport(sessions, "30d", now);
  assert.ok(Math.abs(all.totals.costUSD - 2.75) < 1e-9);
  assert.equal(all.totals.sessions, 2);
  assert.equal(all.totals.projects, 2);
});

test("computes cache hit rate against all input-side tokens", () => {
  const sessions = [
    session("s1", "/work/alpha", [
      record({ timestamp: now.getTime(), inputTokens: 1000, cacheReadTokens: 3000, cacheWriteTokens: 0 }),
    ]),
  ];
  const report = buildReport(sessions, "today", now);
  assert.equal(report.cacheHitRate, 75);
});

test("groups by provider, model, project, and session", () => {
  const sessions = [
    session("s1", "/work/alpha", [
      record({ timestamp: now.getTime(), costUSD: 0.4 }),
      record({ timestamp: now.getTime(), provider: "anthropic", model: "claude-haiku-5-5", costUSD: 0.9 }),
    ]),
    session("s2", "/work/beta", [record({ timestamp: now.getTime(), costUSD: 0.2 })]),
  ];
  const report = buildReport(sessions, "today", now);

  assert.deepEqual(
    report.providers.map((row) => row.label),
    ["anthropic", "opencode-go"],
  );
  assert.equal(report.models.length, 2);
  assert.equal(report.projects.length, 2);
  assert.equal(report.sessions.length, 2);
  assert.equal(report.topModel?.label, "claude-haiku-5-5");
});

test("sorts models by the requested metric", () => {
  const sessions = [
    session("s1", "/work/alpha", [
      record({ timestamp: now.getTime(), model: "quiet", costUSD: 0.01, totalTokens: 50_000 }),
      record({ timestamp: now.getTime(), model: "pricey", costUSD: 1.5, totalTokens: 1_000 }),
    ]),
  ];
  assert.equal(buildReport(sessions, "today", now, "cost").models[0]?.label, "pricey");
  assert.equal(buildReport(sessions, "today", now, "tokens").models[0]?.label, "quiet");
});

test("builds a chart with zero-filled days", () => {
  const sessions = [
    session("s1", "/work/alpha", [record({ timestamp: now.getTime() - 2 * 86_400_000, costUSD: 1 })]),
  ];
  const report = buildReport(sessions, "7d", now);
  assert.equal(report.daily.length, 7);
  assert.ok(report.daily.some((point) => point.costUSD === 0));
  assert.equal(report.peakDay?.costUSD, 1);
  assert.equal(report.activeDays, 1);
});

test("handles an empty period", () => {
  const report = buildReport([], "today", now);
  assert.equal(report.totals.costUSD, 0);
  assert.equal(report.totals.requests, 0);
  assert.equal(report.cacheHitRate, 0);
  assert.equal(report.topModel, undefined);
  assert.ok(report.daily.every((point) => point.costUSD === 0));
});
