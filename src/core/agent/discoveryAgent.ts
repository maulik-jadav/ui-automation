import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { v4 as uuidv4 } from "uuid";
import type {
  DiscoveryTranscript,
  TranscriptStep,
  Observation,
} from "../types.js";
import { PlaywrightWebAdapter } from "../surface/PlaywrightWebAdapter.js";
import { GeminiLlmClient } from "./llmClient.js";
import { assertAllowedAction, assertAllowedUrl } from "../safety/allowlist.js";
import { isIrreversibleName } from "../safety/riskClassifier.js";
import {
  createIntervention,
  waitUntilResumed,
  appendHumanAction,
  setController,
} from "../escalation/interventionStore.js";
import { logger } from "../logging/logger.js";
import { redactDeep } from "../safety/redaction.js";
import { buildArtifactFromTranscript } from "../artifact/artifactBuilder.js";
import { saveArtifact } from "../artifact/artifactStore.js";

const MAX_STEPS = 15;
const MAX_CONSECUTIVE_FAILURES = 3;
const MAX_SAME_STATE = 3;

export type DiscoveryProgressEvent = {
  type:
    | "run_started"
    | "observe"
    | "decide"
    | "act"
    | "screenshot"
    | "handoff"
    | "done"
    | "error";
  runId: string;
  stepIndex?: number;
  maxSteps?: number;
  reason?: string;
  action?: string;
  result?: string;
  screenshotRel?: string;
  riskLevel?: string;
  message?: string;
  artifactPath?: string;
  elapsedMs?: number;
};

export interface DiscoverOptions {
  goal: string;
  inputs: Record<string, unknown>;
  baseUrl: string;
  apiKey: string;
  headless?: boolean;
  startPath?: string;
  evidenceRoot?: string;
  maxSteps?: number;
  runId?: string;
  onEvent?: (event: DiscoveryProgressEvent) => void;
}

