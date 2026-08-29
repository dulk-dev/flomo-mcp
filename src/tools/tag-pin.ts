import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FlomoArgumentError } from '../errors.js';
import { getTz } from '../flomo/client.js';
import { v1 } from '../flomo/types.js';
import { runTool, type ToolContext } from './result.js';

function normalizeTagArg(value: string): string {
  const tag = String(value ?? '').trim().replace(/^#/, '');
  if (!tag) throw new FlomoArgumentError('tag 不能为空');
  return tag;
}

export function registerTagPin(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'flomo_tag_pin',
    {
      description: '置顶标签（标签名精确匹配，见 flomo_tags）',
      inputSchema: z.object({
        tag: z.string().describe('标签名（不带 #）'),
      }),
    },
    async (args) => runTool(async () => {
      const tag = normalizeTagArg(args.tag);
      await ctx.client.apiCall('POST', v1('/tag/pin'), { tag, tz: getTz() });
      return [{ tag, pinned: true }];
    }),
  );
}
