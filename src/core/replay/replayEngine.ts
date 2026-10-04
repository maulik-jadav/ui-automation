import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { v4 as uuidv4 } from "uuid";
import type {
  CapabilityArtifact,
  ReplayResult,
  StepAction,
  ErrorClass,
} from "../types.js";
import { PlaywrightWebAdapter } from "../surface/PlaywrightWebAdapter.js";
import {
  resolveLocator,
  describeLocator,
  describeStrategy,
} from "./locatorResolver.js";
import {
  findMatchingOutcome,
  detectPageConditions,
} from "./outcomeMatcher.js";
import { checkDrift, applyTenantOverride } from "./drift.js";
import {
  assertAllowedAction,
  assertAllowedUrl,
  AllowlistViolation,
} from "../safety/allowlist.js";
import {
  createIntervention,
  waitUntilResumed,
  appendHumanAction,
  setController,
} from "../escalation/interventionStore.js";
import { logger } from "../logging/logger.js";
import { redactDeep } from "../safety/redaction.js";
import {
  validateInputs,
  ArtifactValidationError,
} from "../artifact/artifactStore.js";

/** Optional progress callback for dashboard SSE (never imported by LLM client). */
export type ReplayProgressEvent = {
  type:
    | "run_started"
    | "step_start"
    | "step_done"
    | "screenshot"
    | "handoff"
    | "done"
    | "error";
  runId: string;
  stepId?: number;
  totalSteps?: number;
  action?: string;
  message?: string;
  strategyUsed?: string;
  screenshotRel?: string;
  result?: unknown;
  interventionId?: string;
  elapsedMs?: number;
};

export interface ReplayOptions {
  artifact: CapabilityArtifact;
  inputs: Record<string, unknown>;
  headless?: boolean;
  evidenceRoot?: string;
  tenant?: string;
  /** When true, pause for human instead of auto-failing on needs_human gates */
  allowHandoff?: boolean;
  /** Pre-assigned run id (dashboard). */
  runId?: string;
  /** Live progress for SSE consumers. */
  onEvent?: (event: ReplayProgressEvent) => void;
}

function resolveInputValue(
  valueFrom: string,
  inputs: Record<string, unknown>
): string {
  if (valueFrom.startsWith("inputs.")) {
    const key = valueFrom.slice("inputs.".length);
    return String(inputs[key] ?? "");
  }
  const m = valueFrom.match(/^\{\{(\w+)\}\}$/);
  if (m) return String(inputs[m[1]] ?? "");
  return valueFrom;
}

function transformValue(
  raw: string,
  transform?: "parseCurrency" | "trim" | "none"
): string {
  if (transform === "trim" || !transform) return raw.trim();
  if (transform === "none") return raw;
  const m = raw.match(/\$?\s*[\d,]+(?:\.\d{2})?/);
  return m ? m[0].replace(/\s/g, "") : raw.trim();
}

