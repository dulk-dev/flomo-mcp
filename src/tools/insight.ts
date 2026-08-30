import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FlomoArgumentError, FlomoEmptyError } from '../errors.js';
import type { ApiParams, FlomoClient } from '../flomo/client.js';
import { asRecord, ensureNonEmptyList, parseLimitArg, requireSlugArg } from '../flomo/memos.js';
import { v1 } from '../flomo/types.js';
import { runTool, type ToolContext } from './result.js';

export const INSIGHT_READONLY_MODES = ['history', 'templates'] as const;
export const INSIGHT_GENERATING_MODES = ['memo', 'query', 'related'] as const;

/** Catalog pages stay well under a ~40KB MCP client cap. */
export const INSIGHT_HISTORY_CATALOG_DEFAULT = 20;
export const INSIGHT_HISTORY_CATALOG_MAX = 40;
/** Full-text pages: one weekly review can be ~12KB. */
export const INSIGHT_HISTORY_FULL_DEFAULT = 3;
export const INSIGHT_HISTORY_FULL_MAX = 5;
export const INSIGHT_HISTORY_PREVIEW_CHARS = 200;
/** Upstream walk when from/to/template_id require more than one flomo page. */
export const INSIGHT_HISTORY_WALK_MAX_PAGES = 15;
export const INSIGHT_HISTORY_WALK_PAGE_SIZE = 50;

export const insightInputSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('history'),
    limit: z.number().int().min(1).max(100).optional().describe(
      '每页条数。目录默认 20（实际最多 40），全文默认 3（实际最多 5）。更大的值会截到上限，请用 page 翻页',
    ),
    page: z.number().int().min(1).optional().describe('页码，从 1 开始。对应 flomo 网页的 page'),
    full: z.boolean().optional().describe('true 返回完整正文（每页最多 5 条）；默认 200 字预览'),
    from: z.string().optional().describe('按 created_at 起始日期 YYYY-MM-DD。上游 history 无日期参数，Worker 会翻页过滤'),
    to: z.string().optional().describe('按 created_at 结束日期 YYYY-MM-DD（含）'),
    template_id: z.string().optional().describe('按 template_id 或 template_name 过滤（Worker 侧；上游 history 不支持此参数）'),
    source: z.string().optional().describe('上游支持的来源过滤：memo / query / recommended'),
    chat_id: z.string().optional().describe('按 chat_id 或 task_id 取一条全文（不标已读）'),
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
  limit: z.number().int().min(1).max(100).optional().describe(
    'history：每页条数。目录默认 20（最多 40），全文默认 3（最多 5）',
  ),
  page: z.number().int().min(1).optional().describe('history：页码，从 1 开始'),
  full: z.boolean().optional().describe('history：完整正文（每页最多 5 条）；默认 200 字预览'),
  slug: z.string().optional().describe('memo / related 必填'),
  think: z.boolean().optional().describe('生成模式：输出里附带模型的思考过程'),
  template_id: z.string().optional().describe('query 必填：模板 ID。history 可选：按 template_id 或 template_name 过滤'),
  tag: z.string().optional().describe('query：限定标签范围'),
  from: z.string().optional().describe('query：生成范围起始日。history：按 created_at 过滤 YYYY-MM-DD'),
  to: z.string().optional().describe('query：生成范围结束日。history：按 created_at 过滤 YYYY-MM-DD（含）'),
  keyword: z.string().optional().describe('query：限定搜索关键词范围'),
  source: z.string().optional().describe('history：上游来源过滤 memo / query / recommended'),
  chat_id: z.string().optional().describe('history：按 chat_id 或 task_id 取一条全文'),
});

export type InsightInput = z.infer<typeof insightInputSchema>;
export type InsightHistoryArgs = Extract<InsightInput, { mode: 'history' }>;

export type InsightHistoryItem = {
  title: string;
  source: string;
  template_name: string;
  template_id: string;
  content: string;
  content_chars: number;
  memo_slug: string;
  created_at: string;
  chat_id: string;
  task_id: string;
};

export type InsightHistoryPage = {
  items: InsightHistoryItem[];
  page: number;
  limit: number;
  total: number | null;
  has_more: boolean;
  next_page: number | null;
};

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

export function clampInsightHistoryLimit(full: boolean, requested: number | undefined): number {
  const fallback = full ? INSIGHT_HISTORY_FULL_DEFAULT : INSIGHT_HISTORY_CATALOG_DEFAULT;
  const parsed = parseLimitArg(requested, fallback, { max: 100 });
  const cap = full ? INSIGHT_HISTORY_FULL_MAX : INSIGHT_HISTORY_CATALOG_MAX;
  return Math.min(parsed, cap);
}

