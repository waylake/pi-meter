import type { GroupBucket, Report } from "../analytics/types.ts";
import { PERIODS } from "../analytics/types.ts";
import {
  formatCount,
  formatDuration,
  formatPercent,
  formatShortDate,
  formatTokens,
  formatUSD,
} from "../analytics/format.ts";
import type { QuotaCard, QuotaWindow } from "../quota/types.ts";
import { TAB_LABELS, TABS, type DashboardState, type TabId } from "./state.ts";
import {
  joinColumns,
  pad,
  padStart,
  percentText,
  quotaColor,
  rule,
  sectionTitle,
  severityColor,
  sparkline,
  truncate,
  usageBar,
  type MeterTheme,
} from "./theme.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

export interface RenderContext {
  width: number;
  height: number;
  theme: MeterTheme;
  now: number;
}

const MIN_WIDTH = 40;

export function renderDashboard(state: DashboardState, context: RenderContext): string[] {
  const width = Math.max(MIN_WIDTH, context.width);
  const height = Math.max(12, context.height);
  const lines: string[] = [];

  if (state.help) return renderHelp(width, height, context.theme);
  if (!state.data && state.loading) return renderLoading(width, height, context.theme);
  if (!state.data) return renderError(state.error ?? "No usage data", width, context.theme);

  lines.push(...renderHeader(state, width, context));
  lines.push(...renderTabBar(state, width, context.theme));
  lines.push("");

  const bodyHeight = Math.max(6, height - lines.length - 2);
  switch (state.tab) {
    case "overview":
      lines.push(...renderOverview(state, state.data, width, bodyHeight, context));
      break;
    case "models":
      lines.push(...renderTable(state, state.data, "models", width, bodyHeight, context));
      break;
    case "projects":
      lines.push(...renderTable(state, state.data, "projects", width, bodyHeight, context));
      break;
    case "sessions":
      lines.push(...renderTable(state, state.data, "sessions", width, bodyHeight, context));
      break;
    case "quotas":
      lines.push(...renderQuotas(state, width, bodyHeight, context));
      break;
  }

  lines.push("");
  lines.push(...renderHints(state, width, context.theme));
  return lines.map((line) => truncate(line, width)).slice(0, height);
}

function renderHeader(state: DashboardState, width: number, context: RenderContext): string[] {
  const { theme, now } = context;
  const title = theme.fg("accent", theme.bold(" pi-meter "));
  const age = state.refreshing
    ? theme.fg("warning", "refreshing…")
    : state.data
      ? theme.fg("muted", `updated ${formatAgo(state.data.scan.scannedAt, now)}`)
      : "";
  const files = state.data
    ? theme.fg("dim", `${state.data.scan.sessions.length} sessions · ${state.data.scan.filesScanned} parsed / ${state.data.scan.filesReused} cached`)
    : "";
  const right = [age, files].filter(Boolean).join(theme.fg("dim", " · "));
  const gap = Math.max(2, width - visibleWidth(title) - visibleWidth(right) - 2);
  return [title + theme.fg("borderMuted", "─".repeat(gap)) + " " + right];
}

function renderTabBar(state: DashboardState, width: number, theme: MeterTheme): string[] {
  const parts: string[] = [];
  TABS.forEach((tab, index) => {
    const label = `${index + 1} ${TAB_LABELS[tab]}`;
    parts.push(tab === state.tab ? theme.fg("accent", theme.bold(`▍${label}`)) : theme.fg("muted", ` ${label} `));
  });
  const period = PERIODS.map((entry) =>
    entry.id === state.period ? theme.fg("accent", theme.bold(entry.label)) : theme.fg("dim", entry.label),
  ).join(theme.fg("dim", " · "));
  const left = parts.join(" ");
  const right = `${period}`;
  const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right) - 1);
  return [`${left}${" ".repeat(gap)}${right}`];
}

