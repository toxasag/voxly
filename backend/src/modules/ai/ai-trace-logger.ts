import fs from "node:fs";

export const TRACE_JSONL_PATH = "/tmp/getvoxly-ai-trace.jsonl";
export const TRACE_LOG_PATH = "/tmp/getvoxly-ai-trace.log";

export class AiTraceLogger {
  private static instance: AiTraceLogger;

  private constructor() {
    this.initFiles();
  }

  public static getInstance(): AiTraceLogger {
    if (!AiTraceLogger.instance) {
      AiTraceLogger.instance = new AiTraceLogger();
    }
    return AiTraceLogger.instance;
  }

  public initFiles(): void {
    try {
      if (!fs.existsSync(TRACE_JSONL_PATH)) {
        fs.writeFileSync(TRACE_JSONL_PATH, "", { mode: 0o666 });
      } else {
        try {
          fs.chmodSync(TRACE_JSONL_PATH, 0o666);
        } catch {
          // ignore chmod errors if owned by another user but writable
        }
      }
      if (!fs.existsSync(TRACE_LOG_PATH)) {
        fs.writeFileSync(TRACE_LOG_PATH, "", { mode: 0o666 });
      } else {
        try {
          fs.chmodSync(TRACE_LOG_PATH, 0o666);
        } catch {
          // ignore chmod errors
        }
      }
    } catch (err) {
      console.error("[AiTraceLogger] Failed to init trace files:", err);
    }
  }

  public clearFiles(): void {
    try {
      fs.writeFileSync(TRACE_JSONL_PATH, "", { mode: 0o666 });
      fs.writeFileSync(TRACE_LOG_PATH, "", { mode: 0o666 });
    } catch (err) {
      console.error("[AiTraceLogger] Failed to clear trace files:", err);
    }
  }

  public traceEvent(event: string, payload: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();
    const entry = {
      timestamp,
      event,
      ...payload,
    };

    // 1. Write JSONL (fire and forget, unbuffered async)
    try {
      const jsonLine = JSON.stringify(entry) + "\n";
      fs.appendFile(TRACE_JSONL_PATH, jsonLine, (err) => {
        if (err) {
          console.error("[AiTraceLogger] appendFile error (jsonl):", err);
        }
      });
    } catch (err) {
      console.error("[AiTraceLogger] Failed to stringify JSONL trace:", err);
    }

    // 2. Write human-readable formatted text
    try {
      const header = `\n================================================================================\n[AI TRACE] ${timestamp} | EVENT: ${event}\n--------------------------------------------------------------------------------\n`;
      const body = Object.entries(payload)
        .map(([key, val]) => {
          let strVal: string;
          if (typeof val === "string") {
            strVal = val.length > 2000 ? `${val.slice(0, 2000)}... (truncated ${val.length} chars)` : val;
          } else {
            strVal = JSON.stringify(val, null, 2);
          }
          return `  • ${key}: ${strVal}`;
        })
        .join("\n");
      const fullText = `${header}${body}\n`;

      fs.appendFile(TRACE_LOG_PATH, fullText, (err) => {
        if (err) {
          console.error("[AiTraceLogger] appendFile error (log):", err);
        }
      });
    } catch (err) {
      console.error("[AiTraceLogger] Failed to format text trace:", err);
    }
  }
}

export const aiTraceLogger = AiTraceLogger.getInstance();
