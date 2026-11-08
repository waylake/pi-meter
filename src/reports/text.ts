import {
  formatCount,
  formatDuration,
  formatPercent,
  formatShortDate,
  formatTokens,
  formatUSD,
} from "../analytics/format.ts";
import { pad, padStart, percentText, usageBar } from "../ui/theme.ts";
import type { GroupBucket, Report } from "../analytics/types.ts";
import { PERIODS } from "../analytics/types.ts";
import type { QuotaCard } from "../quota/types.ts";

export interface TextReportOptions {
  quotas?: QuotaCard[];
  width?: number;
  now?: number;
  includeQuotas?: boolean;
  maxRows?: number;
}

export function renderTextReport(report: Report, options: TextReportOptions = {}): string {
  const width = options.width ?? 72;
  const now = options.now ?? Date.now();
  const maxRows = options.maxRows ?? 8;
  const lines: string[] = [];
  const period = PERIODS.find((entry) => entry.id === report.period)?.label ?? report.period;

  lines.push(`pi-meter · ${period}`);
  if (Number.isFinite(report.start)) {
    lines.push(
      `${formatShortDate(report.start)} → ${formatShortDate(report.end)} · ${report.activeDays} active ${report.activeDays === 1 ? "day" : "days"}`,
    );
  }
  lines.push("");
  lines.push(
    `Spend ${formatUSD(report.totals.costUSD)} · ${formatTokens(report.totals.tokens)} tokens · ${formatCount(report.totals.requests)} requests · cache ${formatPercent(report.cacheHitRate)}`,
  );
  lines.push(
    `Sessions ${formatCount(report.totals.sessions)} · projects ${formatCount(report.totals.projects)} · ${formatUSD(report.avgCostPerRequest)}/request${report.avgDurationMs !== undefined ? ` · ${formatDuration(report.avgDurationMs)} avg response` : ""}`,
  );

  if (report.peakDay && report.peakDay.costUSD > 0) {
    lines.push(
      `Peak ${formatUSD(report.peakDay.costUSD)} on ${formatShortDate(report.peakDay.date.getTime())}`,
    );
  }

  if (report.providers.length > 0) {
    lines.push("");
    lines.push("Providers");
    const providerWidth = Math.min(24, Math.max(12, ...report.providers.map((row) => row.label.length)));
    for (const provider of report.providers.slice(0, maxRows)) {
      lines.push(renderRow(provider, report, providerWidth, width));
    }
  }

  lines.push("");
  lines.push("Models");
  if (report.models.length === 0) {
    lines.push("  (no usage in this period)");
  } else {
    const modelLabels = report.models.map((row) =>
      row.detail && report.models.filter((entry) => entry.label === row.label).length > 1
        ? `${row.detail}/${row.label}`
        : row.label,
    );
    const modelWidth = Math.min(
      44,
      Math.max(16, ...modelLabels.slice(0, maxRows).map((label) => label.length)),
    );
    report.models.slice(0, maxRows).forEach((model, index) => {
      lines.push(renderRow(model, report, modelWidth, width, modelLabels[index]));
    });
    if (report.models.length > maxRows) {
      lines.push(`  … ${report.models.length - maxRows} more`);
    }
  }

  if (report.projects.length > 0) {
    lines.push("");
    lines.push("Projects");
    const projectWidth = Math.min(32, Math.max(14, ...report.projects.slice(0, maxRows).map((row) => row.label.length)));
    for (const project of report.projects.slice(0, maxRows)) {
      lines.push(renderRow(project, report, projectWidth, width));
    }
  }

  if (options.includeQuotas !== false && options.quotas?.length) {
    lines.push("");
    lines.push("Quotas");
    for (const card of options.quotas) {
      lines.push(...renderQuotaText(card, width, now));
    }
  }

  return lines.join("\n");
}

function renderRow(
  group: GroupBucket,
  report: Report,
  labelWidth: number,
  width: number,
  label = group.label,
): string {
  const share = report.totals.costUSD > 0 ? (group.totals.costUSD / report.totals.costUSD) * 100 : 0;
  const barWidth = Math.max(6, Math.min(12, width - labelWidth - 42));
  return [
    `  ${pad(label.slice(0, labelWidth), labelWidth)}`,
    usageBar(share, barWidth),
    padStart(formatUSD(group.totals.costUSD), 9),
    padStart(formatTokens(group.totals.tokens), 7),
    padStart(`${formatCount(group.totals.requests)} req`, 11),
  ].join(" ");
}

export function renderQuotaText(card: QuotaCard, width: number, now: number): string[] {
  const lines: string[] = [];
  const plan = card.plan ? ` · ${card.plan}` : "";
  const balance = card.balance ? ` · ${card.balance.label} ${card.balance.value}` : "";
  lines.push(`  ${card.label}${plan}${balance}`);
  if (card.error) {
    lines.push(`    error: ${card.error}`);
    return lines;
  }
  if (card.windows.length === 0) {
    lines.push("    no usage windows reported");
    return lines;
  }
  const labelWidth = Math.max(6, ...card.windows.map((window) => window.label.length));
  for (const window of card.windows) {
    const reset =
      window.resetsAt !== undefined
        ? `resets ${formatUntil(window.resetsAt, now)}`
        : window.detail ?? "";
    lines.push(
      [
        `    ${pad(window.label, labelWidth)}`,
        usageBar(window.usedPercent, Math.max(8, Math.min(20, width - labelWidth - 26))),
        padStart(percentText(window.usedPercent), 4),
        reset,
      ].join(" "),
    );
  }
  return lines;
}

function formatUntil(timestamp: number, now: number): string {
  const delta = timestamp - now;
  if (delta <= 0) return "now";
  const minutes = Math.round(delta / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = delta / 3_600_000;
  if (hours < 36) return `in ${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h`;
  const days = delta / 86_400_000;
  return `in ${days < 10 ? days.toFixed(1) : Math.round(days)}d`;
}
