import { buildReport, type SortMetric } from "../analytics/aggregate.ts";
import { PERIODS, type PeriodId } from "../analytics/types.ts";
import type { ScanResult } from "../analytics/types.ts";
import type { QuotaCard } from "../quota/types.ts";

export const TABS = ["overview", "models", "projects", "sessions", "quotas"] as const;
export type TabId = (typeof TABS)[number];

export const TAB_LABELS: Record<TabId, string> = {
  overview: "Overview",
  models: "Models",
  projects: "Projects",
  sessions: "Sessions",
  quotas: "Quotas",
};

export interface MeterData {
  scan: ScanResult;
  quotas: QuotaCard[];
  quotasUpdatedAt?: number;
  quotasError?: string;
}

export class DashboardState {
  tab: TabId = "overview";
  period: PeriodId = "7d";
  sortMetric: SortMetric = "cost";
  selection = 0;
  scroll = 0;
  detail = false;
  help = false;
  data: MeterData | undefined;
  loading = true;
  refreshing = false;
  error: string | undefined;
  now = Date.now();

  cyclePeriod(direction = 1): void {
    const index = PERIODS.findIndex((period) => period.id === this.period);
    const next = (index + direction + PERIODS.length) % PERIODS.length;
    this.period = PERIODS[next]?.id ?? "7d";
    this.selection = 0;
    this.scroll = 0;
  }

  setPeriod(period: PeriodId): void {
    this.period = period;
    this.selection = 0;
    this.scroll = 0;
  }

  setTab(tab: TabId): void {
    this.tab = tab;
    this.selection = 0;
    this.scroll = 0;
  }

  nextTab(direction = 1): void {
    const index = TABS.indexOf(this.tab);
    const next = (index + direction + TABS.length) % TABS.length;
    this.tab = TABS[next] ?? "overview";
    this.selection = 0;
    this.scroll = 0;
  }

  cycleSort(): void {
    const order: SortMetric[] = ["cost", "tokens", "requests"];
    const index = order.indexOf(this.sortMetric);
    this.sortMetric = order[(index + 1) % order.length] ?? "cost";
  }

  report() {
    if (!this.data) return undefined;
    return buildReport(this.data.scan.sessions, this.period, new Date(this.now), this.sortMetric);
  }

  rows() {
    if (!this.data) return [];
    const report = this.report();
    if (!report) return [];
    switch (this.tab) {
      case "models":
        return report.models;
      case "projects":
        return report.projects;
      case "sessions":
        return report.sessions;
      case "quotas":
        return [];
      default:
        return report.models;
    }
  }

  moveSelection(delta: number, visibleRows: number): void {
    const rows = this.rows();
    if (rows.length === 0) return;
    const next = Math.min(rows.length - 1, Math.max(0, this.selection + delta));
    this.selection = next;
    if (this.selection < this.scroll) this.scroll = this.selection;
    if (this.selection >= this.scroll + visibleRows) this.scroll = this.selection - visibleRows + 1;
  }

  clampScroll(visibleRows: number): void {
    const rows = this.rows();
    const maxScroll = Math.max(0, rows.length - visibleRows);
    this.scroll = Math.min(Math.max(0, this.scroll), maxScroll);
    if (rows.length === 0) this.selection = 0;
    else if (this.selection > rows.length - 1) this.selection = rows.length - 1;
  }

  selectedRow() {
    const rows = this.rows();
    return rows[this.selection];
  }
}
