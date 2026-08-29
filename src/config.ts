import path from 'node:path';
import type { FlomoCredentials } from './flomo/types.js';

export type AppConfig = {
  mcpApiKey: string;
  port: number;
  host: string;
  dataDir: string;
  credentials: FlomoCredentials;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const mcpApiKey = env.MCP_API_KEY?.trim() ?? '';
  if (!mcpApiKey) {
    process.stderr.write('MCP_API_KEY 为空，拒绝启动。请在 .env 里设置。\n');
    process.exit(1);
  }

  const portRaw = env.PORT?.trim() || '8787';
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write(`PORT 无效: ${portRaw}\n`);
    process.exit(1);
  }

  const host = env.HOST?.trim() || '127.0.0.1';
  const dataDir = path.resolve(env.FLOMO_DATA_DIR?.trim() || './data');

  const accessToken = env.FLOMO_ACCESS_TOKEN?.trim() ?? '';
  const account = env.FLOMO_ACCOUNT?.trim() ?? '';
  const password = env.FLOMO_PASSWORD ?? '';
  const placeholderAccount = /your_phone_or_email_here/.test(account);
  const placeholderPassword = /your_password_here/.test(password);

  const usablePassword = account && password && !placeholderAccount && !placeholderPassword;
  if (!accessToken && !usablePassword) {
    process.stderr.write('需要 FLOMO_ACCESS_TOKEN，或 FLOMO_ACCOUNT + FLOMO_PASSWORD。\n');
    process.exit(1);
  }
  const credentials: FlomoCredentials = {
    accessToken: accessToken || null,
    account: usablePassword ? account : null,
    password: usablePassword ? password : null,
  };

  return { mcpApiKey, port, host, dataDir, credentials };
}
