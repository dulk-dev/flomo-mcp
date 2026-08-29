import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FlomoArgumentError } from '../errors.js';
import {
  activeMemos, ensureNonEmptyList, fetchAllTags, normalizeTags, parseLimitArg, syncMemoCache,
} from '../flomo/memos.js';
import { runTool, type ToolContext } from './result.js';

export function registerTags(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'flomo_tags',
    {
      description: '标签列表（含层级、每个标签的 memo 数、置顶状态、emoji 图标）。口径与网页侧栏一致：从 memo 派生完整标签树',
      inputSchema: z.object({
        pinned: z.boolean().optional().describe('只看置顶标签'),
        limit: z.number().int().min(1).max(500).optional().describe('返回条数，默认 100'),
        sort: z.enum(['count', 'name']).optional().describe('排序：count（memo 数）或 name，默认 count'),
      }),
    },
    async (args) => runTool(async () => {
      const limit = parseLimitArg(args.limit, 100);
      const sortKey = args.sort ?? 'count';
      if (sortKey !== 'count' && sortKey !== 'name') {
        throw new FlomoArgumentError(`sort 只能是 count 或 name（got "${String(args.sort)}"）`);
      }
      const cache = await syncMemoCache(ctx.client, ctx.store);
      const officialTags = await fetchAllTags(ctx.client);
      const meta = new Map(officialTags.map((t) => [String(t.name || ''), t]));
      const counts = new Map<string, number>();
      const lastUsed = new Map<string, string>();
      for (const memo of activeMemos(cache)) {
        const created = String(memo.created_at || '');
        const seen = new Set<string>();
        for (const t of normalizeTags(memo.tags).split(', ').filter(Boolean)) {
          const parts = t.split('/');
          for (let i = 1; i <= parts.length; i++) seen.add(parts.slice(0, i).join('/'));
        }
        for (const t of seen) {
          counts.set(t, (counts.get(t) || 0) + 1);
          if (created > (lastUsed.get(t) || '')) lastUsed.set(t, created);
        }
      }
      let rows = [...counts.keys()].map((tag) => ({
        tag,
        memoCount: counts.get(tag) ?? 0,
        pinned: Number(meta.get(tag)?.pin) === 1,
        icon: meta.get(tag)?.icon_value ? String(meta.get(tag)?.icon_value) : '',
        lastUsedAt: lastUsed.get(tag) || '',
      }));
      if (args.pinned) rows = rows.filter((r) => r.pinned);
      rows.sort(sortKey === 'name'
        ? (a, b) => a.tag.localeCompare(b.tag, 'zh')
        : (a, b) => b.memoCount - a.memoCount || a.tag.localeCompare(b.tag, 'zh'));
      ensureNonEmptyList(rows, args.pinned ? '没有置顶标签' : '账号里还没有标签');
      return rows.slice(0, limit);
    }),
  );
}
