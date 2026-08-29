import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { emptyMemoCache, type MemoCache, type TokenRecord } from './types.js';

export interface Store {
  loadToken(): Promise<TokenRecord | null>;
  saveToken(record: TokenRecord): Promise<void>;
  clearToken(): Promise<void>;
  loadMemos(): Promise<MemoCache>;
  saveMemos(cache: MemoCache): Promise<void>;
}

export class DirStore implements Store {
  constructor(private readonly dir: string) {}

  private tokenPath(): string {
    return path.join(this.dir, 'token.json');
  }

  private memosPath(): string {
    return path.join(this.dir, 'memos.json');
  }

  async loadToken(): Promise<TokenRecord | null> {
    try {
      const raw = await readFile(this.tokenPath(), 'utf8');
      const data: unknown = JSON.parse(raw);
      if (!data || typeof data !== 'object') return null;
      const rec = data as Record<string, unknown>;
      if (typeof rec.access_token !== 'string' || rec.access_token.length === 0) return null;
      const userRaw = rec.user && typeof rec.user === 'object' ? rec.user as Record<string, unknown> : {};
      return {
        access_token: rec.access_token,
        user: {
          id: userRaw.id == null ? null : String(userRaw.id),
          name: userRaw.name == null ? null : String(userRaw.name),
          email: userRaw.email == null ? null : String(userRaw.email),
        },
        saved_at: typeof rec.saved_at === 'string' ? rec.saved_at : '',
      };
    } catch {
      return null;
    }
  }

  async saveToken(record: TokenRecord): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.tokenPath(), JSON.stringify(record, null, 2), 'utf8');
  }

  async clearToken(): Promise<void> {
    try {
      await rm(this.tokenPath());
    } catch {
      /* already gone */
    }
  }

  async loadMemos(): Promise<MemoCache> {
    try {
      const raw = await readFile(this.memosPath(), 'utf8');
      const data: unknown = JSON.parse(raw);
      if (!data || typeof data !== 'object') return emptyMemoCache();
      const rec = data as Record<string, unknown>;
      if (!rec.memos || typeof rec.memos !== 'object' || Array.isArray(rec.memos)) {
        return emptyMemoCache();
      }
      return {
        latest_updated_at: Number(rec.latest_updated_at) || 0,
        latest_slug: String(rec.latest_slug || ''),
        synced_at: Number(rec.synced_at) || 0,
        memos: rec.memos as MemoCache['memos'],
      };
    } catch {
      return emptyMemoCache();
    }
  }

  async saveMemos(cache: MemoCache): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.memosPath(), JSON.stringify(cache), 'utf8');
  }
}
