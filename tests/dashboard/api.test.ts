import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createApp } from "../../src/dashboard/server/app.js";
import { redactDeep } from "../../src/core/safety/redaction.js";
import {
  claimIntervention,
  createIntervention,
  listInterventions,
  markResumed,
  saveInterventions,
} from "../../src/core/escalation/interventionStore.js";
import { safePath } from "../../src/dashboard/server/pathSafe.js";

async function withServer(
  fn: (base: string) => Promise<void>
): Promise<void> {
  const app = createApp();
  const server = app.listen(0);
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    await fn(base);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

describe("dashboard API", () => {
  it("GET /api/health returns structure", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/health`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        demoMode: boolean;
        coreserv: { url: string };
        safety: { loaded: boolean };
      };
      assert.equal(body.demoMode, true);
      assert.ok(body.coreserv.url);
      assert.equal(typeof body.safety.loaded, "boolean");
    });
  });

  it("GET /api/artifacts lists real files", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/artifacts`);
      assert.equal(res.status, 200);
      const list = (await res.json()) as { id: string; name: string }[];
      assert.ok(Array.isArray(list));
      assert.ok(list.length >= 1, "expected seeded artifacts");
      assert.ok(list.every((a) => a.id && a.name));
    });
  });

  it("redacts secrets from API-shaped payloads", () => {
    const raw = {
      username: "teller",
      password: "super-secret",
      email: "jane.doe@example.com",
      ssn: "123-45-6789",
      note: "call 555-123-4567",
    };
    const out = redactDeep(raw) as Record<string, string>;
    assert.equal(out.password, "[REDACTED]");
    assert.match(out.email, /REDACTED/);
    assert.match(out.ssn, /REDACTED/);
    assert.match(out.note, /REDACTED/);
  });

  it("claim/resume state transitions", () => {
    const before = listInterventions();
    const created = createIntervention({
      runId: `dash-test-${Date.now()}`,
      goalOrCapability: "dashboard unit test",
      stepIndex: 1,
      reason: "unit test handoff",
      paramsRedacted: { memberId: "12345", password: "[REDACTED]" },
    });
    assert.equal(created.status, "pending");
    assert.equal(created.currentController, "PAUSED");

    const claimed = claimIntervention(created.runId, "Operator");
    assert.ok(claimed);
    assert.equal(claimed!.status, "claimed");
    assert.equal(claimed!.currentController, "HUMAN");

    const resumed = markResumed(created.runId);
    assert.ok(resumed);
    assert.equal(resumed!.status, "resumed");
    assert.equal(resumed!.currentController, "RESUMING");

    // cleanup test rows
    saveInterventions(before);
  });

  it("pathSafe blocks traversal", () => {
    assert.throws(() => safePath("evidence", "..", "etc", "passwd"));
  });

  it("POST /api/safety/test-url and redact", async () => {
    await withServer(async (base) => {
      const ok = await fetch(`${base}/api/safety/test-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "http://localhost:4000/login" }),
      });
      const okBody = (await ok.json()) as { allowed: boolean };
      assert.equal(okBody.allowed, true);

      const bad = await fetch(`${base}/api/safety/test-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://evil.example/phish" }),
      });
      const badBody = (await bad.json()) as { allowed: boolean; reason: string };
      assert.equal(badBody.allowed, false);
      assert.ok(badBody.reason);

      const red = await fetch(`${base}/api/safety/redact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "SSN 123-45-6789 email a@b.com" }),
      });
      const redBody = (await red.json()) as { redacted: string };
      assert.match(redBody.redacted, /REDACTED/);
      assert.doesNotMatch(redBody.redacted, /123-45-6789/);
    });
  });

  it("POST /api/replay without artifactId is 400", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/replay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs: {} }),
      });
      assert.equal(res.status, 400);
    });
  });
});
