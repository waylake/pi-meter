import { credentialFromCodex } from "./credentials.ts";
import {
  cardStatus,
  clampPercent,
  errorCard,
  fetchJson,
  parseResetDate,
  windowLabel,
} from "./http.ts";
import type { QuotaAdapter, QuotaCard, QuotaWindow } from "./types.ts";

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

export const codexAdapter: QuotaAdapter = {
  id: "codex",
  label: "OpenAI Codex",
  async fetch(context): Promise<QuotaCard | undefined> {
    const credential = await credentialFromCodex(context.env);
    if (!credential) return undefined;
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${credential.value}`,
        Accept: "application/json",
        "User-Agent": "pi-meter/0.1",
      };
      if (credential.accountId) headers["ChatGPT-Account-Id"] = credential.accountId;
      const payload = await fetchJson<unknown>(
        context.env.PI_METER_CODEX_USAGE_URL?.trim() || USAGE_URL,
        { method: "GET", headers },
        context,
      );
      return parseCodexUsage(payload, context.now, credential.source);
    } catch (error) {
      return errorCard("codex", "OpenAI Codex", credential.source, error, context.now);
    }
  },
};

export function parseCodexUsage(payload: unknown, now: number, source: string): QuotaCard {
  const root = asRecord(payload);
  const rateLimit = asRecord(root?.rate_limit);
  if (!rateLimit) throw new Error("Codex response has no rate limit");

  const windows: QuotaWindow[] = [];
  const primary = parseWindow(rateLimit.primary_window, "primary", now);
  if (primary) windows.push(primary);
  const secondary = parseWindow(rateLimit.secondary_window, "secondary", now);
  if (secondary) windows.push(secondary);

  const plan = typeof root?.plan_type === "string" ? capitalize(root.plan_type) : undefined;
  const credits = asRecord(root?.credits);
  const hasCredits = credits?.has_credits === true;
  const unlimited = credits?.unlimited === true;
  const balanceValue = typeof credits?.balance === "number" ? credits.balance : undefined;
  const balance =
    unlimited
      ? { label: "Credits", value: "unlimited" }
      : hasCredits && balanceValue !== undefined
        ? { label: "Credits", value: `$${balanceValue.toFixed(2)}` }
        : undefined;

  return {
    id: "codex",
    label: "OpenAI Codex",
    status: cardStatus(windows),
    ...(plan ? { plan } : {}),
    windows,
    ...(balance ? { balance } : {}),
    updatedAt: now,
    source,
  };
}

function parseWindow(value: unknown, id: string, now: number): QuotaWindow | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const limitSeconds = numberValue(record.limit_window_seconds);
  const usedPercent = clampPercent(numberValue(record.used_percent) ?? 0);
  const resetsAt =
    parseResetDate(record.reset_at) ??
    parseResetDate(record.resets_at) ??
    (() => {
      const seconds = numberValue(record.reset_after_seconds);
      return seconds !== undefined ? now + seconds * 1_000 : undefined;
    })();
  return {
    id,
    label: windowLabel(limitSeconds, id === "primary" ? "Primary" : "Secondary"),
    usedPercent,
    ...(limitSeconds !== undefined ? { windowSeconds: limitSeconds } : {}),
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

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
