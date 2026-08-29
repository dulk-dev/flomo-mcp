import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { htmlToText, invalidateMemoCacheFreshness, memoUrl, requireSlugArg } from '../flomo/memos.js';
import { v1 } from '../flomo/types.js';
import { runTool, type ToolContext } from './result.js';

export function registerPin(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'flomo_pin',
    {
      description: '置顶 memo（全局仅一条置顶。已有置顶时不加 force 会报错）',
      inputSchema: z.object({
        slug: z.string().describe('memo slug'),
        force: z.boolean().optional().describe('已有置顶时替换之'),
      }),
    },
    async (args) => runTool(async () => {
      const slug = requireSlugArg(args.slug);
      const current = await ctx.client.apiCall('GET', v1(`/memo/${encodeURIComponent(slug)}`), {});
      const body = args.force ? { force: 1 } : {};
      await ctx.client.apiCall('POST', v1(`/memo/${encodeURIComponent(slug)}/pin`), body);
      await invalidateMemoCacheFreshness(ctx.store);
      const rec = current && typeof current === 'object' ? current as { content?: unknown } : {};
      return [{
        slug,
        pinned: true,
        preview: htmlToText(rec.content ?? '').slice(0, 60),
        url: memoUrl(slug),
      }];
    }),
  );
}
