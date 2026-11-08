# Design notes

## Goal

Make pi's own transcript the source of truth for "what did my agent work cost, and how much headroom is left on each subscription?", and answer it inside pi's TUI with no extra daemon.

## Data flow

```text
~/.pi/agent/sessions/**/*.jsonl
        │  scanner.ts (size+mtime cache, full parse on change)
        ▼
SessionUsage[] (records: tokens, cost, provider, model, duration)
        │  aggregate.ts (period filter)
        ▼
Report (totals, providers, models, projects, sessions, daily, hourly)
        │
        ├── render.ts   → interactive dashboard (pi TUI component)
        ├── text.ts     → /meter-report, CLI
        └── html.ts     → /meter-export, CLI
```

Quotas are a separate, parallel path: `quota/*.ts` adapters → `QuotaCard[]`, merged into the same `MeterData` snapshot. The dashboard refreshes quotas at most once a minute (a provider can rate-limit), while transcripts are re-read on demand.

## Why the transcript, not provider APIs, for cost

Provider billing APIs are not uniform: some expose organization spend behind admin keys, some have no usage API at all, and subscription seats have no per-request price. pi, however, records `usage.cost` on every assistant message with the rate of the model that actually answered — including local models priced at zero. Pricing pi's own log gives one consistent number across every provider, and it stays correct when a provider is swapped mid-session.

Rules the scanner follows:

- Count `assistant` messages, `usage` entries (cache warming), and `compaction` / `branch_summary` summaries: all are real spend.
- Prefer `usage.cost.total`; if it is missing, use `totalFromProvider`; if that is missing, sum the component prices.
- Never re-price an aggregate. Store per-message values and sum them, so a pricing change cannot silently rewrite history.
- Deduplicate by entry id, tolerate a truncated trailing line (live sessions are appended while being read), and skip forward-compatible entry types instead of failing the whole file.

## Cache semantics

The scanner cache is keyed by absolute path and validated by `size` + `mtimeMs`. A warm scan with no changes touches no JSON. Writes are atomic (`tmp` + `rename`) with `0600`, and the cache lives under the pi agent dir so it never lands in a repository.

Cache invalidation is deliberately conservative: any size or mtime change reparses the whole file. Sessions are small (tens of MB for months of work), so this is cheaper than tracking byte offsets and far less error-prone.

## Quota providers

All four adapters were implemented against the public endpoints each vendor's own tooling uses; the request shapes were cross-checked against [CodexBar](https://github.com/steipete/CodexBar) (MIT), which documents them per provider in `docs/`.

| Provider | Endpoint | Shape used |
|---|---|---|
| OpenCode Go | `GET https://opencode.ai/zen/go/v1/usage` | `usage.rolling/weekly/monthly.{percent,resetsAt}` |
| OpenAI Codex | `GET https://chatgpt.com/backend-api/wham/usage` | `rate_limit.{primary,secondary}_window.used_percent`, `plan_type`, `credits` |
| Claude | `GET https://api.anthropic.com/api/oauth/usage` | `five_hour`, `seven_day`, `seven_day_{sonnet,opus}`, `extra_usage` (needs `anthropic-beta: oauth-2025-04-20`) |
| Neuralwatt | `GET https://api.neuralwatt.com/v1/quota` | `subscription.kwh_{included,used}`, `balance.credits_remaining_usd`, `key.allowance` |

Deliberate differences from CodexBar:

- **Read-only credentials.** No OAuth refresh, no keychain prompts, no cookie databases. If a token is expired, the card shows an error and you refresh it with the provider's own CLI.
- **No browser scraping.** Only files pi (or the provider's CLI) already wrote.
- **Estimate-first cost.** We do not mirror provider dashboards for spend; the transcript is the ledger.
- **pi-native UI.** Rendering, keybindings, and theming go through `@earendil-works/pi-tui`, so it matches whatever theme is active and works over SSH.

## UI decisions

- The dashboard is a `ctx.ui.custom()` component rather than a widget: it needs arrow keys and its own scroll state.
- The compact widget and footer status are opt-in because pi's footer already shows session usage; the widget adds the cross-session picture.
- Reports appended with `pi.appendEntry()` never enter the model context, so asking for a report costs nothing.
- All list rows render through a single `truncate()` that measures display width (wide CJK glyphs count as two cells), and every line is truncated to the terminal width to avoid wrapping artifacts.

## Known limitations

- Session totals only cover this machine. A second laptop has its own `~/.pi/agent/sessions`.
- Claude subscription quota requires a Claude Code OAuth login; an Anthropic API key is not accepted by the usage endpoint.
- Codex cost is not available without a spend API key; only tokens and quota windows are shown there.
- Anthropic's usage endpoint rate-limits aggressively (HTTP 429). The dashboard respects a 60 s TTL, and failures are shown rather than retried in a loop.
