import { Router } from "express";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadArtifact,
  updateArtifactReview,
  validateArtifact,
} from "../../../core/artifact/artifactStore.js";
import { checkDrift } from "../../../core/replay/drift.js";
import { PlaywrightWebAdapter } from "../../../core/surface/PlaywrightWebAdapter.js";
import { redactDeep } from "../../../core/safety/redaction.js";
import { safePath, listEvidenceDirs } from "../pathSafe.js";
import type { ArtifactSummary, RunStatusChip } from "../../shared/contracts.js";

export const artifactsRouter = Router();

function riskOf(artifact: ReturnType<typeof loadArtifact>): ArtifactSummary["riskClass"] {
  if (artifact.steps.some((s) => "irreversible" in s && s.irreversible)) {
    return "irreversible";
  }
  if (
    artifact.safety.requiresApprovalToReplayUnattended ||
    artifact.steps.some((s) => s.risk_class === "irreversible")
  ) {
    return "irreversible";
  }
  if (artifact.steps.some((s) => s.risk_class === "reversible_write")) {
    return "reversible_write";
  }
  return "read";
}

function lastRunFor(artifactId: string): { status?: RunStatusChip; successRate?: number } {
  const dirs = listEvidenceDirs();
  let success = 0;
  let total = 0;
  let lastStatus: RunStatusChip | undefined;
  for (const name of dirs.slice().reverse()) {
    try {
      const metaPath = join(safePath("evidence", name), "meta.json");
      const resultPath = join(safePath("evidence", name), "result.json");
      if (!existsSync(resultPath)) continue;
      let match = false;
      if (existsSync(metaPath)) {
        const meta = JSON.parse(readFileSync(metaPath, "utf8")) as {
          artifactId?: string;
          artifactName?: string;
        };
        match =
          meta.artifactId === artifactId ||
          Boolean(meta.artifactName && meta.artifactName.includes(artifactId));
      }
      if (!match) continue;
      const result = JSON.parse(readFileSync(resultPath, "utf8")) as {
        status?: string;
      };
      total += 1;
      if (result.status === "success") success += 1;
      if (!lastStatus) {
        lastStatus = (result.status as RunStatusChip) ?? "unknown";
      }
    } catch {
      /* skip */
    }
  }
  return {
    status: lastStatus,
    successRate: total ? success / total : undefined,
  };
}

artifactsRouter.get("/artifacts", (_req, res) => {
  const dir = safePath("artifacts");
  if (!existsSync(dir)) return res.json([]);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const list: ArtifactSummary[] = [];
  for (const file of files) {
    try {
      const a = loadArtifact(join(dir, file));
      const stats = lastRunFor(a.artifactId);
      list.push({
        id: a.artifactId,
        name: a.name,
        description: a.description,
        version: a.capabilityVersion,
        reviewStatus: a.reviewStatus,
        riskClass: riskOf(a),
        lastRunStatus: stats.status,
        successRate: stats.successRate,
        tenants: Object.keys(a.tenant_overrides ?? {}),
        filename: file,
        provenanceSource: a.provenance?.discoveryRunId ? "discovered" : "fixture",
      });
    } catch {
      /* skip invalid */
    }
  }
  res.json(list);
});

artifactsRouter.get("/artifacts/:id", (req, res) => {
  try {
    const a = loadArtifact(req.params.id);
    let schemaValid = true;
    let schemaErrors: string[] = [];
    try {
      validateArtifact(a);
    } catch (err) {
      schemaValid = false;
      schemaErrors = [err instanceof Error ? err.message : String(err)];
    }
    res.json({
      artifact: redactDeep(a),
      schemaValid,
      schemaErrors,
      riskClass: riskOf(a),
    });
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

artifactsRouter.post("/artifacts/:id/approve", (req, res) => {
  try {
    const updated = updateArtifactReview(req.params.id, "approved");
    const auditDir = safePath("evidence", "_audit");
    mkdirSync(auditDir, { recursive: true });
    writeFileSync(
      join(auditDir, `approve-${updated.artifactId}-${Date.now()}.json`),
      JSON.stringify(
        {
          at: new Date().toISOString(),
          artifactId: updated.artifactId,
          by: "Operator",
          action: "approve",
        },
        null,
        2
      )
    );
    res.json({ artifact: redactDeep(updated) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

artifactsRouter.post("/artifacts/:id/reject", (req, res) => {
  try {
    const updated = updateArtifactReview(req.params.id, "draft");
    res.json({ artifact: redactDeep(updated) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

artifactsRouter.post("/artifacts/:id/drift", async (req, res) => {
  const tenant = String(req.query.tenant ?? req.body?.tenant ?? "");
  try {
    const artifact = loadArtifact(req.params.id);
    const baseUrl = artifact.targetApp.baseUrl;
    const adapter = new PlaywrightWebAdapter({
      baseUrl,
      headless: true,
    });
    await adapter.launch();
    try {
      await adapter.act({
        kind: "navigate",
        path: artifact.preconditions.startUrl || "/login",
      });
      // Soft login if credentials present so fingerprint can see member search
      const user = process.env.CORESERV_USER ?? process.env.CORESERV_USERNAME;
      const pass = process.env.CORESERV_PASS ?? process.env.CORESERV_PASSWORD;
      if (user && pass) {
        const page = adapter.getPage();
        await page.locator('input[name="username"]').fill(user).catch(() => undefined);
        await page.locator('input[name="password"]').fill(pass).catch(() => undefined);
        await page.locator('input[type="submit"], button[type="submit"]').first().click().catch(() => undefined);
        await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      }
      const obs = await adapter.observe();
      const drift = checkDrift(artifact, obs);
      res.json(redactDeep({ ...drift, tenant: tenant || null }));
    } finally {
      await adapter.close();
    }
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
