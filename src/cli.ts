import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildReport } from "./analytics/aggregate.ts";
import { PERIODS, type PeriodId, type Report } from "./analytics/types.ts";
import { resolveAgentDir } from "./analytics/scanner.ts";
import { MeterController } from "./controller.ts";
import { renderHtmlReport } from "./reports/html.ts";
import { renderTextReport } from "./reports/text.ts";
import { renderQuotaText } from "./reports/text.ts";

const HELP = `pi-meter — local usage, cost, and quota report for the pi coding agent

Usage
  pi-meter [options]
  pi-meter quotas
  pi-meter json

Options
  --period <today|7d|30d|all>   reporting window (default: 7d)
  --sort <cost|tokens|requests> sort order (default: cost)
  --json                        print the full report as JSON
  --html <file>                 write a standalone HTML report
  --out <file>                  write the text report to a file
  --quotas                      include live provider quota checks
  --no-cache                    rescan every session transcript
  --agent-dir <dir>             pi agent dir (default: $PI_CODING_AGENT_DIR or ~/.pi/agent)
  --width <n>                   text report width (default: 72)
  -h, --help                    show this help

Environment
  PI_CODING_AGENT_DIR           overrides the pi agent dir
  PI_METER_SESSION_DIR          extra session roots, separated by the OS path delimiter
  PI_METER_CACHE_DIR            overrides the scan cache location
  NEURALWATT_API_KEY            Neuralwatt quota
  OPENCODE_GO_API_KEY           OpenCode Go quota when pi has no stored key

Quota credentials reuse what pi already stores: auth.json, models.json, ~/.codex/auth.json,
~/.claude/.credentials.json, and the OpenCode auth store. Nothing is written back.
`;

interface Options {
  period: PeriodId;
  sort: "cost" | "tokens" | "requests";
  json: boolean;
  html: string | undefined;
  out: string | undefined;
  quotas: boolean;
  cache: boolean;
  agentDir: string;
  width: number;
  help: boolean;
  command: "report" | "quotas" | "json";
}

export async function runCli(argv: string[]): Promise<number> {
  let options: Options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${HELP}`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const controller = new MeterController({
    agentDir: options.agentDir,
    useCache: options.cache,
  });
  const wantsQuotas = options.quotas || options.command === "quotas";
  const data = await controller.refresh({ forceQuotas: wantsQuotas, refreshQuotas: wantsQuotas });
  const report = buildReport(data.scan.sessions, options.period, new Date(), options.sort);

  if (options.command === "json" || options.json) {
    process.stdout.write(`${JSON.stringify(toJson(report, data.quotas, data.scan), null, 2)}\n`);
    return 0;
  }

  if (options.command === "quotas") {
    if (data.quotas.length === 0) {
      process.stdout.write("No provider credentials found. Run /login in pi or set an API key env var.\n");
      return 0;
    }
    const now = Date.now();
    process.stdout.write(`${data.quotas.flatMap((card) => renderQuotaText(card, options.width, now)).join("\n")}\n`);
    return 0;
  }

  const text = renderTextReport(report, { quotas: data.quotas, width: options.width, maxRows: 10 });
  if (options.html) {
    await writeFileSafe(options.html, renderHtmlReport(report, { quotas: data.quotas }));
  }
  if (options.out) {
    await writeFileSafe(options.out, text);
    process.stdout.write(`${text}\n`);
    return 0;
  }
  process.stdout.write(`${text}\n`);
  return 0;
}

export function toJson(report: Report, quotas: unknown[], scan: unknown) {
  return {
    schema: "pi-meter.report/v1",
    generatedAt: new Date(report.generatedAt).toISOString(),
    report,
    quotas,
    scan,
  };
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    period: "7d",
    sort: "cost",
    json: false,
    html: undefined,
    out: undefined,
    quotas: false,
    cache: true,
    agentDir: resolveAgentDir(),
    width: 72,
    help: false,
    command: "report",
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg) continue;
    switch (arg) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "report":
        options.command = "report";
        break;
      case "json":
        options.command = "json";
        break;
      case "quotas":
        options.command = "quotas";
        break;
      case "--json":
        options.json = true;
        break;
      case "--quotas":
        options.quotas = true;
        break;
      case "--no-cache":
        options.cache = false;
        break;
      case "--html":
        options.html = requireValue(argv, ++index, "--html");
        break;
      case "--out":
        options.out = requireValue(argv, ++index, "--out");
        break;
      case "--agent-dir":
        options.agentDir = resolve(requireValue(argv, ++index, "--agent-dir"));
        break;
      case "--period": {
        const value = requireValue(argv, ++index, "--period");
        if (!PERIODS.some((period) => period.id === value)) {
          throw new Error(`Unknown period: ${value}`);
        }
        options.period = value as PeriodId;
        break;
      }
      case "--sort": {
        const value = requireValue(argv, ++index, "--sort");
        if (value !== "cost" && value !== "tokens" && value !== "requests") {
          throw new Error(`Unknown sort metric: ${value}`);
        }
        options.sort = value;
        break;
      }
      case "--width": {
        const value = Number(requireValue(argv, ++index, "--width"));
        if (!Number.isFinite(value) || value < 40 || value > 400) throw new Error("--width must be 40–400");
        options.width = value;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

async function writeFileSafe(file: string, contents: string): Promise<void> {
  const target = resolve(file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents, "utf8");
}
