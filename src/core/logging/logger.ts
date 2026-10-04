import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { LogEntry } from "../types.js";
import { redactDeep } from "../safety/redaction.js";

const LOG_DIR = join(process.cwd(), "evidence");

export const logger = {
  log(entry: LogEntry): void {
    const safe = redactDeep(entry);
    const line = JSON.stringify(safe);
    console.log(line);
    try {
      mkdirSync(join(LOG_DIR, entry.runId), { recursive: true });
      appendFileSync(join(LOG_DIR, entry.runId, "steps.log"), line + "\n");
    } catch {
      // best-effort
    }
  },
};
