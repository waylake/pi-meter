import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import type { ScanResult, ScanWarning, SessionUsage, UsageKind, UsageRecord } from "./types.ts";

const CACHE_VERSION = 1;
const MAX_FILE_BYTES = 128 * 1024 * 1024;

interface CacheEntry {
  size: number;
  mtimeMs: number;
  session: SessionUsage;
}

interface CacheFile {
  version: number;
  entries: Record<string, CacheEntry>;
}

export interface ScanOptions {
  /** Override discovered session roots. */
  roots?: string[];
  /** Pi agent dir. Defaults to PI_CODING_AGENT_DIR or ~/.pi/agent. */
  agentDir?: string;
  /** Cache file. Defaults to <agentDir>/pi-meter/session-cache-v1.json. */
  cacheFile?: string;
  useCache?: boolean;
}

export function resolveAgentDir(): string {
  return resolve(process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent"));
}

export function discoverSessionRoots(agentDir = resolveAgentDir()): string[] {
  const explicit = process.env.PI_METER_SESSION_DIR ?? process.env.PI_CODING_AGENT_SESSION_DIR;
  const roots: string[] = [];
  if (explicit?.trim()) {
    for (const part of explicit.split(delimiter)) {
      if (part.trim()) roots.push(resolve(part.trim()));
    }
  }
  if (roots.length === 0) roots.push(join(agentDir, "sessions"));
  return unique(roots);
}

export function defaultCacheFile(agentDir = resolveAgentDir()): string {
  return join(process.env.PI_METER_CACHE_DIR?.trim() || join(agentDir, "pi-meter"), "session-cache-v1.json");
}

export async function scanSessions(options: ScanOptions = {}): Promise<ScanResult> {
  const started = performance.now();
  const agentDir = options.agentDir ?? resolveAgentDir();
  const roots = unique((options.roots ?? discoverSessionRoots(agentDir)).map((root) => resolve(root)));
  const cacheFile = options.cacheFile ?? defaultCacheFile(agentDir);
  const useCache = options.useCache !== false && process.env.PI_METER_CACHE !== "0";
  const warnings: ScanWarning[] = [];

  const cache = useCache ? await loadCache(cacheFile) : emptyCache();
  const nextCache = emptyCache();
  const files: Array<{ path: string; size: number; mtimeMs: number }> = [];
  const seen = new Set<string>();

  for (const root of roots) {
    if (!existsSync(root)) {
      warnings.push({ message: `Session root not found: ${root}` });
      continue;
    }
    const discovered = await walk(root, 0, warnings);
    for (const file of discovered) {
      if (seen.has(file)) continue;
      seen.add(file);
      try {
        const info = await stat(file);
        if (!info.isFile()) continue;
        files.push({ path: file, size: info.size, mtimeMs: info.mtimeMs });
      } catch (error) {
        warnings.push({ file, message: `Cannot stat session: ${errorMessage(error)}` });
      }
    }
  }

  const sessions: SessionUsage[] = [];
  let filesScanned = 0;
  let filesReused = 0;

  for (const file of files) {
    const cached = cache.entries[file.path];
    if (cached && cached.size === file.size && cached.mtimeMs === file.mtimeMs) {
      sessions.push(cached.session);
      nextCache.entries[file.path] = cached;
      filesReused++;
      continue;
    }

    try {
      const session = await parseSessionFile(file.path);
      sessions.push(session);
      nextCache.entries[file.path] = { size: file.size, mtimeMs: file.mtimeMs, session };
      filesScanned++;
    } catch (error) {
      warnings.push({ file: file.path, message: `Cannot parse session: ${errorMessage(error)}` });
    }
  }

  sessions.sort((a, b) => b.lastActivityAt - a.lastActivityAt);

  if (useCache) {
    try {
      await saveCache(cacheFile, nextCache);
    } catch (error) {
      warnings.push({ file: cacheFile, message: `Cannot write session cache: ${errorMessage(error)}` });
    }
  }

  return {
    sessions,
    roots,
    scannedAt: Date.now(),
    durationMs: performance.now() - started,
    filesScanned,
    filesReused,
    warnings,
  };
}

export async function parseSessionFile(file: string): Promise<SessionUsage> {
  const info = await stat(file);
  if (info.size > MAX_FILE_BYTES) {
    throw new Error(`Session is larger than ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MiB`);
  }
  const text = await readFile(file, "utf8");
  return parseSessionText(text, file);
}

export function parseSessionText(text: string, file = "session.jsonl"): SessionUsage {
  const lines = text.split(/\r?\n/);
  let cwd = "";
  let sessionId = "";
  let parentSession: string | undefined;
  let startedAt = 0;
  let lastActivityAt = 0;
  let currentProvider = "";
  let currentModel = "";
  let name: string | undefined;
  const records: UsageRecord[] = [];
  const entryIds = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      // A live session can end with a partially written line. Keep everything before it.
      continue;
    }
    if (!entry || typeof entry !== "object") continue;

    const entryTimestamp = parseTimestamp(entry.timestamp);
    if (entryTimestamp !== undefined) {
      lastActivityAt = Math.max(lastActivityAt, entryTimestamp);
      if (!startedAt) startedAt = entryTimestamp;
    }

    if (entry.type === "session") {
      cwd = typeof entry.cwd === "string" ? entry.cwd : cwd;
      sessionId = typeof entry.id === "string" ? entry.id : sessionId;
      parentSession = typeof entry.parentSession === "string" ? entry.parentSession : parentSession;
      if (entryTimestamp !== undefined && !startedAt) startedAt = entryTimestamp;
      continue;
    }

    if (entry.type === "session_info") {
      if (typeof entry.name === "string" && entry.name.trim()) name = entry.name.trim();
      continue;
    }

    if (entry.type === "model_change") {
      if (typeof entry.provider === "string") currentProvider = entry.provider;
      if (typeof entry.modelId === "string") currentModel = entry.modelId;
      continue;
    }

    const entryId = typeof entry.id === "string" ? entry.id : undefined;
    if (entryId && entryIds.has(entryId)) continue;

    if (entry.type === "message") {
      const message = asRecord(entry.message);
      if (!message || message.role !== "assistant") continue;
      const usage = asRecord(message.usage);
      if (!usage) continue;
      const timestamp = numberValue(message.timestamp) ?? entryTimestamp;
      if (timestamp === undefined) continue;
      records.push(
        makeRecord({
          entryId,
          kind: "assistant",
          timestamp,
          provider: stringValue(message.provider) || currentProvider || "unknown",
          model: stringValue(message.model) || currentModel || "unknown",
          usage,
          durationMs: numberValue(message.durationMs),
          stopReason: stringValue(message.stopReason),
        }),
      );
      if (entryId) entryIds.add(entryId);
      continue;
    }

    if (entry.type === "usage" || entry.type === "compaction" || entry.type === "branch_summary") {
      const usage = asRecord(entry.usage);
      if (!usage) continue;
      const timestamp = entryTimestamp;
      if (timestamp === undefined) continue;
      const kind: UsageKind =
        entry.type === "usage" ? "usage" : entry.type === "compaction" ? "compaction" : "branch_summary";
      records.push(
        makeRecord({
          entryId,
          kind,
          timestamp,
          provider: stringValue(entry.provider) || currentProvider || "unknown",
          model: stringValue(entry.model) || currentModel || "unknown",
          usage,
          durationMs: numberValue(entry.durationMs),
          stopReason: stringValue(entry.stopReason),
        }),
      );
      if (entryId) entryIds.add(entryId);
    }
  }

  const fallbackId = sessionIdFromFilename(file);
  const finalId = sessionId || fallbackId || basename(file, ".jsonl");
  const finalStartedAt = startedAt || Date.now();
  const finalLastActivity = Math.max(lastActivityAt, finalStartedAt, ...records.map((record) => record.timestamp));

  return {
    id: finalId,
    file,
    cwd,
    ...(name ? { name } : {}),
    ...(parentSession ? { parentSession } : {}),
    startedAt: finalStartedAt,
    lastActivityAt: finalLastActivity,
    records,
  };
}

