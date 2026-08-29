import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { FlomoClient } from "./flomo/client.js";
import type { Store } from "./flomo/store.js";
import type { FlomoCredentials } from "./flomo/types.js";
import { createFlomoMcpServer } from "./server.js";

export async function handleMcpWebRequest(
  request: Request,
  opts: { store: Store; credentials: FlomoCredentials },
): Promise<Response> {
  const mcp = createFlomoMcpServer({
    client: new FlomoClient(opts.store, opts.credentials),
    store: opts.store,
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await mcp.connect(transport);
  return transport.handleRequest(request);
}
