#!/usr/bin/env node
import 'dotenv/config';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { FlomoClient } from './flomo/client.js';
import { DirStore } from './flomo/store.js';
import { createFlomoMcpServer } from './server.js';
import { startMemoSync } from './sync.js';

const config = loadConfig();
const store = new DirStore(config.dataDir);
const client = new FlomoClient(store, config.credentials);
const every = config.syncIntervalMs > 0 ? `每 ${config.syncIntervalMs}ms` : '已关闭';
process.stderr.write(`flomo-mcp stdio，缓存 ${config.dataDir}，定时同步${every}\n`);
startMemoSync(client, store, config.syncIntervalMs);

const mcp = createFlomoMcpServer({ client, store });
await mcp.connect(new StdioServerTransport());
