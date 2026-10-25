import type { FlomoClient } from './flomo/client.js';
import { syncMemoCache } from './flomo/memos.js';
import type { Store } from './flomo/store.js';

function logSyncError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`flomo 同步失败: ${message}\n`);
}

/**
 * Force one sync round immediately. When intervalMs > 0, later rounds follow
 * the same fresh-window rules as read tools (not force).
 * Returns a stop function; the timer does not keep the process alive.
 */
export function startMemoSync(
  client: FlomoClient,
  store: Store,
  intervalMs: number,
): () => void {
  const run = (force: boolean) => {
    void syncMemoCache(client, store, force ? { force: true } : undefined).then(
      (cache) => {
        if (!force) return;
        const count = Object.keys(cache.memos).length;
        process.stderr.write(`flomo 启动同步：${count} 条，complete=${cache.complete}\n`);
      },
      logSyncError,
    );
  };

  run(true);
  if (intervalMs <= 0) return () => {};
  const timer = setInterval(() => run(false), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
