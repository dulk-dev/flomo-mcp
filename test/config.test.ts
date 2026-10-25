import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DATA_DIR,
  loadConfig,
  parseSyncIntervalMs,
  resolveDataDir,
} from '../src/config.js';
import { SYNC_FRESH_MS } from '../src/flomo/memos.js';

describe('resolveDataDir', () => {
  it('默认 /workspace/cache/flomo-cache', () => {
    expect(DEFAULT_DATA_DIR).toBe('/workspace/cache/flomo-cache');
    expect(resolveDataDir(undefined)).toBe('/workspace/cache/flomo-cache');
    expect(resolveDataDir('  ')).toBe('/workspace/cache/flomo-cache');
  });

  it('FLOMO_DATA_DIR 覆盖', () => {
    expect(resolveDataDir('  /tmp/flomo  ')).toBe('/tmp/flomo');
  });
});

describe('parseSyncIntervalMs', () => {
  it('缺省等于新鲜窗口', () => {
    expect(parseSyncIntervalMs(undefined)).toBe(SYNC_FRESH_MS);
    expect(parseSyncIntervalMs('')).toBe(15 * 60 * 1000);
  });

  it('0 和 off 关闭', () => {
    expect(parseSyncIntervalMs('0')).toBe(0);
    expect(parseSyncIntervalMs('off')).toBe(0);
    expect(parseSyncIntervalMs(' OFF ')).toBe(0);
  });

  it('接受正整数毫秒', () => {
    expect(parseSyncIntervalMs('5000')).toBe(5000);
  });

  it('拒绝非法值', () => {
    expect(parseSyncIntervalMs('-1')).toEqual({ error: expect.stringContaining('FLOMO_SYNC_INTERVAL_MS') });
    expect(parseSyncIntervalMs('1.5')).toEqual({ error: expect.stringContaining('FLOMO_SYNC_INTERVAL_MS') });
    expect(parseSyncIntervalMs('abc')).toEqual({ error: expect.stringContaining('FLOMO_SYNC_INTERVAL_MS') });
  });
});

describe('loadConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('不要求 MCP_API_KEY', () => {
    const config = loadConfig({
      FLOMO_ACCESS_TOKEN: 'tok',
      FLOMO_SYNC_INTERVAL_MS: '0',
    });
    expect(config.dataDir).toBe('/workspace/cache/flomo-cache');
    expect(config.syncIntervalMs).toBe(0);
    expect(config.credentials.accessToken).toBe('tok');
  });

  it('没有 flomo 凭据时拒绝启动', () => {
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });
    expect(() => loadConfig({})).toThrow('exit 1');
  });
});
