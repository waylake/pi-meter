import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import { matchesKey } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { MeterController } from "../controller.ts";
import { DashboardState, TABS } from "./state.ts";
import { renderDashboard } from "./render.ts";
import { meterTheme } from "./theme.ts";

export interface DashboardOptions {
  controller: MeterController;
  autoRefreshMs?: number;
}

export class DashboardComponent implements Component {
  private readonly state = new DashboardState();
  private readonly controller: MeterController;
  private readonly theme: Theme;
  private readonly tui: TUI;
  private readonly keybindings: KeybindingsManager;
  private readonly done: (result: void) => void;
  private readonly autoRefreshMs: number;
  private timer: NodeJS.Timeout | undefined;
  private width = 80;
  private cachedLines: string[] | undefined;
  private cachedWidth: number | undefined;
  private cachedHeight: number | undefined;
  private activeRefresh: AbortController | undefined;
  private disposed = false;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (result: void) => void,
    options: DashboardOptions,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.controller = options.controller;
    this.autoRefreshMs = options.autoRefreshMs ?? 45_000;
    void this.load();
  }

  start(): void {
    if (this.timer || this.autoRefreshMs <= 0) return;
    this.timer = setInterval(() => {
      if (this.disposed) return;
      void this.load();
    }, this.autoRefreshMs);
    this.timer.unref?.();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.activeRefresh?.abort();
  }

  invalidate(): void {
    this.cachedLines = undefined;
    this.cachedWidth = undefined;
    this.cachedHeight = undefined;
  }

  render(width: number): string[] {
    const height = Math.max(12, this.tui.terminal.rows - 2);
    if (this.cachedLines && this.cachedWidth === width && this.cachedHeight === height) {
      return this.cachedLines;
    }
    this.width = width;
    this.state.now = Date.now();
    const lines = renderDashboard(this.state, {
      width,
      height,
      theme: meterTheme(this.theme),
      now: this.state.now,
    });
    this.cachedLines = lines;
    this.cachedWidth = width;
    this.cachedHeight = height;
    return lines;
  }

  handleInput(data: string): void {
    const kb = this.keybindings;
    if (matchesKey(data, "q") || matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.done();
      return;
    }
    if (matchesKey(data, "?")) {
      this.state.help = !this.state.help;
      this.refreshView();
      return;
    }
    if (this.state.help) {
      this.state.help = false;
      this.refreshView();
      return;
    }

    if (/^[1-5]$/.test(data)) {
      const tab = TABS[Number(data) - 1];
      if (tab) this.state.setTab(tab);
      this.refreshView();
      return;
    }
    if (matchesKey(data, "tab")) {
      this.state.nextTab(1);
      this.refreshView();
      return;
    }
    if (matchesKey(data, "shift+tab")) {
      this.state.nextTab(-1);
      this.refreshView();
      return;
    }
    if (matchesKey(data, "up") || matchesKey(data, "k")) {
      this.state.moveSelection(-1, this.visibleRows());
      this.refreshView();
      return;
    }
    if (matchesKey(data, "down") || matchesKey(data, "j")) {
      this.state.moveSelection(1, this.visibleRows());
      this.refreshView();
      return;
    }
    if (matchesKey(data, "enter")) {
      if (this.state.tab === "overview") {
        this.state.setTab("models");
        this.state.detail = true;
      } else {
        this.state.detail = !this.state.detail;
      }
      this.refreshView();
      return;
    }
    if (matchesKey(data, "p")) {
      this.state.cyclePeriod(1);
      this.refreshView();
      return;
    }
    if (matchesKey(data, "shift+p")) {
      this.state.cyclePeriod(-1);
      this.refreshView();
      return;
    }
    if (matchesKey(data, "s")) {
      this.state.cycleSort();
      this.refreshView();
      return;
    }
    if (matchesKey(data, "r")) {
      void this.load(true);
      return;
    }
    if (kb.matches?.(data, "tui.select.cancel")) {
      this.done();
    }
  }

  private visibleRows(): number {
    return Math.max(4, this.tui.terminal.rows - 18);
  }

  private refreshView(): void {
    this.invalidate();
    this.tui.requestRender();
  }

  private async load(forceQuotas = false): Promise<void> {
    if (this.state.refreshing) return;
    this.state.refreshing = true;
    this.state.error = undefined;
    this.refreshView();
    this.activeRefresh?.abort();
    const controller = new AbortController();
    this.activeRefresh = controller;

    try {
      const data = await this.controller.refresh({
        signal: controller.signal,
        forceQuotas,
      });
      if (controller.signal.aborted || this.disposed) return;
      this.state.data = data;
      this.state.loading = false;
      this.state.now = Date.now();
    } catch (error) {
      if (controller.signal.aborted || this.disposed) return;
      this.state.error = error instanceof Error ? error.message : String(error);
      this.state.loading = false;
    } finally {
      if (!controller.signal.aborted) {
        this.state.refreshing = false;
        this.refreshView();
      }
    }
  }
}
