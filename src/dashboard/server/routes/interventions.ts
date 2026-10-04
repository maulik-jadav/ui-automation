import { Router } from "express";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import {
  claimIntervention,
  listInterventions,
  markResumed,
  appendHumanAction,
} from "../../../core/escalation/interventionStore.js";
import { redactDeep } from "../../../core/safety/redaction.js";
import { resolveEvidenceDir } from "../pathSafe.js";
import { EventEmitter } from "node:events";

export const interventionsRouter = Router();

const bus = new EventEmitter();
bus.setMaxListeners(100);

let lastSnapshot = "";
let pollTimer: ReturnType<typeof setInterval> | null = null;
let sseClients = 0;

function ensurePoller(): void {
  if (pollTimer) return;
  lastSnapshot = JSON.stringify(listInterventions());
  pollTimer = setInterval(() => {
    try {
      const next = JSON.stringify(listInterventions());
      if (next !== lastSnapshot) {
        lastSnapshot = next;
        bus.emit("change", redactDeep(listInterventions()));
      }
    } catch {
      /* ignore */
    }
    if (sseClients === 0 && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }, 1500);
  pollTimer.unref?.();
}

interventionsRouter.get("/interventions", (_req, res) => {
  const items = listInterventions()
    .slice()
    .reverse()
    .map((i) => redactDeep(i));
  res.json(items);
});

interventionsRouter.get("/interventions/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  sseClients += 1;
  ensurePoller();
  res.write(`data: ${JSON.stringify({ type: "snapshot", items: redactDeep(listInterventions()) })}\n\n`);
  const onChange = (items: unknown) => {
    res.write(`data: ${JSON.stringify({ type: "update", items })}\n\n`);
  };
  bus.on("change", onChange);
  const heartbeat = setInterval(() => res.write(`: ping\n\n`), 15000);
  heartbeat.unref?.();
  req.on("close", () => {
    clearInterval(heartbeat);
    bus.off("change", onChange);
    sseClients = Math.max(0, sseClients - 1);
  });
});

interventionsRouter.get("/interventions/:id", (req, res) => {
  const items = listInterventions();
  const found =
    items.find((i) => i.id === req.params.id) ??
    items.find((i) => i.runId === req.params.id);
  if (!found) return res.status(404).json({ error: "Not found" });
  let humanActions: unknown[] = [];
  try {
    const dir = resolveEvidenceDir(found.runId);
    const ha = join(dir, "human-actions.jsonl");
    if (existsSync(ha)) {
      humanActions = readFileSync(ha, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
    }
  } catch {
    /* evidence may not exist yet */
  }
  res.json(redactDeep({ ...found, humanActions }));
});

interventionsRouter.post("/interventions/:id/claim", (req, res) => {
  try {
    const items = listInterventions();
    const found =
      items.find((i) => i.id === req.params.id) ??
      items.find((i) => i.runId === req.params.id);
    if (!found) return res.status(404).json({ error: "Not found" });
    const claimed = claimIntervention(found.runId, "Operator");
    bus.emit("change", redactDeep(listInterventions()));
    res.json(redactDeep(claimed));
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

interventionsRouter.post("/interventions/:id/resume", (req, res) => {
  try {
    const items = listInterventions();
    const found =
      items.find((i) => i.id === req.params.id) ??
      items.find((i) => i.runId === req.params.id);
    if (!found) return res.status(404).json({ error: "Not found" });
    const note = typeof req.body?.note === "string" ? req.body.note : undefined;
    if (note) {
      try {
        const dir = resolveEvidenceDir(found.runId);
        appendHumanAction(found.runId, dir, {
          kind: "operator_note",
          note: note.slice(0, 2000),
        });
      } catch {
        /* ignore */
      }
    }
    const resumed = markResumed(found.runId);
    bus.emit("change", redactDeep(listInterventions()));
    res.json(redactDeep(resumed));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Latest screenshot for an intervention's run (MVP live view). */
interventionsRouter.get("/interventions/:id/screen", (req, res) => {
  try {
    const items = listInterventions();
    const found =
      items.find((i) => i.id === req.params.id) ??
      items.find((i) => i.runId === req.params.id);
    if (!found) return res.status(404).json({ error: "Not found" });
    const dir = resolveEvidenceDir(found.runId);
    const shots = join(dir, "screenshots");
    if (!existsSync(shots)) return res.status(404).json({ error: "No screenshots yet" });
    const files = readdirSync(shots)
      .filter((f) => f.endsWith(".png"))
      .map((f) => ({ f, m: statSync(join(shots, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    if (!files.length) return res.status(404).json({ error: "No screenshots yet" });
    res.sendFile(join(shots, files[0].f));
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
