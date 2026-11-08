import {
  formatCount,
  formatDuration,
  formatPercent,
  formatShortDate,
  formatTokens,
  formatUSD,
} from "../analytics/format.ts";
import { PERIODS, type Report } from "../analytics/types.ts";
import type { QuotaCard } from "../quota/types.ts";

export interface HtmlReportOptions {
  quotas?: QuotaCard[];
  now?: number;
  title?: string;
}

export function renderHtmlReport(report: Report, options: HtmlReportOptions = {}): string {
  const now = options.now ?? Date.now();
  const title = options.title ?? "pi-meter";
  const period = PERIODS.find((entry) => entry.id === report.period)?.label ?? report.period;
  const maxDaily = Math.max(1, ...report.daily.map((point) => point.costUSD));

  const bars = report.daily
    .map((point) => {
      const height = Math.max(2, Math.round((point.costUSD / maxDaily) * 100));
      const label = `${formatShortDate(point.date.getTime())} · ${formatUSD(point.costUSD)}`;
      return `<div class="day" title="${escapeHtml(label)}"><div class="day-bar" style="height:${height}%"></div><span>${escapeHtml(formatShortDate(point.date.getTime()))}</span></div>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} — ${escapeHtml(period)}</title>
<style>
  :root { color-scheme: dark; --bg:#0e1116; --panel:#161b22; --border:#242c37; --text:#e6edf3; --muted:#8b949e; --accent:#4d9abf; --success:#3fb950; --warning:#d29922; --error:#f85149; }
  * { box-sizing: border-box; }
  body { margin:0; padding:32px; background:var(--bg); color:var(--text); font:14px/1.5 ui-sans-serif,-apple-system,"Segoe UI",sans-serif; }
  main { max-width:900px; margin:0 auto; }
  h1 { font-size:18px; letter-spacing:.02em; margin:0 0 4px; }
  h1 span { color:var(--accent); }
  .sub { color:var(--muted); margin:0 0 24px; }
  .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:24px; }
  .kpi { background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:14px 16px; }
  .kpi b { display:block; font-size:22px; font-weight:600; margin-top:2px; }
  .kpi span { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.06em; }
  section { background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:16px 18px; margin-bottom:16px; }
  section h2 { font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin:0 0 12px; }
  .chart { display:flex; align-items:flex-end; gap:4px; height:120px; padding-top:8px; }
  .day { flex:1; display:flex; flex-direction:column; justify-content:flex-end; align-items:center; height:100%; gap:4px; }
  .day-bar { width:100%; background:linear-gradient(180deg,var(--accent),#2f6c86); border-radius:3px 3px 0 0; min-height:1px; }
  .day span { color:var(--muted); font-size:10px; white-space:nowrap; }
  table { width:100%; border-collapse:collapse; }
  th,td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--border); font-size:13px; }
  th { color:var(--muted); font-weight:500; font-size:11px; text-transform:uppercase; letter-spacing:.05em; }
  td.num,th.num { text-align:right; font-variant-numeric:tabular-nums; }
  tr:last-child td { border-bottom:none; }
  .bar { height:6px; background:#21262d; border-radius:3px; overflow:hidden; min-width:60px; }
  .bar i { display:block; height:100%; background:var(--accent); }
  .quota { margin-bottom:12px; }
  .quota-head { display:flex; justify-content:space-between; gap:12px; }
  .quota-head b { font-weight:600; }
  .quota-head span { color:var(--muted); }
  .quota-window { display:flex; align-items:center; gap:10px; margin-top:6px; color:var(--muted); font-size:12px; }
  .quota-window .bar { flex:1; }
  .quota-window em { font-style:normal; min-width:34px; text-align:right; }
  .ok { color:var(--success); } .warn { color:var(--warning); } .err { color:var(--error); }
  footer { color:var(--muted); font-size:12px; margin-top:24px; }
</style>
</head>
<body>
<main>
  <h1><span>pi-meter</span> · ${escapeHtml(period)}</h1>
  <p class="sub">${escapeHtml(formatShortDate(report.start))} → ${escapeHtml(formatShortDate(report.end))} · generated ${escapeHtml(new Date(now).toLocaleString("en-US"))}</p>

  <div class="kpis">
    <div class="kpi"><span>Spend</span><b>${escapeHtml(formatUSD(report.totals.costUSD))}</b></div>
    <div class="kpi"><span>Tokens</span><b>${escapeHtml(formatTokens(report.totals.tokens))}</b></div>
    <div class="kpi"><span>Requests</span><b>${escapeHtml(formatCount(report.totals.requests))}</b></div>
    <div class="kpi"><span>Cache hit</span><b>${escapeHtml(formatPercent(report.cacheHitRate))}</b></div>
    <div class="kpi"><span>Sessions</span><b>${escapeHtml(formatCount(report.totals.sessions))}</b></div>
    <div class="kpi"><span>Avg / request</span><b>${escapeHtml(formatUSD(report.avgCostPerRequest))}</b></div>
  </div>

  <section>
    <h2>Daily spend</h2>
    <div class="chart">${bars}</div>
  </section>

  <section>
    <h2>Models</h2>
    ${renderTable(report, report.models, report.totals.costUSD)}
  </section>

  <section>
    <h2>Providers</h2>
    ${renderTable(report, report.providers, report.totals.costUSD)}
  </section>

  <section>
    <h2>Projects</h2>
    ${renderTable(report, report.projects, report.totals.costUSD)}
  </section>

  ${options.quotas?.length ? `<section><h2>Quotas</h2>${options.quotas.map((card) => renderQuotaCard(card, now)).join("")}</section>` : ""}

  <footer>Estimated from pi session transcripts at recorded API rates, not a billing statement. ${report.avgDurationMs !== undefined ? `Average response ${escapeHtml(formatDuration(report.avgDurationMs))}.` : ""}</footer>
</main>
</body>
</html>`;
}

function renderTable(report: Report, rows: Report["models"], totalCost: number): string {
  if (rows.length === 0) return "<p>No usage in this period.</p>";
  const body = rows
    .slice(0, 20)
    .map((row) => {
      const share = totalCost > 0 ? (row.totals.costUSD / totalCost) * 100 : 0;
      return `<tr>
        <td>${escapeHtml(row.label)}</td>
        <td class="num">${escapeHtml(formatUSD(row.totals.costUSD))}</td>
        <td><div class="bar"><i style="width:${share.toFixed(1)}%"></i></div></td>
        <td class="num">${escapeHtml(formatTokens(row.totals.tokens))}</td>
        <td class="num">${escapeHtml(formatCount(row.totals.requests))}</td>
        <td class="num">${escapeHtml(formatUSD(row.totals.requests ? row.totals.costUSD / row.totals.requests : 0))}</td>
      </tr>`;
    })
    .join("");
  return `<table><thead><tr><th>Name</th><th class="num">Spend</th><th></th><th class="num">Tokens</th><th class="num">Requests</th><th class="num">Avg</th></tr></thead><tbody>${body}</tbody></table>`;
}

function renderQuotaCard(card: QuotaCard, now: number): string {
  const statusClass = card.status === "critical" || card.status === "error" ? "err" : card.status === "warning" ? "warn" : "ok";
  const head = `<div class="quota-head"><b>${escapeHtml(card.label)}${card.plan ? ` · ${escapeHtml(card.plan)}` : ""}</b><span>${card.balance ? `${escapeHtml(card.balance.label)} ${escapeHtml(card.balance.value)}` : ""}</span></div>`;
  if (card.error) {
    return `<div class="quota">${head}<div class="quota-window err">${escapeHtml(card.error)}</div></div>`;
  }
  const windows = card.windows
    .map((window) => {
      const reset =
        window.resetsAt !== undefined ? `resets ${formatUntil(window.resetsAt, now)}` : window.detail ?? "";
      return `<div class="quota-window"><span>${escapeHtml(window.label)}</span><div class="bar"><i style="width:${Math.min(100, window.usedPercent).toFixed(1)}%"></i></div><em class="${statusClass}">${Math.round(window.usedPercent)}%</em><span>${escapeHtml(reset)}</span></div>`;
    })
    .join("");
  return `<div class="quota">${head}${windows}</div>`;
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

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