function renderOverview(
  state: DashboardState,
  data: NonNullable<DashboardState["data"]>,
  width: number,
  height: number,
  context: RenderContext,
): string[] {
  const { theme } = context;
  const report = state.report();
  if (!report) return [];
  const lines: string[] = [];

  const kpis: Array<[string, string]> = [
    ["Spend", formatUSD(report.totals.costUSD)],
    ["Tokens", formatTokens(report.totals.tokens)],
    ["Requests", formatCount(report.totals.requests)],
    ["Cache hit", formatPercent(report.cacheHitRate, 1)],
  ];
  const overage: Array<[string, string]> = [
    ["Sessions", formatCount(report.totals.sessions)],
    ["Projects", formatCount(report.totals.projects)],
    ["Avg / req", formatUSD(report.avgCostPerRequest)],
    ["Active days", formatCount(report.activeDays)],
  ];

  if (width >= 76) {
    lines.push(kpiLine(kpis, width, theme));
    lines.push(kpiLine(overage, width, theme));
  } else {
    for (const [label, value] of [...kpis, ...overage]) {
      lines.push(` ${theme.fg("muted", pad(label, 12))}${theme.fg("text", theme.bold(value))}`);
    }
  }

  lines.push("");
  lines.push(sectionTitle("Daily spend", width, theme, report.peakDay ? `peak ${formatUSD(report.peakDay.costUSD)} on ${formatShortDate(report.peakDay.date.getTime())}` : undefined));
  const daily = report.daily;
  const chartWidth = Math.max(10, Math.min(width - 4, daily.length * 2));
  const costs = daily.map((point) => point.costUSD);
  const spark = sparkline(costs, chartWidth);
  const totalCost = report.totals.costUSD;
  const sparkColored = costs.some((cost) => cost > 0) ? theme.fg("accent", spark) : theme.fg("dim", spark);
  const range = daily.length
    ? `${formatShortDate(daily[0]?.date.getTime() ?? context.now)} → ${formatShortDate(daily[daily.length - 1]?.date.getTime() ?? context.now)}`
    : "";
  lines.push(` ${sparkColored}  ${theme.fg("dim", range)}`);
  lines.push(
    ` ${theme.fg("muted", "total")} ${theme.fg("text", formatUSD(totalCost))}  ${theme.fg("muted", "avg/day")} ${theme.fg("text", formatUSD(daily.length ? totalCost / daily.length : 0))}  ${theme.fg("muted", "top model")} ${theme.fg("text", report.topModel ? modelLabel(report.topModel, report) : "—")}`,
  );

  const providerBudget = width >= 76 ? 4 : 3;
  const modelBudget = Math.max(3, Math.min(6, height - 12));
  if (report.providers.length > 0) {
    lines.push("");
    lines.push(sectionTitle("Providers", width, theme, `${report.providers.length} active`));
    const providerWidth = Math.max(12, Math.min(width - 46, 28));
    for (const provider of report.providers.slice(0, providerBudget)) {
      lines.push(renderShareRow(provider, report, providerWidth, width, theme, report.totals.costUSD));
    }
  }

  lines.push("");
  lines.push(sectionTitle("Top models", width, theme, state.sortMetric === "cost" ? "by spend" : `by ${state.sortMetric}`));
  const modelWidth = Math.max(12, Math.min(width - 60, 34));
  for (const model of report.models.slice(0, modelBudget)) {
    lines.push(renderModelRow(model, modelWidth, width, theme, report.totals.costUSD, report));
  }
  if (report.models.length === 0) {
    lines.push(` ${theme.fg("dim", "No usage recorded in this period.")}`);
  }

  return lines;
}

function kpiLine(items: Array<[string, string]>, width: number, theme: MeterTheme): string {
  const cell = Math.max(12, Math.floor(width / items.length));
  const labelWidth = Math.max(...items.map(([label]) => label.length)) + 1;
  return items
    .map(
      ([label, value]) =>
        `${theme.fg("muted", pad(label, labelWidth))}${theme.fg("text", theme.bold(pad(value, Math.max(4, cell - labelWidth))))}`,
    )
    .join("")
    .trimEnd();
}

function renderShareRow(
  group: GroupBucket,
  report: Report,
  labelWidth: number,
  width: number,
  theme: MeterTheme,
  totalCost: number,
): string {
  const share = totalCost > 0 ? (group.totals.costUSD / totalCost) * 100 : 0;
  const name = pad(truncate(group.label, labelWidth), labelWidth);
  const barWidth = Math.max(6, Math.min(14, width - labelWidth - 44));
  const bar = theme.fg(severityColor(share), usageBar(share, barWidth));
  return joinColumns([
    { text: ` ${theme.fg("text", name)}`, width: labelWidth + 1 },
    { text: bar, width: barWidth },
    { text: theme.fg("text", formatUSD(group.totals.costUSD)), width: 9, align: "right" },
    { text: theme.fg("muted", formatPercent(share, 0)), width: 5, align: "right" },
    { text: theme.fg("dim", `${formatTokens(group.totals.tokens)} tok`), width: 12, align: "right" },
  ]);
}

