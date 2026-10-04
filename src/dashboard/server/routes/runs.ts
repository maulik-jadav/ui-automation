import { Router } from "express";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { basename, join } from "node:path";
import { redactDeep } from "../../../core/safety/redaction.js";
import { runManager } from "../runManager.js";
import {
  listEvidenceDirs,
  resolveEvidenceDir,
  safeEvidencePath,
  safePath,
  assertUnder,
} from "../pathSafe.js";
import type {
  DiscoverRequest,
  ReplayRequest,
  RunKind,
  RunStatusChip,
  RunSummary,
  StabilityRequest,
} from "../../shared/contracts.js";

export const runsRouter = Router();

function readJsonSafe(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function folderKind(name: string): RunKind {
  if (name.startsWith("stability-")) return "stability";
  if (name.startsWith("replay-")) return "replay";
  if (name.includes("handoff")) return "handoff";
  const meta = readJsonSafe(join(safePath("evidence", name), "meta.json")) as {
    kind?: string;
  } | null;
  if (meta?.kind === "discovery") return "discovery";
  if (meta?.kind === "replay") return "replay";
  if (existsSync(join(safePath("evidence", name), "transcript.json"))) {
    return "discovery";
  }
  return "replay";
}

function folderId(name: string): string {
  return name.replace(/^(replay-|stability-)/, "");
}

function statusFromResult(result: unknown): RunStatusChip {
  if (!result || typeof result !== "object") return "unknown";
  const s = (result as { status?: string }).status;
  if (
    s === "success" ||
    s === "business_outcome" ||
    s === "recovered" ||
    s === "needs_human" ||
    s === "hard_failure"
  ) {
    return s;
  }
  return "unknown";
}

runsRouter.get("/runs", (req, res) => {
  const statusFilter = String(req.query.status ?? "");
  const taskFilter = String(req.query.task ?? "").toLowerCase();
  const q = String(req.query.q ?? "").toLowerCase();
  const list: RunSummary[] = [];

  for (const name of listEvidenceDirs()) {
    if (name.startsWith("_")) continue;
    const dir = safePath("evidence", name);
    const meta = readJsonSafe(join(dir, "meta.json")) as Record<string, unknown> | null;
    const result = readJsonSafe(join(dir, "result.json"));
    const st = existsSync(join(dir, "result.json"))
      ? statusFromResult(result)
      : runManager.getActiveRunId() === folderId(name)
        ? "running"
        : "unknown";
    const summary: RunSummary = {
      id: folderId(name),
      kind: folderKind(name),
      status: st,
      startedAt: typeof meta?.startedAt === "string" ? meta.startedAt : undefined,
      durationMs:
        result && typeof result === "object" && "durationMs" in result
          ? Number((result as { durationMs: number }).durationMs)
          : undefined,
      artifactName:
        typeof meta?.artifactName === "string"
          ? meta.artifactName
          : typeof meta?.goal === "string"
            ? String(meta.goal)
            : undefined,
      tenant: typeof meta?.tenant === "string" ? meta.tenant : undefined,
      message:
        result && typeof result === "object" && "message" in result
          ? String((result as { message: string }).message)
          : undefined,
      evidenceDir: name,
    };
    if (statusFilter && summary.status !== statusFilter) continue;
    if (taskFilter && !(summary.artifactName ?? "").toLowerCase().includes(taskFilter)) {
      continue;
    }
    if (
      q &&
      !JSON.stringify(summary).toLowerCase().includes(q) &&
      !summary.id.includes(q)
    ) {
      continue;
    }
    list.push(summary);
  }

  list.sort((a, b) => {
    const at = a.startedAt ?? "";
    const bt = b.startedAt ?? "";
    return bt.localeCompare(at);
  });
  res.json(list);
});

runsRouter.get("/runs/:id", (req, res) => {
  try {
    const dir = resolveEvidenceDir(req.params.id);
    const meta = readJsonSafe(join(dir, "meta.json"));
    const result = readJsonSafe(join(dir, "result.json"));
    const transcript = readJsonSafe(join(dir, "transcript.json"));
    let steps: unknown[] = [];
    const stepsLog = join(dir, "steps.log");
    if (existsSync(stepsLog)) {
      steps = readFileSync(stepsLog, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return { raw: line };
          }
        });
    }
    let humanActions: unknown[] = [];
    const ha = join(dir, "human-actions.jsonl");
    if (existsSync(ha)) {
      humanActions = readFileSync(ha, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return { raw: line };
          }
        });
    }
    const shotsDir = join(dir, "screenshots");
    const screenshots = existsSync(shotsDir)
      ? readdirSync(shotsDir)
          .filter((f) => f.endsWith(".png"))
          .map((f) => `/api/runs/${req.params.id}/evidence/screenshots/${f}`)
      : [];

    res.json(
      redactDeep({
        id: req.params.id,
        evidenceDir: basename(dir),
        meta,
        result,
        transcript,
        steps,
        humanActions,
        screenshots,
        status: result ? statusFromResult(result) : "running",
      })
    );
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

