import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Box, Text, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { buildReport } from "./analytics/aggregate.ts";
import { formatPercent, formatTokens, formatUSD } from "./analytics/format.ts";
import { PERIODS, type PeriodId } from "./analytics/types.ts";
import { MeterController } from "./controller.ts";
import { renderHtmlReport } from "./reports/html.ts";
import { renderQuotaText, renderTextReport } from "./reports/text.ts";
import { DashboardComponent } from "./ui/dashboard.ts";
import { percentText, usageBar, severityColor } from "./ui/theme.ts";

const REPORT_ENTRY = "pi-meter-report";
const WIDGET_KEY = "pi-meter-widget";
const STATUS_KEY = "pi-meter";

let controller: MeterController | undefined;
let widgetEnabled = false;
let widgetTimer: NodeJS.Timeout | undefined;
let widgetContext: ExtensionContext | undefined;

function getController(): MeterController {
  controller ??= new MeterController();
  return controller;
}

function parsePeriod(value: string, fallback: PeriodId = "7d"): PeriodId {
  const normalized = value.trim().toLowerCase();
  for (const period of PERIODS) {
    if (period.id === normalized || period.label.toLowerCase() === normalized) return period.id;
  }
  if (normalized === "week" || normalized === "weekly") return "7d";
  if (normalized === "month" || normalized === "monthly") return "30d";
  if (normalized === "all" || normalized === "alltime" || normalized === "epoch") return "all";
  return fallback;
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    widgetContext = ctx;
    if (widgetEnabled) await startWidget();
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    stopWidget();
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });

  pi.registerCommand("meter", {
    description: "Open the pi-meter usage and quota cockpit",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        const report = await buildQuickReport(getController(), parsePeriod(args));
        ctx.ui.notify(report, "info");
        return;
      }
      const meter = getController();
      await ctx.ui.custom<void>(
        (tui, theme, keybindings, done) => {
          const dashboard = new DashboardComponent(tui, theme, keybindings, done, { controller: meter });
          dashboard.start();
          return dashboard;
        },
        { blocked: { kind: "question", message: "Viewing pi-meter" } },
      );
    },
  });

  pi.registerCommand("meter-report", {
    description: "Print a pi-meter report into the session (today|7d|30d|all)",
    getArgumentCompletions: (prefix) =>
      PERIODS.filter((period) => period.id.startsWith(prefix)).map((period) => ({
        value: period.id,
        label: period.id,
        description: period.label,
      })),
    handler: async (args, ctx) => {
      const period = parsePeriod(args);
      const meter = getController();
      const data = await meter.refresh({ refreshQuotas: false });
      const report = buildReport(data.scan.sessions, period);
      const text = renderTextReport(report, { quotas: [], width: 76, maxRows: 10 });
      emitReport(pi, ctx, text, period);
    },
  });

  pi.registerCommand("meter-quota", {
    description: "Check live provider quota windows",
    handler: async (_args, ctx) => {
      const meter = getController();
      const cards = await meter.refreshQuotas(ctx.signal);
      if (cards.length === 0) {
        ctx.ui.notify("No provider credentials found. Run /login or set an API key env var.", "warning");
        return;
      }
      const text = cards.flatMap((card) => renderQuotaText(card, 76, Date.now())).join("\n");
      emitReport(pi, ctx, text, "quotas");
    },
  });

  pi.registerCommand("meter-export", {
    description: "Write an HTML or JSON usage report (html|json [period])",
    handler: async (args, ctx) => {
      const [formatRaw = "html", periodRaw] = args.trim().split(/\s+/);
      const format = formatRaw.toLowerCase() === "json" ? "json" : "html";
      const period = parsePeriod(periodRaw ?? "7d");
      const meter = getController();
      const data = await meter.refresh({ refreshQuotas: false });
      const report = buildReport(data.scan.sessions, period);
      const dir = `${meter.agentDir}/pi-meter/exports`;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const file = `${dir}/pi-meter-${period}-${stamp}.${format}`;
      const body =
        format === "json"
          ? `${JSON.stringify({ schema: "pi-meter.report/v1", report, quotas: data.quotas }, null, 2)}\n`
          : renderHtmlReport(report, { quotas: data.quotas });
      await writeFile(file, body);
      ctx.ui.notify(`Saved ${format.toUpperCase()} report: ${file}`, "info");
    },
  });

  pi.registerCommand("meter-widget", {
    description: "Toggle the compact pi-meter widget above the editor",
    handler: async (_args, ctx) => {
      widgetEnabled = !widgetEnabled;
      widgetContext = ctx;
      if (widgetEnabled) {
        await startWidget();
        ctx.ui.notify("pi-meter widget on", "info");
      } else {
        stopWidget();
        ctx.ui.notify("pi-meter widget off", "info");
      }
    },
  });

  pi.registerCommand("meter-status", {
    description: "Put today's spend and worst quota window in the footer status",
    handler: async (_args, ctx) => {
      const text = await statusText(getController());
      ctx.ui.setStatus(STATUS_KEY, text);
    },
  });

  pi.registerEntryRenderer(REPORT_ENTRY, (entry, _options, theme) => {
    const data = entry.data as { text?: string; period?: string } | undefined;
    const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
    const heading = theme.fg("accent", theme.bold(` pi-meter · ${data?.period ?? "report"} `));
    box.addChild(new Text(truncateToWidth(heading, 200)));
    for (const line of (data?.text ?? "").split("\n")) {
      box.addChild(new Text(theme.fg("text", line)));
    }
    return box;
  });

  async function startWidget(): Promise<void> {
    const ctx = widgetContext;
    if (!ctx) return;
    stopWidget();
    widgetEnabled = true;

    const paint = async () => {
      const current = widgetContext;
      if (!current || !widgetEnabled) return;
      try {
        const meter = getController();
        const data = await meter.refresh();
        const report = buildReport(data.scan.sessions, "today");
        const quotas = data.quotas;
        current.ui.setWidget(WIDGET_KEY, (_tui, theme): Component => {
          return new Text(renderWidgetLine(report.totals.costUSD, report.totals.tokens, quotas, theme));
        });
      } catch {
        // Widgets are best-effort; the dashboard surfaces real errors.
      }
    };

    await paint();
    widgetTimer = setInterval(() => void paint(), 60_000);
    widgetTimer.unref?.();
  }

  function stopWidget(): void {
    if (widgetTimer) clearInterval(widgetTimer);
    widgetTimer = undefined;
    widgetContext?.ui.setWidget(WIDGET_KEY, undefined);
  }
}

