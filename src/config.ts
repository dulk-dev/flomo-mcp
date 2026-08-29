import path from "node:path";
import type { FlomoCredentials } from "./flomo/types.js";

export type AppConfig = {
  mcpApiKey: string;
  port: number;
  host: string;
  dataDir: string;
  credentials: FlomoCredentials;
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

export function loadConfig(env: EnvLike = process.env): AppConfig {
  const mcpApiKey = env.MCP_API_KEY?.trim() ?? "";
  if (!mcpApiKey) {
    process.stderr.write("MCP_API_KEY 为空，拒绝启动。请在 .env 里设置。\n");
    process.exit(1);
  }

  const portRaw = env.PORT?.trim() || "8787";
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write(`PORT 无效: ${portRaw}\n`);
    process.exit(1);
  }

  const host = env.HOST?.trim() || "127.0.0.1";
  const dataDir = path.resolve(env.FLOMO_DATA_DIR?.trim() || "./data");
  const credentials = parseCredentials(env);
  if ("error" in credentials) {
    process.stderr.write(`${credentials.error}\n`);
    process.exit(1);
  }

  return { mcpApiKey, port, host, dataDir, credentials };
}
