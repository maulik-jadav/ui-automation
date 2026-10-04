import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { v4 as uuidv4 } from "uuid";
import type { Controller, InterventionRequest } from "../types.js";
import { redactDeep } from "../safety/redaction.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)));
export const INTERVENTIONS_PATH = join(ROOT, "interventions.json");

function ensureFile(): void {
  mkdirSync(dirname(INTERVENTIONS_PATH), { recursive: true });
  if (!existsSync(INTERVENTIONS_PATH)) {
    writeFileSync(INTERVENTIONS_PATH, "[]\n");
  }
}

export function listInterventions(): InterventionRequest[] {
  ensureFile();
  return JSON.parse(
    readFileSync(INTERVENTIONS_PATH, "utf8")
  ) as InterventionRequest[];
}

export function saveInterventions(items: InterventionRequest[]): void {
  ensureFile();
  writeFileSync(INTERVENTIONS_PATH, JSON.stringify(items, null, 2) + "\n");
}

export function createIntervention(
  partial: Omit<
    InterventionRequest,
    "id" | "status" | "createdAt" | "currentController"
  >
): InterventionRequest {
  const items = listInterventions();
  // Single-owner: reject if another pending for same run
  const existing = items.find(
    (i) => i.runId === partial.runId && (i.status === "pending" || i.status === "claimed")
  );
  if (existing) return existing;

  const req: InterventionRequest = {
    ...partial,
    id: uuidv4().slice(0, 8),
    status: "pending",
    createdAt: new Date().toISOString(),
    currentController: "PAUSED",
    liveSessionHint:
      partial.liveSessionHint ??
      "Headful Playwright window for this runId — do not open a new browser; use the existing window.",
  };
  items.push(req);
  saveInterventions(items);
  return req;
}

export function claimIntervention(
  runId: string,
  claimedBy = "operator"
): InterventionRequest | null {
  const items = listInterventions();
  const idx = [...items]
    .reverse()
    .findIndex(
      (i) => i.runId === runId && (i.status === "pending" || i.status === "claimed")
    );
  if (idx === -1) return null;
  const realIdx = items.length - 1 - idx;
  if (items[realIdx].status === "claimed" && items[realIdx].claimedBy !== claimedBy) {
    throw new Error(
      `Intervention already claimed by ${items[realIdx].claimedBy}`
    );
  }
  items[realIdx].status = "claimed";
  items[realIdx].claimedAt = new Date().toISOString();
  items[realIdx].claimedBy = claimedBy;
  items[realIdx].currentController = "HUMAN";
  saveInterventions(items);
  return items[realIdx];
}

export function markResumed(runId: string): InterventionRequest | null {
  const items = listInterventions();
  const idx = [...items]
    .reverse()
    .findIndex(
      (i) =>
        i.runId === runId &&
        (i.status === "pending" || i.status === "claimed")
    );
  if (idx === -1) return null;
  const realIdx = items.length - 1 - idx;
  items[realIdx].status = "resumed";
  items[realIdx].resumedAt = new Date().toISOString();
  items[realIdx].currentController = "RESUMING";
  saveInterventions(items);
  return items[realIdx];
}

export function setController(runId: string, controller: Controller): void {
  const items = listInterventions();
  const latest = [...items].reverse().find((i) => i.runId === runId);
  if (!latest) return;
  latest.currentController = controller;
  saveInterventions(items);
}

export async function waitUntilResumed(
  runId: string,
  pollMs = 1500,
  timeoutMs = 30 * 60 * 1000
): Promise<InterventionRequest> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const items = listInterventions();
    const latest = [...items].reverse().find((i) => i.runId === runId);
    if (latest?.status === "resumed") {
      setController(runId, "AUTOMATION");
      return latest;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Timed out waiting for human resume on run ${runId}`);
}

export function appendHumanAction(
  runId: string,
  evidenceDir: string,
  entry: Record<string, unknown>
): void {
  mkdirSync(evidenceDir, { recursive: true });
  const line = JSON.stringify(
    redactDeep({ ...entry, runId, ts: new Date().toISOString() })
  );
  appendFileSync(join(evidenceDir, "human-actions.jsonl"), line + "\n");
}
