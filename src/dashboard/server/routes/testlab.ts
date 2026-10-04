import { Router } from "express";
import { spawn } from "node:child_process";

export const testlabRouter = Router();

const CORESERV = () => process.env.MOCK_APP_BASE_URL ?? "http://localhost:4000";

const FAULTS: Record<
  string,
  { body: Record<string, unknown>; explanation: string }
> = {
  latency: {
    body: { fault: "latency", ms: 8000, session_sid: "*" },
    explanation:
      "Pages take several seconds to load — like a busy core processor. Employees would see a long wait, then the page.",
  },
  http500: {
    body: { fault: "http500", session_sid: "*" },
    explanation:
      "The next request returns an HTTP 500 error page — the kind of outage tellers call the help desk about.",
  },
  unexpected_modal: {
    body: { fault: "unexpected_modal", session_sid: "*" },
    explanation:
      "An unexpected pop-up appears over the screen. Automation must dismiss it or ask for help.",
  },
  session_expire: {
    body: { fault: "session_expire", afterActions: 2, session_sid: "*" },
    explanation:
      "After a couple of clicks the session expires and the employee must log in again.",
  },
  mfa_challenge: {
    body: { fault: "mfa_challenge", session_sid: "*" },
    explanation:
      "A multi-factor challenge appears. Only a human can complete it — this is a classic handoff.",
  },
  stale_record: {
    body: { fault: "stale_record", session_sid: "*" },
    explanation:
      "The record looks out of date compared to what the teller expects — a data freshness problem.",
  },
};

testlabRouter.get("/testlab/faults", (_req, res) => {
  res.json(
    Object.entries(FAULTS).map(([id, v]) => ({
      id,
      explanation: v.explanation,
    }))
  );
});

testlabRouter.post("/testlab/:fault", async (req, res) => {
  const fault = req.params.fault;
  if (fault === "reset") {
    try {
      const r = await fetch(`${CORESERV()}/__test/reset`, { method: "POST" });
      const body = await r.json().catch(() => ({}));
      return res.json({ ok: r.ok, body });
    } catch (err) {
      return res.status(502).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (fault === "clear-sessions") {
    try {
      const r = await fetch(`${CORESERV()}/__test/clear-sessions`, {
        method: "POST",
      });
      const body = await r.json().catch(() => ({}));
      return res.json({ ok: r.ok, body });
    } catch (err) {
      return res.status(502).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (fault === "demo-handoff") {
    // Spawn existing demo-handoff script (real stuck locator → intervention)
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/demo-handoff.ts"],
      {
        cwd: process.cwd(),
        env: { ...process.env, PLAYWRIGHT_CDP_PORT: "9333" },
        detached: true,
        stdio: "ignore",
      }
    );
    child.unref();
    return res.status(202).json({
      ok: true,
      message:
        "Demo handoff started — watch Needs your help. Use the headed Chromium window if shown.",
    });
  }

  const def = FAULTS[fault];
  if (!def) {
    return res.status(404).json({ error: `Unknown fault: ${fault}` });
  }
  try {
    const r = await fetch(`${CORESERV()}/__test/faults`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(def.body),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(r.status).json({
        error: "CoreServ rejected the fault",
        body,
        explanation: def.explanation,
      });
    }
    res.json({ ok: true, armed: def.body, explanation: def.explanation, body });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : String(err),
      explanation: def.explanation,
    });
  }
});
