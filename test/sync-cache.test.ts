import { describe, expect, it } from 'vitest';
import type { FlomoClient } from '../src/flomo/client.js';
import { FLOMO_TZ, getTz } from '../src/flomo/client.js';
import {
  isMemoCacheFresh,
  SYNC_FRESH_MS,
  SYNC_PAGE_LIMIT,
  syncMemoCache,
} from '../src/flomo/memos.js';
import { KV_VALUE_MAX_BYTES, parseMemoCache, serializeMemoCache, type Store } from '../src/flomo/store.js';
import { emptyMemoCache, type MemoCache, type TokenRecord } from '../src/flomo/types.js';
import { FlomoApiError } from '../src/errors.js';

class MemoryStore implements Store {
  readonly syncScope: string;
  memos: MemoCache;
  lockHeld = false;
  refuseLock = false;

  constructor(scope: string, memos = emptyMemoCache()) {
    this.syncScope = scope;
    this.memos = memos;
  }

  async loadToken(): Promise<TokenRecord | null> {
    return null;
  }
  async saveToken(): Promise<void> {}
  async clearToken(): Promise<void> {}
  async loadMemos(): Promise<MemoCache> {
    return structuredClone(this.memos);
  }
  async saveMemos(cache: MemoCache): Promise<void> {
    this.memos = structuredClone(cache);
  }
  async tryBeginSync(): Promise<boolean> {
    if (this.refuseLock || this.lockHeld) return false;
    this.lockHeld = true;
    return true;
  }
  async endSync(): Promise<void> {
    this.lockHeld = false;
  }
}

function fullPage(offset: number): unknown[] {
  return Array.from({ length: SYNC_PAGE_LIMIT }, (_, i) => {
    const n = offset + i;
    return {
      slug: `m${n}`,
      content: `<p>${n}</p>`,
      updated_at: '2026-01-01 12:00:00',
      created_at: '2026-01-01 12:00:00',
    };
  });
}

function fakeClient(queue: unknown[][]): FlomoClient & { calls: number } {
  const state = { calls: 0 };
  const client = {
    get calls() {
      return state.calls;
    },
    apiCall: async () => {
      state.calls += 1;
      return queue.shift() ?? [];
    },
  };
  return client as unknown as FlomoClient & { calls: number };
}

describe('serializeMemoCache KV 上限', () => {
  it('超过 maxBytes 抛 FlomoApiError，不返回残缺 JSON', () => {
    const cache = emptyMemoCache();
    cache.memos.a = { slug: 'a', content: 'hello' };
    expect(() => serializeMemoCache(cache, { maxBytes: 10 })).toThrow(FlomoApiError);
    expect(serializeMemoCache(cache).length).toBeGreaterThan(10);
    expect(KV_VALUE_MAX_BYTES).toBe(25 * 1024 * 1024);
  });
});

