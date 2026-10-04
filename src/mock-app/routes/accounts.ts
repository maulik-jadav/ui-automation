import { Router } from "express";
import { getDb } from "../db/store.js";
import { getTenant } from "../lib/tenants.js";
import {
  pageShell,
  esc,
  money,
  fieldRow,
  ctlId,
  actionButton,
} from "../lib/hostile.js";
import { requireAuth, requirePerm, logAction } from "../middleware/session.js";
import { can } from "../lib/tenants.js";

export const accountRouter = Router();

accountRouter.get("/app/accounts/inquiry", requireAuth, requirePerm("account.view"), (req, res) => {
  const acctId = String(req.query.acct ?? "12345-S01");
  const a = getDb().prepare(`SELECT * FROM accounts WHERE id = ?`).get(acctId) as
    | Record<string, unknown>
    | undefined;
  if (!a) {
    return res.send(pageShell("Inquiry", `<div class="banner-info">Record not found</div>
      <script>try{alert('Account not found');}catch(e){}</script>`));
  }
  const hist = [Number(a.current_bal), Number(a.current_bal) * 0.9, Number(a.current_bal) * 1.05, Number(a.available_bal)];
  res.send(
    pageShell(
      "Account Inquiry",
      `<h3 style="font-size:12px;">Account Inquiry — ${esc(acctId)}</h3>
       <form method="GET"><table>
         ${fieldRow("Acct Number:", `<input name="acct" value="${esc(acctId)}" id="${ctlId("acct")}" /> ${actionButton("Search", { kind: "submit" })}`)}
       </table></form>
       <table class="grid">
         <tr><td>Product</td><td>${esc(a.product_name)} (${esc(a.product_code)})</td></tr>
         <tr><td>Status</td><td>${esc(a.status)} ${a.frozen ? "FROZEN" : ""} ${a.dormant ? "DORMANT" : ""}</td></tr>
         <tr><td>Current</td><td>${money(Number(a.current_bal))}</td></tr>
         <tr><td>Available</td><td>${money(Number(a.available_bal))}</td></tr>
         <tr><td>Pending</td><td>${money(Number(a.pending_bal))}</td></tr>
         <tr><td>Hold</td><td>${money(Number(a.hold_bal))}</td></tr>
         <tr><td>Ledger</td><td>${money(Number(a.ledger_bal))}</td></tr>
         <tr><td>Interest YTD</td><td>${money(Number(a.interest_ytd))}</td></tr>
         <tr><td>Last Statement</td><td>${esc(a.last_statement)}</td></tr>
         <tr><td>Maturity</td><td>${esc(a.maturity_date ?? "N/A")}</td></tr>
         <tr><td>OD Protection</td><td>${esc(a.od_protection_acct ?? "None")}</td></tr>
       </table>
       <p><b>Balance History</b> (canvas — screenshot required to read)</p>
       <canvas id="bh" width="320" height="80" style="border:1px solid #808080;"></canvas>
       <p>
         <a href="/app/accounts/transactions?acct=${esc(acctId)}">Transaction History</a> |
         <a href="/app/accounts/maintain?acct=${esc(acctId)}">Maintenance</a>
       </p>
       <script>
       (function(){
         var c=document.getElementById('bh').getContext('2d');
         var d=${JSON.stringify(hist)};
         var max=Math.max.apply(null,d)||1;
         c.strokeStyle='#0a246a'; c.beginPath();
         d.forEach(function(v,i){ var x=20+i*90; var y=70-(v/max)*60; if(i===0)c.moveTo(x,y); else c.lineTo(x,y); c.fillText('$'+v.toFixed(0),x-10,y-4); });
         c.stroke();
       })();
       </script>`
    )
  );
});

