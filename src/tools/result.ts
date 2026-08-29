import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { FlomoClient } from '../flomo/client.js';
import type { Store } from '../flomo/store.js';

export type ToolContext = {
  client: FlomoClient;
  store: Store;
};

export async function runTool(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const data = await fn();
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      isError: true,
      content: [{ type: 'text', text: message }],
    };
  }
}
