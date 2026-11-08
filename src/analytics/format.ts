import { homedir } from "node:os";
import { basename } from "node:path";
import type { PeriodId } from "./types.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatUSD(value: number): string {
  if (!Number.isFinite(value)) return "$—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  let digits: number;
  if (abs === 0) digits = 2;
  else if (abs >= 10) digits = 2;
  else if (abs >= 1) digits = 2;
  else if (abs >= 0.01) digits = 3;
  else digits = 4;
  return `${sign}$${abs.toFixed(digits)}`;
}

export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value >= 1_000_000_000) return `${trimZero(value / 1_000_000_000)}B`;
  if (value >= 1_000_000) return `${trimZero(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimZero(value / 1_000)}k`;
  return Math.round(value).toString();
}

function trimZero(value: number): string {
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 1;
  return value.toFixed(digits).replace(/\.0$/, "");
}

export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("en-US");
}

export function formatPercent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(digits).replace(/\.0$/, "")}%`;
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) return restMinutes > 0 ? `${hours}h ${restMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours > 0 ? `${days}d ${restHours}h` : `${days}d`;
}

export function formatReset(resetsAt: number | undefined, now = Date.now()): string {
  if (resetsAt === undefined || !Number.isFinite(resetsAt)) return "";
  const delta = resetsAt - now;
  if (delta <= 0) return "now";
  return `in ${formatDuration(delta)}`;
}

export function formatRelative(timestamp: number, now = Date.now()): string {
  const delta = Math.max(0, now - timestamp);
  if (delta < 60_000) return "just now";
  return `${formatDuration(delta)} ago`;
}

export function formatClock(timestamp: number): string {
  const date = new Date(timestamp);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatShortDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

export function formatDateTime(timestamp: number): string {
  return `${formatShortDate(timestamp)} ${formatClock(timestamp)}`;
}

export function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function startOfLocalDay(date: Date | number = new Date()): Date {
  const value = new Date(date);
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function periodRange(period: PeriodId, now: Date = new Date()): { start: number; end: number } {
  const end = now.getTime();
  if (period === "all") return { start: Number.NEGATIVE_INFINITY, end };
  const today = startOfLocalDay(now);
  const days = period === "today" ? 0 : period === "7d" ? 6 : 29;
  return { start: addDays(today, -days).getTime(), end };
}

export function dayPointsBetween(start: number, end: number): Date[] {
  if (!Number.isFinite(start)) return [];
  const first = startOfLocalDay(start);
  const last = startOfLocalDay(end);
  const points: Date[] = [];
  for (let cursor = first; cursor.getTime() <= last.getTime(); cursor = addDays(cursor, 1)) {
    points.push(new Date(cursor));
  }
  return points;
}

export function projectLabel(cwd: string): string {
  if (!cwd) return "unknown";
  if (cwd === homedir()) return "~";
  const name = basename(cwd);
  return name || cwd;
}

export function compactPath(cwd: string): string {
  const home = homedir();
  if (cwd === home) return "~";
  if (cwd.startsWith(`${home}/`)) return `~/${cwd.slice(home.length + 1)}`;
  return cwd;
}

export function padRight(value: string, width: number): string {
  const length = displayWidth(value);
  return length >= width ? value : value + " ".repeat(width - length);
}

export function padLeft(value: string, width: number): string {
  const length = displayWidth(value);
  return length >= width ? value : " ".repeat(width - length) + value;
}

export function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

/**
 * Local width estimate that ignores ANSI escapes and treats common wide glyphs as two cells.
 * The TUI layer still owns final truncation; this is for column padding before theming.
 */
export function displayWidth(value: string): number {
  let width = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0x1b) {
      const next = value[index + 1];
      if (next === "[") {
        index += 2;
        while (index < value.length) {
          const char = value.charCodeAt(index);
          if (char >= 0x40 && char <= 0x7e) break;
          index++;
        }
      } else if (next === "]") {
        index += 2;
        while (index < value.length && value.charCodeAt(index) !== 0x07) index++;
      }
      continue;
    }
    if (code >= 0x1100 && (
      code <= 0x115f ||
      code === 0x2329 || code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
    )) {
      width += 2;
      continue;
    }
    width += 1;
  }
  return width;
}