export function insightHistoryHasMore(meta: {
  has_more?: unknown;
  has_next?: unknown;
  total?: unknown;
  page?: unknown;
  limit?: unknown;
  page_size?: unknown;
  itemCount: number;
}): boolean {
  if (meta.has_more === true || meta.has_next === true) return true;
  const total = typeof meta.total === 'number' ? meta.total : Number.NaN;
  const page = typeof meta.page === 'number' && meta.page > 0 ? meta.page : 1;
  const sizeRaw = typeof meta.limit === 'number' ? meta.limit
    : typeof meta.page_size === 'number' ? meta.page_size
    : 20;
  const size = sizeRaw > 0 ? sizeRaw : 20;
  return Number.isFinite(total) && meta.itemCount > 0 && page * size < total;
}

function recordContent(rec: Record<string, unknown>): string {
  if (typeof rec.content === 'string') return rec.content.trim();
  if (typeof rec.insight_content === 'string') return rec.insight_content.trim();
  const nested = asRecord(rec.result);
  if (nested && typeof nested.content === 'string') return nested.content.trim();
  return '';
}

export function mapInsightHistoryItem(raw: unknown, full: boolean): InsightHistoryItem | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const content = recordContent(rec);
  const taskId = String(rec.task_id ?? rec.id ?? rec.chat_id ?? '').trim();
  const chatId = String(rec.chat_id ?? rec.task_id ?? rec.id ?? '').trim();
  if (!taskId && !chatId && !content && !rec.formatted_title && !rec.title) return null;
  return {
    title: String(rec.formatted_title ?? rec.title ?? ''),
    source: String(rec.source ?? ''),
    template_name: String(rec.template_name ?? ''),
    template_id: rec.template_id == null && rec.templateId == null
      ? ''
      : String(rec.template_id ?? rec.templateId ?? ''),
    content: full || content.length <= INSIGHT_HISTORY_PREVIEW_CHARS
      ? content
      : `${content.slice(0, INSIGHT_HISTORY_PREVIEW_CHARS)}…`,
    content_chars: content.length,
    memo_slug: String(rec.memo_slug ?? ''),
    created_at: String(rec.created_at ?? ''),
    chat_id: chatId,
    task_id: taskId,
  };
}

export function createdAtDay(createdAt: string): string {
  const t = String(createdAt ?? '').trim();
  const day = t.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '';
}

export function insightItemMatchesWindow(
  item: InsightHistoryItem,
  window: { from: string; to: string; template_id: string },
): boolean {
  if (window.from || window.to) {
    const day = createdAtDay(item.created_at);
    if (!day) return false;
    if (window.from && day < window.from) return false;
    if (window.to && day > window.to) return false;
  }
  if (window.template_id) {
    const needle = window.template_id;
    if (item.template_id !== needle && item.template_name !== needle) return false;
  }
  return true;
}

export function paginateInsightItems(
  items: InsightHistoryItem[],
  page: number,
  limit: number,
  total: number | null = items.length,
): InsightHistoryPage {
  const safePage = page < 1 ? 1 : page;
  const start = (safePage - 1) * limit;
  const slice = items.slice(start, start + limit);
  const knownTotal = total;
  const hasMore = knownTotal == null
    ? slice.length === limit
    : start + slice.length < knownTotal;
  return {
    items: slice,
    page: safePage,
    limit,
    total: knownTotal,
    has_more: hasMore,
    next_page: hasMore ? safePage + 1 : null,
  };
}

function historyIdList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  const rec = asRecord(data);
  if (!rec) return [];
  if (Array.isArray(rec.history)) return rec.history;
  if (Array.isArray(rec.items)) return rec.items;
  if (Array.isArray(rec.list)) return rec.list;
  return [];
}

