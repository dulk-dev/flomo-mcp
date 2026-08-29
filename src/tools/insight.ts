import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FlomoArgumentError } from '../errors.js';
import type { ApiParams } from '../flomo/client.js';
import { asRecord, ensureNonEmptyList, parseLimitArg, requireSlugArg } from '../flomo/memos.js';
import { v1 } from '../flomo/types.js';
import { runTool, type ToolContext } from './result.js';

export const INSIGHT_READONLY_MODES = ['history', 'templates'] as const;
export const INSIGHT_GENERATING_MODES = ['memo', 'query', 'related'] as const;

export const insightInputSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('history'),
    limit: z.number().int().min(1).max(100).optional().describe('返回条数，默认 10'),
    full: z.boolean().optional().describe('输出完整正文（默认截断到 200 字）'),
  }),
  z.object({
    mode: z.literal('templates'),
  }),
  z.object({
    mode: z.literal('memo'),
    slug: z.string().describe('目标 memo 的 slug'),
    think: z.boolean().optional().describe('输出里附带模型的思考过程'),
  }),
  z.object({
    mode: z.literal('query'),
    template_id: z.string().describe('模板 ID，先用 mode=templates 查看'),
    tag: z.string().optional().describe('限定标签范围'),
    from: z.string().optional().describe('起始日期 YYYY-MM-DD'),
    to: z.string().optional().describe('结束日期 YYYY-MM-DD'),
    keyword: z.string().optional().describe('限定搜索关键词范围'),
    think: z.boolean().optional().describe('输出里附带模型的思考过程'),
  }),
  z.object({
    mode: z.literal('related'),
    slug: z.string().describe('笔记 slug：对该笔记的相关推荐做整体洞察'),
    think: z.boolean().optional().describe('输出里附带模型的思考过程'),
  }),
]);

/** MCP SDK 1.x 无法把 Zod discriminatedUnion 编成 JSON Schema（会变成空 object）。工具列表用扁平 schema，运行时再走 union。 */
export const insightToolSchema = z.object({
  mode: z.enum(['history', 'templates', 'memo', 'query', 'related']).describe(
    'history/templates 只读不耗额度；memo/query/related 会生成并消耗 Pro 每日额度',
  ),
  limit: z.number().int().min(1).max(100).optional().describe('history：返回条数，默认 10'),
  full: z.boolean().optional().describe('history：输出完整正文（默认截断到 200 字）'),
  slug: z.string().optional().describe('memo / related 必填'),
  think: z.boolean().optional().describe('生成模式：输出里附带模型的思考过程'),
  template_id: z.string().optional().describe('query 必填：模板 ID，先用 mode=templates 查看'),
  tag: z.string().optional().describe('query：限定标签范围'),
  from: z.string().optional().describe('query：起始日期 YYYY-MM-DD'),
  to: z.string().optional().describe('query：结束日期 YYYY-MM-DD'),
  keyword: z.string().optional().describe('query：限定搜索关键词范围'),
});

export type InsightInput = z.infer<typeof insightInputSchema>;

export function isGeneratingInsightMode(mode: string): boolean {
  return (INSIGHT_GENERATING_MODES as readonly string[]).includes(mode);
}

export function isReadonlyInsightMode(mode: string): boolean {
  return (INSIGHT_READONLY_MODES as readonly string[]).includes(mode);
}

function parseDay(input: string | undefined, label: string): string {
  const t = String(input ?? '').trim();
  if (!t) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    throw new FlomoArgumentError(`${label} 格式应为 YYYY-MM-DD（got "${input}"）`);
  }
  return t;
}

async function insightHistory(ctx: ToolContext, args: Extract<InsightInput, { mode: 'history' }>) {
  const limit = parseLimitArg(args.limit, 10, { max: 100 });
  const data = asRecord(await ctx.client.apiCall('GET', v1('/memo/insight/history'), {}));
  const history = Array.isArray(data?.history) ? data.history : [];
  ensureNonEmptyList(history, '还没有生成过 AI 洞察');
  return history.slice(0, limit).map((it) => {
    const rec = it && typeof it === 'object' ? it as Record<string, unknown> : {};
    const content = String(rec.content || '').trim();
    return {
      title: String(rec.formatted_title || rec.title || ''),
      source: String(rec.source || ''),
      template_name: String(rec.template_name || ''),
      content: args.full ? content : (content.length > 200 ? `${content.slice(0, 200)}…` : content),
      memo_slug: String(rec.memo_slug || ''),
      created_at: String(rec.created_at || ''),
      chat_id: String(rec.chat_id || ''),
    };
  });
}

