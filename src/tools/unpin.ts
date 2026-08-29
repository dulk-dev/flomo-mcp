import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { htmlToText, invalidateMemoCacheFreshness, memoUrl, requireSlugArg } from '../flomo/memos.js';
import { v1 } from '../flomo/types.js';
import { runTool, type ToolContext } from './result.js';

export function registerUnpin(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'flomo_unpin',
    {
      description: '取消置顶 memo',
      inputSchema: z.object({
        slug: z.string().describe('memo slug'),
      }),
    },
    async (args) => runTool(async () => {
      const slug = requireSlugArg(args.slug);
      const current = await ctx.client.apiCall('GET', v1(`/memo/${encodeURIComponent(slug)}`), {});
      await ctx.client.apiCall('POST', v1(`/memo/${encodeURIComponent(slug)}/unpin`), {});
      await invalidateMemoCacheFreshness(ctx.store);
      const rec = current && typeof current === 'object' ? current as { content?: unknown } : {};
      return [{
        slug,
        pinned: false,
        preview: htmlToText(rec.content ?? '').slice(0, 60),
        url: memoUrl(slug),
      }];
    }),
  );
}