accountRouter.get("/app/accounts/transactions", requireAuth, requirePerm("txn.view"), (req, res) => {
  const acctId = String(req.query.acct ?? "12345-S01");
  const page = Math.max(1, Number(req.query.page ?? 1));
  const minAmt = req.query.minAmt ? Number(req.query.minAmt) : null;
  let sql = `SELECT * FROM transactions WHERE account_id = ?`;
  const params: (string | number)[] = [acctId];
  if (minAmt != null && !Number.isNaN(minAmt)) {
    sql += ` AND amount >= ?`;
    params.push(minAmt);
  }
  sql += ` ORDER BY posted_at DESC LIMIT 10 OFFSET ?`;
  params.push((page - 1) * 10);
  const rows = getDb().prepare(sql).all(...params) as Record<string, unknown>[];

  res.send(
    pageShell(
      "Transactions",
      `<h3>Transaction History — ${esc(acctId)}</h3>
       <form method="GET">
         <input type="hidden" name="acct" value="${esc(acctId)}" />
         <table>
           ${fieldRow("From:", `<input name="from" /> <a href="javascript:void(0)" onclick="window.open('/app/datepicker?f=from','dp','width=280,height=220')">📅</a>`)}
           ${fieldRow("To:", `<input name="to" /> <a href="javascript:void(0)" onclick="window.open('/app/datepicker?f=to','dp','width=280,height=220')">📅</a>`)}
           ${fieldRow("Min Amount:", `<input name="minAmt" value="${esc(req.query.minAmt ?? "")}" />`)}
           <tr><td>Type:</td><td>
             <select name="types" multiple size="3">
               <option>debit</option><option>credit</option><option>fee</option>
             </select>
           </td></tr>
           <tr><td></td><td>${actionButton("Filter", { kind: "submit" })}
             ${actionButton("Export to CSV", { kind: "link", href: `/app/accounts/transactions/export?acct=${esc(acctId)}` })}
             ${actionButton("Print", { kind: "link", onclick: `window.open(location.href,'print','width=800,height=600');return false;` })}
           </td></tr>
         </table>
       </form>
       <table class="grid">
         <tr><th>Date</th><th>Description</th><th>Amount</th><th>Type</th><th>Running</th></tr>
         ${rows
           .map(
             (r) => `<tr onclick="location='/app/accounts/transactions/${esc(String(r.id))}?acct=${esc(acctId)}'">
             <td>${esc(String(r.posted_at).slice(0, 10))}</td>
             <td>${esc(r.description)}</td>
             <td>${money(Number(r.amount))}</td>
             <td>${esc(r.type)}</td>
             <td>${money(Number(r.running_bal))}</td>
           </tr>`
           )
           .join("")}
       </table>
       <p><a href="?acct=${esc(acctId)}&page=${page + 1}">Next page →</a></p>
       <iframe name="txnDetail" width="100%" height="160" style="border:1px inset #808080;"></iframe>`
    )
  );
});

