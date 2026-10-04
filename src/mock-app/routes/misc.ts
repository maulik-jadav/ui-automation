import { Router } from "express";
import { getDb } from "../db/store.js";
import { getTenant, can } from "../lib/tenants.js";
import { pageShell, esc, money, fieldRow, accessDenied } from "../lib/hostile.js";
import { requireAuth, requirePerm, logAction } from "../middleware/session.js";

export const miscRouter = Router();

miscRouter.get("/app/queues/approvals", requireAuth, requirePerm("queue.approve"), (req, res) => {
  if (!can(req.user!.role, "queue.approve")) return res.status(200).send(accessDenied());
  const rows = getDb()
    .prepare(`SELECT * FROM approval_queue ORDER BY created_at DESC`)
    .all() as Record<string, unknown>[];
  res.send(
    pageShell(
      "Approvals",
      `<h3>Approval Queue</h3>
       <form method="POST" action="/app/queues/approvals">
         <table class="grid">
           <tr><th></th><th>ID</th><th>Kind</th><th>Status</th><th>Locked</th><th>Created</th></tr>
           ${rows
             .map(
               (r) => `<tr>
               <td><input type="checkbox" name="ids" value="${esc(String(r.id))}" ${r.locked_by && r.locked_by !== req.user!.username ? "disabled" : ""} /></td>
               <td><a href="/app/queues/approvals/${esc(String(r.id))}">${esc(r.id)}</a></td>
               <td>${esc(r.kind)}</td><td>${esc(r.status)}</td>
               <td>${r.locked_by ? `In use by ${esc(r.locked_by)}` : ""}</td>
               <td>${esc(r.created_at)}</td>
             </tr>`
             )
             .join("")}
         </table>
         <p>
           <button class="btn" name="action" value="approve">Bulk Approve</button>
           <button class="btn" name="action" value="reject">Bulk Reject</button>
         </p>
       </form>`
    )
  );
});

miscRouter.post("/app/queues/approvals", requireAuth, requirePerm("queue.approve"), (req, res) => {
  const ids = ([] as string[]).concat((req.body.ids as string[]) || []).filter(Boolean);
  const action = String(req.body.action);
  for (const id of ids) {
    const row = getDb().prepare(`SELECT * FROM approval_queue WHERE id=?`).get(id) as
      | { locked_by: string | null; kind: string; payload: string }
      | undefined;
    if (!row) continue;
    if (row.locked_by && row.locked_by !== req.user!.username) continue;
    getDb()
      .prepare(`UPDATE approval_queue SET status=? WHERE id=?`)
      .run(action === "approve" ? "approved" : "rejected", id);
    logAction(req, `queue_${action}`, { id, kind: row.kind });
  }
  res.redirect("/app/queues/approvals");
});

miscRouter.get("/app/queues/approvals/:id", requireAuth, requirePerm("queue.approve"), (req, res) => {
  const row = getDb()
    .prepare(`SELECT * FROM approval_queue WHERE id=?`)
    .get(String(req.params.id)) as Record<string, unknown> | undefined;
  if (!row) return res.send("not found");
  res.send(
    pageShell(
      "Item",
      `<h3>${esc(row.id)}</h3>
       <pre style="font-size:10px;background:#fff;border:1px solid #808080;padding:8px;">${esc(row.payload)}</pre>
       <p>Status: ${esc(row.status)}</p>
       ${row.locked_by ? `<div class="banner-warn">In use by ${esc(row.locked_by)}</div>` : ""}`
    )
  );
});

miscRouter.get("/app/queues/work", requireAuth, (req, res) => {
  const tasks = getDb()
    .prepare(`SELECT * FROM work_tasks ORDER BY updated_at DESC`)
    .all() as Record<string, unknown>[];
  res.send(
    pageShell(
      "Work Queue",
      `<h3>Work Queue / Tasks</h3>
       <div class="banner-info">Auto-refresh every 30s (resets selection — classic automation trap).</div>
       <meta http-equiv="refresh" content="30" />
       <table class="grid">
         <tr><th>Sel</th><th>ID</th><th>Title</th><th>Assignee</th><th>Status</th></tr>
         ${tasks
           .map(
             (t, i) => `<tr>
             <td><input type="radio" name="sel" ${i === 0 ? "checked" : ""} /></td>
             <td>${esc(t.id)}</td><td>${esc(t.title)}</td><td>${esc(t.assigned_to)}</td><td>${esc(t.status)}</td>
           </tr>`
           )
           .join("")}
       </table>
       <form method="POST" action="/app/queues/work/note">
         ${fieldRow("Add note:", `<input name="note" />`)}
         <tr><td></td><td><input type="submit" value="Save Note" class="btn" /></td></tr>
       </form>`
    )
  );
});

