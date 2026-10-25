import path from "node:path";
import { SYNC_FRESH_MS } from "./flomo/memos.js";
import type { FlomoCredentials } from "./flomo/types.js";

/** Memo / token files. Override with FLOMO_DATA_DIR. */
export const DEFAULT_DATA_DIR = "/workspace/cache/flomo-cache";

export type AppConfig = {
  dataDir: string;
  credentials: FlomoCredentials;
  /** 0 disables the in-process interval. Startup still forces one round. */
  syncIntervalMs: number;
};

export type EnvLike = Record<string, string | undefined>;

export function parseCredentials(
  env: EnvLike,
): FlomoCredentials | { error: string } {
  const accessToken = env.FLOMO_ACCESS_TOKEN?.trim() ?? "";
  const account = env.FLOMO_ACCOUNT?.trim() ?? "";
  const password = env.FLOMO_PASSWORD ?? "";
  const placeholderAccount = /your_phone_or_email_here/.test(account);
  const placeholderPassword = /your_password_here/.test(password);
  const usablePassword = Boolean(
    account && password && !placeholderAccount && !placeholderPassword,
  );
  if (!accessToken && !usablePassword) {
    return {
      error: "需要 FLOMO_ACCESS_TOKEN，或 FLOMO_ACCOUNT + FLOMO_PASSWORD。",
    };
  }
  return {
    accessToken: accessToken || null,
    account: usablePassword ? account : null,
    password: usablePassword ? password : null,
  };
}

export function resolveDataDir(raw: string | undefined): string {
  const dir = raw?.trim();
  return path.resolve(dir || DEFAULT_DATA_DIR);
}

/** Unset keeps the fresh-window length. `0` or `off` disables the interval. */
export function parseSyncIntervalMs(
  raw: string | undefined,
): number | { error: string } {
  if (raw == null || raw.trim() === "") return SYNC_FRESH_MS;
  const text = raw.trim();
  if (text === "0" || text.toLowerCase() === "off") return 0;
  if (!/^\d+$/.test(text)) {
    return {
      error: `FLOMO_SYNC_INTERVAL_MS 无效: ${raw}（正整数毫秒，或 0 / off 关闭）`,
    };
  }
  const ms = Number(text);
  if (!Number.isSafeInteger(ms)) {
    return { error: `FLOMO_SYNC_INTERVAL_MS 无效: ${raw}` };
  }
  return ms;
}

export function loadConfig(env: EnvLike = process.env): AppConfig {
  const credentials = parseCredentials(env);
  if ("error" in credentials) {
    process.stderr.write(`${credentials.error}\n`);
    process.exit(1);
  }
  const syncIntervalMs = parseSyncIntervalMs(env.FLOMO_SYNC_INTERVAL_MS);
  if (typeof syncIntervalMs !== "number") {
    process.stderr.write(`${syncIntervalMs.error}\n`);
    process.exit(1);
  }
  return {
    dataDir: resolveDataDir(env.FLOMO_DATA_DIR),
    credentials,
    syncIntervalMs,
  };
}
