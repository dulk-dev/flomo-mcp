import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { prepareParams, signParams } from '../src/flomo/client.js';

const SALT = 'dbbc3dd73364b4084c3a69346e0ce2b2';

function md5(text: string): string {
  return createHash('md5').update(text).digest('hex');
}

describe('signParams', () => {
  it('ksort 后 k=v& 串联再加盐做 MD5', () => {
    const params = {
      timestamp: '1',
      api_key: 'flomo_web',
      app_version: '4.0',
      platform: 'web',
      webp: '1',
    };
    const base = 'api_key=flomo_web&app_version=4.0&platform=web&timestamp=1&webp=1';
    expect(signParams(params)).toBe(md5(base + SALT));
  });

  it('数组按 key[]=v& 且元素排序', () => {
    const params = { b: '2', a: ['y', 'x'] };
    expect(signParams(params)).toBe(md5('a[]=x&a[]=y&b=2' + SALT));
  });

  it('跳过空字符串，保留数字 0', () => {
    expect(signParams({ a: '', b: '1' })).toBe(md5('b=1' + SALT));
    expect(signParams({ n: 0, a: 'x' })).toBe(md5('a=x&n=0' + SALT));
  });

  it('空数组不往签名串里写 key[]=', () => {
    expect(signParams({ file_ids: [], source: 'web' })).toBe(md5('source=web' + SALT));
  });

  it('prepareParams 会写入公共字段和 sign', () => {
    const prepared = prepareParams({ content: 'hi' });
    expect(prepared.api_key).toBe('flomo_web');
    expect(prepared.app_version).toBe('4.0');
    expect(prepared.platform).toBe('web');
    expect(prepared.webp).toBe('1');
    expect(typeof prepared.timestamp).toBe('string');
    const { sign, ...rest } = prepared;
    expect(sign).toBe(signParams(rest));
  });
});
