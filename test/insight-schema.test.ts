import { describe, expect, it } from 'vitest';
import {
  insightInputSchema,
  insightToolSchema,
  isGeneratingInsightMode,
  isReadonlyInsightMode,
} from '../src/tools/insight.js';

describe('flomo_insight mode 校验', () => {
  it('history / templates 是只读，不要求 slug 或 template_id', () => {
    expect(insightInputSchema.parse({ mode: 'history' }).mode).toBe('history');
    expect(insightInputSchema.parse({ mode: 'history', limit: 5, full: true }).mode).toBe('history');
    expect(insightInputSchema.parse({
      mode: 'history',
      page: 2,
      from: '2025-06-01',
      to: '2025-08-31',
      chat_id: 'chat-1',
      source: 'query',
    }).mode).toBe('history');
    expect(insightInputSchema.parse({ mode: 'templates' }).mode).toBe('templates');
    expect(isReadonlyInsightMode('history')).toBe(true);
    expect(isReadonlyInsightMode('templates')).toBe(true);
    expect(isGeneratingInsightMode('history')).toBe(false);
    expect(isGeneratingInsightMode('templates')).toBe(false);
  });

  it('memo / query / related 是生成模式，会耗每日额度', () => {
    for (const mode of ['memo', 'query', 'related'] as const) {
      expect(isGeneratingInsightMode(mode)).toBe(true);
      expect(isReadonlyInsightMode(mode)).toBe(false);
    }
  });

  it('memo 必须有 slug', () => {
    expect(insightInputSchema.parse({ mode: 'memo', slug: 'abcd' }).mode).toBe('memo');
    expect(insightInputSchema.safeParse({ mode: 'memo' }).success).toBe(false);
  });

  it('query 必须有 template_id', () => {
    expect(insightInputSchema.parse({ mode: 'query', template_id: '9' }).mode).toBe('query');
    expect(insightInputSchema.safeParse({ mode: 'query' }).success).toBe(false);
  });

  it('related 必须有 slug', () => {
    expect(insightInputSchema.parse({ mode: 'related', slug: 'abcd' }).mode).toBe('related');
    expect(insightInputSchema.safeParse({ mode: 'related' }).success).toBe(false);
  });

  it('对外 JSON Schema 必须带上 mode，不能是空 object', () => {
    const shape = insightToolSchema.shape;
    expect(Object.keys(shape)).toEqual(expect.arrayContaining([
      'mode', 'limit', 'full', 'page', 'slug', 'think', 'template_id', 'tag', 'from', 'to',
      'keyword', 'source', 'chat_id',
    ]));
    expect(insightToolSchema.parse({ mode: 'history' }).mode).toBe('history');
    expect(insightToolSchema.safeParse({}).success).toBe(false);
  });

  it('拒绝未知 mode，且生成 mode 不能混进只读字段组合', () => {
    expect(insightInputSchema.safeParse({ mode: 'search' }).success).toBe(false);
    expect(insightInputSchema.safeParse({ mode: 'query', slug: 'abcd' }).success).toBe(false);
    const query = insightInputSchema.parse({ mode: 'query', template_id: '5', from: '2026-01-01' });
    expect(query).toMatchObject({ mode: 'query', template_id: '5', from: '2026-01-01' });
    expect('slug' in query).toBe(false);
  });
});
