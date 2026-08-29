import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { FlomoApiError } from "../errors.js";
import { emptyMemoCache, type MemoCache, type TokenRecord } from "./types.js";

export interface Store {
  /** Same-isolate sync mutex key. All Worker KV stores share one scope. */
  readonly syncScope: string;
  loadToken(): Promise<TokenRecord | null>;
  saveToken(record: TokenRecord): Promise<void>;
  clearToken(): Promise<void>;
  loadMemos(): Promise<MemoCache>;
  saveMemos(cache: MemoCache): Promise<void>;
  tryBeginSync(): Promise<boolean>;
  endSync(): Promise<void>;
}

const TOKEN_KEY = "token.json";
const MEMOS_KEY = "memos.json";
const SYNC_LOCK_KEY = "sync.lock";
/** KV expirationTtl minimum is 60s; also the lock TTL if endSync never runs. */
const SYNC_LOCK_TTL_SEC = 60;

export const KV_VALUE_MAX_BYTES = 25 * 1024 * 1024;

const dirSyncLocks = new Map<string, number>();

export function serializeMemoCache(
  cache: MemoCache,
  { maxBytes }: { maxBytes?: number } = {},
): string {
  let json: string;
  try {
    json = JSON.stringify(cache);
  } catch {
    throw new FlomoApiError("memo 缓存无法序列化（体积过大）");
  }
  if (maxBytes != null) {
    const bytes = new TextEncoder().encode(json).byteLength;
    if (bytes > maxBytes) {
      throw new FlomoApiError(
        `memo 缓存 ${bytes} 字节超过 KV 单 key 上限 ${maxBytes}（25 MiB），停止写入以免打坏现有快照`,
      );
    }
  }
  return json;
}

export function parseTokenRecord(raw: string): TokenRecord | null {
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    const rec = data as Record<string, unknown>;
    if (typeof rec.access_token !== "string" || rec.access_token.length === 0)
      return null;
    const userRaw =
      rec.user && typeof rec.user === "object"
        ? (rec.user as Record<string, unknown>)
        : {};
    return {
      access_token: rec.access_token,
      user: {
        id: userRaw.id == null ? null : String(userRaw.id),
        name: userRaw.name == null ? null : String(userRaw.name),
        email: userRaw.email == null ? null : String(userRaw.email),
      },
      saved_at: typeof rec.saved_at === "string" ? rec.saved_at : "",
    };
  } catch {
    return null;
  }
}

export function parseMemoCache(raw: string): MemoCache {
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return emptyMemoCache();
    const rec = data as Record<string, unknown>;
    if (
      !rec.memos ||
      typeof rec.memos !== "object" ||
      Array.isArray(rec.memos)
    ) {
      return emptyMemoCache();
    }
    return {
      latest_updated_at: Number(rec.latest_updated_at) || 0,
      latest_slug: String(rec.latest_slug || ""),
      synced_at: Number(rec.synced_at) || 0,
      memos: rec.memos as MemoCache["memos"],
    };
  } catch {
    return emptyMemoCache();
  }
}

export class DirStore implements Store {
  readonly syncScope: string;

  constructor(private readonly dir: string) {
    this.syncScope = `dir:${dir}`;
  }

  private tokenPath(): string {
    return path.join(this.dir, "token.json");
  }

  private memosPath(): string {
    return path.join(this.dir, "memos.json");
  }

  async loadToken(): Promise<TokenRecord | null> {
    try {
      return parseTokenRecord(await readFile(this.tokenPath(), "utf8"));
    } catch {
      return null;
    }
  }

  async saveToken(record: TokenRecord): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.tokenPath(), JSON.stringify(record, null, 2), "utf8");
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
      return parseMemoCache(await readFile(this.memosPath(), "utf8"));
    } catch {
      return emptyMemoCache();
    }
  }

  async saveMemos(cache: MemoCache): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.memosPath(), serializeMemoCache(cache), "utf8");
  }

  async tryBeginSync(): Promise<boolean> {
    const now = Date.now();
    const until = dirSyncLocks.get(this.dir) ?? 0;
    if (now < until) return false;
    dirSyncLocks.set(this.dir, now + SYNC_LOCK_TTL_SEC * 1000);
    return true;
  }

  async endSync(): Promise<void> {
    dirSyncLocks.delete(this.dir);
  }
}

export type KvLike = {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
};

export class KvStore implements Store {
  readonly syncScope = "kv";

  constructor(private readonly kv: KvLike) {}

  async loadToken(): Promise<TokenRecord | null> {
    const raw = await this.kv.get(TOKEN_KEY);
    return raw ? parseTokenRecord(raw) : null;
  }

  async saveToken(record: TokenRecord): Promise<void> {
    await this.kv.put(TOKEN_KEY, JSON.stringify(record));
  }

  async clearToken(): Promise<void> {
    await this.kv.delete(TOKEN_KEY);
  }

  async loadMemos(): Promise<MemoCache> {
    const raw = await this.kv.get(MEMOS_KEY);
    return raw ? parseMemoCache(raw) : emptyMemoCache();
  }

  async saveMemos(cache: MemoCache): Promise<void> {
    await this.kv.put(
      MEMOS_KEY,
      serializeMemoCache(cache, { maxBytes: KV_VALUE_MAX_BYTES }),
    );
  }

  async tryBeginSync(): Promise<boolean> {
    const held = await this.kv.get(SYNC_LOCK_KEY);
    if (held) return false;
    await this.kv.put(SYNC_LOCK_KEY, "1", { expirationTtl: SYNC_LOCK_TTL_SEC });
    return true;
  }

  async endSync(): Promise<void> {
    await this.kv.delete(SYNC_LOCK_KEY);
  }
}
