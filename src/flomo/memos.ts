import { FlomoApiError, FlomoArgumentError, FlomoEmptyError } from '../errors.js';
import type { FlomoClient } from './client.js';
import { getTz } from './client.js';
import type { Store } from './store.js';
import { v1, WEB_BASE, type FlomoFile, type FlomoMemo, type MemoCache } from './types.js';

const SYNC_PAGE_LIMIT = 200;
const SYNC_FRESH_MS = 60 * 1000;

export const MEMO_COLUMNS = ['slug', 'content', 'tags', 'images', 'created_at', 'updated_at', 'url'] as const;

export type MemoRow = {
  slug: string;
  content: string;
  tags: string;
  images: string;
  created_at: string;
  updated_at: string;
  url: string;
};

export function toEpochSeconds(text: string): number {
  const t = String(text || '').trim();
  if (!t) return 0;
  const d = new Date(t.replace(' ', 'T') + '+08:00');
  return Number.isNaN(d.getTime()) ? 0 : Math.floor(d.getTime() / 1000);
}

export function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

export function parseDateArg(input: string): string | null {
  const t = String(input ?? '').trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return `${t} 12:00:00`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(t)) return t.length === 16 ? `${t}:00` : t;
  throw new FlomoArgumentError(`date 格式应为 YYYY-MM-DD 或 "YYYY-MM-DD HH:mm[:ss]"（got "${input}"）`);
}

export function textToHtml(text: string): string {
  const t = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!t) throw new FlomoArgumentError('content 不能为空');
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return t.split('\n').map((line) => `<p>${escape(line)}</p>`).join('');
}

export function htmlToText(html: unknown): string {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizeTags(tags: unknown): string {
  if (!Array.isArray(tags)) return '';
  return tags
    .map((tag) => (typeof tag === 'string' ? tag : (tag && typeof tag === 'object' && 'name' in tag ? String((tag as { name?: unknown }).name || '') : '')))
    .map((t) => String(t).trim())
    .filter(Boolean)
    .join(', ');
}

export function normalizeImages(files: unknown): string {
  if (!Array.isArray(files)) return '';
  return files
    .map((f) => {
      if (!f || typeof f !== 'object') return '';
      const rec = f as FlomoFile;
      return rec.thumbnail_url || rec.url || '';
    })
    .map((u) => String(u).trim())
    .filter(Boolean)
    .join(' | ');
}

export function memoFileIds(files: unknown): Array<string | number> {
  if (!Array.isArray(files)) return [];
  const ids: Array<string | number> = [];
  for (const f of files) {
    if (!f || typeof f !== 'object' || !('id' in f)) continue;
    const id = (f as FlomoFile).id;
    if (id != null) ids.push(id);
  }
  return ids;
}

export function memoUrl(slug: string): string {
  return slug ? `${WEB_BASE}/mine/?memo_id=${encodeURIComponent(slug)}` : '';
}

export function memoRow(memo: FlomoMemo): MemoRow {
  const slug = String(memo.slug || '');
  return {
    slug,
    content: htmlToText(memo.content),
    tags: normalizeTags(memo.tags),
    images: normalizeImages(memo.files),
    created_at: String(memo.created_at || ''),
    updated_at: String(memo.updated_at || ''),
    url: memoUrl(slug),
  };
}

export function parseLimitArg(
  value: unknown,
  fallback: number,
  { max = 500, label = 'limit' }: { max?: number; label?: string } = {},
): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(String(value).trim());
  if (!Number.isSafeInteger(n) || n < 1 || n > max) {
    throw new FlomoArgumentError(`${label} 必须是 1-${max} 的整数（got "${value}"）`);
  }
  return n;
}

export function requireSlugArg(value: unknown, label = 'slug'): string {
  const slug = String(value ?? '').trim();
  if (!/^[A-Za-z0-9_=-]{4,128}$/.test(slug)) {
    throw new FlomoArgumentError(`${label} 格式不对（got "${value}"），应为 memo 列表里的 slug`);
  }
  return slug;
}

export function ensureNonEmptyList<T>(list: T[], hint: string): T[] {
  if (!Array.isArray(list) || list.length === 0) throw new FlomoEmptyError(hint);
  return list;
}

export function activeMemos(cache: MemoCache): FlomoMemo[] {
  return Object.values(cache.memos).filter((m) => !m.deleted_at);
}

export function trashedMemos(cache: MemoCache): FlomoMemo[] {
  return Object.values(cache.memos).filter((m) => m.deleted_at);
}

