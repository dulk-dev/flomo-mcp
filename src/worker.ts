import { bearerMatches, unauthorizedResponse } from "./auth.js";
import { parseCredentials } from "./config.js";
import { KvStore } from "./flomo/store.js";
import { handleMcpWebRequest } from "./mcp-http.js";

type WorkerEnv = Env & {
  MCP_API_KEY?: string;
  FLOMO_ACCOUNT?: string;
  FLOMO_PASSWORD?: string;
  FLOMO_ACCESS_TOKEN?: string;
};

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/" && request.method === "GET") {
      return Response.json({ ok: true, name: "flomo-mcp" });
    }
    if (url.pathname !== "/mcp") {
      return Response.json({ error: "not found" }, { status: 404 });
    }

    const apiKey = env.MCP_API_KEY?.trim() ?? "";
    if (
      !apiKey ||
      !bearerMatches(request.headers.get("authorization"), apiKey)
    ) {
      return unauthorizedResponse();
    }

    const credentials = parseCredentials({
      FLOMO_ACCESS_TOKEN: env.FLOMO_ACCESS_TOKEN,
      FLOMO_ACCOUNT: env.FLOMO_ACCOUNT,
      FLOMO_PASSWORD: env.FLOMO_PASSWORD,
    });
    if ("error" in credentials) {
      return Response.json({ error: credentials.error }, { status: 500 });
    }

    return handleMcpWebRequest(request, {
      store: new KvStore(env.CACHE),
      credentials,
    });
  },
};
