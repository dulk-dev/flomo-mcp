import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { FlomoApiError } from "../errors.js";
import { emptyMemoCache, type MemoCache, type TokenRecord } from "./types.js";

export interface Store {
  /** In-process sync mutex key. */
  readonly syncScope: string;
  loadToken(): Promise<TokenRecord | null>;
  saveToken(record: TokenRecord): Promise<void>;
  clearToken(): Promise<void>;
  loadMemos(): Promise<MemoCache>;
  saveMemos(cache: MemoCache): Promise<void>;
  tryBeginSync(): Promise<boolean>;
  endSync(): Promise<void>;
}

/** Lock TTL if endSync never runs. */
const SYNC_LOCK_TTL_SEC = 60;

const dirSyncLocks = new Map<string, number>();

export function serializeMemoCache(cache: MemoCache): string {
  try {
    return JSON.stringify(cache);
  } catch {
    throw new FlomoApiError("memo 缓存无法序列化（体积过大）");
  }
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
    const memos = rec.memos as MemoCache["memos"];
    // Snapshots written before `complete` existed treated a short page as EOF
    // and froze latest_* / synced_at. Drop that cursor so the next sync
    // re-walks from 0 and merges into the memos we already have.
    if (!Object.prototype.hasOwnProperty.call(rec, "complete")) {
      return {
        latest_updated_at: 0,
        latest_slug: "",
        synced_at: 0,
        complete: false,
        memos,
      };
    }
    return {
      latest_updated_at: Number(rec.latest_updated_at) || 0,
      latest_slug: String(rec.latest_slug || ""),
      synced_at: Number(rec.synced_at) || 0,
      complete: rec.complete === true,
      memos,
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
