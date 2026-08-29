import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FlomoEmptyError } from '../errors.js';
import { asMemo, htmlToText, invalidateMemoCacheFreshness, requireSlugArg, syncMemoCache } from '../flomo/memos.js';
import { v1, v2 } from '../flomo/types.js';
import { runTool, type ToolContext } from './result.js';

export function registerDelete(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'flomo_delete',
    {
      description: '删除 memo（进回收站，可用 flomo_restore 恢复）',
      inputSchema: z.object({
        slug: z.string().describe('memo 的 slug'),
      }),
    },
    async (args) => runTool(async () => {
      const slug = requireSlugArg(args.slug);
      let current;
      try {
        current = asMemo(await ctx.client.apiCall('GET', v1(`/memo/${encodeURIComponent(slug)}`), {}));
      } catch (error) {
        const cache = await syncMemoCache(ctx.client, ctx.store).catch(() => null);
        const cached = cache?.memos?.[slug];
        if (cached?.deleted_at) {
          return [{
            slug,
            deleted: true,
            preview: htmlToText(cached.content).slice(0, 60),
            message: `已在回收站（${cached.deleted_at}），无需重复删除`,
          }];
        }
        throw error;
      }
      if (!current?.slug) throw new FlomoEmptyError(`memo "${slug}" 不存在`);
      await ctx.client.apiCall('DELETE', v2(`/memo/${encodeURIComponent(slug)}`), {}, { useBody: false });
      await invalidateMemoCacheFreshness(ctx.store);
      return [{
        slug,
        deleted: true,
        preview: htmlToText(current.content).slice(0, 60),
        message: `已移入回收站。恢复：flomo_restore slug=${slug}`,
      }];
    }),
  );
}
