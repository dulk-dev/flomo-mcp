import { describe, expect, it } from 'vitest';
import { filterSearchHits, parseSearchWords } from '../src/flomo/memos.js';
import type { FlomoMemo } from '../src/flomo/types.js';
import { FlomoArgumentError } from '../src/errors.js';

function memo(partial: Partial<FlomoMemo> & { slug: string; content: string }): FlomoMemo {
  return { tags: [], ...partial };
}

describe('search AND 过滤', () => {
  const pool: FlomoMemo[] = [
    memo({ slug: 'a', content: '<p>foo bar baz</p>', tags: ['读书'] }),
    memo({ slug: 'b', content: '<p>foo only</p>', tags: ['工作'] }),
    memo({ slug: 'c', content: '<p>nothing here</p>', tags: ['读书/认知觉醒'] }),
    memo({ slug: 'd', content: '<p>#工作 周报</p>', tags: ['工作/周报'] }),
  ];

  it('空格分隔的多词是 AND', () => {
    const hits = filterSearchHits(pool, 'foo baz');
    expect(hits.map((m) => m.slug)).toEqual(['a']);
  });

  it('单词命中内容或标签', () => {
    const byContent = filterSearchHits(pool, 'foo');
    expect(byContent.map((m) => m.slug).sort()).toEqual(['a', 'b']);
    const byTag = filterSearchHits(pool, '周报');
    expect(byTag.map((m) => m.slug)).toEqual(['d']);
  });

  it('tag 前缀匹配：读书 命中 读书/认知觉醒', () => {
    const hits = filterSearchHits(pool, 'nothing', '读书');
    expect(hits.map((m) => m.slug)).toEqual(['c']);
  });

  it('tag 精确路径不误伤兄弟标签', () => {
    const hits = filterSearchHits(pool, 'foo', '工作');
    expect(hits.map((m) => m.slug)).toEqual(['b']);
  });

  it('keyword 为空抛错', () => {
    expect(() => filterSearchHits(pool, '   ')).toThrow(FlomoArgumentError);
    expect(parseSearchWords('  Foo  BAR ')).toEqual(['foo', 'bar']);
  });

  it('大小写不敏感', () => {
    expect(filterSearchHits(pool, 'FOO BAR').map((m) => m.slug)).toEqual(['a']);
  });
});
