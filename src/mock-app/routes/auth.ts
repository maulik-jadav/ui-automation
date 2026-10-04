import { Router } from "express";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../db/store.js";
import {
  createSession,
  destroySession,
  loadSession,
  logAction,
} from "../middleware/session.js";
import { getTenant, type Role } from "../lib/tenants.js";
import {
  pageShell,
  esc,
  fieldRow,
  ctlId,
  actionButton,
  cls,
} from "../lib/hostile.js";
import type { Request, Response } from "express";

export const authRouter = Router();

function loginForm(opts: {
  error?: string;
  expired?: boolean;
  tenant?: string;
  concurrent?: boolean;
  username?: string;
  embedded?: boolean;
}): string {
  const tenant = getTenant(opts.tenant);
  const csrf = Math.random().toString(36).slice(2);
  const err = opts.error
    ? `<div class="banner-err">${esc(opts.error)}</div>`
    : opts.expired
      ? `<div class="banner-warn">Session expired. Please log in again.</div>`
      : "";

  const concurrent = opts.concurrent
    ? `<div class="banner-warn">User already logged in elsewhere. Continue and terminate other session?
         <input type="hidden" name="force" value="1" /></div>`
    : "";

  return pageShell(
    "Login — CoreServ",
    `<table width="480" cellpadding="0" cellspacing="0" bgcolor="#ece9d8" style="border:2px solid #003c74;margin:40px auto;">
      <tr><td bgcolor="${tenant.colors.accent}" style="padding:6px 10px;color:#fff;font-weight:bold;">
        ${esc(tenant.name)} — CoreServ Console Login
      </td></tr>
      <tr><td style="padding:12px;">
        ${err}${concurrent}
        <form method="POST" action="/login${opts.embedded ? "?embedded=1" : ""}">
          <input type="hidden" name="csrf" value="${csrf}" />
          <input type="hidden" name="tenant" value="${esc(tenant.id)}" />
          <table class="${cls("login")}">
            ${fieldRow("Username:", `<input type="text" name="username" id="${ctlId("user")}" value="${esc(opts.username ?? "")}" />`)}
            ${fieldRow("Password:", `<input type="password" name="password" id="${ctlId("pwd")}" />`)}
            ${fieldRow(
              "Branch:",
              `<select name="branch" id="${ctlId("br")}">
                <option>Tempe-01</option><option>Mesa-02</option><option>Phoenix-HQ</option>
               </select>`
            )}
            ${fieldRow("Workstation ID:", `<input type="text" name="workstation" id="${ctlId("ws")}" value="WS-AUTO-01" />`)}
            <tr><td></td><td><input type="checkbox" name="terms" value="1" /> I agree to the terms of use</td></tr>
            <tr><td></td><td style="padding-top:8px;">
              ${actionButton("Login", { kind: "submit", name: "login" })}
              &nbsp;${actionButton("Search", { decoy: true })}
            </td></tr>
          </table>
        </form>
        <p style="font-size:10px;color:#666;margin-top:10px;">Tenant: ${esc(tenant.id)} · ${esc(tenant.vendorProduct)} ${esc(tenant.vendorVersion)}</p>
      </td></tr>
    </table>`
  );
}

authRouter.get("/login", (req, res) => {
  const tenant = String(req.query.tenant ?? process.env.TENANT ?? "meridian");
  res.send(
    loginForm({
      expired: req.query.expired === "1",
      tenant,
      embedded: req.query.embedded === "1",
      concurrent: req.query.concurrent === "1",
      username: String(req.query.u ?? ""),
    })
  );
});

