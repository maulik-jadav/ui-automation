/**
 * Smoke tests — prove key screens + fault harness are reachable.
 * Requires a seeded DB; starts no server (uses request injection against app)
 * OR hits a live server if CORESERV_URL is set.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { runSeed } from "../../src/mock-app/seed/seed.js";
import { getDb, initSchema } from "../../src/mock-app/db/store.js";

describe("CoreServ seed", () => {
  before(() => {
    initSchema();
    runSeed();
  });

  it("seeds member 12345 with $4321.09 savings", () => {
    const a = getDb()
      .prepare(`SELECT current_bal FROM accounts WHERE id='12345-S01'`)
      .get() as { current_bal: number };
    assert.equal(a.current_bal, 4321.09);
  });

  it("seeds demo users", () => {
    const u = getDb()
      .prepare(`SELECT role FROM users WHERE username='csr1'`)
      .get() as { role: string };
    assert.equal(u.role, "csr");
  });

  it("seeds Smith collision cluster (>50)", () => {
    const n = getDb()
      .prepare(`SELECT COUNT(*) AS c FROM members WHERE last_name='Smith'`)
      .get() as { c: number };
    assert.ok(n.c > 50);
  });
});

describe("CoreServ live smoke", () => {
  const base = process.env.CORESERV_URL ?? "http://localhost:4000";

  it("login page reachable when server up", async (t) => {
    let res: Response;
    try {
      res = await fetch(`${base}/login`);
    } catch {
      t.skip(`CoreServ not reachable at ${base}`);
      return;
    }
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Username/i);
  });

  it("__meta returns tenant", async (t) => {
    let res: Response;
    try {
      res = await fetch(`${base}/__meta`);
    } catch {
      t.skip(`CoreServ not reachable at ${base}`);
      return;
    }
    const j = (await res.json()) as { tenantId: string };
    assert.ok(j.tenantId);
  });
});
