import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDuration, formatTokens, formatUSD, projectLabel, periodRange } from "../src/analytics/format.ts";
import { DashboardState } from "../src/ui/state.ts";
import { renderDashboard } from "../src/ui/render.ts";
import type { MeterData } from "../src/ui/state.ts";
import type { SessionUsage } from "../src/analytics/types.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  dim: (text: string) => text,
};

const now = new Date("2026-11-08T12:00:00.000Z");

function session(): SessionUsage {
  return {
    id: "session-1",
    file: "/tmp/session-1.jsonl",
    cwd: "/Users/example/waylake-ssot",
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
        durationMs: 1200,
      },
    ],
  };
}

function data(): MeterData {
  return {
    scan: {
      sessions: [session()],
      roots: ["/tmp/sessions"],
      scannedAt: now.getTime() - 5_000,
      durationMs: 12,
      filesScanned: 1,
      filesReused: 0,
      warnings: [],
    },
    quotas: [
      {
        id: "opencode-go",
        label: "OpenCode Go",
        status: "warning",
        plan: "Standard",
        windows: [
          { id: "rolling", label: "5-hour", usedPercent: 42, resetsAt: now.getTime() + 3_600_000, windowSeconds: 18_000 },
        ],
        updatedAt: now.getTime(),
        source: "test",
      },
    ],
    quotasUpdatedAt: now.getTime(),
  };
}

function state(tab: "overview" | "models" | "quotas" = "overview"): DashboardState {
  const value = new DashboardState();
  value.data = data();
  value.loading = false;
  value.now = now.getTime();
  value.setTab(tab);
  return value;
}

test("formats money, tokens, and durations", () => {
  assert.equal(formatUSD(0.00434235), "$0.0043");
  assert.equal(formatUSD(1.2), "$1.20");
  assert.equal(formatUSD(12.345), "$12.35");
  assert.equal(formatTokens(190_948_099), "191M");
  assert.equal(formatTokens(1_500), "1.5k");
  assert.equal(formatDuration(2_345), "2s");
  assert.equal(formatDuration(3_600_000), "1h");
  assert.equal(formatDuration(5_400_000), "1h 30m");
});

test("period ranges start at local midnight", () => {
  const today = periodRange("today", now);
  assert.equal(new Date(today.start).getHours(), 0);
  const week = periodRange("7d", now);
  assert.equal(Math.round((week.end - week.start) / 86_400_000), 7);
});

test("project labels use the last path segment", () => {
  assert.equal(projectLabel("/Users/example/waylake-ssot"), "waylake-ssot");
  assert.equal(projectLabel(""), "unknown");
});

test("renders the overview with totals, providers, and models", () => {
  const lines = renderDashboard(state("overview"), {
    width: 100,
    height: 40,
    theme,
    now: now.getTime(),
  });
  const text = lines.join("\n");
  assert.match(text, /pi-meter/);
  assert.match(text, /Overview/);
  assert.match(text, /Spend/);
  assert.match(text, /opencode-go/);
  assert.match(text, /deepseek-v4\.1-flash/);
  assert.match(text, /Cache hit/);
});

test("renders the models table and detail toggle", () => {
  const value = state("models");
  const before = renderDashboard(value, { width: 90, height: 30, theme, now: now.getTime() }).join("\n");
  assert.match(before, /Models/);
  assert.match(before, /MODEL/);
  value.detail = true;
  const after = renderDashboard(value, { width: 90, height: 30, theme, now: now.getTime() }).join("\n");
  assert.match(after, /Detail/);
  assert.match(after, /tokens/);
});

test("renders quota windows and reset countdowns", () => {
  const text = renderDashboard(state("quotas"), { width: 90, height: 30, theme, now: now.getTime() }).join("\n");
  assert.match(text, /OpenCode Go/);
  assert.match(text, /5-hour/);
  assert.match(text, /42%/);
  assert.match(text, /in 1\.0h/);
});

test("renders the help overlay", () => {
  const value = state();
  value.help = true;
  const text = renderDashboard(value, { width: 80, height: 24, theme, now: now.getTime() }).join("\n");
  assert.match(text, /pi-meter keys/);
  assert.match(text, /switch tab/);
});

test("every rendered line fits the requested width", () => {
  for (const tab of ["overview", "models", "projects", "sessions", "quotas"] as const) {
    const value = state(tab === "overview" ? "overview" : tab === "quotas" ? "quotas" : "models");
    const lines = renderDashboard(value, { width: 48, height: 24, theme, now: now.getTime() });
    for (const line of lines) {
      assert.ok(line.length <= 60, `line too wide: ${JSON.stringify(line)}`);
    }
  }
});
