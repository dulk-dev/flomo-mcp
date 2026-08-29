import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { htmlToText, normalizeTags, parseLimitArg, syncMemoCache, trashedMemos, ensureNonEmptyList } from '../flomo/memos.js';
import { runTool, type ToolContext } from './result.js';

export function registerTrash(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'flomo_trash',
    {
      description: '回收站列表（恢复用 flomo_restore）',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(500).optional().describe('返回条数，默认 50'),
        refresh: z.boolean().optional().describe('强制增量同步后再返回'),
      }),
    },
    async (args) => runTool(async () => {
      const limit = parseLimitArg(args.limit, 50);
      const cache = await syncMemoCache(ctx.client, ctx.store, { force: !!args.refresh });
      const list = trashedMemos(cache);
      list.sort((a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at)));
      ensureNonEmptyList(list, '回收站是空的');
      return list.slice(0, limit).map((m) => ({
        slug: String(m.slug || ''),
        content: htmlToText(m.content),
        tags: normalizeTags(m.tags),
        deleted_at: String(m.deleted_at || ''),
        created_at: String(m.created_at || ''),
      }));
    }),
  );
}