miscRouter.post("/app/queues/work/note", requireAuth, (req, res) => {
  logAction(req, "work_note", { note: req.body.note });
  res.redirect("/app/queues/work");
});

miscRouter.get("/app/loans/inquiry", requireAuth, requirePerm("loan.view"), (req, res) => {
  const loanId = String(req.query.loan ?? "");
  const loan = loanId
    ? (getDb().prepare(`SELECT * FROM loans WHERE id=?`).get(loanId) as Record<string, unknown> | undefined)
    : (getDb().prepare(`SELECT * FROM loans LIMIT 1`).get() as Record<string, unknown> | undefined);
  if (!loan) return res.send(pageShell("Loans", "No loans found"));
  res.send(
    pageShell(
      "Loan Inquiry",
      `<h3>Loan Inquiry</h3>
       <form method="GET">${fieldRow("Loan ID:", `<input name="loan" value="${esc(loan.id)}" />`)}
         <tr><td></td><td><input type="submit" value="Search" class="btn" /></td></tr></form>
       <table class="grid">
         <tr><td>Balance</td><td>${money(Number(loan.balance))}</td></tr>
         <tr><td>Payment due</td><td>${esc(loan.payment_due)}</td></tr>
         <tr><td>Escrow</td><td>${money(Number(loan.escrow))}</td></tr>
         <tr><td>Delinquency</td><td>${esc(loan.delinquency)}</td></tr>
         <tr><td>Payment amt</td><td>${money(Number(loan.payment_amount))}</td></tr>
       </table>`
    )
  );
});

miscRouter.get("/app/cards/maintain", requireAuth, requirePerm("card.maintain"), (req, res) => {
  res.send(
    pageShell(
      "Cards",
      `<h3>Card Maintenance</h3>
       <form method="POST" action="/app/cards/maintain">
         ${fieldRow("Card ID:", `<input name="cardId" value="CD-12345" />`)}
         ${fieldRow("Action:", `<select name="action">
           <option>block</option><option>unblock</option><option>reissue</option>
           <option>lost_stolen</option><option>travel_notice</option><option>pin_request</option>
         </select>`)}
         ${fieldRow("Travel dates:", `<input name="travel" />`)}
         <tr><td></td><td><input type="submit" value="Submit" class="btn" /></td></tr>
       </form>
       <p style="font-size:10px;color:#666;">PIN is never displayed.</p>`
    )
  );
});

miscRouter.post("/app/cards/maintain", requireAuth, requirePerm("card.maintain"), (req, res) => {
  const action = String(req.body.action);
  if (action === "lost_stolen") {
    if (!req.body.confirm) {
      return res.send(
        pageShell(
          "Confirm",
          `<div class="banner-warn">Irreversible: permanently deactivates card.</div>
           <form method="POST" action="/app/cards/maintain">
             <input type="hidden" name="cardId" value="${esc(req.body.cardId)}" />
             <input type="hidden" name="action" value="lost_stolen" />
             <input type="hidden" name="confirm" value="1" />
             <input type="submit" value="Confirm Lost/Stolen" class="btn" />
           </form>`
        )
      );
    }
    getDb().prepare(`UPDATE cards SET status='deactivated' WHERE id=?`).run(String(req.body.cardId));
  } else if (action === "block") {
    getDb().prepare(`UPDATE cards SET status='blocked' WHERE id=?`).run(String(req.body.cardId));
  } else if (action === "unblock") {
    getDb().prepare(`UPDATE cards SET status='active' WHERE id=?`).run(String(req.body.cardId));
  } else if (action === "travel_notice") {
    getDb()
      .prepare(`UPDATE cards SET travel_notice=? WHERE id=?`)
      .run(String(req.body.travel ?? ""), String(req.body.cardId));
  }
  logAction(req, "card_" + action, { cardId: req.body.cardId });
  res.send(pageShell("Card OK", `<div class="banner-info">Card action '${esc(action)}' completed.</div>`));
});

miscRouter.get("/app/reports", requireAuth, requirePerm("reports"), (req, res) => {
  res.send(
    pageShell(
      "Reports",
      `<h3>Daily Reports</h3>
       <ul>
         <li><a href="/app/reports/run?r=teller_balance">Daily Teller Balance</a></li>
         <li><a href="/app/reports/run?r=dormant">Dormant Accounts</a></li>
         <li><a href="/app/reports/run?r=large_cash">Large Cash Transactions</a></li>
       </ul>`
    )
  );
});

