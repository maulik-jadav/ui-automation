import type { Request, Response, NextFunction } from "express";
import { getDb } from "../db/store.js";
import { pageShell, esc } from "../lib/hostile.js";

export interface Fault {
  fault: string;
  route?: string;
  ms?: number;
  once?: boolean;
  after_actions?: number;
  memberId?: string;
  on?: string;
  screen?: string;
  variant?: string;
  session_sid?: string;
  _used?: boolean;
}

export function getFaults(sid?: string): Fault[] {
  const rows = getDb()
    .prepare(
      `SELECT id, fault_json FROM faults WHERE session_sid = ? OR session_sid = '*'`
    )
    .all(sid ?? "*") as { id: number; fault_json: string }[];
  return rows.map((r) => ({
    ...(JSON.parse(r.fault_json) as Fault),
    _id: r.id,
  })) as Fault[];
}

export function faultMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (process.env.ENABLE_TEST_HARNESS !== "1") return next();
  if (req.path.startsWith("/__test")) return next();

  const faults = getFaults(req.user?.sid);
  for (const f of faults) {
    if (f.route && !req.path.includes(f.route.replace(/^\//, ""))) continue;

    if (f.fault === "latency" && f.ms) {
      setTimeout(() => next(), f.ms);
      return;
    }
    if (f.fault === "http500") {
      consumeOnce(f);
      res.status(500).send(
        pageShell(
          "Server Error",
          `<h3>Server Error in '/' Application.</h3>
           <pre style="font-size:10px;background:#fff;border:1px solid #c00;padding:8px;">
System.Data.SqlClient.SqlException: Transaction (Process ID 52) was deadlocked on lock resources with another process and has been chosen as the deadlock victim. Rerun the transaction.
   at CoreServ.Web.AccountController.Confirm()
   at System.Web.Mvc.Controller.ActionInvoker...
           </pre>`
        )
      );
      return;
    }
    if (f.fault === "unexpected_modal") {
      consumeOnce(f);
      const orig = res.send.bind(res);
      res.send = ((body: unknown) => {
        const html = String(body);
        const modal = `<div id="faultModal" style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;">
          <div style="margin:120px auto;width:360px;background:#ece9d8;border:2px solid #003c74;padding:12px;font-family:Tahoma;font-size:11px;">
            <b>System Notice</b><p>Unexpected maintenance advisory. Please acknowledge.</p>
            <button onclick="document.getElementById('faultModal').remove()">OK</button>
          </div></div>`;
        return orig(html.replace("</body>", modal + "</body>"));
      }) as typeof res.send;
    }
  }
  next();
}

function consumeOnce(f: Fault & { _id?: number }): void {
  if (!f.once || f._id == null) return;
  getDb().prepare(`DELETE FROM faults WHERE id = ?`).run(f._id);
}

export function registerTestRoutes(app: import("express").Express): void {
  app.post("/__test/faults", (req, res) => {
    if (process.env.ENABLE_TEST_HARNESS !== "1") {
      return res.status(404).send("not found");
    }
    const body = req.body as Fault;
    const sid = body.session_sid ?? req.user?.sid ?? "*";
    getDb()
      .prepare(`INSERT INTO faults (session_sid, fault_json) VALUES (?, ?)`)
      .run(sid, JSON.stringify(body));
    res.json({ ok: true, armed: body });
  });

  app.post("/__test/clear-sessions", (_req, res) => {
    if (process.env.ENABLE_TEST_HARNESS !== "1") {
      return res.status(404).send("not found");
    }
    const db = getDb();
    db.prepare(`DELETE FROM active_logins`).run();
    db.prepare(`DELETE FROM sessions`).run();
    res.json({ ok: true, cleared: true });
  });

  app.post("/__test/reset", async (_req, res) => {
    if (process.env.ENABLE_TEST_HARNESS !== "1") {
      return res.status(404).send("not found");
    }
    const { runSeed } = await import("../seed/seed.js");
    runSeed();
    res.json({ ok: true, reseeding: true });
  });

  app.get("/__test/state", (req, res) => {
    if (process.env.ENABLE_TEST_HARNESS !== "1") {
      return res.status(404).send("not found");
    }
    const db = getDb();
    const memberId = String(req.query.memberId ?? "12345");
    const member = db.prepare(`SELECT * FROM members WHERE id = ?`).get(memberId);
    const accounts = db
      .prepare(`SELECT * FROM accounts WHERE member_id = ?`)
      .all(memberId);
    const queue = db
      .prepare(`SELECT * FROM approval_queue ORDER BY created_at DESC LIMIT 50`)
      .all();
    res.json({ member, accounts, queue });
  });

  app.get("/__test/audit", (_req, res) => {
    if (process.env.ENABLE_TEST_HARNESS !== "1") {
      return res.status(404).send("not found");
    }
    const rows = getDb()
      .prepare(`SELECT * FROM audit_log ORDER BY id DESC LIMIT 500`)
      .all();
    res.json(rows);
  });
}

export function waitPage(ms: number, redirectTo: string): string {
  return pageShell(
    "Please wait",
    `<p><font face="Tahoma" size="2">Please wait... Processing...</font></p>
     <p><img src="data:image/gif;base64,R0lGODlhEAAQAPIAAP///wAAAMLCwkJCQgAAAGJiYoKCgpKSkiH/C05FVFNDQVBFMi4wAwEAAAAh/hpDcmVhdGVkIHdpdGggYWpheGxvYWQuaW5mbwAh+QQJCgAAACwAAAAAEAAQAAADMwi63P4wyklrE2MIOggZnAdOmGYJRbAsqIgIcwSAsinYphYVFZizrTFAuJwFADs=" alt=""/></p>
     <meta http-equiv="refresh" content="${Math.max(1, Math.round(ms / 1000))};url=${esc(redirectTo)}" />`
  );
}
