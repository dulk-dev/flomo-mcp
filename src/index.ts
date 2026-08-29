import 'dotenv/config';
import { createServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { authorizeBearer } from './auth.js';
import { loadConfig } from './config.js';
import { FlomoClient } from './flomo/client.js';
import { DirStore } from './flomo/store.js';
import { createFlomoMcpServer } from './server.js';

const config = loadConfig();
const store = new DirStore(config.dataDir);
const client = new FlomoClient(store, config.credentials);

const httpServer = createServer((req, res) => {
  void (async () => {
    const pathOnly = (req.url ?? '/').split('?')[0];
    if (pathOnly !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    if (!authorizeBearer(req, res, config.mcpApiKey)) return;

    const mcp = createFlomoMcpServer({ client, store });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void mcp.close();
    });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`MCP 请求失败: ${message}\n`);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        }));
      }
    }
  })();
});

httpServer.listen(config.port, config.host, () => {
  process.stderr.write(`flomo-mcp 监听 http://${config.host}:${config.port}/mcp\n`);
});
