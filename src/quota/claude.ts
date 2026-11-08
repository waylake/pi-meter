import { credentialFromClaudeCode } from "./credentials.ts";
import { cardStatus, clampPercent, errorCard, fetchJson, parseResetDate } from "./http.ts";
import type { QuotaAdapter, QuotaCard, QuotaWindow } from "./types.ts";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage?cedar_ember=1";

export const claudeAdapter: QuotaAdapter = {
  id: "claude",
  label: "Claude",
  async fetch(context): Promise<QuotaCard | undefined> {
    const credential = await credentialFromClaudeCode(context.agentDir, context.env);
    if (!credential) return undefined;
    try {
      const payload = await fetchJson<unknown>(
        USAGE_URL,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${credential.value}`,
            Accept: "application/json",
            "Content-Type": "application/json",
            "anthropic-beta": "oauth-2025-04-20",
            "User-Agent": "claude-cli/2.1.0 (external, cli)",
          },
        },
        context,
      );
      return parseClaudeUsage(payload, context.now, credential.source);
    } catch (error) {
      return errorCard("claude", "Claude", credential.source, error, context.now);
    }
  },
};

export function parseClaudeUsage(payload: unknown, now: number, source: string): QuotaCard {
  const root = asRecord(payload);
  if (!root) throw new Error("Claude response was not an object");
  const windows: QuotaWindow[] = [];

  addWindow(windows, root, "five_hour", "five-hour", "5-hour", 5 * 3600);
  addWindow(windows, root, "seven_day", "weekly", "Weekly", 7 * 86_400);
  addWindow(windows, root, "seven_day_sonnet", "weekly-sonnet", "Weekly · Sonnet", 7 * 86_400);
  addWindow(windows, root, "seven_day_opus", "weekly-opus", "Weekly · Opus", 7 * 86_400);

  const extra = asRecord(root.extra_usage);
  if (extra?.is_enabled === true && typeof extra.utilization === "number") {
    windows.push({
      id: "extra-usage",
      label: "Extra usage",
      usedPercent: clampPercent(extra.utilization),
    });
  }

  if (windows.length === 0) throw new Error("Claude response has no usage windows");

  return {
    id: "claude",
    label: "Claude",
    status: cardStatus(windows),
    windows,
    updatedAt: now,
    source,
  };
}

function addWindow(
  windows: QuotaWindow[],
  root: Record<string, unknown>,
  key: string,
  id: string,
  label: string,
  windowSeconds: number,
): void {
  const window = asRecord(root[key]);
  if (!window || typeof window.utilization !== "number") return;
  const resetsAt = parseResetDate(window.resets_at);
  windows.push({
    id,
    label,
    usedPercent: clampPercent(window.utilization),
    windowSeconds,
    ...(resetsAt !== undefined ? { resetsAt } : {}),
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
