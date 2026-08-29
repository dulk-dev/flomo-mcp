import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function authorizeBearer(req: IncomingMessage, res: ServerResponse, apiKey: string): boolean {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    writeUnauthorized(res);
    return false;
  }
  const token = header.slice('Bearer '.length);
  if (!safeEqual(token, apiKey)) {
    writeUnauthorized(res);
    return false;
  }
  return true;
}

function writeUnauthorized(res: ServerResponse): void {
  res.writeHead(401, {
    'Content-Type': 'application/json',
    'WWW-Authenticate': 'Bearer',
  });
  res.end(JSON.stringify({ error: 'unauthorized' }));
}
