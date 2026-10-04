import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { v4 as uuidv4 } from "uuid";
import { loadArtifact } from "../../core/artifact/artifactStore.js";
import { runDiscovery } from "../../core/agent/discoveryAgent.js";
import { runReplay } from "../../core/replay/replayEngine.js";
import { redactDeep } from "../../core/safety/redaction.js";
import type { DiscoverRequest, ReplayRequest, StabilityRequest } from "../shared/contracts.js";

export type SseEvent = {
  type: string;
  runId: string;
  [key: string]: unknown;
};

class RunManager {
  private busy = false;
  private activeRunId?: string;
  private emitters = new Map<string, EventEmitter>();
  private history = new Map<string, SseEvent[]>();

  isBusy(): boolean {
    return this.busy;
  }

  getActiveRunId(): string | undefined {
    return this.activeRunId;
  }

  subscribe(runId: string, listener: (e: SseEvent) => void): () => void {
    let em = this.emitters.get(runId);
    if (!em) {
      em = new EventEmitter();
      em.setMaxListeners(50);
      this.emitters.set(runId, em);
    }
    for (const past of this.history.get(runId) ?? []) listener(past);
    em.on("event", listener);
    return () => em!.off("event", listener);
  }

  private push(runId: string, event: SseEvent): void {
    const list = this.history.get(runId) ?? [];
    list.push(event);
    if (list.length > 500) list.shift();
    this.history.set(runId, list);
    this.emitters.get(runId)?.emit("event", event);
  }

  private acquire(runId: string): void {
    if (this.busy) {
      throw new Error(
        `Another run is in progress (${this.activeRunId}). Wait for it to finish or stop it.`
      );
    }
    this.busy = true;
    this.activeRunId = runId;
  }

  private release(): void {
    this.busy = false;
    this.activeRunId = undefined;
  }