runsRouter.get("/runs/:id/events", (req, res) => {
  const runId = req.params.id;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event: unknown) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  send({ type: "connected", runId });
  const unsub = runManager.subscribe(runId, send);
  const heartbeat = setInterval(() => {
    res.write(`: ping\n\n`);
  }, 15000);
  req.on("close", () => {
    clearInterval(heartbeat);
    unsub();
  });
});

runsRouter.get("/runs/:id/evidence/:folder/:file", (req, res) => {
  try {
    const dir = resolveEvidenceDir(req.params.id);
    const folder = req.params.folder;
    const file = req.params.file;
    if (
      !folder ||
      !file ||
      folder.includes("..") ||
      file.includes("..") ||
      folder.includes("/") ||
      file.includes("/")
    ) {
      return res.status(400).json({ error: "Invalid path" });
    }
    const full = join(dir, folder, file);
    assertUnder(dir, full);
    if (!existsSync(full) || !statSync(full).isFile()) {
      return res.status(404).json({ error: "Not found" });
    }
    res.sendFile(full);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

runsRouter.get("/runs/:id/evidence/:file", (req, res) => {
  try {
    const dir = resolveEvidenceDir(req.params.id);
    const file = req.params.file;
    if (!file || file.includes("..") || file.includes("/")) {
      return res.status(400).json({ error: "Invalid path" });
    }
    const full = join(dir, file);
    assertUnder(dir, full);
    if (!existsSync(full) || !statSync(full).isFile()) {
      return res.status(404).json({ error: "Not found" });
    }
    res.sendFile(full);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

runsRouter.post("/discover", async (req, res) => {
  try {
    const body = req.body as DiscoverRequest;
    if (!body?.goal?.trim()) {
      return res.status(400).json({ error: "Goal is required" });
    }
    const started = await runManager.startDiscovery(body);
    res.status(202).json(started);
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

runsRouter.post("/replay", async (req, res) => {
  try {
    const body = req.body as ReplayRequest;
    if (!body?.artifactId) {
      return res.status(400).json({ error: "artifactId is required" });
    }
    const started = await runManager.startReplay(body);
    res.status(202).json(started);
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

runsRouter.post("/stability", async (req, res) => {
  try {
    const body = req.body as StabilityRequest;
    if (!body?.artifactId) {
      return res.status(400).json({ error: "artifactId is required" });
    }
    const started = await runManager.startStability(body);
    res.status(202).json(started);
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Overview helpers
runsRouter.get("/overview", (_req, res) => {
  const artifactsDir = safePath("artifacts");
  const artifactCount = existsSync(artifactsDir)
    ? readdirSync(artifactsDir).filter((f) => f.endsWith(".json")).length
    : 0;
  const today = new Date().toISOString().slice(0, 10);
  let runsToday = 0;
  let successToday = 0;
  const recent: RunSummary[] = [];
  for (const name of listEvidenceDirs()) {
    if (name.startsWith("_")) continue;
    const dir = safePath("evidence", name);
    const meta = readJsonSafe(join(dir, "meta.json")) as { startedAt?: string; artifactName?: string; goal?: string } | null;
    const result = readJsonSafe(join(dir, "result.json"));
    const startedAt = meta?.startedAt ?? (existsSync(dir) ? statSync(dir).mtime.toISOString() : undefined);
    const status = result ? statusFromResult(result) : "unknown";
    if (startedAt?.startsWith(today)) {
      runsToday += 1;
      if (status === "success" || status === "business_outcome" || status === "recovered") {
        successToday += 1;
      }
    }
    recent.push({
      id: folderId(name),
      kind: folderKind(name),
      status,
      startedAt,
      artifactName: meta?.artifactName ?? meta?.goal,
      evidenceDir: name,
    });
  }
  recent.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  res.json({
    tasksInLibrary: artifactCount,
    runsToday,
    successRate: runsToday ? successToday / runsToday : null,
    recent: recent.slice(0, 10),
  });
});
