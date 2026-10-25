import { describe, expect, it, vi } from 'vitest';
import type { FlomoClient } from '../src/flomo/client.js';
import type { Store } from '../src/flomo/store.js';
import { startMemoSync } from '../src/sync.js';
import { emptyMemoCache, type MemoCache, type TokenRecord } from '../src/flomo/types.js';

class MemoryStore implements Store {
  readonly syncScope = 'sync-loop';
  memos: MemoCache = emptyMemoCache();
  lockHeld = false;

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
    if (this.lockHeld) return false;
    this.lockHeld = true;
    return true;
  }
  async endSync(): Promise<void> {
    this.lockHeld = false;
  }
}

function client(onCall: () => unknown[]): FlomoClient {
  return { apiCall: async () => onCall() } as unknown as FlomoClient;
}

describe('startMemoSync', () => {
  it('启动时强制一轮，间隔到点且缓存过期后再一轮', async () => {
    const store = new MemoryStore();
    let calls = 0;
    const stop = startMemoSync(client(() => {
      calls += 1;
      return [];
    }), store, 30);
    try {
      await vi.waitFor(() => expect(store.memos.complete).toBe(true));
      expect(calls).toBe(1);
      store.memos.complete = false;
      store.memos.synced_at = 0;
      await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(2));
    } finally {
      stop();
    }
  });

  it('间隔为 0 时不再定时同步', async () => {
    const store = new MemoryStore();
    let calls = 0;
    const stop = startMemoSync(client(() => {
      calls += 1;
      return [];
    }), store, 0);
    try {
      await vi.waitFor(() => expect(calls).toBe(1));
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(calls).toBe(1);
    } finally {
      stop();
    }
  });
});
