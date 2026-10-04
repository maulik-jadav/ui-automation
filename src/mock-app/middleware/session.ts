import type { Request, Response, NextFunction } from "express";
import { randomBytes } from "node:crypto";
import { getDb, audit } from "../db/store.js";
import { can, type Role } from "../lib/tenants.js";
import { accessDenied } from "../lib/hostile.js";

export interface SessionUser {
  sid: string;
  username: string;
  role: Role;
  branch: string;
  workstationId: string;
  tenant: string;
  csrf: string;
  lastSeen: number;
  drawerOpen: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
      tenantId?: string;
    }
  }
}

export function getSessionTimeoutMs(): number {
  const raw = process.env.SESSION_TIMEOUT_MS;
  if (raw && !Number.isNaN(Number(raw))) return Number(raw);
  return 3 * 60 * 1000;
}

export function loadSession(sid?: string): SessionUser | null {
  if (!sid) return null;
  const row = getDb()
    .prepare(`SELECT * FROM sessions WHERE sid = ?`)
    .get(sid) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    sid: String(row.sid),
    username: String(row.username),
    role: String(row.role) as Role,
    branch: String(row.branch ?? ""),
    workstationId: String(row.workstation_id ?? ""),
    tenant: String(row.tenant ?? "meridian"),
    csrf: String(row.csrf ?? ""),
    lastSeen: Number(row.last_seen ?? 0),
    drawerOpen: Boolean(row.drawer_open),
  };
}

export function touchSession(sid: string): void {
  getDb()
    .prepare(`UPDATE sessions SET last_seen = ? WHERE sid = ?`)
    .run(Date.now(), sid);
}

export function createSession(data: {
  username: string;
  role: Role;
  branch: string;
  workstationId: string;
  tenant: string;
}): SessionUser {
  const sid = randomBytes(16).toString("hex");
  const csrf = randomBytes(12).toString("hex");
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO sessions (sid, username, role, branch, workstation_id, tenant, csrf, last_seen, drawer_open)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
    )
    .run(
      sid,
      data.username,
      data.role,
      data.branch,
      data.workstationId,
      data.tenant,
      csrf,
      now
    );
  getDb()
    .prepare(
      `INSERT INTO active_logins (username, sid, since) VALUES (?, ?, ?)
       ON CONFLICT(username) DO UPDATE SET sid=excluded.sid, since=excluded.since`
    )
    .run(data.username, sid, now);
  return {
    sid,
    username: data.username,
    role: data.role,
    branch: data.branch,
    workstationId: data.workstationId,
    tenant: data.tenant,
    csrf,
    lastSeen: now,
    drawerOpen: false,
  };
}

export function destroySession(sid: string): void {
  const s = loadSession(sid);
  getDb().prepare(`DELETE FROM sessions WHERE sid = ?`).run(sid);
  if (s) {
    getDb()
      .prepare(`DELETE FROM active_logins WHERE username = ? AND sid = ?`)
      .run(s.username, sid);
  }
}

export function sessionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const sid = req.cookies?.coreserv_sid as string | undefined;
  const user = loadSession(sid);
  const timeout = getSessionTimeoutMs();

  if (user) {
    if (Date.now() - user.lastSeen > timeout) {
      destroySession(user.sid);
      res.clearCookie("coreserv_sid");
      if (req.path.startsWith("/console") || req.path.startsWith("/frames") || req.path.startsWith("/app")) {
        // Render login INSIDE frame (classic bug) when mid-flow
        if (req.query.framed === "1" || req.headers["sec-fetch-dest"] === "iframe") {
          return res.redirect("/login?expired=1&embedded=1");
        }
        return res.redirect("/login?expired=1");
      }
    } else {
      touchSession(user.sid);
      req.user = { ...user, lastSeen: Date.now() };
      req.tenantId = user.tenant;
    }
  }

  // Armed fault: session_expire after N actions
  if (req.user && process.env.ENABLE_TEST_HARNESS === "1") {
    tryApplySessionFault(req, res);
  }
  next();
}

function tryApplySessionFault(req: Request, res: Response): void {
  const rows = getDb()
    .prepare(`SELECT id, fault_json FROM faults WHERE session_sid = ? OR session_sid = '*'`)
    .all(req.user!.sid) as { id: number; fault_json: string }[];
  for (const row of rows) {
    const f = JSON.parse(row.fault_json) as {
      fault: string;
      after_actions?: number;
      _count?: number;
    };
    if (f.fault !== "session_expire") continue;
    f._count = (f._count ?? 0) + 1;
    getDb()
      .prepare(`UPDATE faults SET fault_json = ? WHERE id = ?`)
      .run(JSON.stringify(f), row.id);
    if (f.after_actions && f._count >= f.after_actions) {
      destroySession(req.user!.sid);
      res.clearCookie("coreserv_sid");
      getDb().prepare(`DELETE FROM faults WHERE id = ?`).run(row.id);
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    return res.redirect("/login?expired=1");
  }
  next();
}

export function requirePerm(perm: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) return res.redirect("/login");
    if (!can(req.user.role, perm)) {
      audit(req.user.username, req.user.workstationId, "access_denied", { perm });
      res.status(200).send(accessDenied(`Missing permission: ${perm}`));
      return;
    }
    next();
  };
}

export function logAction(
  req: Request,
  action: string,
  payload: unknown
): void {
  if (!req.user) return;
  audit(req.user.username, req.user.workstationId, action, payload);
}
