import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReport } from "../src/analytics/aggregate.ts";
import type { SessionUsage } from "../src/analytics/types.ts";
import { renderHtmlReport } from "../src/reports/html.ts";
import { renderTextReport, renderQuotaText } from "../src/reports/text.ts";
import type { QuotaCard } from "../src/quota/types.ts";

const now = new Date("2026-11-08T12:00:00.000Z");

function sessions(): SessionUsage[] {
  return [
    {
      id: "s1",
      file: "/tmp/s1.jsonl",
      cwd: "/Users/example/<script>",
      startedAt: now.getTime() - 3_600_000,
      lastActivityAt: now.getTime() - 60_000,
      records: [
        {
          kind: "assistant",
          timestamp: now.getTime() - 60_000,
          provider: "opencode-go",
          model: "deepseek-v4.1-flash",
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: 3000,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          totalTokens: 4200,
          costUSD: 0.012,
          requestCount: 1,
        },
      ],
    },
  ];
}

const quota: QuotaCard = {
  id: "codex",
  label: "OpenAI Codex",
  status: "warning",
  plan: "Free",
  windows: [
    { id: "primary", label: "Monthly", usedPercent: 82, resetsAt: now.getTime() + 86_400_000, windowSeconds: 2_592_000 },
  ],
  balance: { label: "Credits", value: "$3.50" },
  updatedAt: now.getTime(),
  source: "test",
};

test("text report includes totals, providers, models, and quotas", () => {
  const report = buildReport(sessions(), "today", now);
  const text = renderTextReport(report, { quotas: [quota], now: now.getTime() });
  assert.match(text, /pi-meter · Today/);
  assert.match(text, /Spend \$0\.012/);
  assert.match(text, /opencode-go/);
  assert.match(text, /deepseek-v4\.1-flash/);
  assert.match(text, /OpenAI Codex · Free/);
  assert.match(text, /82%/);
});

test("text report can hide quotas and cap rows", () => {
  const report = buildReport(sessions(), "today", now);
  const text = renderTextReport(report, { includeQuotas: false, quotas: [quota], maxRows: 1 });
  assert.doesNotMatch(text, /OpenAI Codex/);
});

test("quota text shows errors instead of windows", () => {
  const broken: QuotaCard = { ...quota, status: "error", windows: [], error: "HTTP 401" };
  const lines = renderQuotaText(broken, 72, now.getTime());
  assert.match(lines.join("\n"), /HTTP 401/);
});

test("HTML report escapes user-controlled project paths", () => {
  const report = buildReport(sessions(), "today", now);
  const html = renderHtmlReport(report, { quotas: [quota], now: now.getTime() });
  assert.match(html, /<!doctype html>/);
  assert.match(html, /OpenAI Codex/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("every daily bar is present in the HTML chart", () => {
  const report = buildReport(sessions(), "7d", now);
  const html = renderHtmlReport(report, { now: now.getTime() });
  assert.equal((html.match(/class="day"/g) ?? []).length, 7);
});
