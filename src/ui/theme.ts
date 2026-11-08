import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

export interface MeterTheme {
  fg(color: ThemeColor, text: string): string;
  bold(text: string): string;
  dim(text: string): string;
}

export function meterTheme(theme: Theme): MeterTheme {
  return {
    fg: (color, text) => theme.fg(color, text),
    bold: (text) => theme.bold(text),
    dim: (text) => theme.fg("dim", text),
  };
}

const SPARK_GLYPHS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

export function sparkline(values: number[], width: number): string {
  if (values.length === 0 || width <= 0) return "";
  const points = values.slice(-width);
  const max = Math.max(...points, 0);
  if (max <= 0) return "▁".repeat(points.length);
  return points
    .map((value) => {
      const index = Math.min(SPARK_GLYPHS.length - 1, Math.max(0, Math.round((value / max) * (SPARK_GLYPHS.length - 1))));
      return SPARK_GLYPHS[index];
    })
    .join("");
}

export function usageBar(percent: number, width: number): string {
  const clamped = Math.min(100, Math.max(0, percent));
  const filled = Math.round((clamped / 100) * width);
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}

export function severityColor(percent: number): ThemeColor {
  if (percent >= 90) return "error";
  if (percent >= 70) return "warning";
  if (percent >= 40) return "accent";
  return "success";
}

export function quotaColor(status: string): ThemeColor {
  switch (status) {
    case "critical":
    case "error":
      return "error";
    case "warning":
      return "warning";
    case "unavailable":
      return "muted";
    default:
      return "success";
  }
}

export function pad(value: string, width: number): string {
  const length = visibleWidth(value);
  return length >= width ? value : value + " ".repeat(width - length);
}

export function padStart(value: string, width: number): string {
  const length = visibleWidth(value);
  return length >= width ? value : " ".repeat(width - length) + value;
}

export function truncate(value: string, width: number): string {
  if (width <= 0) return "";
  const length = visibleWidth(value);
  if (length <= width) return value;
  let result = "";
  let used = 0;
  for (const char of value) {
    const charWidth = visibleWidth(char);
    if (used + charWidth > width - 1) break;
    result += char;
    used += charWidth;
  }
  return `${result}…`;
}

export function rule(width: number, color?: (text: string) => string): string {
  const line = "─".repeat(Math.max(0, width));
  return color ? color(line) : line;
}

export function sectionTitle(title: string, width: number, theme: MeterTheme, right?: string): string {
  const left = theme.fg("accent", theme.bold(title));
  const trailer = right ? theme.fg("muted", right) : "";
  const meta = visibleWidth(left) + visibleWidth(trailer);
  const gap = Math.max(2, width - meta - 2);
  return `${left} ${theme.fg("borderMuted", "─".repeat(gap))}${trailer ? ` ${trailer}` : ""}`;
}

export function joinColumns(columns: Array<{ text: string; width: number; align?: "left" | "right" }>): string {
  return columns
    .map((column) => (column.align === "right" ? padStart(column.text, column.width) : pad(column.text, column.width)))
    .join("  ")
    .trimEnd();
}

export function percentText(percent: number): string {
  return `${Math.round(percent)}%`;
}