accountRouter.get("/app/accounts/transactions/export", requireAuth, requirePerm("txn.view"), (req, res) => {
  if (!can(req.user!.role, "txn.view")) return res.send("denied");
  logAction(req, "export_csv_sensitive", { acct: req.query.acct });
  const acctId = String(req.query.acct);
  const rows = getDb()
    .prepare(`SELECT * FROM transactions WHERE account_id = ? ORDER BY posted_at DESC LIMIT 500`)
    .all(acctId) as Record<string, unknown>[];
  const csv = ["date,description,amount,type,running_bal"]
    .concat(
      rows.map(
        (r) =>
          `${r.posted_at},${JSON.stringify(r.description)},${r.amount},${r.type},${r.running_bal}`
      )
    )
    .join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="txns-${acctId}.csv"`);
  res.send(csv);
});

accountRouter.get("/app/accounts/transactions/:txnId", requireAuth, requirePerm("txn.view"), (req, res) => {
  const txn = getDb()
    .prepare(`SELECT * FROM transactions WHERE id = ?`)
    .get(String(req.params.txnId)) as Record<string, unknown> | undefined;
  if (!txn) return res.send("not found");
  const checkCanvas = txn.is_check
    ? `<p>Check image (canvas):</p><canvas id="ck" width="280" height="100" style="border:1px solid #333;"></canvas>
       <script>
       var c=document.getElementById('ck').getContext('2d');
       c.fillStyle='#f5f5dc'; c.fillRect(0,0,280,100);
       c.strokeRect(2,2,276,96);
       c.fillStyle='#000'; c.font='12px Courier';
       c.fillText('CHECK #${esc(txn.check_number)}',20,40);
       c.fillText('PAY TO THE ORDER OF **********',20,60);
       c.fillText('${money(Number(txn.amount))}',180,80);
       </script>`
    : "";
  res.send(
    pageShell(
      "Txn Detail",
      `<table class="grid">
         <tr><td>ID</td><td>${esc(txn.id)}</td></tr>
         <tr><td>Desc</td><td>${esc(txn.description)}</td></tr>
         <tr><td>Amount</td><td>${money(Number(txn.amount))}</td></tr>
       </table>${checkCanvas}`
    )
  );
});

accountRouter.get("/app/datepicker", requireAuth, (req, res) => {
  res.send(
    pageShell(
      "Date",
      `<p>Pick a date</p>
       <input type="text" id="d" value="09/01/2026" />
       <button class="btn" onclick="opener.document.getElementsByName('${esc(req.query.f)}')[0].value=document.getElementById('d').value;window.close();">OK</button>`
    )
  );
});

accountRouter.get("/app/accounts/open", requireAuth, requirePerm("account.open"), (req, res) => {
  const tenant = getTenant(req.user!.tenant);
  const product = String(req.query.product ?? "");
  const products = tenant.products
    .map((p) => `<option value="${p.code}" ${product === p.code ? "selected" : ""}>${esc(p.name)}</option>`)
    .join("");

  res.send(
    pageShell(
      "Open Account",
      `<h3>Open New Account</h3>
       <form method="GET" action="/app/accounts/open">
         ${fieldRow("Member #:", `<input name="memberId" value="${esc(req.query.memberId ?? "12345")}" />`)}
         ${fieldRow("Product:", `<select name="product" onchange="this.form.submit()"><option value="">-- select --</option>${products}</select>`)}
       </form>
       ${
         product
           ? `<form method="POST" action="/app/accounts/open/review">
             <input type="hidden" name="memberId" value="${esc(req.query.memberId ?? "12345")}" />
             <input type="hidden" name="product" value="${esc(product)}" />
             ${!tenant.removeOpenAccountField ? fieldRow("Nickname:", `<input name="nickname" />`) : ""}
             ${product === "C01" || product.startsWith("C") ? fieldRow("Term (months):", `<select name="term"><option>6</option><option>12</option><option>24</option></select>`) + fieldRow("Maturity Action:", `<select name="mat"><option>Renew</option><option>Transfer</option></select>`) : ""}
             ${product === "I01" ? fieldRow("Contribution Year:", `<input name="iraYear" value="2026" />`) + fieldRow("IRA Type:", `<select name="iraType"><option>Traditional</option><option>Roth</option></select>`) : ""}
             ${product === "Y01" ? fieldRow("Custodian (required):", `<input name="custodian" />`) : ""}
             ${tenant.extraOpenAccountField ? fieldRow(tenant.extraOpenAccountField + ":", `<input name="referral" />`) : ""}
             ${fieldRow("Initial Deposit:", `<input name="deposit" />`)}
             ${fieldRow("Source:", `<select name="source"><option>cash</option><option>transfer</option><option>check</option></select>`)}
             <p>Joint owners: <input name="joint" placeholder="Name" /> <a href="javascript:void(0)">Add</a></p>
             <p><a href="/app/accounts/open/disclosure" target="disc" onclick="window.open(this.href,'disc','width=480,height=360');return false;">View Rate Disclosure</a> (scroll to accept)</p>
             <input type="hidden" name="disclosure_ok" id="discOk" value="0" />
             <input type="submit" value="Continue" class="btn" onclick="if(document.getElementById('discOk').value!=='1'){alert('Accept rate disclosure first');return false;}" />
           </form>`
           : ""
       }`
    )
  );
});

accountRouter.get("/app/accounts/open/disclosure", requireAuth, (_req, res) => {
  res.send(`<!DOCTYPE html><html><body style="font-family:Tahoma;font-size:11px;">
    <div id="box" style="height:200px;overflow:auto;border:1px solid #808080;padding:8px;">
      ${"<p>Rate disclosure paragraph. </p>".repeat(20)}
      <p id="end">END OF DISCLOSURE</p>
    </div>
    <button id="acc" class="btn" disabled onclick="opener.document.getElementById('discOk').value='1';window.close();">Accept</button>
    <script>
    var box=document.getElementById('box');
    box.onscroll=function(){
      if(box.scrollTop+box.clientHeight>=box.scrollHeight-4) document.getElementById('acc').disabled=false;
    };
    </script></body></html>`);
});

accountRouter.post("/app/accounts/open/review", requireAuth, requirePerm("account.open"), (req, res) => {
  res.send(
    pageShell(
      "Review",
      `<h3>Review New Account</h3>
       <table class="grid">
         <tr><td>Member</td><td>${esc(req.body.memberId)}</td></tr>
         <tr><td>Product</td><td>${esc(req.body.product)}</td></tr>
         <tr><td>Deposit</td><td>${esc(req.body.deposit)}</td></tr>
         <tr><td>Source</td><td>${esc(req.body.source)}</td></tr>
       </table>
       <form method="POST" action="/app/accounts/open/confirm">
         ${Object.entries(req.body)
           .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}" />`)
           .join("")}
         ${actionButton("Confirm", { kind: "submit" })}
         ${actionButton("Submit", { decoy: true })}
       </form>`
    )
  );
});

accountRouter.post("/app/accounts/open/confirm", requireAuth, requirePerm("account.open"), (req, res) => {
  const memberId = String(req.body.memberId);
  const product = String(req.body.product);
  const tenant = getTenant(req.user!.tenant);
  const prod = tenant.products.find((p) => p.code === product) ?? {
    code: product,
    name: product,
  };
  const acctId = `${memberId}-${product}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
  const deposit = Number(req.body.deposit) || 0;
  getDb()
    .prepare(
      `INSERT INTO accounts (id, member_id, product_code, product_name, nickname, status,
        current_bal, available_bal, pending_bal, hold_bal, ledger_bal, interest_ytd,
        last_statement, maturity_date, od_protection_acct, joint_owners, frozen, dormant, opened_at)
       VALUES (?,?,?,?,?,?,?,?,0,0,?,0,?,?,?,?,0,0,?)`
    )
    .run(
      acctId,
      memberId,
      prod.code,
      prod.name,
      String(req.body.nickname ?? ""),
      "open",
      deposit,
      deposit,
      deposit,
      new Date().toISOString().slice(0, 10),
      req.body.term ? new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10) : null,
      null,
      req.body.joint ? JSON.stringify([req.body.joint]) : null,
      new Date().toISOString().slice(0, 10)
    );
  logAction(req, "account_open", { acctId, memberId, deposit });
  res.send(
    pageShell(
      "Confirmed",
      `<div class="banner-info">Account opened successfully.</div>
       <p>New account #: <b>${esc(acctId)}</b></p>
       <p><a href="javascript:void(0)" onclick="window.open('/app/accounts/receipt?acct=${esc(acctId)}','rcpt','width=400,height=300')">Print Receipt</a></p>`
    )
  );
});