function renderWidgetLine(
  costUSD: number,
  tokens: number,
  quotas: Array<{ label: string; windows: Array<{ label: string; usedPercent: number }>; status: string }>,
  theme: Theme,
): string {
  const parts: string[] = [];
  parts.push(theme.fg("accent", theme.bold("pi-meter")));
  parts.push(`${theme.fg("muted", "today")} ${theme.fg("text", formatUSD(costUSD))}`);
  parts.push(`${theme.fg("muted", "tokens")} ${theme.fg("text", formatTokens(tokens))}`);
  for (const card of quotas.slice(0, 3)) {
    const worst = card.windows.reduce<{ label: string; usedPercent: number } | undefined>(
      (best, window) => (!best || window.usedPercent > best.usedPercent ? window : best),
      undefined,
    );
    if (!worst) continue;
    const color = severityColor(worst.usedPercent);
    parts.push(`${theme.fg("muted", card.label)} ${theme.fg(color, usageBar(worst.usedPercent, 5))} ${theme.fg(color, percentText(worst.usedPercent))}`);
  }
  return parts.join(theme.fg("dim", "  ·  "));
}

async function statusText(meter: MeterController): Promise<string> {
  const data = await meter.refresh({ refreshQuotas: true });
  const report = buildReport(data.scan.sessions, "today");
  const worst = data.quotas
    .flatMap((card) => card.windows.map((window) => ({ card, window })))
    .reduce<{ card: { label: string }; window: { label: string; usedPercent: number } } | undefined>(
      (best, current) =>
        !best || current.window.usedPercent > best.window.usedPercent ? current : best,
      undefined,
    );
  const today = `$${report.totals.costUSD.toFixed(2)} today`;
  if (!worst) return `${today} · no quota data`;
  return `${today} · ${worst.card.label} ${percentText(worst.window.usedPercent)} (${worst.window.label})`;
}

function emitReport(pi: ExtensionAPI, ctx: ExtensionContext, text: string, period: string): void {
  if (ctx.mode === "tui") {
    pi.appendEntry(REPORT_ENTRY, { text, period });
    return;
  }
  if (ctx.hasUI) {
    ctx.ui.notify(text.replace(/\n/g, " · "), "info");
    return;
  }
  console.log(text);
}

async function buildQuickReport(meter: MeterController, period: PeriodId): Promise<string> {
  const data = await meter.refresh({ refreshQuotas: true });
  const report = buildReport(data.scan.sessions, period);
  return `${report.period}: ${formatUSD(report.totals.costUSD)} · ${formatTokens(report.totals.tokens)} tokens · ${formatPercent(report.cacheHitRate)} cache hit`;
}

async function writeFile(file: string, body: string): Promise<void> {
  const { mkdir, writeFile: write } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await write(file, body, { encoding: "utf8", mode: 0o600 });
}