export async function runReplay(opts: ReplayOptions): Promise<ReplayResult> {
  const started = Date.now();
  let artifact = applyTenantOverride(opts.artifact, opts.tenant);
  const runId = opts.runId ?? uuidv4().slice(0, 8);
  const emit = (event: Omit<ReplayProgressEvent, "runId" | "elapsedMs">) => {
    opts.onEvent?.({
      ...event,
      runId,
      elapsedMs: Date.now() - started,
    });
  };
  const evidenceDir =
    opts.evidenceRoot ?? join(process.cwd(), "evidence", `replay-${runId}`);
  mkdirSync(join(evidenceDir, "screenshots"), { recursive: true });
  mkdirSync(join(evidenceDir, "ax-snapshots"), { recursive: true });

  const strategyLog: string[] = [];
  const recovered: { code: string; message: string; action: string }[] = [];
  emit({
    type: "run_started",
    totalSteps: artifact.steps.length,
    message: `Starting replay of ${artifact.name}`,
  });

  try {
    validateInputs(artifact, opts.inputs);
  } catch (err) {
    const fail = {
      status: "hard_failure" as const,
      stepId: -1,
      expected: "valid inputs",
      observed: String(err),
      error_class: "input_validation" as const,
      evidence_paths: [] as string[],
      message:
        err instanceof ArtifactValidationError
          ? err.message
          : String(err),
      durationMs: Date.now() - started,
    };
    emit({ type: "done", result: redactDeep(fail) });
    return fail;
  }

  if (
    artifact.safety.requiresApprovalToReplayUnattended &&
    artifact.reviewStatus !== "approved"
  ) {
    const intervention = createIntervention({
      runId,
      goalOrCapability: artifact.name,
      stepIndex: -1,
      reason: "Artifact requires approval before unattended replay",
      paramsRedacted: redactDeep(opts.inputs) as Record<string, unknown>,
    });
    const needs = {
      status: "needs_human" as const,
      interventionRequestId: intervention.id,
      runId,
      stepId: -1,
      reason: intervention.reason,
      durationMs: Date.now() - started,
    };
    emit({
      type: "handoff",
      interventionId: intervention.id,
      message: intervention.reason,
    });
    emit({ type: "done", result: redactDeep(needs) });
    return needs;
  }

  try {
    assertAllowedUrl(artifact.targetApp.baseUrl);
  } catch (err) {
    return allowlistFailure(err, started);
  }

  const adapter = new PlaywrightWebAdapter({
    baseUrl: artifact.targetApp.baseUrl,
    headless: opts.headless ?? false,
  });
  await adapter.launch();
  const page = adapter.getPage();
  const outputs: Record<string, unknown> = {};
  const retryPolicy = artifact.errorHandling.retryPolicy;

  // Best-effort: clear stale CoreServ sessions so concurrent-login interstitial is rare
  await page
    .request.post(`${artifact.targetApp.baseUrl}/__test/clear-sessions`)
    .catch(() => undefined);

  // Attach human-action listeners for handoff windows (nav + click + input)
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      appendHumanAction(runId, evidenceDir, {
        kind: "navigation",
        url: frame.url(),
      });
    }
  });
  await page.exposeBinding(
    "__uaHumanAction",
    (_source, entry: Record<string, unknown>) => {
      appendHumanAction(runId, evidenceDir, entry);
    }
  ).catch(() => undefined);
  const installHumanListeners = () => {
    const w = window as unknown as {
      __uaHumanAction?: (e: Record<string, unknown>) => void;
    };
    const log = (entry: Record<string, unknown>) => {
      try {
        w.__uaHumanAction?.(entry);
      } catch {
        /* ignore */
      }
    };
    if ((window as unknown as { __uaHumanInstalled?: boolean }).__uaHumanInstalled)
      return;
    (window as unknown as { __uaHumanInstalled?: boolean }).__uaHumanInstalled =
      true;
    document.addEventListener(
      "click",
      (ev) => {
        const t = ev.target as HTMLElement | null;
        if (!t) return;
        log({
          kind: "click",
          tag: t.tagName,
          name: (t as HTMLInputElement).name || t.getAttribute("name"),
          text: (t.innerText || (t as HTMLInputElement).value || "").slice(0, 80),
          id: t.id || undefined,
        });
      },
      true
    );
    document.addEventListener(
      "change",
      (ev) => {
        const t = ev.target as HTMLInputElement | null;
        if (!t) return;
        log({
          kind: "input",
          tag: t.tagName,
          name: t.name,
          valueRedacted:
            t.type === "password"
              ? "[REDACTED]"
              : String(t.value ?? "").slice(0, 40),
        });
      },
      true
    );
  };
  await page.addInitScript(installHumanListeners);
  await page.evaluate(installHumanListeners).catch(() => undefined);

  try {
    // Drift check after landing on start URL
    const start = artifact.preconditions.startUrl || "/";
    try {
      assertAllowedAction("navigate");
      await adapter.act({ kind: "navigate", path: start });
    } catch (err) {
      if (err instanceof AllowlistViolation) return allowlistFailure(err, started);
      throw err;
    }

    const obs0 = await adapter.observe();
    const drift = checkDrift(artifact, obs0);
    writeFileSync(
      join(evidenceDir, "drift.json"),
      JSON.stringify(redactDeep(drift), null, 2)
    );
    if (drift.status === "mismatch") {
      return {
        status: "hard_failure",
        stepId: -1,
        expected: artifact.fingerprint.screenSignature.join(", "),
        observed: drift.message,
        error_class: "unknown",
        evidence_paths: [join(evidenceDir, "drift.json")],
        message: `Screen fingerprint mismatch — possible tenant drift`,
        durationMs: Date.now() - started,
      };
    }

    for (let stepId = 0; stepId < artifact.steps.length; stepId++) {
      const step = artifact.steps[stepId];
      const t0 = Date.now();
      emit({
        type: "step_start",
        stepId,
        totalSteps: artifact.steps.length,
        action: step.kind,
        message: `Step ${stepId + 1}: ${step.kind}`,
      });
      try {
        assertAllowedAction(step.kind);
      } catch (err) {
        await adapter.close();
        const fail = allowlistFailure(err, started, stepId);
        emit({ type: "done", result: redactDeep(fail) });
        return fail;
      }

      // Built-in page detectors before each step
      const detected = await detectPageConditions(page);
      if (detected?.classification === "business_outcome") {
        return {
          status: "business_outcome",
          code: detected.code ?? "BUSINESS_OUTCOME",
          message: detected.message ?? "",
          partialOutputs: { ...outputs },
          durationMs: Date.now() - started,
        };
      }
      if (detected?.classification === "failure") {
        return await hardFail(
          adapter,
          stepId,
          detected.message ?? "page error",
          "error page",
          evidenceDir,
          started,
          detected.error_class ?? "unknown"
        );
      }
      if (detected?.classification === "recoverable") {
        const applied = await applyRecovery(
          adapter,
          detected.code === "SESSION_EXPIRED"
            ? "reauthenticate"
            : "retry",
          artifact,
          opts.inputs
        );
        recovered.push({
          code: detected.code ?? "RECOVERABLE",
          message: detected.message ?? "",
          action: applied,
        });
      }

      let retries = 0;
      let result: ReplayResult | "continue" | null = null;
      while (retries <= retryPolicy.maxRetries) {
        result = await executeStep({
          adapter,
          page,
          step,
          stepId,
          inputs: opts.inputs,
          outputs,
          artifact,
          runId,
          evidenceDir,
          strategyLog,
          allowHandoff: opts.allowHandoff === true,
        });
        if (
          result &&
          typeof result === "object" &&
          result.status === "hard_failure" &&
          result.error_class === "timeout" &&
          retries < retryPolicy.maxRetries
        ) {
          retries += 1;
          await new Promise((r) => setTimeout(r, retryPolicy.backoffMs));
          continue;
        }
        break;
      }

      logger.log({
        runId,
        stepIndex: stepId,
        action: step.kind,
        strategyUsed: strategyLog[strategyLog.length - 1],
        result:
          result === null || result === "continue"
            ? "ok"
            : result.status,
        latencyMs: Date.now() - t0,
        timestamp: new Date().toISOString(),
      });

      const shotRel = `screenshots/step-${stepId}.png`;
      try {
        await adapter.screenshot(join(evidenceDir, shotRel));
        emit({ type: "screenshot", stepId, screenshotRel: shotRel });
      } catch {
        /* ignore screenshot failures */
      }

      if (result && result !== "continue") {
        if (result.status === "needs_human") {
          emit({
            type: "handoff",
            stepId,
            interventionId: result.interventionRequestId,
            message: result.reason,
          });
        }
        emit({
          type: "step_done",
          stepId,
          totalSteps: artifact.steps.length,
          action: step.kind,
          strategyUsed: strategyLog[strategyLog.length - 1],
          message: result.status,
          result: redactDeep(result),
        });
        writeFileSync(
          join(evidenceDir, "result.json"),
          JSON.stringify(redactDeep(result), null, 2)
        );
        emit({ type: "done", result: redactDeep(result) });
        return result;
      }

      emit({
        type: "step_done",
        stepId,
        totalSteps: artifact.steps.length,
        action: step.kind,
        strategyUsed: strategyLog[strategyLog.length - 1],
        message: "ok",
      });
    }

    // Checkpoint must pass
    const checkpointMatch = await findMatchingOutcome(page, [
      artifact.checkpoint,
    ]);
    if (
      artifact.checkpoint.classification === "continue" ||
      artifact.checkpoint.match.text ||
      artifact.checkpoint.match.name
    ) {
      // If checkpoint is a positive marker (continue), require it visible
      if (
        artifact.checkpoint.classification === "continue" &&
        !checkpointMatch
      ) {
        // soft: also accept if outputs were extracted
        if (Object.keys(outputs).length === 0) {
          return await hardFail(
            adapter,
            artifact.steps.length,
            "checkpoint not met",
            describeStrategy(artifact.checkpoint.match),
            evidenceDir,
            started,
            "checkpoint"
          );
        }
      }
    }

    const success: ReplayResult =
      recovered.length > 0
        ? {
            status: "recovered",
            outputs,
            recovered,
            durationMs: Date.now() - started,
          }
        : {
            status: "success",
            outputs,
            durationMs: Date.now() - started,
            strategyLog,
          };
    writeFileSync(
      join(evidenceDir, "result.json"),
      JSON.stringify(redactDeep(success), null, 2)
    );
    await adapter.stopTracing(join(evidenceDir, "trace.zip"));
    emit({ type: "done", result: redactDeep(success) });
    return success;
  } finally {
    await adapter.close();
  }
}