accountRouter.get("/app/accounts/receipt", requireAuth, (req, res) => {
  res.send(pageShell("Receipt", `<h3>Receipt</h3><p>Account ${esc(req.query.acct)}</p><p>${new Date().toLocaleString()}</p>`));
});

accountRouter.get("/app/accounts/holds", requireAuth, requirePerm("hold"), (req, res) => {
  const acct = String(req.query.acct ?? "12345-S01");
  const holds = getDb()
    .prepare(`SELECT * FROM holds WHERE account_id = ? AND active = 1`)
    .all(acct) as Record<string, unknown>[];
  res.send(
    pageShell(
      "Holds",
      `<h3>Holds & Flags — ${esc(acct)}</h3>
       <table class="grid"><tr><th>ID</th><th>Amount</th><th>Reason</th><th>Expiry</th><th></th></tr>
       ${holds
         .map(
           (h) => `<tr>
           <td>${esc(h.id)}</td><td>${money(Number(h.amount))}</td><td>${esc(h.reason)}</td><td>${esc(h.expiry)}</td>
           <td><a href="/app/accounts/holds/release?id=${esc(String(h.id))}&sup=${h.requires_supervisor}">Release</a></td>
         </tr>`
         )
         .join("")}
       </table>
       <h4>Place Hold</h4>
       <form method="POST" action="/app/accounts/holds/place">
         <input type="hidden" name="acct" value="${esc(acct)}" />
         ${fieldRow("Amount:", `<input name="amount" />`)}
         ${fieldRow("Reason:", `<select name="reason"><option>Suspected Fraud</option><option>Card Dispute</option><option>Legal Request</option><option>Other</option></select>`)}
         ${fieldRow("Expiry:", `<input name="expiry" value="12/31/2026" />`)}
         <tr><td></td><td><input type="submit" value="Place Hold" class="btn" /></td></tr>
       </form>
       <p>
         <a href="/app/accounts/holds?acct=${esc(acct)}&flag=deceased">Set Deceased Flag</a> |
         <a href="/app/accounts/holds?acct=${esc(acct)}&flag=fraud">Set Fraud Flag</a> |
         <a href="/app/accounts/holds?acct=${esc(acct)}&flag=dnm">Do Not Mail</a>
       </p>`
    )
  );
});