function renderModelRow(
  group: GroupBucket,
  labelWidth: number,
  width: number,
  theme: MeterTheme,
  totalCost: number,
  report: Report,
): string {
  const share = totalCost > 0 ? (group.totals.costUSD / totalCost) * 100 : 0;
  const name = truncate(modelLabel(group, report), labelWidth);
  const barWidth = Math.max(6, Math.min(12, width - labelWidth - 52));
  return joinColumns([
    { text: ` ${theme.fg("text", pad(name, labelWidth))}`, width: labelWidth + 1 },
    { text: theme.fg("dim", barWidth > 0 ? usageBar(share, barWidth) : ""), width: barWidth },
    { text: theme.fg("text", formatUSD(group.totals.costUSD)), width: 9, align: "right" },
    { text: theme.fg("dim", formatTokens(group.totals.tokens)), width: 8, align: "right" },
    { text: theme.fg("dim", `${formatCount(group.totals.requests)} req`), width: 12, align: "right" },
    { text: theme.fg("muted", formatUSD(group.totals.requests ? group.totals.costUSD / group.totals.requests : 0)), width: 9, align: "right" },
  ]);
}

function renderTable(
  state: DashboardState,
  data: NonNullable<DashboardState["data"]>,
  tab: Exclude<TabId, "overview" | "quotas">,
  width: number,
  height: number,
  context: RenderContext,
): string[] {
  const { theme } = context;
  const report = state.report();
  if (!report) return [];
  const rows = tab === "models" ? report.models : tab === "projects" ? report.projects : report.sessions;
  const lines: string[] = [];
  const sortLabel = state.sortMetric === "cost" ? "spend" : state.sortMetric;

  lines.push(sectionTitle(TAB_LABELS[tab], width, theme, `${rows.length} rows · by ${sortLabel} · p period`));
  if (rows.length === 0) {
    lines.push("");
    lines.push(` ${theme.fg("dim", "No rows for this period.")}`);
    return lines;
  }

  const headerWidths = tableWidths(tab, width);
  lines.push(
    joinColumns([
      { text: ` ${theme.fg("muted", pad(tab === "models" ? "MODEL" : tab === "projects" ? "PROJECT" : "SESSION", headerWidths.name))}`, width: headerWidths.name + 1 },
      { text: theme.fg("muted", padStart("SPEND", headerWidths.cost)), width: headerWidths.cost, align: "right" },
      { text: theme.fg("muted", padStart("TOKENS", headerWidths.tokens)), width: headerWidths.tokens, align: "right" },
      { text: theme.fg("muted", padStart("REQ", headerWidths.requests)), width: headerWidths.requests, align: "right" },
      { text: theme.fg("muted", padStart(tab === "projects" ? "SESS" : tab === "sessions" ? "TIME" : "AVG", headerWidths.extra)), width: headerWidths.extra, align: "right" },
    ]),
  );

  const detailRows = state.detail ? 4 : 0;
  const visible = Math.max(1, height - lines.length - detailRows - 1);
  state.clampScroll(visible);
  const slice = rows.slice(state.scroll, state.scroll + visible);

  slice.forEach((row, index) => {
    const selected = state.scroll + index === state.selection;
    lines.push(renderTableRow(row, tab, width, theme, headerWidths, selected, report));
  });

  if (rows.length > visible) {
    lines.push(
      ` ${theme.fg("dim", `${state.scroll + 1}–${Math.min(rows.length, state.scroll + visible)} of ${rows.length}  ·  ↑↓ scroll`)}`,
    );
  }

  const selectedRow = state.selectedRow();
  if (state.detail && selectedRow) {
    lines.push("");
    lines.push(sectionTitle("Detail", width, theme));
    for (const line of renderDetail(selectedRow, theme, width)) lines.push(line);
  }

  return lines;
}

function tableWidths(tab: Exclude<TabId, "overview" | "quotas">, width: number) {
  if (width < 70) {
    return { name: Math.max(14, width - 38), cost: 9, tokens: 7, requests: 6, extra: 8 };
  }
  const name = Math.max(20, Math.min(46, width - 52));
  return { name, cost: 10, tokens: 8, requests: 9, extra: 10 };
}