export function parseSearchWords(keyword: string): string[] {
  return String(keyword ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function memoMatchesTag(memo: FlomoMemo, tagQuery: string): boolean {
  const q = String(tagQuery ?? '').trim().replace(/^#/, '').toLowerCase();
  if (!q) return true;
  return normalizeTags(memo.tags).toLowerCase().split(', ')
    .some((t) => t === q || t.startsWith(`${q}/`));
}

export function memoMatchesKeywords(memo: FlomoMemo, words: string[]): boolean {
  if (words.length === 0) return false;
  const haystack = `${htmlToText(memo.content)}\n${normalizeTags(memo.tags)}`.toLowerCase();
  return words.every((w) => haystack.includes(w));
}

export function filterSearchHits(memos: FlomoMemo[], keyword: string, tag = ''): FlomoMemo[] {
  const words = parseSearchWords(keyword);
  if (words.length === 0) throw new FlomoArgumentError('keyword 不能为空');
  return memos.filter((m) => memoMatchesTag(m, tag) && memoMatchesKeywords(m, words));
}

export async function syncMemoCache(
  client: FlomoClient,
  store: Store,
  { force = false }: { force?: boolean } = {},
): Promise<MemoCache> {
  const cache = await store.loadMemos();
  if (!force && Date.now() - cache.synced_at < SYNC_FRESH_MS) return cache;
  let cursorAt = cache.latest_updated_at || 0;
  let cursorSlug = cache.latest_slug || '';
  for (let page = 0; page < 500; page++) {
    const extra: Record<string, string> = {
      limit: String(SYNC_PAGE_LIMIT),
      latest_updated_at: String(cursorAt),
      tz: getTz(),
    };
    if (cursorSlug) extra.latest_slug = cursorSlug;
    const batch = await client.apiCall('GET', v1('/memo/updated/'), extra);
    if (!Array.isArray(batch)) throw new FlomoApiError('flomo /memo/updated/ 返回了非数组数据');
    for (const item of batch) {
      const memo = asMemo(item);
      if (!memo) continue;
      cache.memos[memo.slug] = memo;
    }
    if (batch.length > 0) {
      const last = asMemo(batch[batch.length - 1]);
      if (last) {
        cursorAt = toEpochSeconds(last.updated_at || '');
        cursorSlug = last.slug;
      }
    }
    if (batch.length < SYNC_PAGE_LIMIT) break;
  }
  cache.latest_updated_at = cursorAt;
  cache.latest_slug = cursorSlug;
  cache.synced_at = Date.now();
  await store.saveMemos(cache);
  return cache;
}

export async function invalidateMemoCacheFreshness(store: Store): Promise<void> {
  const cache = await store.loadMemos();
  cache.synced_at = 0;
  await store.saveMemos(cache);
}

export async function fetchAllTags(
  client: FlomoClient,
  { includeDeleted = false }: { includeDeleted?: boolean } = {},
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let latestUpdatedAt = '0';
  let latestId = '';
  for (let page = 0; page < 50; page++) {
    const extra: Record<string, string> = { limit: '200', latest_updated_at: latestUpdatedAt, tz: getTz() };
    if (latestId) extra.latest_id = latestId;
    const batch = await client.apiCall('GET', v1('/tag/updated/'), extra);
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const item of batch) {
      if (item && typeof item === 'object') out.push(item as Record<string, unknown>);
    }
    const last = batch[batch.length - 1];
    if (last && typeof last === 'object') {
      const rec = last as Record<string, unknown>;
      latestUpdatedAt = String(toEpochSeconds(String(rec.updated_at || '')));
      latestId = String(rec.id ?? '');
    }
    if (batch.length < 200) break;
  }
  return includeDeleted ? out : out.filter((t) => !t.deleted_at);
}

export function asMemo(value: unknown): FlomoMemo | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  const slug = String(rec.slug || '').trim();
  if (!slug) return null;
  return {
    slug,
    content: rec.content == null ? undefined : String(rec.content),
    tags: rec.tags,
    files: rec.files,
    pin: rec.pin,
    linked_count: rec.linked_count,
    created_at: rec.created_at == null ? undefined : String(rec.created_at),
    updated_at: rec.updated_at == null ? undefined : String(rec.updated_at),
    deleted_at: rec.deleted_at ? String(rec.deleted_at) : rec.deleted_at === null ? null : undefined,
  };
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