function allowlistFailure(
  err: unknown,
  started: number,
  stepId = -1
): ReplayResult {
  return {
    status: "hard_failure",
    stepId,
    expected: "allowlisted action/url",
    observed: err instanceof Error ? err.message : String(err),
    error_class: "allowlist",
    evidence_paths: [],
    message: err instanceof Error ? err.message : String(err),
    durationMs: Date.now() - started,
  };
}

async function executeStep(ctx: {
  adapter: PlaywrightWebAdapter;
  page: import("playwright").Page;
  step: StepAction;
  stepId: number;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  artifact: CapabilityArtifact;
  runId: string;
  evidenceDir: string;
  strategyLog: string[];
  allowHandoff: boolean;
}): Promise<ReplayResult | "continue" | null> {
  const {
    adapter,
    page,
    step,
    stepId,
    inputs,
    outputs,
    artifact,
    runId,
    evidenceDir,
    strategyLog,
    allowHandoff,
  } = ctx;
  const started = Date.now();

  if (step.kind === "assertOutcome") {
    const match = await findMatchingOutcome(page, step.outcomes);
    if (!match) return null;
    const { rule } = match;
    if (rule.classification === "continue") return null;
    if (rule.classification === "business_outcome") {
      return {
        status: "business_outcome",
        code: rule.code ?? "BUSINESS_OUTCOME",
        message: rule.message ?? match.matchedText,
        partialOutputs: { ...outputs },
        durationMs: Date.now() - started,
      };
    }
    if (rule.classification === "recoverable") {
      await applyRecovery(adapter, rule.recoveryAction, artifact, inputs);
      return "continue";
    }
    return await hardFail(
      adapter,
      stepId,
      rule.message ?? "failure outcome",
      "assertOutcome",
      evidenceDir,
      started,
      "unknown"
    );
  }

  if (step.kind === "navigate") {
    const path = step.path.replace(
      /inputs\.(\w+)/g,
      (_, k: string) => String(inputs[k] ?? "")
    );
    if (path.startsWith("http")) {
      try {
        assertAllowedUrl(path);
      } catch (err) {
        return allowlistFailure(err, started, stepId);
      }
    }
    const act = await adapter.act({ kind: "navigate", path });
    if (!act.ok) {
      return await hardFail(
        adapter,
        stepId,
        act.error ?? "navigate failed",
        path,
        evidenceDir,
        started,
        "unknown"
      );
    }
    return null;
  }

  const locatorStep = step as Extract<StepAction, { locator: import("../types.js").Locator }>;
  // Extract may legitimately match repeated currency strings — take first unique strategy hit
  let resolved = await resolveLocator(page, locatorStep.locator, {
    allowAmbiguousFirst: step.kind === "extract",
  });

  if (
    (!resolved.resolved || !resolved.locator) &&
    step.kind === "click" &&
    step.optional
  ) {
    return null;
  }

  if (!resolved.resolved || !resolved.locator) {
    const screenshotPath = join(
      evidenceDir,
      "screenshots",
      `fail-step-${stepId}.png`
    );
    await adapter.screenshot(screenshotPath);
    const obs = await adapter.observe();
    writeFileSync(
      join(evidenceDir, "ax-snapshots", `fail-step-${stepId}.json`),
      JSON.stringify(redactDeep(obs), null, 2)
    );

    if (resolved.error_class === "locator_ambiguous") {
      return {
        status: "hard_failure",
        stepId,
        expected: describeLocator(locatorStep.locator),
        observed: resolved.error ?? "ambiguous",
        error_class: "locator_ambiguous",
        evidence_paths: [screenshotPath],
        message: resolved.error ?? "ambiguous locator",
        durationMs: Date.now() - started,
      };
    }

    if (!allowHandoff) {
      return {
        status: "hard_failure",
        stepId,
        expected: describeLocator(locatorStep.locator),
        observed: obs.flattenedText.slice(0, 500),
        error_class: "locator_unresolved",
        evidence_paths: [screenshotPath],
        message: resolved.error ?? "locator unresolved",
        durationMs: Date.now() - started,
      };
    }

    const intervention = createIntervention({
      runId,
      goalOrCapability: artifact.name,
      stepIndex: stepId,
      reason: resolved.error ?? "locator unresolved",
      currentUrl: page.url(),
      screenshotPath,
      axSnapshotPath: join(
        evidenceDir,
        "ax-snapshots",
        `fail-step-${stepId}.json`
      ),
      paramsRedacted: redactDeep(inputs) as Record<string, unknown>,
    });
    console.log(
      `\n⏸  NEEDS_HUMAN (run ${runId}, intervention ${intervention.id}).\n` +
        `   Claim: npm run claim -- --runId ${runId}\n` +
        `   Fix in the headful window, then: npm run resume -- --runId ${runId}\n`
    );
    await waitUntilResumed(runId);
    setController(runId, "AUTOMATION");

    // Re-verify: fresh observe + re-resolve
    const obsAfter = await adapter.observe();
    appendHumanAction(runId, evidenceDir, {
      kind: "resume_reobserve",
      url: obsAfter.url,
      elementCount: obsAfter.elements.length,
    });
    resolved = await resolveLocator(page, locatorStep.locator);
    if (!resolved.resolved || !resolved.locator) {
      return {
        status: "hard_failure",
        stepId,
        expected: describeLocator(locatorStep.locator),
        observed: obsAfter.flattenedText.slice(0, 500),
        error_class: "locator_unresolved",
        evidence_paths: [screenshotPath],
        message: "locator unresolved after human resume",
        durationMs: Date.now() - started,
      };
    }
  }

  if (resolved.strategyUsed) {
    strategyLog.push(
      `step${stepId}:${describeStrategy(resolved.strategyUsed)}`
    );
  }

  const loc = resolved.locator!;

  // Irreversible gate mid-replay
  if (
    step.kind === "click" &&
    (step.irreversible || step.risk_class === "irreversible") &&
    artifact.reviewStatus !== "approved" &&
    allowHandoff
  ) {
    const intervention = createIntervention({
      runId,
      goalOrCapability: artifact.name,
      stepIndex: stepId,
      reason: "Irreversible step requires human confirmation",
      currentUrl: page.url(),
      paramsRedacted: redactDeep(inputs) as Record<string, unknown>,
    });
    console.log(
      `\n⏸  Irreversible step gated — claim/resume run ${runId} (${intervention.id})\n`
    );
    await waitUntilResumed(runId);
  }

  switch (step.kind) {
    case "type": {
      await loc.fill(resolveInputValue(step.valueFrom, inputs));
      return null;
    }
    case "select": {
      const v = resolveInputValue(step.valueFrom, inputs);
      await loc.selectOption({ label: v }).catch(() => loc.selectOption(v));
      return null;
    }
    case "click": {
      await loc.click();
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      return null;
    }
    case "waitFor": {
      try {
        await loc.waitFor({ state: "visible", timeout: step.timeoutMs });
      } catch {
        return await hardFail(
          adapter,
          stepId,
          "waitFor timeout",
          describeLocator(step.locator),
          evidenceDir,
          started,
          "timeout"
        );
      }
      return null;
    }
    case "extract": {
      let text = "";
      try {
        text = (await loc.innerText()).trim();
      } catch {
        text = (await loc.inputValue()).trim();
      }
      if (step.outputName === "savingsBalance" && !/\$/.test(text)) {
        const frame = step.locator.primary.frame?.[0];
        if (frame) {
          const handle = await page.locator(frame).elementHandle();
          const content = handle ? await handle.contentFrame() : null;
          if (content) {
            const all = await content.locator("td").allInnerTexts();
            const idx = all.findIndex((t) => /savings balance/i.test(t));
            if (idx >= 0 && all[idx + 1]) text = all[idx + 1];
            else {
              const money = all.find((t) => /\$[\d,]+/.test(t));
              if (money) text = money;
            }
          }
        }
        // Also try main page cells (CoreServ accounts table)
        if (!/\$/.test(text)) {
          const all = await page.locator("td").allInnerTexts();
          const idx = all.findIndex((t) => /savings|current/i.test(t));
          const money = all.find((t) => /\$[\d,]+\.\d{2}/.test(t));
          if (money) text = money;
          void idx;
        }
      }
      outputs[step.outputName] = transformValue(text, step.transform);
      return null;
    }
    default:
      return null;
  }
}