miscRouter.get("/app/reports/run", requireAuth, requirePerm("reports"), (req, res) => {
  if (!req.query.ready) {
    return res.send(
      pageShell(
        "Generating",
        `<p>Report still generating...</p>
         <meta http-equiv="refresh" content="2;url=?r=${esc(req.query.r)}&ready=1" />`
      )
    );
  }
  res.send(
    pageShell(
      "Report",
      `<h3>Report: ${esc(req.query.r)}</h3>
       <script>window.open('','rpt');</script>
       <table class="grid">
         <tr><th>Row</th><th>Value</th></tr>
         <tr><td>1</td><td>$12,450.00</td></tr>
         <tr><td>2</td><td>$8,200.00</td></tr>
         <tr><td>3</td><td>$3,100.50</td></tr>
       </table>
       <p><a href="javascript:window.print()">Print</a></p>`
    )
  );
});

miscRouter.get("/app/admin/users", requireAuth, requirePerm("admin"), (req, res) => {
  if (!can(req.user!.role, "*") && req.user!.role !== "admin") {
    return res.status(200).send(accessDenied());
  }
  const users = getDb().prepare(`SELECT username, role, display_name, active FROM users`).all() as Record<
    string,
    unknown
  >[];
  res.send(
    pageShell(
      "Users",
      `<h3>User Management</h3>
       <table class="grid"><tr><th>User</th><th>Role</th><th>Name</th><th>Active</th></tr>
       ${users.map((u) => `<tr><td>${esc(u.username)}</td><td>${esc(u.role)}</td><td>${esc(u.display_name)}</td><td>${u.active}</td></tr>`).join("")}
       </table>
       <form method="POST" action="/app/admin/users">
         ${fieldRow("New username:", `<input name="username" />`)}
         ${fieldRow("Password:", `<input name="password" />`)}
         ${fieldRow("Role:", `<select name="role"><option>teller</option><option>csr</option><option>supervisor</option><option>readonly</option></select>`)}
         <tr><td></td><td><input type="submit" value="Create User" class="btn" /></td></tr>
       </form>`
    )
  );
});

miscRouter.post("/app/admin/users", requireAuth, (req, res) => {
  if (req.user!.role !== "admin") return res.status(200).send(accessDenied());
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO users (username, password, role, display_name, force_password_change, mfa_required, active)
       VALUES (?, ?, ?, ?, 0, 0, 1)`
    )
    .run(String(req.body.username), String(req.body.password), String(req.body.role), String(req.body.username));
  logAction(req, "user_create", { username: req.body.username });
  res.redirect("/app/admin/users");
});

miscRouter.get("/app/admin/tenant", requireAuth, (req, res) => {
  if (req.user!.role !== "admin") return res.status(200).send(accessDenied());
  const tenant = getTenant(req.user!.tenant);
  res.send(
    pageShell(
      "Tenant",
      `<h3>Tenant / Config</h3>
       <table class="grid">
         <tr><td>Tenant</td><td>${esc(tenant.id)}</td></tr>
         <tr><td>Name</td><td>${esc(tenant.name)}</td></tr>
         <tr><td>Vendor</td><td>${esc(tenant.vendorProduct)} ${esc(tenant.vendorVersion)}</td></tr>
         <tr><td>Teller cash limit</td><td>${money(tenant.tellerCashLimit)}</td></tr>
       </table>
       <p>Switch tenant via login <code>?tenant=harborview</code> or <code>TENANT=</code> env.</p>`
    )
  );
});

miscRouter.get("/app/admin/audit", requireAuth, requirePerm("audit"), (req, res) => {
  const rows = getDb()
    .prepare(`SELECT * FROM audit_log ORDER BY id DESC LIMIT 100`)
    .all() as Record<string, unknown>[];
  res.send(
    pageShell(
      "Audit",
      `<h3>Audit Log Viewer</h3>
       <table class="grid">
         <tr><th>TS</th><th>User</th><th>WS</th><th>Action</th><th>Payload</th></tr>
         ${rows
           .map(
             (r) =>
               `<tr><td>${esc(r.ts)}</td><td>${esc(r.username)}</td><td>${esc(r.workstation_id)}</td><td>${esc(r.action)}</td><td><font size="1">${esc(String(r.payload_masked).slice(0, 80))}</font></td></tr>`
           )
           .join("")}
       </table>`
    )
  );
});