interface RecordInput {
  entryId?: string;
  kind: UsageKind;
  timestamp: number;
  provider: string;
  model: string;
  usage: Record<string, unknown>;
  durationMs?: number;
  stopReason?: string;
}

function makeRecord(input: RecordInput): UsageRecord {
  const usage = input.usage;
  const inputTokens = numberValue(usage.input) ?? 0;
  const outputTokens = numberValue(usage.output) ?? 0;
  const cacheReadTokens = numberValue(usage.cacheRead) ?? numberValue(usage.cache_read) ?? 0;
  const cacheWriteTokens = numberValue(usage.cacheWrite) ?? numberValue(usage.cache_write) ?? 0;
  const reasoningTokens = numberValue(usage.reasoning) ?? 0;
  const derivedTotal = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  const totalTokens = Math.max(numberValue(usage.totalTokens) ?? 0, derivedTotal);
  const cost = asRecord(usage.cost);
  const costUSD = cost
    ? numberValue(cost.total) ?? numberValue(cost.totalFromProvider) ?? sumCost(cost) ?? 0
    : numberValue(usage.cost) ?? 0;

  return {
    ...(input.entryId ? { entryId: input.entryId } : {}),
    kind: input.kind,
    timestamp: input.timestamp,
    provider: input.provider,
    model: input.model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    totalTokens,
    costUSD: Number.isFinite(costUSD) && costUSD >= 0 ? costUSD : 0,
    requestCount: 1,
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    ...(input.stopReason ? { stopReason: input.stopReason } : {}),
  };
}

function sumCost(cost: Record<string, unknown>): number | undefined {
  const parts = ["input", "output", "cacheRead", "cacheWrite"]
    .map((key) => numberValue(cost[key]) ?? 0);
  const total = parts.reduce((sum, value) => sum + value, 0);
  return total > 0 ? total : undefined;
}

async function walk(root: string, depth: number, warnings: ScanWarning[]): Promise<string[]> {
  if (depth > 4) return [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    warnings.push({ message: `Cannot read session directory ${root}: ${errorMessage(error)}` });
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full, depth + 1, warnings)));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(full);
    }
  }
  return files;
}

function sessionIdFromFilename(file: string): string | undefined {
  const name = basename(file, ".jsonl");
  const match = name.match(/_([0-9a-f]{8}-[0-9a-f-]{27,})$/i);
  return match?.[1];
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 10_000_000_000 ? value * 1_000 : value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptyCache(): CacheFile {
  return { version: CACHE_VERSION, entries: {} };
}

async function loadCache(file: string): Promise<CacheFile> {
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as CacheFile;
    if (parsed.version !== CACHE_VERSION || !parsed.entries || typeof parsed.entries !== "object") {
      return emptyCache();
    }
    return parsed;
  } catch {
    return emptyCache();
  }
}

async function saveCache(file: string, cache: CacheFile): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(cache), { encoding: "utf8", mode: 0o600 });
  await rename(temp, file);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