accountRouter.post("/app/accounts/holds/place", requireAuth, requirePerm("hold"), (req, res) => {
  const id = `HLD-${Date.now().toString(36).toUpperCase()}`;
  getDb()
    .prepare(
      `INSERT INTO holds (id, account_id, amount, reason, expiry, requires_supervisor, active, created_at)
       VALUES (?,?,?,?,?,0,1,?)`
    )
    .run(
      id,
      String(req.body.acct),
      Number(req.body.amount),
      String(req.body.reason),
      String(req.body.expiry),
      new Date().toISOString().slice(0, 10)
    );
  logAction(req, "hold_place", { id });
  res.redirect(`/app/accounts/holds?acct=${encodeURIComponent(String(req.body.acct))}`);
});

accountRouter.get("/app/accounts/holds/release", requireAuth, requirePerm("hold"), (req, res) => {
  if (req.query.sup === "1" && !can(req.user!.role, "hold.release_supervisor")) {
    return res.send(
      pageShell(
        "Override",
        `<div class="banner-err">Supervisor required to release this hold.</div>
         <form method="POST" action="/app/accounts/holds/override">
           <input type="hidden" name="id" value="${esc(req.query.id)}" />
           ${fieldRow("Supervisor user:", `<input name="supuser" />`)}
           ${fieldRow("Password:", `<input type="password" name="suppass" />`)}
           <tr><td></td><td><input type="submit" value="Override" class="btn" /></td></tr>
         </form>`
      )
    );
  }
  getDb().prepare(`UPDATE holds SET active=0 WHERE id=?`).run(String(req.query.id));
  logAction(req, "hold_release", { id: req.query.id });
  res.send(pageShell("Released", `<div class="banner-info">Hold released.</div>`));
});

accountRouter.get("/app/accounts/stop", requireAuth, requirePerm("stop"), (req, res) => {
  res.send(
    pageShell(
      "Stop Payment",
      `<h3>Stop Payment</h3>
       <form method="POST" action="/app/accounts/stop">
         ${fieldRow("Account:", `<input name="acct" value="12345-S01" />`)}
         ${fieldRow("Check # or start:", `<input name="start" />`)}
         ${fieldRow("Check # end (range):", `<input name="end" />`)}
         <tr><td></td><td><input type="checkbox" name="fee" value="1" /> Fee acknowledgement ($25)</td></tr>
         <tr><td></td><td><input type="submit" value="Submit Stop" class="btn" /></td></tr>
       </form>`
    )
  );
});

accountRouter.post("/app/accounts/stop", requireAuth, requirePerm("stop"), (req, res) => {
  if (!req.body.fee) {
    return res.send(pageShell("Stop", `<div class="banner-err">Fee acknowledgement required.</div>`));
  }
  const start = String(req.body.start);
  if (start === "1042") {
    return res.send(
      pageShell(
        "Duplicate",
        `<div class="banner-warn">A stop already exists for check #1042</div>
         <p><a href="/app/accounts/stop">Back</a></p>`
      )
    );
  }
  const id = `STP-${Date.now().toString(36).toUpperCase()}`;
  const exp = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);
  getDb()
    .prepare(
      `INSERT INTO stop_payments (id, account_id, check_start, check_end, fee_acked, created_at, expires_at)
       VALUES (?,?,?,?,1,?,?)`
    )
    .run(id, String(req.body.acct), start, String(req.body.end || start), new Date().toISOString().slice(0, 10), exp);
  logAction(req, "stop_payment", { id, start });
  res.send(pageShell("Stop OK", `<div class="banner-info">Stop placed ${esc(id)}. Expires ${esc(exp)} (6 months).</div>`));
});