authRouter.post("/login", (req, res) => {
  const username = String(req.body.username ?? "").trim();
  const password = String(req.body.password ?? "");
  const branch = String(req.body.branch ?? "Tempe-01");
  const workstation = String(req.body.workstation ?? "WS-UNK");
  const tenant = String(req.body.tenant ?? "meridian");
  const force = req.body.force === "1" || req.query.force === "1";
  const embedded = req.query.embedded === "1";

  if (!req.body.terms) {
    return res.send(
      loginForm({
        error: "You must accept the terms of use.",
        tenant,
        username,
        embedded,
      })
    );
  }

  const user = getDb()
    .prepare(`SELECT * FROM users WHERE username = ? AND active = 1`)
    .get(username) as
    | {
        username: string;
        password: string;
        role: Role;
        force_password_change: number;
        mfa_required: number;
      }
    | undefined;

  if (!user || user.password !== password) {
    return res.send(
      loginForm({
        error: "Invalid username or password.",
        tenant,
        username,
        embedded,
      })
    );
  }

  const existing = getDb()
    .prepare(`SELECT * FROM active_logins WHERE username = ?`)
    .get(username) as { sid: string } | undefined;
  if (existing && !force) {
    const other = loadSession(existing.sid);
    if (other) {
      return res.send(
        loginForm({
          concurrent: true,
          tenant,
          username,
          embedded,
          error: "User already logged in elsewhere.",
        })
      );
    }
  }
  if (existing && force) {
    destroySession(existing.sid);
  }

  if (user.force_password_change) {
    return res.send(
      pageShell(
        "Password Change Required",
        `<div class="banner-warn">Your password must be changed before continuing.</div>
         <form method="POST" action="/login/force-password">
           <input type="hidden" name="username" value="${esc(username)}" />
           <input type="hidden" name="tenant" value="${esc(tenant)}" />
           <input type="hidden" name="branch" value="${esc(branch)}" />
           <input type="hidden" name="workstation" value="${esc(workstation)}" />
           <table>
             ${fieldRow("New Password:", `<input type="password" name="newpass" />`)}
             ${fieldRow("Confirm:", `<input type="password" name="confirm" />`)}
             <tr><td></td><td><input type="submit" value="Change Password" class="btn" /></td></tr>
           </table>
         </form>`
      )
    );
  }

  if (user.mfa_required || req.body.mfa_pending) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    mkdirSync(join(process.cwd(), "data"), { recursive: true });
    appendFileSync(
      join(process.cwd(), "data", "mfa.log"),
      `${new Date().toISOString()} user=${username} code=${code}\n`
    );
    console.log(`[MFA] user=${username} code=${code} (also in data/mfa.log)`);
    return res.send(
      pageShell(
        "MFA Challenge",
        `<div class="banner-info">Enter the 6-digit code (available to managers via server console / data/mfa.log).</div>
         <form method="POST" action="/login/mfa">
           <input type="hidden" name="username" value="${esc(username)}" />
           <input type="hidden" name="password" value="${esc(password)}" />
           <input type="hidden" name="tenant" value="${esc(tenant)}" />
           <input type="hidden" name="branch" value="${esc(branch)}" />
           <input type="hidden" name="workstation" value="${esc(workstation)}" />
           <input type="hidden" name="expected" value="${esc(code)}" />
           <table>
             ${fieldRow("6-digit code:", `<input type="text" name="code" maxlength="6" />`)}
             <tr><td></td><td><input type="submit" value="Verify" class="btn" /></td></tr>
           </table>
         </form>
         <p><a href="/manager" target="_blank">Open manager swipe station</a></p>`
      )
    );
  }

  // Maintenance interstitial once
  if (!req.body.dismiss_maint) {
    return res.send(
      pageShell(
        "System Maintenance",
        `<div style="margin:60px auto;width:420px;background:#fff8e0;border:2px solid #c80;padding:16px;">
          <b>System maintenance Saturday 10pm–2am MST</b>
          <p>Online servicing may be unavailable. Click Continue to proceed.</p>
          <form method="POST" action="/login">
            <input type="hidden" name="username" value="${esc(username)}" />
            <input type="hidden" name="password" value="${esc(password)}" />
            <input type="hidden" name="tenant" value="${esc(tenant)}" />
            <input type="hidden" name="branch" value="${esc(branch)}" />
            <input type="hidden" name="workstation" value="${esc(workstation)}" />
            <input type="hidden" name="terms" value="1" />
            <input type="hidden" name="force" value="1" />
            <input type="hidden" name="dismiss_maint" value="1" />
            <input type="submit" value="Continue" class="btn" />
          </form>
        </div>`
      )
    );
  }

  finishLogin(req, res, {
    username,
    role: user.role,
    branch,
    workstation,
    tenant,
    embedded,
  });
});

authRouter.post("/login/mfa", (req, res) => {
  if (String(req.body.code) !== String(req.body.expected)) {
    return res.send(
      pageShell(
        "MFA Failed",
        `<div class="banner-err">Invalid code.</div><p><a href="/login">Back</a></p>`
      )
    );
  }
  const user = getDb()
    .prepare(`SELECT role FROM users WHERE username = ?`)
    .get(String(req.body.username)) as { role: Role };
  finishLogin(req, res, {
    username: String(req.body.username),
    role: user.role,
    branch: String(req.body.branch),
    workstation: String(req.body.workstation),
    tenant: String(req.body.tenant),
  });
});

authRouter.post("/login/force-password", (req, res) => {
  if (req.body.newpass !== req.body.confirm || !req.body.newpass) {
    return res.send(
      pageShell("Error", `<div class="banner-err">Passwords do not match.</div>`)
    );
  }
  getDb()
    .prepare(
      `UPDATE users SET password = ?, force_password_change = 0 WHERE username = ?`
    )
    .run(String(req.body.newpass), String(req.body.username));
  res.redirect("/login?tenant=" + encodeURIComponent(String(req.body.tenant)));
});

function finishLogin(
  req: Request,
  res: Response,
  data: {
    username: string;
    role: Role;
    branch: string;
    workstation: string;
    tenant: string;
    embedded?: boolean;
  }
): void {
  const session = createSession({
    username: data.username,
    role: data.role,
    branch: data.branch,
    workstationId: data.workstation,
    tenant: data.tenant,
  });
  res.cookie("coreserv_sid", session.sid, {
    httpOnly: true,
    sameSite: "lax",
  });
  logAction(
    { ...req, user: session } as Request,
    "login",
    { tenant: data.tenant, branch: data.branch }
  );
  if (data.embedded) {
    return res.redirect("/console");
  }
  res.redirect("/console");
}

authRouter.get("/logout", (req, res) => {
  if (req.user) destroySession(req.user.sid);
  res.clearCookie("coreserv_sid");
  res.redirect("/login");
});

authRouter.get("/manager", (_req, res) => {
  res.send(
    pageShell(
      "Manager Swipe Station",
      `<h3>Manager Approval / Swipe Station</h3>
       <p>Use this page in a separate tab to complete MFA or supervisor override codes.</p>
       <p>Latest MFA codes are written to <code>data/mfa.log</code> and the server console — never shown in the main UI.</p>
       <form method="GET" action="/manager/code">
         <input type="submit" value="Reveal latest MFA code" class="btn" />
       </form>`
    )
  );
});

authRouter.get("/manager/code", (_req, res) => {
  try {
    const log = readFileSync(join(process.cwd(), "data", "mfa.log"), "utf8");
    const lines = log.trim().split("\n");
    const last = lines[lines.length - 1] ?? "(none)";
    res.send(
      pageShell(
        "MFA Code",
        `<div class="banner-info"><font face="Courier" size="3">${esc(last)}</font></div>
         <p><a href="/manager">Back</a></p>`
      )
    );
  } catch {
    res.send(pageShell("MFA Code", `<p>No MFA challenges yet.</p>`));
  }
});