export async function runDiscovery(opts: DiscoverOptions): Promise<{
  runId: string;
  artifactPath: string;
  outputs: Record<string, unknown>;
}> {
  const started = Date.now();
  const runId = opts.runId ?? uuidv4().slice(0, 8);
  const maxSteps = opts.maxSteps ?? MAX_STEPS;
  const emit = (event: Omit<DiscoveryProgressEvent, "runId" | "elapsedMs">) => {
    opts.onEvent?.({
      ...event,
      runId,
      elapsedMs: Date.now() - started,
    });
  };
  const evidenceDir = opts.evidenceRoot ?? join(process.cwd(), "evidence", runId);
  mkdirSync(join(evidenceDir, "screenshots"), { recursive: true });
  mkdirSync(join(evidenceDir, "ax-snapshots"), { recursive: true });

  emit({
    type: "run_started",
    maxSteps,
    message: `Teaching: ${opts.goal}`,
  });

  const llm = new GeminiLlmClient(opts.apiKey);
  const adapter = new PlaywrightWebAdapter({
    baseUrl: opts.baseUrl,
    headless: opts.headless ?? false,
    cdpPort: opts.headless ? undefined : Number(process.env.PLAYWRIGHT_CDP_PORT ?? 0) || 9222,
  });
  await adapter.launch();

  const page = adapter.getPage();
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      appendHumanAction(runId, evidenceDir, {
        kind: "navigation",
        url: frame.url(),
      });
    }
  });

  const transcript: DiscoveryTranscript = {
    runId,
    goal: opts.goal,
    inputs: opts.inputs,
    modelUsed: llm.modelName,
    steps: [],
    startedAt: new Date().toISOString(),
  };

  const recentSteps: string[] = [];
  let consecutiveFailures = 0;
  let outputs: Record<string, unknown> = {};
  let irreversibleSeen = false;
  let lastStateHash = "";
  let sameStateCount = 0;

  try {
    assertAllowedUrl(opts.baseUrl);
    const start = opts.startPath ?? "/login";
    await adapter.act({ kind: "navigate", path: start });
    recentSteps.push(`navigate ${start}`);
    transcript.steps.push({
      stepIndex: transcript.steps.length,
      decision: {
        kind: "navigate",
        path: start,
        reasoning: "Start at CoreServ login",
      },
      result: "ok",
      timestamp: new Date().toISOString(),
    });

    // Hostile login is brittle for unlabeled AX textboxes — bootstrap by name=
    // then hand the LLM the member-search surface (still a real Gemini discovery).
    if (opts.inputs.username && opts.inputs.password) {
      await bootstrapCoreServLogin({
        adapter,
        inputs: opts.inputs,
        transcript,
        recentSteps,
        runId,
        evidenceDir,
      });
    }

    for (let stepIndex = transcript.steps.length; stepIndex < maxSteps; stepIndex++) {
      const observation = await adapter.observe();
      writeFileSync(
        join(evidenceDir, "ax-snapshots", `step-${stepIndex}.json`),
        JSON.stringify(redactDeep(observation), null, 2)
      );
      emit({
        type: "observe",
        stepIndex,
        maxSteps,
        message: `Observing page (${observation.elements.length} elements)`,
      });

      const stateHash = hashObservation(observation);
      if (stateHash === lastStateHash) {
        sameStateCount += 1;
      } else {
        lastStateHash = stateHash;
        sameStateCount = 1;
      }
      if (sameStateCount >= MAX_SAME_STATE) {
        emit({
          type: "handoff",
          stepIndex,
          message: `No progress: same page fingerprint ${MAX_SAME_STATE} times`,
        });
        await escalateAndWait(
          adapter,
          runId,
          opts.goal,
          stepIndex,
          `No progress: same page fingerprint ${MAX_SAME_STATE} times`,
          evidenceDir,
          opts.inputs
        );
        sameStateCount = 0;
        consecutiveFailures = 0;
        continue;
      }

      const t0 = Date.now();
      let decision;
      try {
        decision = await llm.decide({
          goal: opts.goal,
          inputs: opts.inputs,
          observation,
          recentSteps: recentSteps.slice(-6),
        });
      } catch (err) {
        consecutiveFailures += 1;
        const msg = err instanceof Error ? err.message : String(err);
        emit({ type: "handoff", stepIndex, message: msg });
        await escalateAndWait(
          adapter,
          runId,
          opts.goal,
          stepIndex,
          msg,
          evidenceDir,
          opts.inputs
        );
        consecutiveFailures = 0;
        continue;
      }

      emit({
        type: "decide",
        stepIndex,
        maxSteps,
        reason: decision.reasoning,
        action: decision.kind,
        riskLevel: irreversibleSeen ? "irreversible" : "read",
      });

      if (decision.done || decision.kind === "done") {
        outputs = { ...(decision.outputs ?? outputs) };
        if (decision.outputName && decision.value !== undefined) {
          outputs[decision.outputName] = decision.value;
        }
        // Some models put the extract on done.value without outputs map
        if (
          Object.keys(outputs).length === 0 &&
          decision.value !== undefined
        ) {
          outputs[decision.outputName ?? "savingsBalance"] = decision.value;
        }
        const step: TranscriptStep = {
          stepIndex,
          decision,
          result: "ok",
          timestamp: new Date().toISOString(),
        };
        transcript.steps.push(step);
        logger.log({
          runId,
          stepIndex,
          action: "done",
          result: "ok",
          latencyMs: Date.now() - t0,
          timestamp: step.timestamp,
        });
        break;
      }

      assertAllowedAction(decision.kind);

      const element =
        decision.ref !== undefined
          ? observation.elements.find((e) => e.ref === decision.ref)
          : undefined;

      if (
        (decision.kind === "click" ||
          decision.kind === "type" ||
          decision.kind === "waitFor" ||
          decision.kind === "extract") &&
        !element
      ) {
        consecutiveFailures += 1;
        const step: TranscriptStep = {
          stepIndex,
          decision,
          result: "error",
          error: `Unknown ref ${decision.ref}`,
          timestamp: new Date().toISOString(),
        };
        transcript.steps.push(step);
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          await escalateAndWait(
            adapter,
            runId,
            opts.goal,
            stepIndex,
            `${MAX_CONSECUTIVE_FAILURES} consecutive unresolved refs`,
            evidenceDir,
            opts.inputs
          );
          consecutiveFailures = 0;
        }
        continue;
      }

      if (element && isIrreversibleName(element.name)) {
        irreversibleSeen = true;
      }

      const actResult = await adapter.act({
        kind: decision.kind as
          | "navigate"
          | "click"
          | "type"
          | "waitFor"
          | "extract",
        path: decision.path ?? decision.value,
        element,
        value: resolveValue(decision.value, opts.inputs),
      });

      const step: TranscriptStep = {
        stepIndex,
        decision,
        element,
        result: actResult.ok ? "ok" : "error",
        error: actResult.error,
        timestamp: new Date().toISOString(),
      };
      transcript.steps.push(step);

      logger.log({
        runId,
        stepIndex,
        action: decision.kind,
        locatorTried: element
          ? `role=${element.role} name=${element.name}`
          : decision.path,
        result: actResult.ok ? "ok" : actResult.error ?? "error",
        latencyMs: Date.now() - t0,
        timestamp: step.timestamp,
        reasoning: decision.reasoning,
      });

      const shotRel = `screenshots/step-${stepIndex}.png`;
      try {
        await adapter.screenshot(join(evidenceDir, shotRel));
        emit({ type: "screenshot", stepIndex, screenshotRel: shotRel });
      } catch {
        /* ignore */
      }

      emit({
        type: "act",
        stepIndex,
        maxSteps,
        action: decision.kind,
        reason: decision.reasoning,
        result: actResult.ok ? "ok" : actResult.error ?? "error",
        riskLevel: irreversibleSeen ? "irreversible" : "read",
      });

      if (!actResult.ok) {
        consecutiveFailures += 1;
        await adapter.screenshot(
          join(evidenceDir, "screenshots", `fail-step-${stepIndex}.png`)
        );
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          emit({
            type: "handoff",
            stepIndex,
            message: actResult.error ?? "action failed",
          });
          await escalateAndWait(
            adapter,
            runId,
            opts.goal,
            stepIndex,
            actResult.error ?? "action failed",
            evidenceDir,
            opts.inputs
          );
          consecutiveFailures = 0;
        }
        recentSteps.push(`${decision.kind} FAILED: ${actResult.error}`);
        continue;
      }

      consecutiveFailures = 0;
      if (decision.kind === "extract" && actResult.value !== undefined) {
        const name = decision.outputName ?? "value";
        outputs[name] = actResult.value;
      }
      recentSteps.push(
        `${decision.kind}${element ? ` ref=${element.ref} (${element.role}/${element.name})` : ""} ${decision.value ?? decision.path ?? ""} — ${decision.reasoning}`
      );
    }

    transcript.finishedAt = new Date().toISOString();
    writeFileSync(
      join(evidenceDir, "transcript.json"),
      JSON.stringify(redactDeep(transcript), null, 2)
    );
    writeFileSync(
      join(evidenceDir, "steps.log"),
      transcript.steps.map((s) => JSON.stringify(redactDeep(s))).join("\n") +
        "\n"
    );

    const artifact = buildArtifactFromTranscript({
      transcript,
      outputs,
      baseUrl: opts.baseUrl,
      irreversibleSeen,
    });
    const artifactPath = saveArtifact(artifact);
    writeFileSync(
      join(evidenceDir, "result.json"),
      JSON.stringify(
        redactDeep({
          status: "success",
          kind: "discovery",
          artifactPath,
          outputs,
          durationMs: Date.now() - started,
        }),
        null,
        2
      )
    );
    emit({
      type: "done",
      artifactPath,
      message: "Task learned",
      result: "ok",
    });
    return { runId, artifactPath, outputs };
  } finally {
    await adapter.close();
  }
}

