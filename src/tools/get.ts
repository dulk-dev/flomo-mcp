import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FlomoEmptyError } from '../errors.js';
import { asMemo, htmlToText, memoUrl, normalizeImages, normalizeTags, requireSlugArg, syncMemoCache } from '../flomo/memos.js';
import { v1 } from '../flomo/types.js';
import { runTool, type ToolContext } from './result.js';

export function registerGet(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'flomo_get',
    {
      description: '查看单条 memo 详情（实时数据，含原始 HTML 与置顶/引用数）。回收站条目会回落本地缓存',
      inputSchema: z.object({
        slug: z.string().describe('memo 的 slug（列表工具的 slug 字段）'),
      }),
    },
    async (args) => runTool(async () => {
      const slug = requireSlugArg(args.slug);
      let memo;
      try {
        memo = asMemo(await ctx.client.apiCall('GET', v1(`/memo/${encodeURIComponent(slug)}`), {}));
      } catch (error) {
        const cache = await syncMemoCache(ctx.client, ctx.store).catch(() => null);
        memo = cache?.memos?.[slug] ? asMemo(cache.memos[slug]) : null;
        if (!memo) throw error;
      }
      if (!memo?.slug) throw new FlomoEmptyError(`memo "${slug}" 不存在或已被彻底删除`);
      return [{
        slug: String(memo.slug),
        content: htmlToText(memo.content),
        html: String(memo.content || ''),
        tags: normalizeTags(memo.tags),
        images: normalizeImages(memo.files),
        pin: Number(memo.pin) === 1,
        linked_count: Number(memo.linked_count ?? 0),
        created_at: String(memo.created_at || ''),
        updated_at: String(memo.updated_at || ''),
        deleted_at: memo.deleted_at ? String(memo.deleted_at) : null,
        url: memoUrl(String(memo.slug)),
      }];
    }),
  );
}