accountRouter.get("/app/accounts/close", requireAuth, requirePerm("account.close"), (req, res) => {
  res.send(
    pageShell(
      "Close Account",
      `<h3>Close Account</h3>
       <form method="POST" action="/app/accounts/close/step1">
         ${fieldRow("Account:", `<input name="acct" />`)}
         ${fieldRow("Reason code:", `<select name="reason"><option>Member request</option><option>Dormant</option><option>Fraud</option></select>`)}
         <tr><td></td><td><input type="submit" value="Continue" class="btn" /></td></tr>
       </form>`
    )
  );
});

accountRouter.post("/app/accounts/close/step1", requireAuth, requirePerm("account.close"), (req, res) => {
  const acct = getDb()
    .prepare(`SELECT * FROM accounts WHERE id = ?`)
    .get(String(req.body.acct)) as Record<string, unknown> | undefined;
  if (!acct) return res.send(pageShell("Err", "Record not found"));
  const bal = Number(acct.current_bal);
  if (bal !== 0 && !can(req.user!.role, "account.close")) {
    return res.send(pageShell("Denied", `<div class="denied">Access Denied</div>`));
  }
  if (bal !== 0) {
    getDb()
      .prepare(
        `INSERT INTO approval_queue (id, kind, payload, status, locked_by, created_by, created_at, expires_at)
         VALUES (?,?,?,'pending',NULL,?,?,?)`
      )
      .run(
        `AQ-CLOSE-${Date.now().toString(36)}`,
        "account_close",
        JSON.stringify({ accountId: acct.id, reason: req.body.reason, balance: bal }),
        req.user!.username,
        new Date().toISOString().slice(0, 10),
        new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
      );
    return res.send(
      pageShell(
        "Queued",
        `<div class="banner-warn">Non-zero balance ${money(bal)} — submitted to Approval Queue for supervisor.</div>`
      )
    );
  }
  res.send(
    pageShell(
      "Confirm Close",
      `<div class="banner-warn">Irreversible. Type CLOSE to confirm.</div>
       <form method="POST" action="/app/accounts/close/final">
         <input type="hidden" name="acct" value="${esc(req.body.acct)}" />
         ${fieldRow("Type CLOSE:", `<input name="confirm" />`)}
         <tr><td></td><td><input type="submit" value="Close Account" class="btn" /></td></tr>
       </form>`
    )
  );
});

accountRouter.post("/app/accounts/close/final", requireAuth, requirePerm("account.close"), (req, res) => {
  if (String(req.body.confirm) !== "CLOSE") {
    return res.send(pageShell("Err", `<div class="banner-err">Confirmation text mismatch.</div>`));
  }
  getDb().prepare(`UPDATE accounts SET status='closed', current_bal=0, available_bal=0 WHERE id=?`).run(String(req.body.acct));
  logAction(req, "account_close", { acct: req.body.acct });
  res.send(pageShell("Closed", `<div class="banner-info">Account closed.</div>`));
});

accountRouter.get("/app/accounts/maintain", requireAuth, requirePerm("account.maintain"), (req, res) => {
  const acct = String(req.query.acct ?? "");
  res.send(
    pageShell(
      "Maintenance",
      `<h3>Account Maintenance — ${esc(acct)}</h3>
       <form method="POST" action="/app/accounts/maintain">
         <input type="hidden" name="acct" value="${esc(acct)}" />
         ${fieldRow("Nickname:", `<input name="nickname" />`)}
         ${fieldRow("Statement cycle:", `<select name="cycle"><option>Monthly</option><option>Quarterly</option></select>`)}
         ${fieldRow("OD Protection acct:", `<input name="od" />`)}
         ${fieldRow("Add POD beneficiary:", `<input name="pod" />`)}
         <tr><td></td><td>${actionButton("Save", { kind: "submit" })}</td></tr>
       </form>`
    )
  );
});

accountRouter.post("/app/accounts/maintain", requireAuth, requirePerm("account.maintain"), (req, res) => {
  getDb()
    .prepare(`UPDATE accounts SET nickname=?, od_protection_acct=? WHERE id=?`)
    .run(String(req.body.nickname ?? ""), String(req.body.od ?? ""), String(req.body.acct));
  logAction(req, "account_maintain", { acct: req.body.acct });
  res.redirect(`/app/accounts/inquiry?acct=${encodeURIComponent(String(req.body.acct))}`);
});