async function insightTemplates(ctx: ToolContext) {
  const data = await ctx.client.apiCall('GET', v1('/memo/insight/templates/with_category'), {});
  const rows: Array<{
    id: number;
    title: string;
    category: string;
    timeRange: string;
    desc: string;
    likeCount: number;
  }> = [];
  for (const cat of Array.isArray(data) ? data : []) {
    const rec = cat && typeof cat === 'object' ? cat as Record<string, unknown> : {};
    const templates = Array.isArray(rec.templates) ? rec.templates : [];
    for (const t of templates) {
      const item = t && typeof t === 'object' ? t as Record<string, unknown> : {};
      rows.push({
        id: Number(item.id),
        title: String(item.title || ''),
        category: String(rec.category_name || rec.category || ''),
        timeRange: Array.isArray(item.topic_tags) ? item.topic_tags.map(String).join(', ') : '',
        desc: String(item.desc || ''),
        likeCount: Number(item.like_count ?? 0),
      });
    }
  }
  ensureNonEmptyList(rows, '没有可用的洞察模板');
  return rows;
}

export function registerInsight(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'flomo_insight',
    {
      description: [
        'flomo AI 洞察。mode 决定行为：',
        'history / templates 只读，不消耗每日额度；',
        'memo / query / related 会生成洞察，消耗 Pro 每日额度（见 flomo_whoami 的 insight_remaining）。',
        'query 用模板（先 templates 拿 id），不给日期/标签范围时常报笔记太少。',
        'related 会先拉该笔记的相关推荐（最多 10 条）再生成。',
      ].join(' '),
      inputSchema: insightToolSchema,
    },
    async (raw) => runTool(async () => {
      const parsed = insightInputSchema.safeParse(raw);
      if (!parsed.success) {
        throw new FlomoArgumentError(parsed.error.issues.map((i) => i.message).join('; '));
      }
      const args = parsed.data;
      switch (args.mode) {
        case 'history':
          return insightHistory(ctx, args);
        case 'templates':
          return insightTemplates(ctx);
        case 'memo': {
          const slug = requireSlugArg(args.slug);
          const result = await ctx.client.apiSSE('/memo/insight', {
            memo_slugs: [slug],
            source: 'memo',
            template_id: '0',
          });
          return [{
            content: result.content.trim(),
            think: args.think ? result.think.trim() : '',
            chat_id: result.chatId,
            slug,
          }];
        }
        case 'query': {
          const templateId = String(args.template_id ?? '').trim();
          if (!/^\d+$/.test(templateId)) {
            throw new FlomoArgumentError(`template_id 应为数字模板 ID（got "${args.template_id}"），先用 mode=templates`);
          }
          const extra: ApiParams = {
            memo_slugs: [],
            source: 'query',
            search_keyword: String(args.keyword ?? '').trim(),
            begin_at: parseDay(args.from, 'from'),
            end_at: parseDay(args.to, 'to'),
            tags: String(args.tag ?? '').trim() ? [String(args.tag).trim().replace(/^#/, '')] : [],
            prompt_version: 'v3',
            template_id: templateId,
          };
          const result = await ctx.client.apiSSE('/memo/insight', extra);
          return [{
            content: result.content.trim(),
            think: args.think ? result.think.trim() : '',
            chat_id: result.chatId,
            reference_slugs: result.referenceSlugs.join(', '),
          }];
        }
        case 'related': {
          const relatedSlug = requireSlugArg(args.slug);
          const recommended = await ctx.client.apiCall('GET', v1(`/memo/${encodeURIComponent(relatedSlug)}/recommended`), {
            type: '1',
            no_same_tag: '0',
          });
          const slugs = (Array.isArray(recommended) ? recommended : [])
            .map((m) => {
              const rec = m && typeof m === 'object' ? m as Record<string, unknown> : {};
              const memo = rec.memo && typeof rec.memo === 'object' ? rec.memo as Record<string, unknown> : {};
              return String(memo.slug || '');
            })
            .filter(Boolean)
            .slice(0, 10);
          if (slugs.length === 0) {
            throw new FlomoArgumentError(`笔记 ${relatedSlug} 没有相关推荐，无法做相关笔记洞察`);
          }
          const result = await ctx.client.apiSSE('/memo/insight', {
            memo_slugs: slugs,
            source: 'recommended',
            search_keyword: '',
            begin_at: '',
            end_at: '',
            tags: [],
            prompt_version: 'v3',
          });
          return [{
            content: result.content.trim(),
            think: args.think ? result.think.trim() : '',
            chat_id: result.chatId,
            reference_slugs: result.referenceSlugs.join(', '),
          }];
        }
        default: {
          const _exhaustive: never = args;
          throw new FlomoArgumentError(`未知 insight mode: ${String(_exhaustive)}`);
        }
      }
    }),
  );
}
