import { credentialFromOpenCode } from "./credentials.ts";
import { cardStatus, clampPercent, errorCard, fetchJson, parseResetDate } from "./http.ts";
import type { QuotaAdapter, QuotaCard, QuotaWindow } from "./types.ts";

const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";

export const openCodeGoAdapter: QuotaAdapter = {
  id: "opencode-go",
  label: "OpenCode Go",
  async fetch(context): Promise<QuotaCard | undefined> {
    const credential = await credentialFromOpenCode(context.agentDir, context.env);
    if (!credential) return undefined;
    try {
      const payload = await fetchJson<unknown>(
        USAGE_URL,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${credential.value}`,
            Accept: "application/json",
            "User-Agent": "pi-meter/0.1",
          },
        },
        context,
      );
      return parseOpenCodeGoUsage(payload, context.now, credential.source);
    } catch (error) {
      return errorCard("opencode-go", "OpenCode Go", credential.source, error, context.now);
    }
  },
};

export function parseOpenCodeGoUsage(payload: unknown, now: number, source: string): QuotaCard {
  const root = asRecord(payload);
  const usage = asRecord(root?.usage);
  const rolling = asRecord(usage?.rolling);
  if (!usage || !rolling) throw new Error("OpenCode Go response has no rolling usage window");

  const windows: QuotaWindow[] = [];
  for (const [id, value, label, seconds] of [
    ["rolling", usage.rolling, "5-hour", 5 * 3600],
    ["weekly", usage.weekly, "Weekly", 7 * 86_400],
    ["monthly", usage.monthly, "Monthly", 30 * 86_400],
  ] as const) {
    const window = parseWindow(value, id, label, seconds, now);
    if (window) windows.push(window);
  }

  return {
    id: "opencode-go",
    label: "OpenCode Go",
    status: cardStatus(windows),
    windows,
    detail: "Subscription usage",
    updatedAt: now,
    source,
  };
}

function parseWindow(
  value: unknown,
  id: string,
  label: string,
  windowSeconds: number,
  now: number,
): QuotaWindow | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const percent = clampPercent(
    numberValue(record.percent) ??
      numberValue(record.usedPercent) ??
      numberValue(record.used_percent) ??
      numberValue(record.usagePercent) ??
      0,
  );
  const resetsAt =
    parseResetDate(record.resetsAt) ??
    parseResetDate(record.resets_at) ??
    parseResetDate(record.resetAt) ??
    parseResetDate(record.reset_at) ??
    (() => {
      const seconds = numberValue(record.resetInSec) ?? numberValue(record.reset_in_sec);
      return seconds !== undefined ? now + seconds * 1_000 : undefined;
    })();
  return {
    id,
    label,
    usedPercent: percent,
    windowSeconds,
    ...(resetsAt !== undefined ? { resetsAt } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
