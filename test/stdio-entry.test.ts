import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

function childEnv(dataDir: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  delete env.MCP_API_KEY;
  env.FLOMO_ACCESS_TOKEN = 'stdio-test-token';
  env.FLOMO_ACCOUNT = '';
  env.FLOMO_PASSWORD = '';
  env.FLOMO_DATA_DIR = dataDir;
  env.FLOMO_SYNC_INTERVAL_MS = '0';
  return env;
}

describe('stdio 入口', () => {
  const dirs: string[] = [];

  afterAll(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('不需要 MCP_API_KEY，能列出工具', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'flomo-mcp-'));
    dirs.push(dataDir);
    const transport = new StdioClientTransport({
      command: path.join(process.cwd(), 'node_modules/.bin/tsx'),
      args: ['src/index.ts'],
      cwd: process.cwd(),
      env: childEnv(dataDir),
      stderr: 'pipe',
    });
    const client = new Client({ name: 'flomo-mcp-test', version: '0' });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
        'flomo_daily',
        'flomo_delete',
        'flomo_edit',
        'flomo_get',
        'flomo_insight',
        'flomo_memos',
        'flomo_new',
        'flomo_pin',
        'flomo_random',
        'flomo_related',
        'flomo_restore',
        'flomo_revisions',
        'flomo_search',
        'flomo_stats',
        'flomo_tag_pin',
        'flomo_tag_rename',
        'flomo_tag_unpin',
        'flomo_tags',
        'flomo_trash',
        'flomo_unpin',
        'flomo_upload',
        'flomo_whoami',
      ]);
    } finally {
      await client.close();
    }
  }, 20_000);
});