function renderTableRow(
  row: GroupBucket,
  tab: Exclude<TabId, "overview" | "quotas">,
  width: number,
  theme: MeterTheme,
  widths: ReturnType<typeof tableWidths>,
  selected: boolean,
  report: Report,
): string {
  const label = tab === "models" ? modelLabel(row, report) : row.label;
  const name = truncate(label, widths.name);
  const text = selected ? theme.fg("accent", theme.bold(name)) : theme.fg("text", name);
  const marker = selected ? theme.fg("accent", "▸") : " ";
  const extra =
    tab === "projects"
      ? formatCount(row.totals.sessions)
      : tab === "sessions"
        ? formatDuration(Math.max(0, row.lastUsed - row.firstUsed))
        : formatUSD(row.totals.requests ? row.totals.costUSD / row.totals.requests : 0);
  const line = joinColumns([
    { text: `${marker}${text}`, width: widths.name + 1 },
    { text: theme.fg("text", formatUSD(row.totals.costUSD)), width: widths.cost, align: "right" },
    { text: theme.fg("muted", formatTokens(row.totals.tokens)), width: widths.tokens, align: "right" },
    { text: theme.fg("muted", formatCount(row.totals.requests)), width: widths.requests, align: "right" },
    { text: theme.fg("dim", extra), width: widths.extra, align: "right" },
  ]);
  return truncate(line, width);
}

function modelLabel(row: GroupBucket, report: Report): string {
  if (!row.detail) return row.label;
  const duplicates = report.models.filter((entry) => entry.label === row.label).length;
  return duplicates > 1 ? `${row.detail}/${row.label}` : row.label;
}

function renderDetail(row: GroupBucket, theme: MeterTheme, width: number): string[] {
  const topModels = row.models.slice(0, 3).join(", ");
  return [
    ` ${theme.fg("muted", pad("models", 8))}${theme.fg("text", truncate(topModels || "—", width - 12))}`,
    ` ${theme.fg("muted", pad("tokens", 8))}${theme.fg("text", `${formatTokens(row.totals.inputTokens)} in · ${formatTokens(row.totals.outputTokens)} out · ${formatTokens(row.totals.cacheReadTokens)} cached`)}`,
    ` ${theme.fg("muted", pad("requests", 8))}${theme.fg("text", `${formatCount(row.totals.requests)} · ${formatUSD(row.totals.requests ? row.totals.costUSD / row.totals.requests : 0)} avg`)}`,
  ];
}

function renderQuotas(
  state: DashboardState,
  width: number,
  height: number,
  context: RenderContext,
): string[] {
  const { theme, now } = context;
  const lines: string[] = [];
  const cards = state.data?.quotas ?? [];
  const age = state.data?.quotasUpdatedAt
    ? theme.fg("muted", `checked ${formatAgo(state.data.quotasUpdatedAt, now)}`)
    : theme.fg("dim", "not checked yet");

  lines.push(sectionTitle("Quotas", width, theme, `r refresh · ${age}`));

  if (cards.length === 0) {
    lines.push("");
    lines.push(` ${theme.fg("dim", "No provider credentials found.")}`);
    lines.push(` ${theme.fg("muted", "pi-meter reads what pi already has: pi auth.json, models.json, ~/.codex/auth.json, ~/.claude and OPENCODE keys.")}`);
    lines.push(` ${theme.fg("muted", "Add a key with /login in pi, or set NEURALWATT_API_KEY / OPENCODE_GO_API_KEY.")}`);
    return lines;
  }

  let remaining = Math.max(4, height - lines.length - 1);
  for (const card of cards) {
    if (remaining <= 0) break;
    const cardLines = renderQuotaCard(card, width, theme, now);
    lines.push(...cardLines.slice(0, Math.max(1, remaining)));
    remaining -= cardLines.length;
    if (remaining > 0) lines.push("");
  }
  return lines;
}

