import { createHash } from 'node:crypto';
import { FlomoApiError, FlomoAuthError, FlomoEmptyError, FlomoTimeoutError } from '../errors.js';
import { API_V1, v1, type FlomoCredentials, type TokenRecord } from './types.js';
import type { Store } from './store.js';

const SIGN_SALT = 'dbbc3dd73364b4084c3a69346e0ce2b2';

export type ApiParamValue = string | number | boolean | Array<string | number>;
export type ApiParams = Record<string, ApiParamValue | undefined>;

/**
 * flomo web / memo timestamps are China Standard Time. Cloudflare Workers
 * run UTC, so `getTimezoneOffset()` would send `0:0` and desync the cursor
 * from `toEpochSeconds` (which already assumes +08:00).
 */
export const FLOMO_TZ = '8:0';

export function getTz(): string {
  return FLOMO_TZ;
}

/** flomo 通用签名：ksort → k=v& 串联（数组 k[]=v& 且元素排序）→ MD5(base+salt). */
export function signParams(params: Record<string, unknown>): string {
  const keys = Object.keys(params).sort();
  let base = '';
  for (const key of keys) {
    const val = params[key];
    if (val === undefined || (!val && val !== 0)) continue;
    if (Array.isArray(val)) {
      const sorted = [...val].sort((a, b) => String(a).localeCompare(String(b)));
      for (const item of sorted) base += `${key}[]=${item}&`;
    } else {
      base += `${key}=${val}&`;
    }
  }
  base = base.slice(0, -1);
  return createHash('md5').update(base + SIGN_SALT).digest('hex');
}

export function prepareParams(extra: ApiParams = {}): Record<string, unknown> {
  const params: Record<string, unknown> = {
    ...extra,
    timestamp: String(Math.floor(Date.now() / 1000)),
    api_key: 'flomo_web',
    app_version: '4.0',
    platform: 'web',
    webp: '1',
  };
  params.sign = signParams(params);
  return params;
}

function isAuthMessage(message: string): boolean {
  return /auth|unauth|token|permission|forbidden|unauthorized|登录|登陆|鉴权|权限|过期/i.test(message);
}

function toQuery(params: Record<string, unknown>): string {
  const rec: Record<string, string> = {};
  for (const [key, val] of Object.entries(params)) {
    if (val === undefined) continue;
    rec[key] = Array.isArray(val) ? val.join(',') : String(val);
  }
  return new URLSearchParams(rec).toString();
}

export type InsightStream = {
  chatId: string;
  content: string;
  think: string;
  referenceSlugs: string[];
};

export class FlomoClient {
  /** Avoid a KV get on every apiCall during a multi-page sync. */
  private memoryToken: string | null = null;

  constructor(
    private readonly store: Store,
    private readonly credentials: FlomoCredentials,
  ) {}

  async rememberUser(user: Record<string, unknown>): Promise<void> {
    const cached = await this.store.loadToken();
    const token = cached?.access_token;
    if (!token) return;
    await this.store.saveToken(tokenRecord(token, user));
  }

  async apiCall(
    method: string,
    url: string,
    extra: ApiParams = {},
    options: { useBody?: boolean } = {},
  ): Promise<unknown> {
    return this.withAuthRetry((token) => this.apiCallOnce(method, url, extra, token, options));
  }

  async apiSSE(apiPath: string, extra: ApiParams, options: { timeoutSec?: number } = {}): Promise<InsightStream> {
    return this.withAuthRetry((token) => this.apiSSEOnce(apiPath, extra, token, options));
  }

  private async withAuthRetry<T>(fn: (token: string) => Promise<T>): Promise<T> {
    const token = await this.ensureToken();
    try {
      return await fn(token);
    } catch (error) {
      if (!(error instanceof FlomoAuthError)) throw error;
      this.memoryToken = null;
      await this.store.clearToken();
      if (!this.credentials.account || !this.credentials.password) throw error;
      const next = await this.loginByEmail();
      return await fn(next);
    }
  }

