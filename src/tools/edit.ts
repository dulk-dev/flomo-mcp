import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FlomoApiError, FlomoArgumentError, FlomoEmptyError } from '../errors.js';
import { getTz } from '../flomo/client.js';
import {
  asMemo, htmlToText, invalidateMemoCacheFreshness, memoFileIds, memoUrl, normalizeTags,
  nowEpoch, requireSlugArg, syncMemoCache, textToHtml, toEpochSeconds,
} from '../flomo/memos.js';
import { v1, v2 } from '../flomo/types.js';
import { runTool, type ToolContext } from './result.js';

export function registerEdit(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'flomo_edit',
    {
      description: '编辑 memo：content 整体替换，或 append 追加段落。会回传原 file_ids，避免把图片清掉',
      inputSchema: z.object({
        slug: z.string().describe('memo 的 slug'),
        content: z.string().optional().describe('新内容（纯文本，整体替换）'),
        append: z.string().optional().describe('在原内容后追加的文本'),
        html: z.boolean().optional().describe('content/append 按原始 HTML 直传'),
      }),
    },
    async (args) => runTool(async () => {
      const slug = requireSlugArg(args.slug);
      const replace = String(args.content ?? '').trim();
      const append = String(args.append ?? '').trim();
      if (!replace && !append) throw new FlomoArgumentError('需要 content（替换）或 append（追加）之一');
      if (replace && append) throw new FlomoArgumentError('content 和 append 不能同时用');

      let current;
      try {
        current = asMemo(await ctx.client.apiCall('GET', v1(`/memo/${encodeURIComponent(slug)}`), {}));
      } catch (error) {
        const cache = await syncMemoCache(ctx.client, ctx.store).catch(() => null);
        if (cache?.memos?.[slug]?.deleted_at) {
          throw new FlomoArgumentError(`memo "${slug}" 在回收站里，先用 flomo_restore`);
        }
        throw error;
      }
      if (!current?.slug) throw new FlomoEmptyError(`memo "${slug}" 不存在`);
      if (current.deleted_at) throw new FlomoArgumentError(`memo "${slug}" 在回收站里，先用 flomo_restore`);

      const files = current.files;
      let content: string;
      if (replace) {
        content = args.html ? replace : textToHtml(replace);
      } else {
        const extra = args.html ? append : textToHtml(append);
        content = `${String(current.content || '')}${extra}`;
      }
      const memo = asMemo(await ctx.client.apiCall('PUT', v2(`/memo/${encodeURIComponent(slug)}`), {
        content,
        local_updated_at: Math.max(nowEpoch(), toEpochSeconds(current.updated_at || '') + 1),
        source: 'web',
        memo_from: 'human',
        file_ids: memoFileIds(files),
        tz: getTz(),
        pin: Number(current.pin) === 1 ? 1 : 0,
      }));
      if (!memo?.slug) throw new FlomoApiError('编辑接口返回成功但没有 slug，接口可能已改版');
      await invalidateMemoCacheFreshness(ctx.store);
      return [{
        slug: String(memo.slug),
        content: htmlToText(memo.content),
        tags: normalizeTags(memo.tags),
        updated_at: String(memo.updated_at || ''),
        url: memoUrl(String(memo.slug)),
      }];
    }),
  );
}
