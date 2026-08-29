import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  activeMemos, ensureNonEmptyList, filterSearchHits, memoRow, parseLimitArg, parseSearchWords, syncMemoCache,
} from '../flomo/memos.js';
import { runTool, type ToolContext } from './result.js';

export function registerSearch(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'flomo_search',
    {
      description: '全文搜索 memo（内容+标签，大小写不敏感，多关键词 AND）',
      inputSchema: z.object({
        keyword: z.string().describe('关键词；空格分隔多词为 AND'),
        tag: z.string().optional().describe('限定标签范围（前缀匹配）'),
        limit: z.number().int().min(1).max(500).optional().describe('返回条数，默认 20'),
        refresh: z.boolean().optional().describe('强制增量同步后再搜'),
      }),
    },
    async (args) => runTool(async () => {
      const words = parseSearchWords(args.keyword);
      const limit = parseLimitArg(args.limit, 20);
      const cache = await syncMemoCache(ctx.client, ctx.store, { force: !!args.refresh });
      const hits = filterSearchHits(activeMemos(cache), args.keyword, args.tag ?? '');
      hits.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      ensureNonEmptyList(hits, `没有 memo 同时包含：${words.join('、')}`);
      return hits.slice(0, limit).map(memoRow);
    }),
  );
}