  private async ensureToken(): Promise<string> {
    if (this.memoryToken) return this.memoryToken;
    const cached = await this.store.loadToken();
    if (cached?.access_token) {
      this.memoryToken = cached.access_token;
      return this.memoryToken;
    }
    if (this.credentials.accessToken) {
      await this.store.saveToken(tokenRecord(this.credentials.accessToken, {}));
      this.memoryToken = this.credentials.accessToken;
      return this.memoryToken;
    }
    return this.loginByEmail();
  }

  private async loginByEmail(): Promise<string> {
    if (!this.credentials.account || !this.credentials.password) {
      throw new FlomoAuthError('没有可用的 flomo 登录态，且未配置 FLOMO_ACCOUNT / FLOMO_PASSWORD');
    }
    const params = prepareParams({
      email: this.credentials.account,
      password: this.credentials.password,
      wechat_union_id: '',
      wechat_oa_open_id: '',
      apple_sub: '',
    });
    let resp: Response;
    try {
      resp = await fetch(`${API_V1}/user/login_by_email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(params),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new FlomoApiError(`登录请求失败: ${message}`);
    }
    let body: unknown;
    try {
      body = await resp.json();
    } catch {
      throw new FlomoApiError(`登录接口返回非 JSON（HTTP ${resp.status}）`);
    }
    const envelope = asEnvelope(body);
    if (!envelope || envelope.code !== 0) {
      const message = envelope?.message || `登录失败（HTTP ${resp.status}）`;
      throw new FlomoAuthError(`flomo 登录被拒：${message}。检查 FLOMO_ACCOUNT / FLOMO_PASSWORD`);
    }
    const data = envelope.data && typeof envelope.data === 'object'
      ? envelope.data as Record<string, unknown>
      : null;
    const token = data && typeof data.access_token === 'string' ? data.access_token : '';
    if (!token) throw new FlomoApiError('登录成功但响应里没有 access_token，接口可能已改版');
    await this.store.saveToken(tokenRecord(token, data ?? {}));
    this.memoryToken = token;
    return token;
  }

  private async apiCallOnce(
    method: string,
    url: string,
    extra: ApiParams,
    token: string,
    { useBody }: { useBody?: boolean },
  ): Promise<unknown> {
    const m = method.toUpperCase();
    const inBody = useBody ?? ['POST', 'PUT', 'PATCH'].includes(m);
    const params = prepareParams(extra);
    const target = inBody ? url : `${url}?${toQuery(params)}`;
    let resp: Response;
    try {
      resp = await fetch(target, {
        method: m,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(inBody ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(inBody ? { body: JSON.stringify(params) } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new FlomoApiError(`flomo API 请求失败（${m} ${url}）: ${message}`);
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new FlomoAuthError(`flomo API 返回 HTTP ${resp.status}，登录态失效`);
    }
    let body: unknown;
    try {
      body = await resp.json();
    } catch {
      throw new FlomoApiError(`flomo API 返回非 JSON（HTTP ${resp.status}，${m} ${url}）`);
    }
    const envelope = asEnvelope(body);
    if (!resp.ok) {
      throw new FlomoApiError(`flomo API HTTP ${resp.status}: ${envelope?.message || ''}`);
    }
    if (!envelope || typeof envelope.code !== 'number') {
      throw new FlomoApiError('flomo API 响应缺少 code 字段，接口可能已改版');
    }
    if (envelope.code !== 0) {
      const message = envelope.message || `flomo API error code ${envelope.code}`;
      if (isAuthMessage(message)) throw new FlomoAuthError(message);
      throw new FlomoApiError(message);
    }
    return envelope.data;
  }

  private async apiSSEOnce(
    apiPath: string,
    extra: ApiParams,
    token: string,
    { timeoutSec = 180 }: { timeoutSec?: number },
  ): Promise<InsightStream> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutSec * 1000);
    let resp: Response;
    try {
      resp = await fetch(v1(apiPath), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(prepareParams(extra)),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      const message = error instanceof Error ? error.message : String(error);
      throw new FlomoApiError(`flomo SSE 请求失败: ${message}`);
    }
    if (resp.status === 401 || resp.status === 403) {
      clearTimeout(timer);
      throw new FlomoAuthError(`flomo API 返回 HTTP ${resp.status}，登录态失效`);
    }
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('text/event-stream')) {
      clearTimeout(timer);
      const body = await resp.json().catch(() => null);
      const envelope = asEnvelope(body);
      const message = envelope?.message || `HTTP ${resp.status}（content-type: ${ct}）`;
      if (isAuthMessage(message)) throw new FlomoAuthError(message);
      throw new FlomoApiError(`AI 洞察未返回流式响应：${message}`);
    }
    const out: InsightStream = { chatId: '', content: '', think: '', referenceSlugs: [] };
    const reader = resp.body?.getReader();
    if (!reader) {
      clearTimeout(timer);
      throw new FlomoApiError('洞察流没有 body');
    }
    const decoder = new TextDecoder();
    let buffer = '';
    let doneStream = false;
    try {
      while (!doneStream) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx = buffer.indexOf('\n');
        while (idx >= 0) {
          const line = buffer.slice(0, idx).replace(/\r$/, '');
          buffer = buffer.slice(idx + 1);
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim();
            if (data === '[DONE]') {
              doneStream = true;
              break;
            }
            let event: unknown;
            try {
              event = JSON.parse(data);
            } catch {
              idx = buffer.indexOf('\n');
              continue;
            }
            applyInsightDelta(out, event);
          }
          idx = buffer.indexOf('\n');
        }
      }
    } catch (error) {
      if (error instanceof FlomoApiError) throw error;
      if (controller.signal.aborted) throw new FlomoTimeoutError(`flomo AI insight stream 超时（${timeoutSec}s）`);
      const message = error instanceof Error ? error.message : String(error);
      throw new FlomoApiError(`读取洞察流失败: ${message}`);
    } finally {
      clearTimeout(timer);
      reader.releaseLock();
    }
    if (!out.content.trim()) {
      throw new FlomoEmptyError('洞察流结束但没有产出内容（可能笔记太少或额度用尽）');
    }
    return out;
  }
}

function tokenRecord(accessToken: string, user: Record<string, unknown>): TokenRecord {
  return {
    access_token: accessToken,
    user: {
      id: user.id == null ? null : String(user.id),
      name: user.name == null ? null : String(user.name),
      email: user.email == null ? null : String(user.email),
    },
    saved_at: new Date().toISOString(),
  };
}

function asEnvelope(body: unknown): { code?: number; message?: string; data?: unknown } | null {
  if (!body || typeof body !== 'object') return null;
  const rec = body as Record<string, unknown>;
  return {
    code: typeof rec.code === 'number' ? rec.code : undefined,
    message: rec.message == null ? undefined : String(rec.message),
    data: rec.data,
  };
}

function applyInsightDelta(out: InsightStream, event: unknown): void {
  if (!event || typeof event !== 'object') return;
  const rec = event as Record<string, unknown>;
  if (typeof rec.message === 'string' && rec.choices == null) {
    throw new FlomoApiError(`AI 洞察出错：${rec.message}`);
  }
  if (rec.id != null) out.chatId = String(rec.id);
  const choices = rec.choices;
  if (!Array.isArray(choices) || choices.length === 0) return;
  const first = choices[0];
  if (!first || typeof first !== 'object') return;
  const delta = (first as Record<string, unknown>).delta;
  if (!delta || typeof delta !== 'object') return;
  const d = delta as Record<string, unknown>;
  if (typeof d.content === 'string') out.content += d.content;
  if (typeof d.reasoning_content === 'string') out.think += d.reasoning_content;
  if (Array.isArray(d.reference_memos)) {
    out.referenceSlugs = d.reference_memos
      .map((m) => {
        if (typeof m === 'string') return m;
        if (m && typeof m === 'object' && 'slug' in m) return String((m as { slug?: unknown }).slug || '');
        return '';
      })
      .filter(Boolean);
  }
}
