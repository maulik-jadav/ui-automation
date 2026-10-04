import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyMessage } from "../src/core/replay/outcomeMatcher.js";
import { buildSeededLookupArtifact } from "../src/core/artifact/artifactBuilder.js";
import { isIrreversibleName } from "../src/core/safety/riskClassifier.js";
import { redactString, redactDeep } from "../src/core/safety/redaction.js";
import {
  validateArtifact,
  validateInputs,
  ArtifactValidationError,
} from "../src/core/artifact/artifactStore.js";
import { applyTenantOverride, checkDrift } from "../src/core/replay/drift.js";
import {
  claimIntervention,
  createIntervention,
  markResumed,
  listInterventions,
  saveInterventions,
} from "../src/core/escalation/interventionStore.js";
import { assertAllowedUrl, AllowlistViolation } from "../src/core/safety/allowlist.js";
import type { Observation } from "../src/core/types.js";

describe("outcomeMatcher / seeded artifact", () => {
  it("classifies CoreServ / legacy messages", () => {
    assert.equal(classifyMessage("No records found"), "business_outcome");
    assert.equal(classifyMessage("No member found for ID 99999"), "business_outcome");
    assert.equal(classifyMessage("Access Denied"), "business_outcome");
    assert.equal(classifyMessage("Session expired, please log in again"), "recoverable");
    assert.equal(classifyMessage("System temporarily unavailable, please retry"), "recoverable");
    assert.equal(classifyMessage("Opening deposit must be at least $25.00"), "business_outcome");
    assert.equal(classifyMessage("something else"), null);
  });

  it("seeded artifact is CoreServ-shaped schema 1.1", () => {
    const artifact = buildSeededLookupArtifact("http://localhost:4000");
    assert.equal(artifact.reviewStatus, "approved");
    assert.equal(artifact.schema_version, "1.1.0");
    assert.equal(artifact.preconditions.startUrl, "/login");
    assert.ok(artifact.fingerprint.screenSignature.includes("Login"));
    assert.ok(artifact.tenant_overrides?.harborview);
    const assertStep = artifact.steps.find((s) => s.kind === "assertOutcome");
    assert.ok(assertStep);
    if (assertStep && assertStep.kind === "assertOutcome") {
      const codes = assertStep.outcomes.map((o) => o.code);
      assert.ok(codes.includes("MEMBER_NOT_FOUND"));
      assert.ok(codes.includes("PERMISSION_DENIED") || codes.includes("ACCESS_DENIED"));
    }
    const risks = artifact.steps.map((s) => s.risk_class);
    assert.ok(risks.every((r) => r === "read" || r === "reversible_write" || r === "irreversible"));
  });

  it("validates artifact and required inputs", () => {
    const artifact = buildSeededLookupArtifact("http://localhost:4000");
    const v = validateArtifact(artifact);
    assert.equal(v.artifactId, "seeded-lookup");
    assert.throws(
      () => validateInputs(artifact, { memberId: "12345" }),
      (e: unknown) => e instanceof ArtifactValidationError
    );
    validateInputs(artifact, {
      memberId: "12345",
      username: "csr1",
      password: "csr-pass",
    });
    assert.throws(
      () =>
        validateInputs(artifact, {
          memberId: "abc",
          username: "csr1",
          password: "x",
        }),
      /validation/
    );
  });
});

describe("safety helpers", () => {
  it("flags irreversible action names", () => {
    assert.equal(isIrreversibleName("Confirm"), true);
    assert.equal(isIrreversibleName("Submit"), true);
    assert.equal(isIrreversibleName("Search"), false);
  });

  it("redacts regulated sample data", () => {
    assert.equal(redactString("ssn 123-45-6789 ok"), "ssn [REDACTED-SSN] ok");
    assert.match(redactString("email alice.chen@example.test"), /REDACTED-EMAIL/);
    assert.match(redactString("call 480-555-0101"), /REDACTED-PHONE/);
    assert.match(redactString("dob 04/12/1988"), /REDACTED-DOB/);
    assert.match(redactString("card 4111 1111 1111 1111"), /REDACTED-CARD/);
    assert.match(redactString("password: hunter2"), /REDACTED/);
    const deep = redactDeep({
      password: "secret",
      note: "ssn 111-22-3333",
      cookie: "sid=abc",
    });
    assert.equal(deep.password, "[REDACTED]");
    assert.equal(deep.cookie, "[REDACTED]");
    assert.match(String(deep.note), /REDACTED-SSN/);
  });

  it("blocks non-allowlisted URLs", () => {
    assert.throws(
      () => assertAllowedUrl("https://evil.example/"),
      (e: unknown) => e instanceof AllowlistViolation
    );
    assertAllowedUrl("http://localhost:4000");
  });
});

describe("drift + tenant overrides", () => {
  it("matches login fingerprint", () => {
    const artifact = buildSeededLookupArtifact("http://localhost:4000");
    const obs: Observation = {
      url: "http://localhost:4000/login",
      title: "Login",
      elements: [],
      flattenedText: "Login Username Password Workstation",
    };
    const drift = checkDrift(artifact, obs);
    assert.equal(drift.status, "match");
  });

  it("applies harborview startPath override", () => {
    const artifact = buildSeededLookupArtifact("http://localhost:4000");
    const overridden = applyTenantOverride(artifact, "harborview");
    assert.equal(
      overridden.preconditions.startUrl,
      "/login?tenant=harborview"
    );
  });
});

describe("handoff state machine", () => {
  it("pending → claimed(HUMAN) → resumed(RESUMING)", () => {
    // Isolate store for this test by rewriting to empty then restoring
    const before = listInterventions();
    saveInterventions([]);
    try {
      const created = createIntervention({
        runId: "test-run-handoff",
        goalOrCapability: "test",
        stepIndex: 1,
        reason: "unit test",
        currentUrl: "http://localhost:4000/login",
        paramsRedacted: { memberId: "12345" },
      });
      assert.equal(created.status, "pending");
      assert.equal(created.currentController, "PAUSED");

      const claimed = claimIntervention("test-run-handoff", "tester");
      assert.ok(claimed);
      assert.equal(claimed!.status, "claimed");
      assert.equal(claimed!.currentController, "HUMAN");
      assert.equal(claimed!.claimedBy, "tester");

      const resumed = markResumed("test-run-handoff");
      assert.ok(resumed);
      assert.equal(resumed!.status, "resumed");
      assert.equal(resumed!.currentController, "RESUMING");
    } finally {
      saveInterventions(before);
    }
  });
});

describe("replay never imports LLM", () => {
  it("replayEngine module has no generative-ai import", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/core/replay/replayEngine.ts"),
      "utf8"
    );
    assert.equal(/generative-ai|GeminiLlm|llmClient/.test(src), false);
  });
});
