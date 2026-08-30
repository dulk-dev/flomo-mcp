import { describe, expect, it } from 'vitest';
import type { FlomoClient } from '../src/flomo/client.js';
import { FlomoEmptyError } from '../src/errors.js';
import {
  clampInsightHistoryLimit,
  createdAtDay,
  insightHistoryHasMore,
  insightItemMatchesWindow,
  loadInsightHistoryPage,
  mapInsightHistoryItem,
  paginateInsightItems,
  parseInsightHistoryResponse,
  INSIGHT_HISTORY_CATALOG_MAX,
  INSIGHT_HISTORY_FULL_MAX,
  INSIGHT_HISTORY_PREVIEW_CHARS,
  type InsightHistoryArgs,
  type InsightHistoryItem,
} from '../src/tools/insight.js';

function rawInsight(n: number, extra: {
  created_at?: string;
  content?: string;
  template_name?: string;
  template_id?: string;
  source?: string;
} = {}): Record<string, unknown> {
  const month = String((n % 12) + 1).padStart(2, '0');
  return {
    formatted_title: `title-${n}`,
    title: `title-${n}`,
    source: extra.source ?? 'memo',
    template_name: extra.template_name ?? '笔记洞察',
    template_id: extra.template_id ?? String(n % 3),
    content: extra.content ?? `body-${n}-${'全文'.repeat(120)}`,
    memo_slug: `slug-${n}`,
    created_at: extra.created_at ?? `2025-${month}-15 12:00:00`,
    chat_id: `chat-${n}`,
    task_id: `task-${n}`,
  };
}

function dumpClient(rows: Record<string, unknown>[], tasks: Record<string, Record<string, unknown>> = {}) {
  const calls: Array<{ url: string; extra: Record<string, unknown> }> = [];
  const client = {
    calls,
    apiCall: async (_method: string, url: string, extra: Record<string, unknown> = {}) => {
      calls.push({ url, extra });
      const taskMatch = url.match(/\/memo\/insight\/tasks\/([^/?]+)$/);
      if (taskMatch) {
        const id = decodeURIComponent(taskMatch[1] ?? '');
        const hit = tasks[id];
        if (!hit) throw new Error(`no task ${id}`);
        return hit;
      }
      return { history: rows };
    },
  };
  return client as unknown as FlomoClient & { calls: typeof calls };
}

function pagingClient(rows: Record<string, unknown>[]) {
  const calls: Array<{ url: string; extra: Record<string, unknown> }> = [];
  const client = {
    calls,
    apiCall: async (_method: string, url: string, extra: Record<string, unknown> = {}) => {
      calls.push({ url, extra });
      const page = Number(extra.page ?? 1);
      const size = Number(extra.page_size ?? extra.limit ?? 20);
      const start = (page - 1) * size;
      const history = rows.slice(start, start + size);
      return {
        history,
        page,
        page_size: size,
        total: rows.length,
        has_more: start + history.length < rows.length,
      };
    },
  };
  return client as unknown as FlomoClient & { calls: typeof calls };
}

function historyArgs(partial: Partial<Omit<InsightHistoryArgs, 'mode'>> = {}): InsightHistoryArgs {
  return { mode: 'history', ...partial };
}