export function parseInsightHistoryResponse(data: unknown, requestedPage: number, requestedSize: number): {
  records: unknown[];
  page: number;
  total: number | null;
  has_more: boolean | null;
  dumped_all: boolean;
} {
  const rec = asRecord(data);
  const records = historyIdList(data);
  const pageRaw = rec && (rec.page ?? rec.current_page);
  const page = typeof pageRaw === 'number' && pageRaw > 0 ? pageRaw : requestedPage;
  const totalRaw = rec && rec.total;
  const total = typeof totalRaw === 'number' && totalRaw >= 0 ? totalRaw : null;
  const hasMeta = rec != null && (
    rec.has_more === true || rec.has_more === false
    || rec.has_next === true || rec.has_next === false
    || typeof rec.total === 'number'
    || typeof rec.page === 'number'
    || typeof rec.current_page === 'number'
  );
  const flag = rec
    ? insightHistoryHasMore({
      has_more: rec.has_more,
      has_next: rec.has_next,
      total,
      page,
      limit: rec.limit,
      page_size: rec.page_size,
      itemCount: records.length,
    })
    : false;
  const dumpedAll = records.length > requestedSize
    || (!hasMeta && records.length < requestedSize);
  const hasMore = dumpedAll
    ? null
    : rec && (rec.has_more === true || rec.has_next === true)
      ? true
      : rec && (rec.has_more === false || rec.has_next === false) && total == null
        ? false
        : total != null
          ? flag
          : records.length >= requestedSize;
  return { records, page, total, has_more: dumpedAll ? null : hasMore, dumped_all: dumpedAll };
}

function unwrapTaskRecord(data: unknown): Record<string, unknown> | null {
  const rec = asRecord(data);
  if (!rec) return null;
  if (
    typeof rec.content === 'string'
    || rec.formatted_title != null
    || rec.title != null
    || rec.chat_id != null
    || rec.task_id != null
  ) {
    return rec;
  }
  return asRecord(rec.task) ?? asRecord(rec.insight) ?? asRecord(rec.data);
}

function historyPageResult(
  items: InsightHistoryItem[],
  page: number,
  limit: number,
  total: number | null,
  hasMore: boolean,
): InsightHistoryPage {
  return {
    items,
    page,
    limit,
    total,
    has_more: hasMore,
    next_page: hasMore ? page + 1 : null,
  };
}

async function fetchHistoryRecords(
  client: Pick<FlomoClient, 'apiCall'>,
  extra: ApiParams,
): Promise<unknown> {
  return client.apiCall('GET', v1('/memo/insight/history'), extra);
}

export async function loadInsightHistoryPage(
  client: Pick<FlomoClient, 'apiCall'>,
  args: InsightHistoryArgs,
): Promise<InsightHistoryPage> {
  const full = Boolean(args.full);
  const limit = clampInsightHistoryLimit(full, args.limit);
  const page = parseLimitArg(args.page, 1, { max: 100_000, label: 'page' });
  const from = parseDay(args.from, 'from');
  const to = parseDay(args.to, 'to');
  const templateId = String(args.template_id ?? '').trim();
  const source = String(args.source ?? '').trim();
  const chatId = String(args.chat_id ?? '').trim();
  const window = { from, to, template_id: templateId };
  const needsWindow = Boolean(from || to || templateId);

  if (chatId) {
    const item = await loadInsightById(client, chatId, true);
    if (!insightItemMatchesWindow(item, window)) {
      throw new FlomoEmptyError(`洞察 ${chatId} 不在 from/to/template_id 范围内`);
    }
    if (source && item.source && item.source !== source) {
      throw new FlomoEmptyError(`洞察 ${chatId} 的 source 是 ${item.source}，不是 ${source}`);
    }
    return historyPageResult([item], 1, 1, 1, false);
  }

  const firstSize = needsWindow ? INSIGHT_HISTORY_WALK_PAGE_SIZE : limit;
  const firstExtra: ApiParams = {
    page: needsWindow ? 1 : page,
    page_size: firstSize,
  };
  if (source) firstExtra.source = source;
  const firstRaw = await fetchHistoryRecords(client, firstExtra);
  const first = parseInsightHistoryResponse(firstRaw, needsWindow ? 1 : page, firstSize);
  if (first.records.length === 0 && page === 1 && !needsWindow) {
    throw new FlomoEmptyError('还没有生成过 AI 洞察');
  }

  if (first.dumped_all) {
    const mapped = first.records
      .map((row) => mapInsightHistoryItem(row, full))
      .filter((row): row is InsightHistoryItem => row != null)
      .filter((row) => insightItemMatchesWindow(row, window))
      .filter((row) => !source || !row.source || row.source === source);
    if (mapped.length === 0 && page === 1 && !needsWindow) {
      throw new FlomoEmptyError('还没有生成过 AI 洞察');
    }
    return paginateInsightItems(mapped, page, limit, mapped.length);
  }

  if (!needsWindow) {
    const mapped = first.records
      .map((row) => mapInsightHistoryItem(row, full))
      .filter((row): row is InsightHistoryItem => row != null);
    const hasMore = first.has_more === true
      || (first.has_more == null && mapped.length >= limit);
    const total = first.total;
    return historyPageResult(mapped.slice(0, limit), first.page || page, limit, total, hasMore);
  }

  const collected: InsightHistoryItem[] = [];
  let upPage = 1;
  let upHasMore = true;
  let parsed = first;
  while (upPage <= INSIGHT_HISTORY_WALK_MAX_PAGES) {
    const mapped = parsed.records
      .map((row) => mapInsightHistoryItem(row, full))
      .filter((row): row is InsightHistoryItem => row != null)
      .filter((row) => insightItemMatchesWindow(row, window));
    collected.push(...mapped);
    upHasMore = parsed.has_more === true
      || (parsed.has_more == null && parsed.records.length >= INSIGHT_HISTORY_WALK_PAGE_SIZE);
    if (!upHasMore) break;
    if (collected.length >= page * limit) break;
    upPage += 1;
    const extra: ApiParams = { page: upPage, page_size: INSIGHT_HISTORY_WALK_PAGE_SIZE };
    if (source) extra.source = source;
    parsed = parseInsightHistoryResponse(
      await fetchHistoryRecords(client, extra),
      upPage,
      INSIGHT_HISTORY_WALK_PAGE_SIZE,
    );
    if (parsed.dumped_all) {
      const rest = parsed.records
        .map((row) => mapInsightHistoryItem(row, full))
        .filter((row): row is InsightHistoryItem => row != null)
        .filter((row) => insightItemMatchesWindow(row, window));
      return paginateInsightItems(rest, page, limit, rest.length);
    }
    if (parsed.records.length === 0) {
      upHasMore = false;
      break;
    }
  }
  const knownTotal = upHasMore && upPage >= INSIGHT_HISTORY_WALK_MAX_PAGES
    ? null
    : upHasMore
      ? null
      : collected.length;
  const result = paginateInsightItems(collected, page, limit, knownTotal ?? collected.length);
  if (upHasMore && result.items.length === limit) {
    result.has_more = true;
    result.next_page = page + 1;
    result.total = knownTotal;
  }
  return result;
}