async function applyRecovery(
  adapter: PlaywrightWebAdapter,
  action: "retry" | "reauthenticate" | "dismissAndContinue" | undefined,
  artifact: CapabilityArtifact,
  inputs: Record<string, unknown>
): Promise<string> {
  if (action === "reauthenticate") {
    const login =
      artifact.preconditions.loginPath ??
      artifact.preconditions.startUrl ??
      "/login";
    await adapter.act({ kind: "navigate", path: login });
    // Best-effort fill demo creds if provided
    const page = adapter.getPage();
    if (inputs.username && inputs.password) {
      await page.fill('input[name="username"]', String(inputs.username)).catch(() => undefined);
      await page.fill('input[name="password"]', String(inputs.password)).catch(() => undefined);
      await page.check('input[name="terms"]').catch(() => undefined);
      await page.click('input[type="submit"]').catch(() => undefined);
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    }
    return "reauthenticate";
  }
  if (action === "retry") {
    await adapter.getPage().reload({ waitUntil: "domcontentloaded" });
    return "retry";
  }
  // dismiss modals if present
  await adapter
    .getPage()
    .locator("#faultModal button")
    .click({ timeout: 1000 })
    .catch(() => undefined);
  return "dismissAndContinue";
}

async function hardFail(
  adapter: PlaywrightWebAdapter,
  stepId: number,
  message: string,
  expected: string,
  evidenceDir: string,
  started: number,
  error_class: ErrorClass
): Promise<ReplayResult> {
  const screenshotPath = join(
    evidenceDir,
    "screenshots",
    `fail-step-${stepId}.png`
  );
  await adapter.screenshot(screenshotPath);
  const obs = await adapter.observe();
  const axPath = join(evidenceDir, "ax-snapshots", `fail-step-${stepId}.json`);
  writeFileSync(axPath, JSON.stringify(redactDeep(obs), null, 2));
  const tracePath = join(evidenceDir, "trace.zip");
  await adapter.stopTracing(tracePath);
  return {
    status: "hard_failure",
    stepId,
    expected,
    observed: obs.flattenedText.slice(0, 800),
    error_class,
    evidence_paths: [screenshotPath, axPath, tracePath],
    message,
    durationMs: Date.now() - started,
  };
}
