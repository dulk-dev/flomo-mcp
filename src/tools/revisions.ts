import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FlomoEmptyError } from '../errors.js';
import { htmlToText, requireSlugArg } from '../flomo/memos.js';
import { v1 } from '../flomo/types.js';
import { runTool, type ToolContext } from './result.js';

export function registerRevisions(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'flomo_revisions',
    {
      description: '查看 memo 的历史版本（每次编辑的 before/after 快照，字段是 old_value/new_value）',
      inputSchema: z.object({
        slug: z.string().describe('memo slug'),
        full: z.boolean().optional().describe('输出完整内容（默认截断 120 字符）'),
      }),
    },
    async (args) => runTool(async () => {
      const slug = requireSlugArg(args.slug);
      const data = await ctx.client.apiCall('GET', v1(`/memo/${encodeURIComponent(slug)}/revisions`), {});
      const list = Array.isArray(data) ? data : [];
      if (list.length === 0) throw new FlomoEmptyError(`memo "${slug}" 没有历史版本（从未被编辑过）`);
      const clip = (html: unknown) => {
        const text = htmlToText(html ?? '');
        return args.full ? text : (text.length > 120 ? `${text.slice(0, 120)}…` : text);
      };
      return list.map((rev, idx) => {
        const rec = rev && typeof rev === 'object' ? rev as Record<string, unknown> : {};
        return {
          seq: idx + 1,
          edited_at: rec.created_at2 ?? rec.created_at ?? '',
          before: clip(rec.old_value),
          after: clip(rec.new_value),
        };
      });
    }),
  );
}