describe('syncMemoCache 分页续传', () => {
  it('单轮只拉 maxPages 页并落盘游标，未翻完不标新鲜', async () => {
    const store = new MemoryStore('cap');
    const client = fakeClient([fullPage(0), fullPage(200), fullPage(400)]);
    const cache = await syncMemoCache(client, store, { maxPages: 2 });
    expect(client.calls).toBe(2);
    expect(Object.keys(cache.memos)).toHaveLength(400);
    expect(cache.latest_slug).toBe('m399');
    expect(cache.complete).toBe(false);
    expect(isMemoCacheFresh(cache)).toBe(false);
    expect(store.memos.latest_slug).toBe('m399');
  });

  it('下一轮从已落盘进度继续，空页结束才标新鲜', async () => {
    const store = new MemoryStore('resume');
    const client = fakeClient([
      fullPage(0),
      fullPage(200),
      [{ slug: 'tail', content: '<p>t</p>', updated_at: '2026-01-01 12:00:01', created_at: '2026-01-01 12:00:01' }],
      [],
    ]);
    await syncMemoCache(client, store, { maxPages: 2 });
    expect(isMemoCacheFresh(store.memos)).toBe(false);
    const cache = await syncMemoCache(client, store, { maxPages: 2 });
    expect(client.calls).toBe(4);
    expect(cache.memos.tail?.slug).toBe('tail');
    expect(Object.keys(cache.memos)).toHaveLength(401);
    expect(cache.complete).toBe(true);
    expect(isMemoCacheFresh(cache)).toBe(true);
  });

  it('短页不是 EOF：后面还有满页就继续翻', async () => {
    const store = new MemoryStore('short-not-eof');
    const short = fullPage(0).slice(0, 31);
    const client = fakeClient([short, fullPage(31), []]);
    const cache = await syncMemoCache(client, store, { maxPages: 8 });
    expect(client.calls).toBe(3);
    expect(Object.keys(cache.memos)).toHaveLength(231);
    expect(cache.complete).toBe(true);
    expect(isMemoCacheFresh(cache)).toBe(true);
  });

  it('新鲜窗口内不再打 /memo/updated/', async () => {
    const store = new MemoryStore('fresh', {
      ...emptyMemoCache(),
      complete: true,
      synced_at: Date.now(),
    });
    const client = fakeClient([fullPage(0)]);
    await syncMemoCache(client, store, { maxPages: 2 });
    expect(client.calls).toBe(0);
    expect(isMemoCacheFresh(store.memos, Date.now() + SYNC_FRESH_MS - 1000)).toBe(true);
    expect(isMemoCacheFresh(store.memos, Date.now() + SYNC_FRESH_MS + 1000)).toBe(false);
  });

  it('拿不到锁时不发请求，避免并行工具打满子请求', async () => {
    const store = new MemoryStore('locked', emptyMemoCache());
    store.refuseLock = true;
    const client = fakeClient([fullPage(0)]);
    const cache = await syncMemoCache(client, store, { maxPages: 8 });
    expect(client.calls).toBe(0);
    expect(cache.memos).toEqual({});
  });

  it('同一 syncScope 并行只跑一轮', async () => {
    const store = new MemoryStore('inflight');
    const queue = [fullPage(0), fullPage(200)];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const client = {
      apiCall: async () => {
        calls += 1;
        await gate;
        return queue.shift() ?? [];
      },
    } as unknown as FlomoClient;
    const a = syncMemoCache(client, store, { maxPages: 2 });
    const b = syncMemoCache(client, store, { maxPages: 2 });
    release();
    const [left, right] = await Promise.all([a, b]);
    expect(calls).toBe(2);
    expect(Object.keys(left.memos)).toHaveLength(400);
    expect(Object.keys(right.memos)).toHaveLength(400);
  });

  it('子请求超限时落盘已翻过的游标，不标完成', async () => {
    const store = new MemoryStore('subreq');
    let calls = 0;
    const client = {
      apiCall: async () => {
        calls += 1;
        if (calls === 3) throw new Error('Too many subrequests by single Worker invocation');
        return fullPage((calls - 1) * SYNC_PAGE_LIMIT);
      },
    } as unknown as FlomoClient;
    const cache = await syncMemoCache(client, store, { maxPages: 8 });
    expect(calls).toBe(3);
    expect(Object.keys(cache.memos)).toHaveLength(400);
    expect(cache.latest_slug).toBe('m399');
    expect(cache.complete).toBe(false);
    expect(isMemoCacheFresh(cache)).toBe(false);
  });
});

describe('parseMemoCache 旧快照', () => {
  it('没有 complete 字段时丢掉游标并保留已有 memo', () => {
    const cache = parseMemoCache(JSON.stringify({
      latest_updated_at: 1700000000,
      latest_slug: 'stuck',
      synced_at: Date.now(),
      memos: { a: { slug: 'a', content: 'keep' } },
    }));
    expect(cache.latest_updated_at).toBe(0);
    expect(cache.latest_slug).toBe('');
    expect(cache.synced_at).toBe(0);
    expect(cache.complete).toBe(false);
    expect(cache.memos.a?.slug).toBe('a');
  });

  it('新快照 complete=true 时保留游标', () => {
    const cache = parseMemoCache(JSON.stringify({
      latest_updated_at: 1700000000,
      latest_slug: 'ok',
      synced_at: 123,
      complete: true,
      memos: { a: { slug: 'a' } },
    }));
    expect(cache.latest_updated_at).toBe(1700000000);
    expect(cache.latest_slug).toBe('ok');
    expect(cache.complete).toBe(true);
    expect(cache.synced_at).toBe(123);
  });
});

describe('getTz', () => {
  it('固定发 8:0，不跟 Worker UTC 走', () => {
    expect(getTz()).toBe('8:0');
    expect(FLOMO_TZ).toBe('8:0');
  });
});
