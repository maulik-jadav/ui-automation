import { Router } from "express";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { loadAllowlist } from "../../../core/safety/allowlist.js";
import { runManager } from "../runManager.js";
import type { HealthResponse } from "../../shared/contracts.js";

const execFileAsync = promisify(execFile);

export const healthRouter = Router();

async function pingCoreserv(url: string): Promise<{ reachable: boolean; detail?: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return { reachable: res.ok || res.status < 500, detail: `HTTP ${res.status}` };
  } catch (err) {
    return {
      reachable: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function pingGemini(): Promise<{
  keyPresent: boolean;
  reachable: boolean;
  detail?: string;
}> {
  const key = process.env.GEMINI_API_KEY;
  const keyPresent = Boolean(key && !key.includes("your_gemini"));
  if (!keyPresent) {
    return { keyPresent: false, reachable: false, detail: "GEMINI_API_KEY missing" };
  }
  try {
    const tsxBin = join(process.cwd(), "node_modules", ".bin", "tsx");
    const { stdout } = await execFileAsync(tsxBin, ["scripts/ping-gemini.ts"], {
      cwd: process.cwd(),
      env: process.env,
      timeout: 45000,
      maxBuffer: 1024 * 1024,
    });
    const reachable = /STATUS:\s*working/.test(stdout);
    return {
      keyPresent: true,
      reachable,
      detail: stdout.trim().split("\n").slice(-3).join(" | "),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stdout = (err as { stdout?: string }).stdout ?? "";
    return {
      keyPresent: true,
      reachable: false,
      detail: stdout || msg,
    };
  }
}

healthRouter.get("/health", async (req, res) => {
  const url = process.env.MOCK_APP_BASE_URL ?? "http://localhost:4000";
  let safetyLoaded = false;
  let allowedBaseUrls: string[] = [];
  let allowedActionKinds: string[] = [];
  try {
    const cfg = loadAllowlist();
    safetyLoaded = true;
    allowedBaseUrls = cfg.allowedBaseUrls;
    allowedActionKinds = cfg.allowedActionKinds;
  } catch {
    safetyLoaded = false;
  }

  const deep = req.query.deep === "1";
  const coreserv = await pingCoreserv(url);
  const key = process.env.GEMINI_API_KEY;
  const keyPresent = Boolean(key && !key.includes("your_gemini"));
  const gemini = deep
    ? await pingGemini()
    : {
        keyPresent,
        reachable: keyPresent,
        detail: keyPresent
          ? "Key present (use ?deep=1 to live-ping Gemini)"
          : "GEMINI_API_KEY missing",
      };

  let harnessEnabled = process.env.ENABLE_TEST_HARNESS === "1";
  if (!harnessEnabled) {
    try {
      const r = await fetch(`${url}/__test/state?memberId=12345`, {
        signal: AbortSignal.timeout(2000),
      });
      harnessEnabled = r.ok;
    } catch {
      harnessEnabled = false;
    }
  }

  const body: HealthResponse = {
    ok: coreserv.reachable && safetyLoaded,
    demoMode: true,
    coreserv: { reachable: coreserv.reachable, url, detail: coreserv.detail },
    gemini,
    safety: { loaded: safetyLoaded, allowedBaseUrls, allowedActionKinds },
    harness: { enabled: harnessEnabled },
    busy: runManager.isBusy(),
    activeRunId: runManager.getActiveRunId(),
  };
  res.json(body);
});