describe('insight history windowing', () => {
  it('full=false 截断到 200 字并保留 content_chars', () => {
    const item = mapInsightHistoryItem(rawInsight(1, { content: '字'.repeat(250) }), false);
    expect(item?.content).toHaveLength(INSIGHT_HISTORY_PREVIEW_CHARS + 1);
    expect(item?.content.endsWith('…')).toBe(true);
    expect(item?.content_chars).toBe(250);
    const full = mapInsightHistoryItem(rawInsight(1, { content: '字'.repeat(250) }), true);
    expect(full?.content).toHaveLength(250);
  });

  it('page 2 不是最新那一页', () => {
    const rows = Array.from({ length: 12 }, (_, i) => rawInsight(i));
    const page1 = paginateInsightItems(
      rows.map((row) => mapInsightHistoryItem(row, false)!),
      1,
      5,
    );
    const page2 = paginateInsightItems(
      rows.map((row) => mapInsightHistoryItem(row, false)!),
      2,
      5,
    );
    expect(page1.items.map((it) => it.chat_id)).toEqual(['chat-0', 'chat-1', 'chat-2', 'chat-3', 'chat-4']);
    expect(page2.items.map((it) => it.chat_id)).toEqual(['chat-5', 'chat-6', 'chat-7', 'chat-8', 'chat-9']);
    expect(page1.has_more).toBe(true);
    expect(page1.next_page).toBe(2);
    expect(page2.has_more).toBe(true);
    expect(page2.next_page).toBe(3);
  });

  it('from/to 按 created_at 日期过滤', () => {
    const items: InsightHistoryItem[] = [
      mapInsightHistoryItem(rawInsight(1, { created_at: '2025-06-20 10:00:00' }), true)!,
      mapInsightHistoryItem(rawInsight(2, { created_at: '2025-08-11 10:00:00' }), true)!,
      mapInsightHistoryItem(rawInsight(3, { created_at: '2026-01-01 10:00:00' }), true)!,
    ];
    const hit = items.filter((it) => insightItemMatchesWindow(it, {
      from: '2025-07-01',
      to: '2025-12-31',
      template_id: '',
    }));
    expect(hit.map((it) => it.chat_id)).toEqual(['chat-2']);
    expect(createdAtDay('2025-08-11 10:00:00')).toBe('2025-08-11');
  });

  it('limit=100 full=true 会被截到全文页上限', () => {
    expect(clampInsightHistoryLimit(true, 100)).toBe(INSIGHT_HISTORY_FULL_MAX);
    expect(clampInsightHistoryLimit(false, 100)).toBe(INSIGHT_HISTORY_CATALOG_MAX);
    expect(clampInsightHistoryLimit(true, undefined)).toBe(3);
    expect(clampInsightHistoryLimit(false, undefined)).toBe(20);
  });

  it('目录页 pretty-print 后仍低于 40KB', () => {
    const items = Array.from({ length: INSIGHT_HISTORY_CATALOG_MAX }, (_, i) => (
      mapInsightHistoryItem(rawInsight(i, { content: '预览'.repeat(120) }), false)!
    ));
    const page = paginateInsightItems(items, 1, INSIGHT_HISTORY_CATALOG_MAX);
    const bytes = new TextEncoder().encode(JSON.stringify(page, null, 2)).byteLength;
    expect(bytes).toBeLessThan(40_000);
    expect(page.items).toHaveLength(INSIGHT_HISTORY_CATALOG_MAX);
  });

  it('上游一次倒出全部时，page=2 仍能切到后半段', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => rawInsight(i));
    const client = dumpClient(rows);
    const page1 = await loadInsightHistoryPage(client, historyArgs({ full: true, limit: 5, page: 1 }));
    const page2 = await loadInsightHistoryPage(client, historyArgs({ full: true, limit: 5, page: 2 }));
    expect(page1.items).toHaveLength(5);
    expect(page2.items).toHaveLength(5);
    expect(page1.items[0]?.chat_id).toBe('chat-0');
    expect(page2.items[0]?.chat_id).toBe('chat-5');
    expect(page1.has_more).toBe(true);
    expect(page2.has_more).toBe(true);
    expect(page1.total).toBe(12);
    expect(page1.items[0]?.content.includes('全文')).toBe(true);
  });

  it('上游支持 page/page_size 时把参数传下去', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => rawInsight(i));
    const client = pagingClient(rows);
    const page2 = await loadInsightHistoryPage(client, historyArgs({ full: false, limit: 10, page: 2 }));
    expect(client.calls[0]?.extra).toMatchObject({ page: 2, page_size: 10 });
    expect(page2.items.map((it) => it.chat_id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `chat-${10 + i}`),
    );
    expect(page2.has_more).toBe(true);
    expect(page2.total).toBe(30);
    expect(page2.next_page).toBe(3);
  });

  it('from/to 在上游分页时会连翻直到凑满一页', async () => {
    const rows = [
      ...Array.from({ length: 55 }, (_, i) => rawInsight(i, { created_at: '2026-08-01 12:00:00' })),
      ...Array.from({ length: 6 }, (_, i) => rawInsight(100 + i, { created_at: '2025-06-24 12:00:00' })),
    ];
    const client = pagingClient(rows);
    const page = await loadInsightHistoryPage(client, historyArgs({
      full: true,
      limit: 5,
      page: 1,
      from: '2025-01-01',
      to: '2025-12-31',
    }));
    expect(page.items).toHaveLength(5);
    expect(page.items.every((it) => it.created_at.startsWith('2025-06-24'))).toBe(true);
    expect(page.has_more).toBe(true);
    expect(client.calls.length).toBeGreaterThan(1);
  });

  it('chat_id 走 /memo/insight/tasks/:id 且 mark_viewed=0', async () => {
    const rows = [rawInsight(1)];
    const full = rawInsight(1, { content: '完整正文'.repeat(50) });
    const client = dumpClient(rows, { 'chat-1': full, 'task-1': full });
    const page = await loadInsightHistoryPage(client, historyArgs({ chat_id: 'chat-1' }));
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.content).toContain('完整正文');
    expect(page.has_more).toBe(false);
    expect(client.calls[0]?.url).toContain('/memo/insight/tasks/chat-1');
    expect(client.calls[0]?.extra).toMatchObject({ mark_viewed: 0 });
  });

  it('task 接口失败时回落到 history 扫描', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => rawInsight(i, { content: `only-${i}` }));
    const client = dumpClient(rows);
    const page = await loadInsightHistoryPage(client, historyArgs({ chat_id: 'chat-2' }));
    expect(page.items[0]?.chat_id).toBe('chat-2');
    expect(page.items[0]?.content).toBe('only-2');
  });

  it('空账号第一页抛错，后面的空页返回空 items', async () => {
    const empty = dumpClient([]);
    await expect(loadInsightHistoryPage(empty, historyArgs({ page: 1 }))).rejects.toBeInstanceOf(FlomoEmptyError);
    const rows = Array.from({ length: 2 }, (_, i) => rawInsight(i));
    const client = dumpClient(rows);
    const page = await loadInsightHistoryPage(client, historyArgs({ page: 5, limit: 5 }));
    expect(page.items).toEqual([]);
    expect(page.has_more).toBe(false);
  });

  it('has_more 算法与网页端一致', () => {
    expect(insightHistoryHasMore({ has_more: true, itemCount: 0 })).toBe(true);
    expect(insightHistoryHasMore({ has_next: true, itemCount: 3 })).toBe(true);
    expect(insightHistoryHasMore({ total: 57, page: 1, page_size: 20, itemCount: 20 })).toBe(true);
    expect(insightHistoryHasMore({ total: 57, page: 3, page_size: 20, itemCount: 17 })).toBe(false);
  });

  it('parse 把一次倒出识别成 dumped_all，避免把第 2 页当成最新页', () => {
    const rows = Array.from({ length: 12 }, (_, i) => rawInsight(i));
    const parsed = parseInsightHistoryResponse({ history: rows }, 2, 5);
    expect(parsed.dumped_all).toBe(true);
    expect(parsed.records).toHaveLength(12);
    const shortDump = parseInsightHistoryResponse({ history: rows.slice(0, 2) }, 5, 5);
    expect(shortDump.dumped_all).toBe(true);
  });
});
