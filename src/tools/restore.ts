import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FlomoArgumentError } from '../errors.js';
import { htmlToText, invalidateMemoCacheFreshness, memoUrl, requireSlugArg, syncMemoCache } from '../flomo/memos.js';
import { v1 } from '../flomo/types.js';
import { runTool, type ToolContext } from './result.js';

export function registerRestore(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'flomo_restore',
    {
      description: '从回收站恢复 memo',
      inputSchema: z.object({
        slug: z.string().describe('回收站里的 memo slug（见 flomo_trash）'),
      }),
    },
    async (args) => runTool(async () => {
      const slug = requireSlugArg(args.slug);
      const cache = await syncMemoCache(ctx.client, ctx.store);
      const cached = cache.memos[slug];
      if (cached && !cached.deleted_at) {
        throw new FlomoArgumentError(`memo "${slug}" 不在回收站里，无需恢复`);
      }
      await ctx.client.apiCall('POST', v1(`/memo/${encodeURIComponent(slug)}/restore`), {});
      await invalidateMemoCacheFreshness(ctx.store);
      return [{
        slug,
        restored: true,
        preview: cached ? htmlToText(cached.content).slice(0, 60) : '',
        url: memoUrl(slug),
      }];
    }),
  );
}
