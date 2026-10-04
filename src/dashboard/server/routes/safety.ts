import { Router } from "express";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertAllowedUrl,
  loadAllowlist,
  AllowlistViolation,
} from "../../../core/safety/allowlist.js";
import { redactDeep, redactString } from "../../../core/safety/redaction.js";
import { loadArtifact } from "../../../core/artifact/artifactStore.js";
import { safePath, listEvidenceDirs } from "../pathSafe.js";

export const safetyRouter = Router();

safetyRouter.get("/safety/config", (_req, res) => {
  try {
    const cfg = loadAllowlist();
    res.json({
      ...cfg,
      riskLegend: [
        {
          class: "read",
          label: "Read-only",
          policy: "Allowed. Logged for audit.",
        },
        {
          class: "reversible_write",
          label: "Reversible",
          policy: "Allowed with logging. Can usually be undone.",
        },
        {
          class: "irreversible",
          label: "Irreversible",
          policy: "Requires supervisor approval or a human in the loop before unattended run.",
        },
      ],
      alwaysMasked: [
        "SSN",
        "Email",
        "Phone",
        "Date of birth",
        "Card numbers",
        "Long account numbers",
        "Passwords / API keys",
        "Cookies / authorization headers",
      ],
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

safetyRouter.post("/safety/test-url", (req, res) => {
  const url = String(req.body?.url ?? "");
  if (!url) return res.status(400).json({ allowed: false, reason: "URL required" });
  try {
    assertAllowedUrl(url);
    res.json({ allowed: true, reason: "URL is on the allowlist." });
  } catch (err) {
    const reason =
      err instanceof AllowlistViolation
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    res.json({ allowed: false, reason });
  }
});

safetyRouter.post("/safety/redact", (req, res) => {
  const text = String(req.body?.text ?? "");
  res.json({ redacted: redactString(text) });
});

safetyRouter.get("/safety/blocked", (_req, res) => {
  const events: unknown[] = [];
  for (const name of listEvidenceDirs()) {
    if (name.startsWith("_")) continue;
    const resultPath = join(safePath("evidence", name), "result.json");
    if (!existsSync(resultPath)) continue;
    try {
      const result = JSON.parse(readFileSync(resultPath, "utf8")) as {
        status?: string;
        error_class?: string;
        message?: string;
      };
      if (
        result.error_class === "allowlist" ||
        result.status === "needs_human" ||
        /allowlist|irreversible|approval/i.test(result.message ?? "")
      ) {
        events.push(
          redactDeep({
            runId: name.replace(/^(replay-|stability-)/, ""),
            evidenceDir: name,
            ...result,
          })
        );
      }
    } catch {
      /* skip */
    }
  }
  res.json(events.slice(0, 100));
});

safetyRouter.get("/safety/approvals", (_req, res) => {
  const dir = safePath("artifacts");
  if (!existsSync(dir)) return res.json([]);
  const drafts = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return loadArtifact(join(dir, f));
      } catch {
        return null;
      }
    })
    .filter((a): a is NonNullable<typeof a> => Boolean(a && a.reviewStatus === "draft"))
    .map((a) =>
      redactDeep({
        id: a.artifactId,
        name: a.name,
        description: a.description,
        irreversibleSteps: a.steps
          .map((s, i) => ({ i, s }))
          .filter(
            ({ s }) =>
              ("irreversible" in s && s.irreversible) || s.risk_class === "irreversible"
          )
          .map(({ i, s }) => ({ step: i, kind: s.kind })),
      })
    );
  res.json(drafts);
});

safetyRouter.get("/safety/audit", (_req, res) => {
  const auditDir = safePath("evidence", "_audit");
  if (!existsSync(auditDir)) return res.json([]);
  const files = readdirSync(auditDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse()
    .slice(0, 50);
  res.json(
    files.map((f) => {
      try {
        return JSON.parse(readFileSync(join(auditDir, f), "utf8"));
      } catch {
        return { file: f };
      }
    })
  );
});
