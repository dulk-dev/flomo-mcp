import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FlomoApiError, FlomoArgumentError } from '../errors.js';
import { getTz } from '../flomo/client.js';
import type { FlomoClient } from '../flomo/client.js';
import {
  asMemo, asRecord, htmlToText, invalidateMemoCacheFreshness, memoFileIds, memoUrl,
  nowEpoch, textToHtml, toEpochSeconds,
} from '../flomo/memos.js';
import { v1, v2 } from '../flomo/types.js';
import { runTool, type ToolContext } from './result.js';

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.heic': 'image/heic',
  '.svg': 'image/svg+xml',
};

function decodeBase64(data: string): Uint8Array {
  const t = data.trim();
  const marker = 'base64,';
  const idx = t.indexOf(marker);
  const raw = idx >= 0 ? t.slice(idx + marker.length) : t;
  const buf = Buffer.from(raw, 'base64');
  if (buf.length === 0) throw new FlomoArgumentError('data_base64 为空或无法解码');
  return new Uint8Array(buf);
}

async function uploadToOss(
  client: FlomoClient,
  filename: string,
  bytes: Uint8Array,
): Promise<{ id: string | number; url: string }> {
  const ext = extname(filename).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) {
    throw new FlomoArgumentError(`不支持的文件类型 "${ext || '(无扩展名)'}"，支持：${Object.keys(MIME_BY_EXT).join(' ')}`);
  }
  const s = asRecord(await client.apiCall('GET', v1('/file/oss_signature'), {}));
  if (!s?.host || !s.policy || !s.dir) {
    throw new FlomoApiError('oss_signature 响应缺少 host/policy/dir，接口可能已改版');
  }
  const name = filename.split(/[/\\]/).pop() || filename;
  const hash = createHash('md5').update(`${name}${bytes.byteLength}${Math.random()}`).digest('hex');
  const key = `${String(s.dir)}/${hash}${ext}`;

  const form = new FormData();
  form.append('name', name);
  form.append('key', key);
  form.append('policy', String(s.policy));
  form.append('OSSAccessKeyId', String(s.accessid ?? ''));
  form.append('success_action_status', '201');
  form.append('signature', String(s.signature ?? ''));
  form.append('file', new Blob([bytes], { type: mime }), name);

  const resp = await fetch(String(s.host), { method: 'POST', body: form });
  if (resp.status !== 201) {
    const body = await resp.text().catch(() => '');
    throw new FlomoApiError(`OSS 直传失败：HTTP ${resp.status} ${body.slice(0, 200)}`);
  }

  const registered = asRecord(await client.apiCall('PUT', v1('/file/'), {
    name: key.split('/').pop() ?? name,
    size: bytes.byteLength,
    path: key,
  }));
  if (registered?.id == null) throw new FlomoApiError('文件注册（PUT /file/）没返回 id，接口可能已改版');
  return { id: registered.id as string | number, url: String(registered.url || '') };
}

export function registerUpload(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'flomo_upload',
    {
      description: '上传图片（filename + data_base64，不要本机路径）。content 建新 memo，或 attach 附到已有 memo，二选一',
      inputSchema: z.object({
        filename: z.string().describe('文件名，含扩展名，如 shot.png'),
        data_base64: z.string().describe('文件内容的 base64（可带 data:image/...;base64, 前缀）'),
        content: z.string().optional().describe('新建 memo 的文字内容（#标签 语法有效）'),
        attach: z.string().optional().describe('附到已有 memo 的 slug'),
      }),
    },
    async (args) => runTool(async () => {
      const content = String(args.content ?? '').trim();
      const attachSlug = String(args.attach ?? '').trim();
      if (!content && !attachSlug) {
        throw new FlomoArgumentError('需指定 content（建新 memo）或 attach（附到已有 memo）之一');
      }
      if (content && attachSlug) throw new FlomoArgumentError('content 与 attach 只能二选一');
      const file = await uploadToOss(ctx.client, String(args.filename ?? '').trim(), decodeBase64(args.data_base64));

      let memo;
      if (attachSlug) {
        const current = asMemo(await ctx.client.apiCall('GET', v1(`/memo/${encodeURIComponent(attachSlug)}`), {}));
        if (current?.deleted_at) {
          throw new FlomoArgumentError(`memo "${attachSlug}" 在回收站里，先用 flomo_restore`);
        }
        memo = asMemo(await ctx.client.apiCall('PUT', v2(`/memo/${encodeURIComponent(attachSlug)}`), {
          content: String(current?.content || ''),
          local_updated_at: Math.max(nowEpoch(), toEpochSeconds(current?.updated_at || '') + 1),
          source: 'web',
          memo_from: 'human',
          file_ids: [...memoFileIds(current?.files), file.id],
          tz: getTz(),
          pin: Number(current?.pin) === 1 ? 1 : 0,
        }));
      } else {
        memo = asMemo(await ctx.client.apiCall('POST', v2('/memo'), {
          content: textToHtml(content),
          local_updated_at: nowEpoch(),
          source: 'web',
          memo_from: 'human',
          file_ids: [file.id],
          tz: getTz(),
        }));
      }
      if (!memo?.slug) throw new FlomoApiError('memo 写入返回成功但没有 slug，接口可能已改版');
      await invalidateMemoCacheFreshness(ctx.store);
      return [{
        slug: String(memo.slug),
        file_id: file.id,
        file_url: file.url,
        content: htmlToText(memo.content),
        url: memoUrl(String(memo.slug)),
      }];
    }),
  );
}
