import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSessionText, discoverSessionRoots, resolveAgentDir } from "../src/analytics/scanner.ts";

function line(value: unknown): string {
  return JSON.stringify(value);
}

const header = line({
  type: "session",
  version: 3,
  id: "01a1811d-c2ea-71c7-a4ef-2c779b93",
  timestamp: "2026-10-28T06:06:13.738Z",
  cwd: "/Users/example/project",
});

test("parses assistant usage, model changes, and names", () => {
  const text = [
    header,
    line({ type: "model_change", id: "m1", parentId: null, timestamp: "2026-10-28T06:06:13.795Z", provider: "opencode-go", modelId: "deepseek-v4.1-flash" }),
    line({
      type: "message",
      id: "a1",
      parentId: "m1",
      timestamp: "2026-10-28T06:06:18.862Z",
      message: {
        role: "assistant",
        provider: "opencode-go",
        model: "deepseek-v4.1-flash",
        usage: {
          input: 28905,
          output: 11,
          cacheRead: 0,
          cacheWrite: 0,
          reasoning: 0,
          totalTokens: 28916,
          cost: { input: 0.00433575, output: 0.0000066, cacheRead: 0, cacheWrite: 0, total: 0.00434235 },
        },
        stopReason: "stop",
        durationMs: 2345,
        timestamp: 1793167576517,
      },
    }),
    line({ type: "session_info", id: "s1", parentId: "a1", timestamp: "2026-10-28T06:07:00.000Z", name: "Refactor auth" }),
  ].join("\n");

  const session = parseSessionText(text, "/sessions/2026-10-28T06-06-13-609Z_01a1811d-c269-71c7-aac4-24ec7b67df0b.jsonl");
  assert.equal(session.cwd, "/Users/example/project");
  assert.equal(session.name, "Refactor auth");
  assert.equal(session.records.length, 1);
  const record = session.records[0]!;
  assert.equal(record.provider, "opencode-go");
  assert.equal(record.model, "deepseek-v4.1-flash");
  assert.equal(record.inputTokens, 28905);
  assert.equal(record.totalTokens, 28916);
  assert.ok(Math.abs(record.costUSD - 0.00434235) < 1e-9);
  assert.equal(record.durationMs, 2345);
  assert.ok(session.lastActivityAt >= Date.parse("2026-10-28T06:07:00.000Z"));
});

test("counts usage entries and compaction summaries", () => {
  const text = [
    header,
    line({
      type: "usage",
      id: "u1",
      parentId: null,
      timestamp: "2026-10-28T07:00:00.000Z",
      kind: "cache_warm",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      usage: { input: 0, output: 0, cacheRead: 50000, cacheWrite: 0, totalTokens: 50000, cost: { total: 0.015 } },
    }),
    line({
      type: "compaction",
      id: "c1",
      parentId: "u1",
      timestamp: "2026-10-28T07:10:00.000Z",
      summary: "…",
      firstKeptEntryId: "c1",
      usage: { input: 1000, output: 100, totalTokens: 1100, cost: { total: 0.002 } },
    }),
  ].join("\n");

  const session = parseSessionText(text);
  assert.deepEqual(
    session.records.map((record) => record.kind),
    ["usage", "compaction"],
  );
  assert.equal(session.records[0]!.cacheReadTokens, 50000);
  assert.equal(session.records[1]!.totalTokens, 1100);
});

test("skips malformed trailing lines and duplicate entry ids", () => {
  const assistant = {
    type: "message",
    id: "a1",
    parentId: null,
    timestamp: "2026-10-28T06:06:18.862Z",
    message: {
      role: "assistant",
      provider: "openai",
      model: "gpt-5",
      usage: { input: 10, output: 5, totalTokens: 15, cost: { total: 0.001 } },
      timestamp: 1793167576517,
    },
  };
  const text = [header, line(assistant), line(assistant), "{not json"].join("\n");
  const session = parseSessionText(text);
  assert.equal(session.records.length, 1);
  assert.equal(session.records[0]?.entryId, "a1");
});

test("falls back to provider/model from model_change when the message omits them", () => {
  const text = [
    header,
    line({ type: "model_change", id: "m1", parentId: null, timestamp: "2026-10-28T06:06:13.795Z", provider: "neuralwatt", modelId: "nw-flash" }),
    line({
      type: "message",
      id: "a1",
      parentId: "m1",
      timestamp: "2026-10-28T06:06:18.862Z",
      message: { role: "assistant", usage: { input: 1, output: 1, totalTokens: 2, cost: { total: 0 } }, timestamp: 1793167576517 },
    }),
  ].join("\n");
  const session = parseSessionText(text);
  assert.equal(session.records[0]?.provider, "neuralwatt");
  assert.equal(session.records[0]?.model, "nw-flash");
});

test("discovers session roots from the agent dir and env overrides", () => {
  const previous = process.env.PI_CODING_AGENT_SESSION_DIR;
  delete process.env.PI_CODING_AGENT_SESSION_DIR;
  assert.equal(discoverSessionRoots("/tmp/agent")[0], "/tmp/agent/sessions");
  process.env.PI_CODING_AGENT_SESSION_DIR = "/tmp/one:/tmp/two";
  assert.deepEqual(discoverSessionRoots("/tmp/agent"), ["/tmp/one", "/tmp/two"]);
  if (previous === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR;
  else process.env.PI_CODING_AGENT_SESSION_DIR = previous;
  assert.ok(resolveAgentDir().length > 0);
});