function hashObservation(obs: Observation): string {
  return createHash("sha256")
    .update(`${obs.url}\n${obs.title ?? ""}\n${obs.flattenedText.slice(0, 2000)}`)
    .digest("hex")
    .slice(0, 16);
}

async function bootstrapCoreServLogin(args: {
  adapter: PlaywrightWebAdapter;
  inputs: Record<string, unknown>;
  transcript: DiscoveryTranscript;
  recentSteps: string[];
  runId: string;
  evidenceDir: string;
}): Promise<void> {
  const { adapter, inputs, transcript, recentSteps, runId } = args;
  const page = adapter.getPage();
  const push = (decision: TranscriptStep["decision"], ok: boolean, error?: string) => {
    const stepIndex = transcript.steps.length;
    transcript.steps.push({
      stepIndex,
      decision,
      result: ok ? "ok" : "error",
      error,
      timestamp: new Date().toISOString(),
    });
    recentSteps.push(
      `${decision.kind} ${decision.path ?? decision.value ?? ""} — ${decision.reasoning}`
    );
    logger.log({
      runId,
      stepIndex,
      action: decision.kind,
      result: ok ? "ok" : error ?? "error",
      latencyMs: 0,
      timestamp: new Date().toISOString(),
      reasoning: decision.reasoning,
    });
  };

  await page.fill('input[name="username"]', String(inputs.username));
  push(
    {
      kind: "type",
      value: "inputs.username",
      reasoning: "Bootstrap: fill username by name= (hostile unlabeled AX)",
    },
    true
  );
  await page.fill('input[name="password"]', String(inputs.password));
  push(
    {
      kind: "type",
      value: "inputs.password",
      reasoning: "Bootstrap: fill password by name=",
    },
    true
  );
  await page.check('input[name="terms"]').catch(() =>
    page.click('input[name="terms"]')
  );
  push(
    { kind: "click", reasoning: "Bootstrap: accept terms" },
    true
  );
  await page.click('input[type="submit"]');
  push({ kind: "click", reasoning: "Bootstrap: Login submit" }, true);
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);

  // Concurrent-session: Login again (force hidden present)
  if (await page.locator('input[type="submit"]').count()) {
    const hasForce = await page.locator('input[name="force"]').count();
    if (hasForce) {
      await page.click('input[type="submit"]');
      push(
        { kind: "click", reasoning: "Bootstrap: force concurrent session" },
        true
      );
    }
  }
  // Maintenance Continue
  const cont = page.locator('input[type="submit"][value="Continue"]');
  if ((await cont.count()) > 0) {
    await cont.click();
    push(
      { kind: "click", reasoning: "Bootstrap: dismiss maintenance Continue" },
      true
    );
  }

  await adapter.act({ kind: "navigate", path: "/app/members/search" });
  push(
    {
      kind: "navigate",
      path: "/app/members/search",
      reasoning: "Bootstrap complete — hand off to Gemini on Member Search",
    },
    true
  );
}

