import assert from "node:assert/strict";
import { test } from "node:test";
import { parseClaudeUsage } from "../src/quota/claude.ts";
import { parseCodexUsage } from "../src/quota/codex.ts";
import { parseNeuralwattUsage } from "../src/quota/neuralwatt.ts";
import { parseOpenCodeGoUsage } from "../src/quota/opencode-go.ts";

const now = Date.parse("2026-11-08T12:00:00.000Z");

test("parses OpenCode Go usage windows", () => {
  const card = parseOpenCodeGoUsage(
    {
      usage: {
        rolling: { status: "ok", percent: 0, resetsAt: "2026-11-08T16:39:05.000Z" },
        weekly: { status: "ok", percent: 12.5, resetsAt: "2026-11-09T00:00:00.000Z" },
        monthly: { status: "ok", percent: 4, resetsAt: "2026-12-07T14:46:17.000Z" },
      },
    },
    now,
    "test",
  );
  assert.equal(card.status, "ok");
  assert.equal(card.windows.length, 3);
  assert.equal(card.windows[1]?.usedPercent, 12.5);
  assert.equal(card.windows[0]?.resetsAt, Date.parse("2026-11-08T16:39:05.000Z"));
});

test("marks OpenCode Go windows as warning/critical by usage", () => {
  const card = parseOpenCodeGoUsage(
    { usage: { rolling: { percent: 74 }, weekly: { percent: 91 } } },
    now,
    "test",
  );
  assert.equal(card.status, "critical");
  assert.equal(card.windows.length, 2);
});

test("parses Codex rate limits, plan, and credits", () => {
  const card = parseCodexUsage(
    {
      plan_type: "free",
      rate_limit: {
        primary_window: { used_percent: 82, limit_window_seconds: 2_592_000, reset_at: 1_794_906_391 },
        secondary_window: null,
      },
      credits: { has_credits: true, unlimited: false, balance: 3.5 },
    },
    now,
    "test",
  );
  assert.equal(card.plan, "Free");
  assert.equal(card.windows[0]?.label, "Monthly");
  assert.equal(card.windows[0]?.usedPercent, 82);
  assert.equal(card.status, "warning");
  assert.deepEqual(card.balance, { label: "Credits", value: "$3.50" });
});

test("uses reset_after_seconds when reset_at is missing", () => {
  const card = parseCodexUsage(
    { rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 18_000, reset_after_seconds: 60 } } },
    now,
    "test",
  );
  assert.equal(card.windows[0]?.resetsAt, now + 60_000);
});

test("parses Claude OAuth usage windows", () => {
  const card = parseClaudeUsage(
    {
      five_hour: { utilization: 32.5, resets_at: "2026-11-08T15:00:00.000Z" },
      seven_day: { utilization: 61, resets_at: "2026-11-12T00:00:00.000Z" },
      seven_day_sonnet: { utilization: 88 },
      extra_usage: { is_enabled: true, utilization: 12, monthly_limit: 100, used_credits: 12 },
    },
    now,
    "test",
  );
  assert.deepEqual(
    card.windows.map((window) => window.label),
    ["5-hour", "Weekly", "Weekly · Sonnet", "Extra usage"],
  );
  assert.equal(card.status, "warning");
});

test("throws when Claude returns no usable windows", () => {
  assert.throws(() => parseClaudeUsage({}, now, "test"), /no usage windows/);
});

test("parses Neuralwatt energy plan, prepaid balance, and month spend", () => {
  const card = parseNeuralwattUsage(
    {
      balance: { credits_remaining_usd: 1, total_credits_usd: 1, credits_used_usd: 0 },
      usage: { current_month: { cost_usd: 5.8255 } },
      subscription: {
        plan: "standard",
        kwh_included: 6.25,
        kwh_used: 2.7825,
        current_period_end: "2026-11-15T06:08:55Z",
      },
      key: { allowance: null },
    },
    now,
    "test",
  );
  assert.equal(card.plan, "standard");
  assert.equal(card.windows.length, 1);
  assert.ok(Math.abs((card.windows[0]?.usedPercent ?? 0) - 44.52) < 0.01);
  assert.deepEqual(card.balance, { label: "Prepaid", value: "$1.00" });
  assert.match(card.detail ?? "", /Month spend \$5\.83/);
});

test("Neuralwatt works with a balance but no subscription", () => {
  const card = parseNeuralwattUsage(
    { balance: { credits_remaining_usd: 12.5 }, subscription: null },
    now,
    "test",
  );
  assert.equal(card.windows.length, 0);
  assert.equal(card.balance?.value, "$12.50");
});
