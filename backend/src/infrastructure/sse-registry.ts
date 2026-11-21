import type { ServerResponse } from "node:http";

// ---------------------------------------------------------------------------
// Реестр активных SSE-потоков для мгновенного graceful shutdown (SIGTERM).
// Без закрытия долгоживущих SSE-соединений `app.close()` ждёт до hard-timeout.
// ---------------------------------------------------------------------------

const activeStreams = new Set<ServerResponse>();

export function registerSseStream(res: ServerResponse): () => void {
  activeStreams.add(res);
  return () => {
    activeStreams.delete(res);
  };
}

export function closeAllSseStreams(): void {
  for (const res of activeStreams) {
    try {
      if (!res.destroyed && !res.writableEnded) {
        res.end();
      }
    } catch {
      // ignore socket errors on shutdown
    }
  }
  activeStreams.clear();
}

export function getActiveSseCount(): number {
  return activeStreams.size;
}
