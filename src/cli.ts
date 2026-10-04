#!/usr/bin/env node
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runDiscovery } from "./core/agent/discoveryAgent.js";
import { runReplay } from "./core/replay/replayEngine.js";
import {
  loadArtifact,
  saveArtifact,
  updateArtifactReview,
} from "./core/artifact/artifactStore.js";
import {
  buildSeededLookupArtifact,
  buildSeededOpenAccountDraftArtifact,
} from "./core/artifact/artifactBuilder.js";
import {
  markResumed,
  claimIntervention,
  listInterventions,
} from "./core/escalation/interventionStore.js";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function usage(): never {
  console.log(`
ui-automation CLI

  ENABLE_TEST_HARNESS=1 npm start           CoreServ on :4000

  # Credentials: set CORESERV_USER / CORESERV_PASS / GEMINI_API_KEY in .env (never --password)

  npm run discover -- --memberId 12345
  npm run replay -- --seeded --memberId 12345
  npm run replay -- --artifact <path|id> --memberId 12345 [--tenant harborview]
  npm run replay -- --seeded-write --memberId 12345   # open-account draft (needs approve)
  npm run stability -- --seeded --n 5 --memberId 12345
  npm run claim -- --runId <id>
  npm run resume -- --runId <id>
  npm run interventions
  npm run approve -- --artifact <path|id>
  npm run seed-artifact

Options:
  --memberId <id>     Member ID (default 12345)
  --goal <text>       Discovery goal override
  --artifact <ref>    Artifact path or id
  --seeded            Hand-authored lookup fixture (labeled seeded)
  --seeded-write      Hand-authored open-account-to-confirm draft
  --tenant <id>       Apply tenant_overrides
  --headless          Playwright headless
  --baseUrl <url>     Default http://localhost:4000
  --n <count>         Stability runs (default 5)
  --allowHandoff      Pause for human on stuck locator
`);
  process.exit(1);
}