  async startDiscovery(req: DiscoverRequest): Promise<{ runId: string; evidenceDir: string }> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey.includes("your_gemini")) {
      throw new Error("GEMINI_API_KEY is missing or still a placeholder in .env");
    }
    const runId = uuidv4().slice(0, 8);
    const evidenceDir = join(process.cwd(), "evidence", runId);
    mkdirSync(evidenceDir, { recursive: true });
    this.acquire(runId);

    const baseUrl = req.baseUrl ?? process.env.MOCK_APP_BASE_URL ?? "http://localhost:4000";
    const inputs = {
      username: process.env.CORESERV_USER ?? process.env.CORESERV_USERNAME,
      password: process.env.CORESERV_PASS ?? process.env.CORESERV_PASSWORD,
      ...(req.inputs ?? {}),
    };

    writeFileSync(
      join(evidenceDir, "meta.json"),
      JSON.stringify(
        redactDeep({
          kind: "discovery",
          goal: req.goal,
          startedAt: new Date().toISOString(),
          tenant: req.tenant,
        }),
        null,
        2
      )
    );

    void (async () => {
      try {
        const result = await runDiscovery({
          goal: req.goal,
          inputs,
          baseUrl,
          apiKey,
          headless: req.headless ?? false,
          startPath: req.startPath ?? "/login",
          evidenceRoot: evidenceDir,
          maxSteps: req.maxSteps,
          runId,
          onEvent: (e) => this.push(runId, { ...e, type: e.type, runId }),
        });
        this.push(runId, {
          type: "done",
          runId,
          artifactPath: result.artifactPath,
          outputs: redactDeep(result.outputs),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        writeFileSync(
          join(evidenceDir, "result.json"),
          JSON.stringify({ status: "hard_failure", message, kind: "discovery" }, null, 2)
        );
        this.push(runId, { type: "error", runId, message });
        this.push(runId, { type: "done", runId, error: message });
      } finally {
        this.release();
      }
    })();

    return { runId, evidenceDir };
  }

  async startReplay(req: ReplayRequest): Promise<{ runId: string; evidenceDir: string }> {
    const artifact = loadArtifact(req.artifactId);
    const runId = uuidv4().slice(0, 8);
    const evidenceDir = join(process.cwd(), "evidence", `replay-${runId}`);
    mkdirSync(evidenceDir, { recursive: true });
    this.acquire(runId);

    const username =
      process.env.CORESERV_USER ?? process.env.CORESERV_USERNAME;
    const password =
      process.env.CORESERV_PASS ?? process.env.CORESERV_PASSWORD;
    const inputs = {
      ...(username ? { username } : {}),
      ...(password ? { password } : {}),
      ...req.inputs,
    };

    writeFileSync(
      join(evidenceDir, "meta.json"),
      JSON.stringify(
        redactDeep({
          kind: "replay",
          artifactId: artifact.artifactId,
          artifactName: artifact.name,
          inputs,
          tenant: req.tenant,
          startedAt: new Date().toISOString(),
        }),
        null,
        2
      )
    );

    void (async () => {
      try {
        const result = await runReplay({
          artifact,
          inputs,
          headless: req.headless ?? false,
          evidenceRoot: evidenceDir,
          tenant: req.tenant,
          allowHandoff: req.allowHandoff !== false,
          runId,
          onEvent: (e) => this.push(runId, { ...e, type: e.type, runId }),
        });
        this.push(runId, {
          type: "done",
          runId,
          result: redactDeep(result),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        writeFileSync(
          join(evidenceDir, "result.json"),
          JSON.stringify({ status: "hard_failure", message, kind: "replay" }, null, 2)
        );
        this.push(runId, { type: "error", runId, message });
        this.push(runId, { type: "done", runId, error: message });
      } finally {
        this.release();
      }
    })();

    return { runId, evidenceDir };
  }

  async startStability(
    req: StabilityRequest
  ): Promise<{ runId: string; evidenceDir: string }> {
    const times = Math.min(Math.max(req.times ?? 5, 2), 10);
    const artifact = loadArtifact(req.artifactId);
    const batchId = uuidv4().slice(0, 8);
    const evidenceDir = join(process.cwd(), "evidence", `stability-${batchId}`);
    mkdirSync(evidenceDir, { recursive: true });
    this.acquire(batchId);

    writeFileSync(
      join(evidenceDir, "meta.json"),
      JSON.stringify(
        redactDeep({
          kind: "stability",
          artifactId: artifact.artifactId,
          times,
          startedAt: new Date().toISOString(),
        }),
        null,
        2
      )
    );

    void (async () => {
      const results: unknown[] = [];
      try {
        for (let i = 0; i < times; i++) {
          if (i > 0 && this.activeRunId !== batchId) break;
          this.push(batchId, {
            type: "status",
            runId: batchId,
            message: `Stability run ${i + 1} of ${times}`,
            index: i,
            times,
          });
          const subId = `${batchId}-${i + 1}`;
          const subDir = join(evidenceDir, `run-${i + 1}`);
          mkdirSync(subDir, { recursive: true });
          const user = process.env.CORESERV_USER ?? process.env.CORESERV_USERNAME;
          const pass = process.env.CORESERV_PASS ?? process.env.CORESERV_PASSWORD;
          const result = await runReplay({
            artifact,
            inputs: {
              ...(user ? { username: user } : {}),
              ...(pass ? { password: pass } : {}),
              ...req.inputs,
            },
            headless: req.headless ?? true,
            evidenceRoot: subDir,
            tenant: req.tenant,
            allowHandoff: false,
            runId: subId,
            onEvent: (e) =>
              this.push(batchId, {
                ...e,
                type: e.type,
                runId: batchId,
                subRun: i + 1,
              }),
          });
          results.push(redactDeep(result));
        }
        const success = results.filter(
          (r) => (r as { status?: string }).status === "success"
        ).length;
        const summary = {
          status: "success",
          kind: "stability",
          times,
          success,
          successRate: results.length ? success / results.length : 0,
          results,
        };
        writeFileSync(
          join(evidenceDir, "result.json"),
          JSON.stringify(summary, null, 2)
        );
        this.push(batchId, { type: "done", runId: batchId, result: summary });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.push(batchId, { type: "error", runId: batchId, message });
        this.push(batchId, { type: "done", runId: batchId, error: message });
      } finally {
        this.release();
      }
    })();

    return { runId: batchId, evidenceDir };
  }
}

export const runManager = new RunManager();
