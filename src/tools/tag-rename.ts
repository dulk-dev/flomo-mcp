import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FlomoArgumentError } from '../errors.js';
import { invalidateMemoCacheFreshness, syncMemoCache } from '../flomo/memos.js';
import { v1 } from '../flomo/types.js';
import { runTool, type ToolContext } from './result.js';

function normalizeTagArg(value: string, label: string): string {
  const tag = String(value ?? '').trim().replace(/^#/, '');
  if (!tag) throw new FlomoArgumentError(`${label} 不能为空`);
  return tag;
}

export function registerTagRename(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'flomo_tag_rename',
    {
      description: '重命名标签：所有含该标签的 memo 内容会被批量改写（层级标签整枝迁移）。接口秒回，内容重写大约几秒后才生效',
      inputSchema: z.object({
        old: z.string().describe('现有标签名（不带 #，精确匹配，见 flomo_tags）'),
        new: z.string().describe('新标签名（不带 #，层级用 /）'),
      }),
    },
    async (args) => runTool(async () => {
      const oldTag = normalizeTagArg(args.old, 'old');
      const newTag = normalizeTagArg(args.new, 'new');
      if (oldTag === newTag) throw new FlomoArgumentError('新旧标签名相同，无需重命名');
      const cache = await syncMemoCache(ctx.client, ctx.store);
      const affected = Object.values(cache.memos).filter((m) => !m.deleted_at
        && (Array.isArray(m.tags) ? m.tags : []).some((t) => {
          const name = typeof t === 'string' ? t : String(t);
          return name === oldTag || name.startsWith(`${oldTag}/`);
        })).length;
      if (affected === 0) throw new FlomoArgumentError(`没有 memo 使用标签 "${oldTag}"（标签名需精确匹配，见 flomo_tags）`);
      await ctx.client.apiCall('POST', v1('/tag/rename'), { old_tag: oldTag, new_tag: newTag });
      await invalidateMemoCacheFreshness(ctx.store);
      return [{ old_tag: oldTag, new_tag: newTag, affected_memos: affected }];
    }),
  );
}
