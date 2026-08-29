import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FlomoArgumentError } from '../errors.js';
import {
  activeMemos, ensureNonEmptyList, memoMatchesTag, memoRow, parseLimitArg, syncMemoCache,
} from '../flomo/memos.js';
import { runTool, type ToolContext } from './result.js';

export function registerMemos(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'flomo_memos',
    {
      description: '列出 memo（本地同步缓存）。支持 tag 前缀筛选、pinned 只看置顶。默认 60 秒内直接用缓存',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(500).optional().describe('返回条数，默认 20'),
        tag: z.string().optional().describe('按标签筛选（前缀匹配，如 读书 命中 读书/认知觉醒）'),
        pinned: z.boolean().optional().describe('只看置顶 memo'),
        sort: z.enum(['created', 'updated']).optional().describe('排序字段，倒序，默认 created'),
        refresh: z.boolean().optional().describe('强制增量同步后再返回'),
      }),
    },
    async (args) => runTool(async () => {
      const limit = parseLimitArg(args.limit, 20);
      const sortKey = args.sort ?? 'created';
      if (sortKey !== 'created' && sortKey !== 'updated') {
        throw new FlomoArgumentError(`sort 只能是 created 或 updated（got "${String(args.sort)}"）`);
      }
      const tagQuery = String(args.tag ?? '').trim().replace(/^#/, '');
      const cache = await syncMemoCache(ctx.client, ctx.store, { force: !!args.refresh });
      let list = activeMemos(cache);
      if (args.pinned) list = list.filter((m) => Number(m.pin) === 1);
      if (tagQuery) list = list.filter((m) => memoMatchesTag(m, tagQuery));
      const field = sortKey === 'created' ? 'created_at' : 'updated_at';
      list.sort((a, b) => String(b[field]).localeCompare(String(a[field])));
      ensureNonEmptyList(list, tagQuery
        ? `没有 memo 命中标签 "${tagQuery}"。看看 flomo_tags 里的可用标签`
        : '账号里还没有 memo');
      return list.slice(0, limit).map(memoRow);
    }),
  );
}
