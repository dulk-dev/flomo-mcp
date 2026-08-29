import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { v1 } from '../flomo/types.js';
import { asRecord } from '../flomo/memos.js';
import { runTool, type ToolContext } from './result.js';

export function registerWhoami(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'flomo_whoami',
    {
      description: '当前 flomo 登录身份（昵称/账号/Pro 状态），含 /user/me 的 insight_remaining',
      inputSchema: z.object({}),
    },
    async () => runTool(async () => {
      const data = await ctx.client.apiCall('GET', v1('/user/me'), {});
      const user = asRecord(data);
      if (!user) throw new Error('flomo /user/me 返回了非对象');
      await ctx.client.rememberUser(user);
      return [{
        user_id: String(user.id ?? ''),
        name: user.name ?? '',
        email: user.email ?? '',
        pro_type: user.pro_type ?? '',
        pro_expired_at: user.pro_expired_at ?? '',
        register_via: user.register_via ?? '',
        created_at: user.created_at ?? '',
        insight_remaining: user.insight_remaining ?? null,
      }];
    }),
  );
}
