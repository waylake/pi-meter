import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Credential } from "./types.ts";

const COMMAND_PREFIX = "!";

export async function readPiAuth(agentDir: string): Promise<Record<string, unknown>> {
  return (await readJson(join(agentDir, "auth.json"))) ?? {};
}

export async function readPiModels(agentDir: string): Promise<Record<string, unknown>> {
  return (await readJson(join(agentDir, "models.json"))) ?? {};
}

export async function credentialForProvider(
  agentDir: string,
  env: NodeJS.ProcessEnv,
  providerIds: string[],
  envKeys: string[],
): Promise<Credential | undefined> {
  for (const key of envKeys) {
    const value = env[key]?.trim();
    if (value && !value.startsWith(COMMAND_PREFIX)) {
      return { type: "api_key", value, source: `env:${key}` };
    }
  }

  const auth = await readPiAuth(agentDir);
  for (const providerId of providerIds) {
    const entry = asRecord(auth[providerId]);
    if (!entry) continue;
    const credential = credentialFromEntry(entry, `pi auth.json:${providerId}`, env);
    if (credential) return credential;
  }

  const models = await readPiModels(agentDir);
  const providers = asRecord(models.providers);
  for (const providerId of providerIds) {
    const entry = asRecord(providers?.[providerId]);
    const key = resolveKeyValue(entry?.apiKey, env);
    if (key) {
      return { type: "api_key", value: key, source: `pi models.json:${providerId}` };
    }
  }

  return undefined;
}

export async function credentialFromCodex(
  env: NodeJS.ProcessEnv,
): Promise<Credential | undefined> {
  const envToken = env.PI_METER_CODEX_ACCESS_TOKEN?.trim() || env.CODEX_ACCESS_TOKEN?.trim();
  const accountEnv = env.PI_METER_CODEX_ACCOUNT_ID?.trim() || env.CHATGPT_ACCOUNT_ID?.trim();
  if (envToken) {
    return {
      type: "oauth",
      value: envToken,
      ...(accountEnv ? { accountId: accountEnv } : {}),
      source: "env:CODEX_ACCESS_TOKEN",
    };
  }

  const codexHome = env.CODEX_HOME?.trim() || join(homedir(), ".codex");
  const auth = await readJson(join(codexHome, "auth.json"));
  const tokens = asRecord(auth?.tokens);
  const access = typeof tokens?.access_token === "string" ? tokens.access_token.trim() : "";
  const accountId = typeof tokens?.account_id === "string" ? tokens.account_id.trim() : "";
  if (access) {
    return {
      type: "oauth",
      value: access,
      ...(accountId ? { accountId } : {}),
      source: `${codexHome}/auth.json`,
    };
  }
  return undefined;
}

export async function credentialFromClaudeCode(
  agentDir: string,
  env: NodeJS.ProcessEnv,
): Promise<Credential | undefined> {
  for (const key of ["PI_METER_CLAUDE_ACCESS_TOKEN", "CLAUDE_OAUTH_TOKEN", "ANTHROPIC_OAUTH_TOKEN"]) {
    const value = env[key]?.trim();
    if (value) return { type: "oauth", value, source: `env:${key}` };
  }

  const piCredential = await credentialForProvider(agentDir, env, ["anthropic"], []);
  if (piCredential?.type === "oauth") return piCredential;

  const claudeDir = env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude");
  const credentials = await readJson(join(claudeDir, ".credentials.json"));
  const oauth = asRecord(credentials?.claudeAiOauth);
  const access =
    (typeof oauth?.accessToken === "string" && oauth.accessToken.trim()) ||
    (typeof credentials?.accessToken === "string" && credentials.accessToken.trim()) ||
    "";
  if (access) {
    return { type: "oauth", value: access, source: `${claudeDir}/.credentials.json` };
  }
  return undefined;
}

export async function credentialFromOpenCode(
  agentDir: string,
  env: NodeJS.ProcessEnv,
): Promise<Credential | undefined> {
  const fromPi = await credentialForProvider(
    agentDir,
    env,
    ["opencode-go", "opencode"],
    ["OPENCODE_GO_API_KEY", "OPENCODE_API_KEY"],
  );
  if (fromPi) return fromPi;

  const dataHome = env.XDG_DATA_HOME?.trim() || join(homedir(), ".local", "share");
  const auth = await readJson(join(resolve(dataHome), "opencode", "auth.json"));
  for (const providerId of ["opencode-go", "opencode"]) {
    const entry = asRecord(auth?.[providerId]);
    if (!entry) continue;
    const key = typeof entry.key === "string" ? entry.key.trim() : "";
    if (key) return { type: "api_key", value: key, source: `opencode auth.json:${providerId}` };
    const access = typeof entry.access === "string" ? entry.access.trim() : "";
    if (access) return { type: "oauth", value: access, source: `opencode auth.json:${providerId}` };
  }
  return undefined;
}

export async function credentialFromNeuralwatt(
  agentDir: string,
  env: NodeJS.ProcessEnv,
): Promise<Credential | undefined> {
  return credentialForProvider(agentDir, env, ["neuralwatt"], ["NEURALWATT_API_KEY"]);
}

function credentialFromEntry(
  entry: Record<string, unknown>,
  source: string,
  env: NodeJS.ProcessEnv,
): Credential | undefined {
  const type = entry.type;
  if (type === "api_key") {
    const key = resolveKeyValue(entry.key, env);
    if (key) return { type: "api_key", value: key, source };
    return undefined;
  }
  if (type === "oauth") {
    const access = typeof entry.access === "string" ? entry.access.trim() : "";
    if (access) {
      const accountId =
        (typeof entry.accountId === "string" && entry.accountId) ||
        (typeof entry.account_id === "string" && entry.account_id) ||
        undefined;
      return {
        type: "oauth",
        value: access,
        ...(accountId ? { accountId } : {}),
        source,
      };
    }
  }
  return undefined;
}

/**
 * pi models.json allows `$VAR` / `${VAR}` references and `!command` shell lookups.
 * Resolve plain references; never execute commands from a usage reader.
 */
function resolveKeyValue(value: unknown, env: NodeJS.ProcessEnv): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith(COMMAND_PREFIX)) return undefined;
  const match = trimmed.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$|^\$([A-Za-z_][A-Za-z0-9_]*)$/);
  if (!match) return trimmed;
  const name = match[1] ?? match[2] ?? "";
  const resolved = env[name]?.trim();
  return resolved && !resolved.startsWith(COMMAND_PREFIX) ? resolved : undefined;
}

async function readJson(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return asRecord(parsed);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