export function renderQuotaCard(card: QuotaCard, width: number, theme: MeterTheme, now: number): string[] {
  const lines: string[] = [];
  const color = quotaColor(card.status);
  const statusGlyph =
    card.status === "error" ? "✕" : card.status === "critical" ? "‼" : card.status === "warning" ? "!" : "✓";
  const plan = card.plan ? theme.fg("muted", ` · ${card.plan}`) : "";
  const left = ` ${theme.fg(color, statusGlyph)} ${theme.fg("text", theme.bold(card.label))}${plan}`;

  const rightParts: string[] = [];
  if (card.balance) rightParts.push(`${card.balance.label} ${card.balance.value}`);
  if (card.detail) rightParts.push(card.detail);
  const right = theme.fg("dim", rightParts.join("  "));
  if (!right) {
    lines.push(left);
  } else {
    const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right) - 1);
    lines.push(`${left}${" ".repeat(gap)}${right}`);
  }

  if (card.error) {
    lines.push(`   ${theme.fg("error", truncate(card.error, width - 4))}`);
    lines.push(`   ${theme.fg("dim", `source ${card.source}`)}`);
    return lines;
  }

  if (card.windows.length === 0) {
    lines.push(`   ${theme.fg("dim", "No usage windows reported.")}`);
    return lines;
  }

  const labelWidth = Math.max(
    ...card.windows.map((window) => window.label.length),
    6,
  );
  for (const window of card.windows) {
    lines.push(renderQuotaWindow(window, labelWidth, width, theme, now));
  }
  lines.push(`   ${theme.fg("dim", `source ${card.source} · checked ${formatAgo(card.updatedAt, now)}`)}`);
  return lines;
}

function renderQuotaWindow(
  window: QuotaWindow,
  labelWidth: number,
  width: number,
  theme: MeterTheme,
  now: number,
): string {
  const color = severityColor(window.usedPercent);
  const barWidth = Math.max(8, Math.min(24, width - labelWidth - 34));
  const bar = theme.fg(color, usageBar(window.usedPercent, barWidth));
  const label = pad(window.label, labelWidth);
  const percent = padStart(percentText(window.usedPercent), 4);
  const reset = window.resetsAt !== undefined ? `resets ${formatUntil(window.resetsAt, now)}` : window.detail ?? "";
  return joinColumns([
    { text: `   ${theme.fg("muted", label)}`, width: labelWidth + 3 },
    { text: bar, width: barWidth },
    { text: theme.fg(color, percent), width: 4, align: "right" },
    { text: theme.fg("dim", truncate(reset, 28)), width: 28 },
  ]);
}

function renderHints(state: DashboardState, width: number, theme: MeterTheme): string[] {
  const hints =
    state.tab === "quotas"
      ? "1-5 tabs · r refresh · ? help · esc close"
      : "1-5 tabs · ↑↓ select · enter detail · p period · s sort · r refresh · ? help · esc close";
  return [` ${theme.fg("dim", truncate(hints, width - 2))}`];
}

function renderLoading(width: number, height: number, theme: MeterTheme): string[] {
  const lines = [
    theme.fg("accent", theme.bold(" pi-meter ")),
    "",
    ` ${theme.fg("muted", "Scanning pi sessions…")}`,
  ];
  while (lines.length < Math.min(height, 8)) lines.push("");
  return lines.map((line) => truncate(line, width));
}

function renderError(message: string, width: number, theme: MeterTheme): string[] {
  return [
    theme.fg("accent", theme.bold(" pi-meter ")),
    "",
    ` ${theme.fg("error", truncate(message, width - 2))}`,
    ` ${theme.fg("dim", "r retry · esc close")}`,
  ];
}

function renderHelp(width: number, height: number, theme: MeterTheme): string[] {
  const rows: Array<[string, string]> = [
    ["1 – 5", "switch tab (overview, models, projects, sessions, quotas)"],
    ["tab / shift+tab", "cycle tabs"],
    ["↑ ↓ / j k", "move selection, scroll lists"],
    ["enter", "toggle detail panel for the selected row"],
    ["p / shift+p", "next / previous period"],
    ["s", "cycle sort: spend → tokens → requests"],
    ["r", "rescan sessions and refresh quotas"],
    ["? ", "toggle this help"],
    ["q / esc", "close pi-meter"],
  ];
  const lines = [theme.fg("accent", theme.bold(" pi-meter keys ")), ""];
  for (const [key, description] of rows.slice(0, Math.max(4, height - 4))) {
    lines.push(` ${theme.fg("accent", pad(key, 16))}${theme.fg("muted", truncate(description, width - 20))}`);
  }
  return lines.map((line) => truncate(line, width));
}

function formatAgo(timestamp: number, now: number): string {
  const delta = Math.max(0, now - timestamp) / 1_000;
  if (delta < 5) return "just now";
  if (delta < 60) return `${Math.round(delta)}s ago`;
  if (delta < 3_600) return `${Math.round(delta / 60)}m ago`;
  if (delta < 86_400) return `${Math.round(delta / 3_600)}h ago`;
  return `${Math.round(delta / 86_400)}d ago`;
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