async function loadInsightById(
  client: Pick<FlomoClient, 'apiCall'>,
  id: string,
  full: boolean,
): Promise<InsightHistoryItem> {
  try {
    const data = await client.apiCall('GET', v1(`/memo/insight/tasks/${encodeURIComponent(id)}`), {
      mark_viewed: 0,
    });
    const rec = unwrapTaskRecord(data);
    const item = rec ? mapInsightHistoryItem(rec, full) : null;
    if (item) return item;
  } catch {
    // Fall back to scanning history. Some accounts identify rows by chat_id, not task_id.
  }
  let page = 1;
  while (page <= INSIGHT_HISTORY_WALK_MAX_PAGES) {
    const raw = await fetchHistoryRecords(client, { page, page_size: INSIGHT_HISTORY_WALK_PAGE_SIZE });
    const parsed = parseInsightHistoryResponse(raw, page, INSIGHT_HISTORY_WALK_PAGE_SIZE);
    const hit = parsed.records
      .map((row) => mapInsightHistoryItem(row, full))
      .find((row) => row && (row.chat_id === id || row.task_id === id));
    if (hit) return hit;
    if (parsed.dumped_all) break;
    const more = parsed.has_more === true
      || (parsed.has_more == null && parsed.records.length >= INSIGHT_HISTORY_WALK_PAGE_SIZE);
    if (!more) break;
    page += 1;
  }
  throw new FlomoEmptyError(`找不到洞察 "${id}"`);
}

async function insightHistory(ctx: ToolContext, args: InsightHistoryArgs) {
  return loadInsightHistoryPage(ctx.client, args);
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
    const rec = asRecord(cat);
    const templates = rec && Array.isArray(rec.templates) ? rec.templates : [];
    for (const t of templates) {
      const item = asRecord(t) ?? {};
      rows.push({
        id: Number(item.id),
        title: String(item.title || ''),
        category: String(rec?.category_name || rec?.category || ''),
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
        'history 按 page 翻页（目录每页最多 40 条预览，全文每页最多 5 条），也可用 chat_id 取单条全文。',
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
              const rec = asRecord(m) ?? {};
              const memo = asRecord(rec.memo) ?? {};
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
