import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { activeMemos, asRecord, normalizeTags, syncMemoCache, trashedMemos } from '../flomo/memos.js';
import { v1 } from '../flomo/types.js';
import { runTool, type ToolContext } from './result.js';

export function registerStats(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'flomo_stats',
    {
      description:
        'memo 总数 / 记录天数 / 标签数 / 连续记录等统计（与网页侧栏同口径，来自本地 /memo/updated/ 缓存）。syncComplete=false 时缓存还没翻完，数字会偏小，再 refresh 或等每天一次的 cron（北京时间 0:00）',
      inputSchema: z.object({
        refresh: z.boolean().optional().describe('强制增量同步后再统计；未翻完时会从游标继续，不会把短页当成结束'),
      }),
    },
    async (args) => runTool(async () => {
      const [cache, userRaw] = await Promise.all([
        syncMemoCache(ctx.client, ctx.store, { force: !!args.refresh }),
        ctx.client.apiCall('GET', v1('/user/me'), {}),
      ]);
      const user = asRecord(userRaw);
      const memos = activeMemos(cache);
      const days = new Set<string>();
      const tagPaths = new Set<string>();
      let first = '';
      let last = '';
      const now = new Date();
      const thisMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      let thisMonth = 0;
      for (const m of memos) {
        const created = String(m.created_at || '');
        const day = created.slice(0, 10);
        if (day) days.add(day);
        if (created.startsWith(thisMonthPrefix)) thisMonth++;
        if (!first || created < first) first = created;
        if (!last || created > last) last = created;
        for (const t of normalizeTags(m.tags).split(', ').filter(Boolean)) {
          const parts = t.split('/');
          for (let i = 1; i <= parts.length; i++) tagPaths.add(parts.slice(0, i).join('/'));
        }
      }
      const dayMs = 24 * 60 * 60 * 1000;
      const registeredAt = new Date(String(user?.created_at || '').replace(' ', 'T') + '+08:00');
      const daysSinceRegister = Number.isNaN(registeredAt.getTime())
        ? null
        : Math.floor((Date.now() - registeredAt.getTime()) / dayMs) + 1;
      const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      let cursor = new Date();
      if (!days.has(fmt(cursor))) cursor = new Date(cursor.getTime() - dayMs);
      let streak = 0;
      while (days.has(fmt(cursor))) {
        streak++;
        cursor = new Date(cursor.getTime() - dayMs);
      }
      return [{
        memoCount: memos.length,
        tagCount: tagPaths.size,
        daysSinceRegister,
        recordedDays: days.size,
        trashCount: trashedMemos(cache).length,
        thisMonthMemos: thisMonth,
        currentStreakDays: streak,
        firstMemoAt: first,
        lastMemoAt: last,
        syncComplete: cache.complete === true,
      }];
    }),
  );
}