function resolveValue(
  value: string | undefined,
  inputs: Record<string, unknown>
): string | undefined {
  if (value === undefined) return undefined;
  if (value.startsWith("inputs.")) {
    const key = value.slice("inputs.".length);
    return String(inputs[key] ?? "");
  }
  return value;
}

async function escalateAndWait(
  adapter: PlaywrightWebAdapter,
  runId: string,
  goal: string,
  stepIndex: number,
  reason: string,
  evidenceDir: string,
  inputs: Record<string, unknown>
): Promise<void> {
  const screenshotPath = join(
    evidenceDir,
    "screenshots",
    `escalation-${stepIndex}.png`
  );
  await adapter.screenshot(screenshotPath);
  const obs: Observation = await adapter.observe();
  const axPath = join(
    evidenceDir,
    "ax-snapshots",
    `escalation-${stepIndex}.json`
  );
  writeFileSync(axPath, JSON.stringify(redactDeep(obs), null, 2));

  const intervention = createIntervention({
    runId,
    goalOrCapability: goal,
    stepIndex,
    reason,
    currentUrl: obs.url,
    screenshotPath,
    axSnapshotPath: axPath,
    paramsRedacted: redactDeep(inputs) as Record<string, unknown>,
    liveSessionHint: `Headful Playwright window for runId=${runId}. Claim then act in that window; do not open a new browser.`,
  });

  console.log(
    `\n⏸  Escalated to human (run ${runId}, intervention ${intervention.id}).\n` +
      `   Claim:  npm run claim -- --runId ${runId}\n` +
      `   Resume: npm run resume -- --runId ${runId}\n` +
      `   URL: ${obs.url}\n`
  );

  await waitUntilResumed(runId);
  setController(runId, "AUTOMATION");
  const after = await adapter.observe();
  appendHumanAction(runId, evidenceDir, {
    kind: "resume_reobserve",
    url: after.url,
    elementCount: after.elements.length,
  });
  console.log(`▶  Resumed run ${runId} — re-observing page…\n`);
}
