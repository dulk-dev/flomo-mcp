import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FlomoEmptyError } from '../errors.js';
import { memoRow, syncMemoCache } from '../flomo/memos.js';
import { v1 } from '../flomo/types.js';
import { runTool, type ToolContext } from './result.js';

export function registerDaily(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'flomo_daily',
    {
      description: '每日回顾：flomo 服务端为今天挑选的回顾 memo 清单',
      inputSchema: z.object({}),
    },
    async () => runTool(async () => {
      const [slugs, cache] = await Promise.all([
        ctx.client.apiCall('GET', v1('/memo/notify_of_today/'), { dau_stat: '1' }),
        syncMemoCache(ctx.client, ctx.store),
      ]);
      const list = (Array.isArray(slugs) ? slugs : [])
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .map((slug) => cache.memos[slug])
        .filter((m) => m && !m.deleted_at);
      if (list.length === 0) {
        throw new FlomoEmptyError('今天没有回顾内容（回顾条数可在 flomo 网页版设置里调整）');
      }
      return list.map(memoRow);
    }),
  );
}
