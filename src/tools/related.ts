import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FlomoEmptyError } from '../errors.js';
import { htmlToText, memoUrl, normalizeTags, parseLimitArg, requireSlugArg } from '../flomo/memos.js';
import { v1 } from '../flomo/types.js';
import { runTool, type ToolContext } from './result.js';

export function registerRelated(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'flomo_related',
    {
      description: '相关笔记：基于语义相似度推荐与指定 memo 关联的笔记（slug 在 item.memo.slug）',
      inputSchema: z.object({
        slug: z.string().describe('基准 memo 的 slug'),
        limit: z.number().int().min(1).max(50).optional().describe('返回条数，默认 10'),
        exclude_same_tag: z.boolean().optional().describe('排除同标签笔记（发现跨领域关联）'),
      }),
    },
    async (args) => runTool(async () => {
      const slug = requireSlugArg(args.slug);
      const limit = parseLimitArg(args.limit, 10, { max: 50 });
      const list = await ctx.client.apiCall('GET', v1(`/memo/${encodeURIComponent(slug)}/recommended`), {
        type: '1',
        no_same_tag: args.exclude_same_tag ? '1' : '0',
      });
      if (!Array.isArray(list) || list.length === 0) {
        throw new FlomoEmptyError(`memo "${slug}" 暂无相关笔记推荐（笔记太少或刚创建索引未生效）`);
      }
      return list.slice(0, limit).map((item) => {
        const rec = item && typeof item === 'object' ? item as Record<string, unknown> : {};
        const memo = rec.memo && typeof rec.memo === 'object' ? rec.memo as Record<string, unknown> : {};
        const s = String(memo.slug || '');
        return {
          slug: s,
          similarity: Math.round(Number(rec.similarity || 0) * 1000) / 1000,
          content: htmlToText(memo.content),
          tags: normalizeTags(memo.tags),
          created_at: String(memo.created_at || ''),
          url: memoUrl(s),
        };
      });
    }),
  );
}
