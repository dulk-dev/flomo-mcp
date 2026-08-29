import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FlomoApiError, FlomoArgumentError } from '../errors.js';
import { getTz } from '../flomo/client.js';
import {
  asMemo, htmlToText, invalidateMemoCacheFreshness, memoUrl, normalizeTags, nowEpoch, parseDateArg, textToHtml,
} from '../flomo/memos.js';
import { v2 } from '../flomo/types.js';
import { runTool, type ToolContext } from './result.js';

export function registerNew(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'flomo_new',
    {
      description: '新建 memo。内容里写 #标签 即打标签，多行用 \\n；date 可回填历史日期',
      inputSchema: z.object({
        content: z.string().describe('memo 内容（纯文本，#标签 语法有效）'),
        date: z.string().optional().describe('自定义创建时间 YYYY-MM-DD [HH:mm:ss]，缺省为现在'),
        html: z.boolean().optional().describe('content 按原始 HTML 直传（默认按纯文本转 <p> 段落）'),
      }),
    },
    async (args) => runTool(async () => {
      const content = args.html ? String(args.content ?? '').trim() : textToHtml(args.content);
      if (!content) throw new FlomoArgumentError('content 不能为空');
      const createdAt = parseDateArg(args.date ?? '');
      const payload: Record<string, string | number | Array<string | number>> = {
        content,
        local_updated_at: nowEpoch(),
        source: 'web',
        memo_from: 'human',
        file_ids: [],
        tz: getTz(),
      };
      if (createdAt) payload.created_at = createdAt;
      const memo = asMemo(await ctx.client.apiCall('POST', v2('/memo'), payload));
      if (!memo?.slug) throw new FlomoApiError('创建接口返回成功但没有 slug，接口可能已改版');
      await invalidateMemoCacheFreshness(ctx.store);
      return [{
        slug: String(memo.slug),
        content: htmlToText(memo.content),
        tags: normalizeTags(memo.tags),
        created_at: String(memo.created_at || ''),
        url: memoUrl(String(memo.slug)),
      }];
    }),
  );
}
