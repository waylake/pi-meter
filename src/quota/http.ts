import type { QuotaCard, QuotaContext, QuotaStatus, QuotaWindow } from "./types.ts";

export class QuotaHttpError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "QuotaHttpError";
    this.status = status;
  }
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit,
  context: QuotaContext,
  timeoutMs = 15_000,
): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = AbortSignal.any([context.signal, timeout]);
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal });
  } catch (error) {
    if (context.signal.aborted) throw error;
    if (timeout.aborted) throw new QuotaHttpError("Request timed out");
    throw new QuotaHttpError(networkMessage(error));
  }

  const text = await response.text();
  if (!response.ok) {
    throw new QuotaHttpError(`HTTP ${response.status}`, response.status);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new QuotaHttpError("Response was not valid JSON", response.status);
  }
}

export function parseResetDate(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 10_000_000_000 ? value * 1_000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function windowStatus(usedPercent: number): QuotaStatus {
  if (usedPercent >= 90) return "critical";
  if (usedPercent >= 70) return "warning";
  return "ok";
}

export function cardStatus(windows: QuotaWindow[], fallback: QuotaStatus = "ok"): QuotaStatus {
  let status = fallback;
  for (const window of windows) {
    const next = windowStatus(window.usedPercent);
    if (next === "critical") return next;
    if (next === "warning") status = next;
  }
  return status;
}

export function windowLabel(seconds: number | undefined, fallback = "Window"): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return fallback;
  if (seconds <= 6 * 3600) return "Session";
  if (seconds <= 8 * 86_400) return "Weekly";
  if (seconds <= 32 * 86_400) return "Monthly";
  return `${Math.round(seconds / 3600)}h`;
}

export function errorCard(
  id: string,
  label: string,
  source: string,
  error: unknown,
  now: number,
): QuotaCard {
  return {
    id,
    label,
    status: "error",
    windows: [],
    error: errorText(error),
    updatedAt: now,
    source,
  };
}

export function errorText(error: unknown): string {
  if (error instanceof QuotaHttpError) return error.message;
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

function networkMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}
