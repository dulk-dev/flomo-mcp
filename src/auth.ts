import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function bearerMatches(
  header: string | null | undefined,
  apiKey: string,
): boolean {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  return safeEqual(header.slice("Bearer ".length), apiKey);
}

export function authorizeBearer(
  req: IncomingMessage,
  res: ServerResponse,
  apiKey: string,
): boolean {
  if (!bearerMatches(req.headers.authorization, apiKey)) {
    writeUnauthorized(res);
    return false;
  }
  return true;
}

export function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": "Bearer",
    },
  });
}

function writeUnauthorized(res: ServerResponse): void {
  res.writeHead(401, {
    "Content-Type": "application/json",
    "WWW-Authenticate": "Bearer",
  });
  res.end(JSON.stringify({ error: "unauthorized" }));
}
