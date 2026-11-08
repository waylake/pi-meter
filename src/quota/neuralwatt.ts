import { credentialFromNeuralwatt } from "./credentials.ts";
import { cardStatus, clampPercent, errorCard, fetchJson, parseResetDate } from "./http.ts";
import type { QuotaAdapter, QuotaCard, QuotaWindow } from "./types.ts";

const USAGE_URL = "https://api.neuralwatt.com/v1/quota";

/**
 * Neuralwatt bills on energy: a subscription kWh allowance plus a prepaid USD balance.
 * Both surfaces are shown because either one can run out independently.
 */
export const neuralwattAdapter: QuotaAdapter = {
  id: "neuralwatt",
  label: "Neuralwatt",
  async fetch(context): Promise<QuotaCard | undefined> {
    const credential = await credentialFromNeuralwatt(context.agentDir, context.env);
    if (!credential) return undefined;
    try {
      const payload = await fetchJson<unknown>(
        context.env.PI_METER_NEURALWATT_URL?.trim() || USAGE_URL,
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
      return parseNeuralwattUsage(payload, context.now, credential.source);
    } catch (error) {
      return errorCard("neuralwatt", "Neuralwatt", credential.source, error, context.now);
    }
  },
};

export function parseNeuralwattUsage(payload: unknown, now: number, source: string): QuotaCard {
  const root = asRecord(payload);
  if (!root) throw new Error("Neuralwatt response was not an object");

  const windows: QuotaWindow[] = [];
  const subscription = asRecord(root.subscription);
  const included = numberValue(subscription?.kwh_included);
  const used = numberValue(subscription?.kwh_used);
  if (included !== undefined && included > 0 && used !== undefined) {
    const resetsAt = parseResetDate(subscription?.current_period_end) ?? parseResetDate(subscription?.kwh_reset_date);
    windows.push({
      id: "kwh",
      label: "Energy plan",
      usedPercent: clampPercent((used / included) * 100),
      ...(resetsAt !== undefined ? { resetsAt } : {}),
      detail: `${round(used)} / ${round(included)} kWh`,
    });
  }

  const key = asRecord(root.key);
  const allowance = asRecord(key?.allowance);
  const limit = numberValue(allowance?.limit_usd);
  const spent = numberValue(allowance?.spent_usd);
  if (limit !== undefined && limit > 0 && spent !== undefined) {
    windows.push({
      id: "allowance",
      label: "Key allowance",
      usedPercent: clampPercent((spent / limit) * 100),
      detail: `$${spent.toFixed(2)} / $${limit.toFixed(2)}`,
    });
  }

  const balance = asRecord(root.balance);
  const remaining = numberValue(balance?.credits_remaining_usd);
  const usage = asRecord(root.usage);
  const month = asRecord(usage?.current_month);
  const monthSpend = numberValue(month?.cost_usd);

  const plan = typeof subscription?.plan === "string" ? subscription.plan : undefined;
  const detail = monthSpend !== undefined ? `Month spend $${monthSpend.toFixed(2)}` : undefined;

  if (!windows.length && remaining === undefined) {
    throw new Error("Neuralwatt response has no quota or balance");
  }

  return {
    id: "neuralwatt",
    label: "Neuralwatt",
    status: cardStatus(windows),
    ...(plan ? { plan } : {}),
    windows,
    ...(remaining !== undefined
      ? { balance: { label: "Prepaid", value: `$${remaining.toFixed(2)}` } }
      : {}),
    ...(detail ? { detail } : {}),
    updatedAt: now,
    source,
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

function round(value: number): string {
  return value >= 10 ? value.toFixed(1) : value.toFixed(2);
}
