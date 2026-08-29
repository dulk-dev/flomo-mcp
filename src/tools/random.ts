import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  activeMemos, ensureNonEmptyList, memoMatchesTag, memoRow, parseLimitArg, syncMemoCache,
} from '../flomo/memos.js';
import { runTool, type ToolContext } from './result.js';

export function registerRandom(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'flomo_random',
    {
      description: '随机漫步：随机抽取 memo 用于回顾（tag 可限定范围）',
      inputSchema: z.object({
        count: z.number().int().min(1).max(50).optional().describe('抽取条数，默认 3'),
        tag: z.string().optional().describe('限定标签范围（前缀匹配）'),
      }),
    },
    async (args) => runTool(async () => {
      const count = parseLimitArg(args.count, 3, { max: 50, label: 'count' });
      const tagQuery = String(args.tag ?? '').trim().replace(/^#/, '').toLowerCase();
      const cache = await syncMemoCache(ctx.client, ctx.store);
      let list = activeMemos(cache);
      if (tagQuery) list = list.filter((m) => memoMatchesTag(m, tagQuery));
      ensureNonEmptyList(list, tagQuery ? `没有 memo 命中标签 "${tagQuery}"` : '账号里还没有 memo');
      for (let i = 0; i < Math.min(count, list.length); i++) {
        const j = i + Math.floor(Math.random() * (list.length - i));
        const tmp = list[i];
        list[i] = list[j]!;
        list[j] = tmp!;
      }
      return list.slice(0, count).map(memoRow);
    }),
  );
}
