# pi-meter 📊

> Every pi token, every provider limit, inside the terminal you are already in.

A local-first **usage, cost, and quota cockpit** for the [pi coding agent](https://github.com/earendil-works/pi). It reads the session transcripts pi already writes, prices them at the rates recorded in each assistant message, and shows the result in a keyboard-driven TUI — plus live subscription windows for providers that expose them.

```text
 pi-meter ──────────────────────────────── updated just now · 69 sessions · 2 parsed / 67 cached
▍1 Overview  2 Models   3 Projects   4 Sessions   5 Quotas      Today · 7 days · 30 days · All time

Spend     $4.14          Tokens    141M           Requests  1,160          Cache hit 98.2%
Sessions  31             Projects  3              Avg / req $0.0036        Active days 6

Daily spend ────────────────────────────────────────────── peak $2.08 on Nov 8
 ▄▁▁▁▁▅█  Nov 2 → Nov 8
 total $4.14  avg/day $0.591  top model deepseek-v4.1-flash-speed

Providers ────────────────────────────────────────────────────────── 5 active
 anthropic                     ███████░░░░░░░      $2.06    50%     19.1M tok
 neuralwatt                    ██████░░░░░░░░      $1.85    45%      104M tok
 opencode-go                   █░░░░░░░░░░░░░     $0.227     5%     15.1M tok
 omlx                          ░░░░░░░░░░░░░░      $0.00     0%      1.8M tok

Top models ───────────────────────────────────────────────────────── by spend
 deepseek-v4.1-flash-speed           █████░░░░░░░      $1.84      103M       621 req    $0.0030
 anthropic/claude-haiku-5-5          ████░░░░░░░░      $1.22     17.6M        90 req     $0.014
 claude-opus-5-5                     █░░░░░░░░░░░     $0.428      366k         6 req     $0.071
 claude-sonnet-5-5                   █░░░░░░░░░░░     $0.417      1.1M        31 req     $0.013
 opencode-go/deepseek-v4.1-flash     █░░░░░░░░░░░     $0.227     14.8M       252 req    $0.0009
 neuralwatt/deepseek-v4.1-flash      ░░░░░░░░░░░░     $0.013      371k        18 req    $0.0007

 1-5 tabs · ↑↓ select · enter detail · p period · s sort · r refresh · ? help · esc close
```

## Why

`pi` already prints the current session's tokens and cost in its footer. Once you spread work across providers — an OpenCode Go subscription, a Neuralwatt plan, a local oMLX server, a Claude Pro seat — three questions stop having an obvious answer:

1. **Where did the money go this week?** Per provider, model, project, and session.
2. **How much cache am I actually hitting?** Cache reads dominate long agent sessions.
3. **Am I about to hit a subscription window?** 5-hour, weekly, and monthly resets per provider.

pi-meter answers all three without a separate daemon, login, or SaaS account.

## Install

pi packages load TypeScript directly, so there is no build step.

```bash
# from git (recommended while unreleased)
pi install git:github.com/waylake/pi-meter

# or try it for one run
pi -e git:github.com/waylake/pi-meter

# or from a local checkout
pi install /path/to/pi-meter
```

Restart pi (or `/reload`), then:

```text
/meter
```

## Commands

| Command | What it does |
|---|---|
| `/meter` | Open the cockpit: Overview, Models, Projects, Sessions, Quotas |
| `/meter-report [today\|7d\|30d\|all]` | Append a text report to the session (not sent to the model) |
| `/meter-quota` | Check live provider quota windows |
| `/meter-export [html\|json] [period]` | Write a report to `~/.pi/agent/pi-meter/exports/` |
| `/meter-widget` | Toggle a one-line status widget above the editor |
| `/meter-status` | Put today's spend plus the tightest quota window in the footer |

### Cockpit keys

| Key | Action |
|---|---|
| `1`–`5`, `tab`, `shift+tab` | Switch tab |
| `↑` `↓` / `j` `k` | Move selection, scroll lists |
| `enter` | Toggle the detail panel for the selected row |
| `p` / `P` | Next / previous period |
| `s` | Cycle sort: spend → tokens → requests |
| `r` | Rescan transcripts and refresh quotas |
| `?` | Key help |
| `q` / `esc` | Close |

## Where the numbers come from

Everything is derived locally from `~/.pi/agent/sessions/**/*.jsonl`:

- `message` entries with `role: "assistant"` and a `usage` block → tokens and the **recorded per-message cost** (`usage.cost.total`, falling back to `totalFromProvider`, then the sum of components)
- `usage` entries (e.g. cache warming) and `compaction` / `branch_summary` summaries → counted, they are real spend
- `model_change` entries → provider/model attribution when a message omits it
- `session_info` → session names in the Sessions tab

Scanning is cached by file size + mtime in `~/.pi/agent/pi-meter/session-cache-v1.json`, so a warm start is instant and only changed transcripts are re-parsed.

**These are API-rate estimates, not a billing statement.** Subscription seats (Claude Pro, ChatGPT Plus, OpenCode Go) report usage at list price; the quota tab is what tells you whether the subscription itself is running out.

## Quotas

The Quotas tab calls the same read-only endpoints the providers' own CLIs and dashboards use. Credentials are **only read**, never refreshed or written back.

| Provider | Windows | Credential source |
|---|---|---|
| **OpenCode Go** | 5-hour, weekly, monthly | `pi auth.json` → `opencode-go`, `pi models.json`, `~/.local/share/opencode/auth.json`, `OPENCODE_GO_API_KEY` |
| **OpenAI Codex** | primary/secondary rate windows, plan, credits | `~/.codex/auth.json`, `CODEX_ACCESS_TOKEN` |
| **Claude** | 5-hour, weekly, model-scoped weekly, extra usage | `~/.claude/.credentials.json`, `pi auth.json` OAuth entry, `CLAUDE_OAUTH_TOKEN` |
| **Neuralwatt** | subscription kWh, per-key allowance, prepaid USD | `pi models.json` → `neuralwatt`, `NEURALWATT_API_KEY` |

Notes:

- An Anthropic **API key** cannot read a Claude subscription's quota. Claude windows need a Claude Code OAuth login (`claude` CLI), because that is the only credential the endpoint accepts.
- Missing credentials simply hide that provider — pi-meter never prompts for secrets.
- Requests time out after 15 s and run in parallel; failures show per card instead of breaking the dashboard.

## CLI

The same engine works outside pi (handy for cron, CI, or a weekly HTML report). From a checkout:

```bash
npm install
node bin/pi-meter.mjs                      # 7-day text report
node bin/pi-meter.mjs --period 30d         # other windows: today, 7d, 30d, all
node bin/pi-meter.mjs quotas               # live quota windows
node bin/pi-meter.mjs --json               # schema: pi-meter.report/v1
node bin/pi-meter.mjs --html report.html   # standalone HTML dashboard
node bin/pi-meter.mjs --no-cache           # force a full rescan

# or, after `npm link` / an npm install of the package
pi-meter --period 30d
```

Requires Node.js 22.18+ (native TypeScript stripping). The package is not on npm yet; install the extension from git.

### Environment

| Variable | Effect |
|---|---|
| `PI_CODING_AGENT_DIR` | pi agent dir (default `~/.pi/agent`) |
| `PI_METER_SESSION_DIR` | Extra session roots, separated by the OS path delimiter |
| `PI_METER_CACHE_DIR` | Scan cache location |
| `PI_METER_CACHE=0` | Disable the scan cache |
| `NEURALWATT_API_KEY` | Neuralwatt quota without a key in `models.json` |
| `OPENCODE_GO_API_KEY` | OpenCode Go quota without a stored pi key |
| `CODEX_ACCESS_TOKEN` | Codex quota without `~/.codex/auth.json` |
| `CLAUDE_OAUTH_TOKEN` | Claude quota without a Claude Code login |

## Privacy

- Transcripts never leave the machine. No request body is sent anywhere; quota calls are plain `GET`s to the provider endpoints listed above.
- No telemetry, no accounts, no background process. Timers only run while pi is open and the widget or dashboard is active.
- Reports contain prompts' token counts and project paths, not prompt text. Review an export before sharing it.

## Development

```bash
npm install
npm run check     # tsc --noEmit + node:test
npm run meter -- --period 7d
```

```text
src/analytics/   session scanner, aggregation, formatting
src/quota/       credential discovery + one adapter per provider
src/ui/          dashboard state, renderer, pi TUI component
src/reports/     text, HTML, JSON output
src/index.ts     pi extension entry (commands, widget, entry renderer)
src/cli.ts       standalone CLI
```

See [docs/DESIGN.md](docs/DESIGN.md) for the data flow, the provider research notes, and what came from studying [CodexBar](https://github.com/steipete/CodexBar).

## License

MIT. Not affiliated with Anthropic, OpenAI, OpenCode, Neuralwatt, or the pi project.
