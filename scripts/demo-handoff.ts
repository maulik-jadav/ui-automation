/**
 * Live handoff demo: starts a headed replay with a stuck locator, claims,
 * acts in the SAME browser via CDP, resumes, writes human-actions.jsonl.
 *
 * Usage (server must be up):
 *   npx tsx scripts/demo-handoff.ts
 */
import "dotenv/config";
import { chromium } from "playwright";
import { buildSeededLookupArtifact } from "../src/core/artifact/artifactBuilder.js";
import { saveArtifact } from "../src/core/artifact/artifactStore.js";
import { runReplay } from "../src/core/replay/replayEngine.js";
import {
  claimIntervention,
  markResumed,
  listInterventions,
} from "../src/core/escalation/interventionStore.js";
import type { CapabilityArtifact, Locator } from "../src/core/types.js";

const CDP_PORT = 9333;
const baseUrl = process.env.MOCK_APP_BASE_URL ?? "http://localhost:4000";

function stuckArtifact(): CapabilityArtifact {
  const a = buildSeededLookupArtifact(baseUrl);
  // Replace extract locator with something that won't resolve → needs_human
  const bad: Locator = {
    primary: {
      strategy: "text",
      text: "___NO_SUCH_ELEMENT_FOR_HANDOFF_DEMO___",
      confidence: "high",
      rationale: "Intentional stuck locator for handoff demo",
    },
    fallbacks: [],
  };
  const steps = a.steps.map((s) =>
    s.kind === "extract" ? { ...s, locator: bad } : s
  );
  return {
    ...a,
    artifactId: "handoff-demo-lookup",
    name: "lookup_member_savings_balance_handoff_demo",
    steps,
  };
}

async function operatorLoop(runIdPromise: Promise<string>): Promise<void> {
  const runId = await runIdPromise;
  // Wait until intervention exists
  for (let i = 0; i < 60; i++) {
    const pending = listInterventions().find(
      (x) => x.runId === runId && (x.status === "pending" || x.status === "claimed")
    );
    if (pending) {
      claimIntervention(runId, "operator-demo");
      console.log("Operator claimed", runId);
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  // Act in the SAME browser via CDP
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const context = browser.contexts()[0];
  const page = context?.pages()[0];
  if (!page) throw new Error("No page on CDP");

  // Human fixes the page so the stuck locator can resolve (same live session)
  await page.evaluate(() => {
    const d = document.createElement("div");
    d.id = "handoff-fix";
    d.textContent = "___NO_SUCH_ELEMENT_FOR_HANDOFF_DEMO___ $4,321.09";
    document.body.appendChild(d);
  });
  await page.click("#handoff-fix").catch(() => undefined);
  console.log("Operator acted in live session; resuming…");
  markResumed(runId);
  // Don't close CDP browser — it's the automation browser
}

async function main(): Promise<void> {
  const user = process.env.CORESERV_USER;
  const pass = process.env.CORESERV_PASS;
  if (!user || !pass) {
    console.error("Set CORESERV_USER / CORESERV_PASS in .env");
    process.exit(1);
  }

  const artifact = stuckArtifact();
  saveArtifact(artifact);

  let resolveRunId!: (id: string) => void;
  const runIdPromise = new Promise<string>((r) => {
    resolveRunId = r;
  });

  // Patch: runReplay creates runId internally — poll interventions instead
  const op = (async () => {
    for (let i = 0; i < 120; i++) {
      const items = listInterventions().filter(
        (x) =>
          x.goalOrCapability.includes("handoff_demo") &&
          (x.status === "pending" || x.status === "claimed")
      );
      if (items.length) {
        resolveRunId(items[items.length - 1].runId);
        await operatorLoop(Promise.resolve(items[items.length - 1].runId));
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("Timed out waiting for intervention");
  })();

  // Dynamic import path: we need CDP on the adapter — set env for replay
  process.env.PLAYWRIGHT_CDP_PORT = String(CDP_PORT);

  const { PlaywrightWebAdapter } = await import(
    "../src/core/surface/PlaywrightWebAdapter.js"
  );
  const origLaunch = PlaywrightWebAdapter.prototype.launch;
  PlaywrightWebAdapter.prototype.launch = async function (this: InstanceType<
    typeof PlaywrightWebAdapter
  >) {
    this.cdpPort = CDP_PORT;
    return origLaunch.call(this);
  };

  const resultPromise = runReplay({
    artifact,
    inputs: { memberId: "12345", username: user, password: pass },
    headless: false,
    allowHandoff: true,
  });

  const [, result] = await Promise.all([op, resultPromise]);
  console.log(JSON.stringify(result, null, 2));
  console.log(
    "Check evidence/replay-*/human-actions.jsonl for click/input/navigation entries."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