function buildInputs(): Record<string, unknown> {
  const username = process.env.CORESERV_USER;
  const password = process.env.CORESERV_PASS;
  if (!username || !password) {
    console.error(
      "Set CORESERV_USER and CORESERV_PASS in .env (do not pass passwords on the CLI)."
    );
    process.exit(1);
  }
  if (arg("password") || arg("username")) {
    console.error(
      "Refusing --username / --password flags (shell history risk). Use .env instead."
    );
    process.exit(1);
  }
  return {
    memberId: arg("memberId") ?? "12345",
    username,
    password,
    deposit: arg("deposit") ?? process.env.CORESERV_DEPOSIT ?? "500",
  };
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (!cmd || cmd === "help" || cmd === "--help") usage();

  const baseUrl =
    arg("baseUrl") ??
    process.env.MOCK_APP_BASE_URL ??
    "http://localhost:4000";
  const headless = flag("headless");
  const tenant = arg("tenant");
  const allowHandoff = flag("allowHandoff");

  if (cmd === "discover") {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey.includes("your_gemini")) {
      console.error(
        "Set GEMINI_API_KEY in .env (https://aistudio.google.com/apikey)"
      );
      process.exit(1);
    }
    const inputs = buildInputs();
    const goal =
      arg("goal") ??
      `You are already authenticated on CoreServ Member Search. Look up member ${inputs.memberId} using the Member # field, run Search, open the savings account inquiry (or navigate to /app/accounts/inquiry?acct=${inputs.memberId}-S01), extract the Current balance as outputName savingsBalance, then done. Prefer top-level /app paths.`;

    console.log(`Discovery starting (Gemini)… model=${process.env.GEMINI_MODEL ?? "fallback-chain"}`);
    const result = await runDiscovery({
      goal,
      inputs,
      baseUrl,
      apiKey,
      headless,
      startPath: "/login",
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (cmd === "replay") {
    const inputs = buildInputs();
    let artifact;
    if (flag("seeded-write")) {
      artifact = buildSeededOpenAccountDraftArtifact(baseUrl);
      const path = saveArtifact(artifact);
      console.log(`Using seeded WRITE (draft) artifact → ${path}`);
    } else if (flag("seeded") || !arg("artifact")) {
      artifact = buildSeededLookupArtifact(baseUrl);
      const path = saveArtifact(artifact);
      console.log(`Using seeded LOOKUP fixture → ${path}`);
    } else {
      artifact = loadArtifact(arg("artifact")!);
    }

    console.log(
      `Replay ${artifact.name} memberId=${inputs.memberId}` +
        (tenant ? ` tenant=${tenant}` : "")
    );
    const result = await runReplay({
      artifact,
      inputs,
      headless,
      tenant,
      allowHandoff,
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "hard_failure") process.exit(2);
    return;
  }

  if (cmd === "stability") {
    const inputs = buildInputs();
    const n = Math.max(1, Number(arg("n") ?? 5));
    let artifact;
    if (flag("seeded") || !arg("artifact")) {
      artifact = buildSeededLookupArtifact(baseUrl);
      saveArtifact(artifact);
    } else {
      artifact = loadArtifact(arg("artifact")!);
    }

    const runs: {
      i: number;
      status: string;
      durationMs?: number;
      message?: string;
    }[] = [];
    for (let i = 1; i <= n; i++) {
      console.log(`\n── Stability run ${i}/${n} ──`);
      const result = await runReplay({
        artifact,
        inputs,
        headless: true,
        tenant,
        allowHandoff: false,
      });
      runs.push({
        i,
        status: result.status,
        durationMs: result.durationMs,
        message:
          "message" in result
            ? String((result as { message?: string }).message ?? "")
            : undefined,
      });
    }

    const successish = runs.filter((r) =>
      ["success", "recovered", "business_outcome"].includes(r.status)
    ).length;
    const report = {
      artifactId: artifact.artifactId,
      name: artifact.name,
      n,
      tenant: tenant ?? null,
      inputs: { memberId: inputs.memberId, username: inputs.username },
      successRate: successish / n,
      byStatus: Object.fromEntries(
        [...new Set(runs.map((r) => r.status))].map((s) => [
          s,
          runs.filter((r) => r.status === s).length,
        ])
      ),
      runs,
      generatedAt: new Date().toISOString(),
    };
    const outDir = join(process.cwd(), "evidence", "stability");
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, `stability-${Date.now()}.json`);
    writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    console.log(`Wrote ${outPath}`);
    if (report.successRate < 1) process.exit(2);
    return;
  }

  if (cmd === "claim") {
    const runId = arg("runId");
    if (!runId) {
      console.error("--runId required");
      process.exit(1);
    }
    try {
      const updated = claimIntervention(runId, arg("by") ?? "operator");
      if (!updated) {
        console.error(`No pending intervention for runId=${runId}`);
        process.exit(1);
      }
      console.log(`Claimed:`, updated);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
    return;
  }

  if (cmd === "resume") {
    const runId = arg("runId");
    if (!runId) {
      console.error("--runId required");
      process.exit(1);
    }
    const updated = markResumed(runId);
    if (!updated) {
      console.error(`No pending/claimed intervention for runId=${runId}`);
      process.exit(1);
    }
    console.log(`Marked resumed:`, updated);
    return;
  }

  if (cmd === "interventions") {
    const items = listInterventions().filter(
      (i) => i.status === "pending" || i.status === "claimed"
    );
    console.log(JSON.stringify(items, null, 2));
    return;
  }

  if (cmd === "approve") {
    const ref = arg("artifact");
    if (!ref) {
      console.error("--artifact required");
      process.exit(1);
    }
    const updated = updateArtifactReview(ref, "approved");
    console.log(`Approved ${updated.artifactId} (${updated.name})`);
    return;
  }

  if (cmd === "seed-artifact") {
    const lookup = saveArtifact(buildSeededLookupArtifact(baseUrl));
    const write = saveArtifact(buildSeededOpenAccountDraftArtifact(baseUrl));
    console.log(lookup);
    console.log(write);
    return;
  }

  usage();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
