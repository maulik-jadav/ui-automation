import { Router } from "express";
import { getDb } from "../db/store.js";
import { getTenant, can } from "../lib/tenants.js";
import { pageShell, esc, money, fieldRow, actionButton } from "../lib/hostile.js";
import { requireAuth, requirePerm, logAction } from "../middleware/session.js";

export const tellerRouter = Router();

tellerRouter.get("/app/teller/drawer", requireAuth, requirePerm("drawer"), (req, res) => {
  res.send(
    pageShell(
      "Drawer",
      `<h3>Open Teller Drawer</h3>
       <form method="POST" action="/app/teller/drawer">
         ${fieldRow("$100:", `<input name="d100" value="0" />`)}
         ${fieldRow("$50:", `<input name="d50" value="0" />`)}
         ${fieldRow("$20:", `<input name="d20" value="0" />`)}
         ${fieldRow("$10:", `<input name="d10" value="0" />`)}
         ${fieldRow("$5:", `<input name="d5" value="0" />`)}
         ${fieldRow("$1:", `<input name="d1" value="0" />`)}
         <tr><td></td><td><input type="submit" value="Open Drawer" class="btn" /></td></tr>
       </form>
       <p>Status: ${req.user!.drawerOpen ? "OPEN" : "CLOSED"}</p>`
    )
  );
});

tellerRouter.post("/app/teller/drawer", requireAuth, requirePerm("drawer"), (req, res) => {
  getDb().prepare(`UPDATE sessions SET drawer_open=1 WHERE sid=?`).run(req.user!.sid);
  logAction(req, "drawer_open", {});
  res.send(pageShell("Drawer", `<div class="banner-info">Drawer opened.</div><p><a href="/app/teller/deposit">Cash Deposit</a></p>`));
});

function requireDrawer(req: import("express").Request): string | null {
  const row = getDb()
    .prepare(`SELECT drawer_open FROM sessions WHERE sid=?`)
    .get(req.user!.sid) as { drawer_open: number } | undefined;
  if (!row?.drawer_open) return "Teller drawer must be Open first.";
  return null;
}

function cashForm(kind: "deposit" | "withdrawal"): string {
  return `<h3>Cash ${kind === "deposit" ? "Deposit" : "Withdrawal"}</h3>
    <form method="POST" action="/app/teller/${kind}">
      ${fieldRow("Member #:", `<input name="memberId" value="12345" />`)}
      ${fieldRow("Account:", `<input name="acct" value="12345-S01" />`)}
      ${fieldRow("Amount:", `<input name="amount" />`)}
      ${fieldRow("Occupation (CTR):", `<input name="occupation" />`)}
      ${fieldRow("ID Type:", `<select name="idtype"><option>DL</option><option>Passport</option></select>`)}
      ${fieldRow("ID Number:", `<input name="idnum" />`)}
      <tr><td></td><td><input type="submit" value="Submit" class="btn" /> ${actionButton("Submit", { decoy: true })}</td></tr>
    </form>`;
}

tellerRouter.get("/app/teller/deposit", requireAuth, requirePerm("txn.cash"), (req, res) => {
  res.send(pageShell("Deposit", cashForm("deposit")));
});
tellerRouter.get("/app/teller/withdrawal", requireAuth, requirePerm("txn.cash"), (req, res) => {
  res.send(pageShell("Withdrawal", cashForm("withdrawal")));
});

function handleCash(
  req: import("express").Request,
  res: import("express").Response,
  kind: "deposit" | "withdrawal"
): void {
  const err = requireDrawer(req);
  if (err) return void res.send(pageShell("Err", `<div class="banner-err">${esc(err)}</div>`));

  const amount = Number(req.body.amount);
  const tenant = getTenant(req.user!.tenant);
  const limit = tenant.tellerCashLimit;

  if (req.user!.role === "teller" && amount > limit && !req.body.override_ok) {
    return void res.send(
      pageShell(
        "Override",
        `<div class="banner-warn">Supervisor override required (limit ${money(limit)}).</div>
         <form method="POST" action="/app/teller/${kind}">
           ${Object.entries(req.body)
             .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}" />`)
             .join("")}
           ${fieldRow("Supervisor user:", `<input name="supuser" />`)}
           ${fieldRow("Supervisor password:", `<input type="password" name="suppass" />`)}
           <input type="hidden" name="override_ok" value="1" />
           <tr><td></td><td><input type="submit" value="Authorize" class="btn" /></td></tr>
         </form>`
      )
    );
  }

  if (req.body.override_ok && req.body.supuser) {
    const sup = getDb()
      .prepare(`SELECT * FROM users WHERE username=? AND password=?`)
      .get(String(req.body.supuser), String(req.body.suppass)) as { role: string } | undefined;
    if (!sup || (sup.role !== "supervisor" && sup.role !== "admin")) {
      return void res.send(pageShell("Err", `<div class="banner-err">Invalid supervisor credentials.</div>`));
    }
  }

  if (amount >= 10000 && !req.body.ctr_ok) {
    return void res.send(
      pageShell(
        "CTR",
        `<h3>Currency Transaction Report</h3>
         <div class="banner-warn">Amounts ≥ $10,000 require CTR.</div>
         <form method="POST" action="/app/teller/${kind}">
           ${Object.entries(req.body)
             .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}" />`)
             .join("")}
           ${fieldRow("Occupation:", `<input name="occupation" value="${esc(req.body.occupation ?? "")}" required />`)}
           ${fieldRow("ID Type:", `<select name="idtype"><option>DL</option><option>Passport</option></select>`)}
           ${fieldRow("ID Number:", `<input name="idnum" required />`)}
           <input type="hidden" name="ctr_ok" value="1" />
           <tr><td></td><td><input type="submit" value="Submit CTR & Continue" class="btn" /></td></tr>
         </form>`
      )
    );
  }

  if (kind === "withdrawal") {
    const acct = getDb()
      .prepare(`SELECT available_bal FROM accounts WHERE id=?`)
      .get(String(req.body.acct)) as { available_bal: number } | undefined;
    if (acct && amount > acct.available_bal && !req.body.od_override) {
      return void res.send(
        pageShell(
          "NSF",
          `<div class="banner-warn">Insufficient funds - Override? Y/N</div>
           <form method="POST" action="/app/teller/withdrawal">
             ${Object.entries(req.body)
               .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}" />`)
               .join("")}
             <input type="hidden" name="od_override" value="1" />
             <input type="submit" name="yn" value="Y" class="btn" />
             <a href="/app/teller/withdrawal">N</a>
           </form>`
        )
      );
    }
  }

  // Double-submit token
  const token = String(req.body.token ?? "");
  if (token && token === (req as unknown as { session?: { lastTok?: string } }).session?.lastTok) {
    return void res.send(pageShell("Dup", `<div class="banner-err">Duplicate transaction detected</div>`));
  }

  const sign = kind === "deposit" ? 1 : -1;
  getDb()
    .prepare(
      `UPDATE accounts SET current_bal = current_bal + ?, available_bal = available_bal + ?, ledger_bal = ledger_bal + ? WHERE id = ?`
    )
    .run(sign * amount, sign * amount, sign * amount, String(req.body.acct));
  const txnId = `TXN-CASH-${Date.now().toString(36)}`;
  getDb()
    .prepare(
      `INSERT INTO transactions (id, account_id, posted_at, description, amount, type, running_bal, check_number, is_check)
       VALUES (?,?,datetime('now'),?,?,?,?,NULL,0)`
    )
    .run(txnId, String(req.body.acct), `Cash ${kind}`, amount, kind === "deposit" ? "credit" : "debit", 0);
  logAction(req, `cash_${kind}`, { amount, acct: req.body.acct, ctr: amount >= 10000 });
  res.send(
    pageShell(
      "Done",
      `<div class="banner-info">Cash ${kind} of ${money(amount)} posted. Ref ${esc(txnId)}</div>
       <p><a href="/app/accounts/inquiry?acct=${esc(req.body.acct)}">View account</a></p>`
    )
  );
}

tellerRouter.post("/app/teller/deposit", requireAuth, requirePerm("txn.cash"), (req, res) =>
  handleCash(req, res, "deposit")
);
tellerRouter.post("/app/teller/withdrawal", requireAuth, requirePerm("txn.cash"), (req, res) =>
  handleCash(req, res, "withdrawal")
);

tellerRouter.get("/app/teller/transfer", requireAuth, requirePerm("txn.transfer"), (req, res) => {
  const accts = getDb()
    .prepare(`SELECT id, product_name, current_bal FROM accounts WHERE member_id='12345'`)
    .all() as { id: string; product_name: string; current_bal: number }[];
  const opts = accts
    .map(
      (a) =>
        `<option value="${esc(a.id)}">${esc(a.id)} ${esc(a.product_name)}  ${money(a.current_bal)}</option>`
    )
    .join("");
  res.send(
    pageShell(
      "Transfer",
      `<h3>Internal Transfer</h3>
       <form method="POST" action="/app/teller/transfer/review">
         ${fieldRow("From:", `<select name="from">${opts}</select>`)}
         ${fieldRow("To:", `<select name="to">${opts}</select>`)}
         ${fieldRow("Amount:", `<input name="amount" />`)}
         ${fieldRow("Memo:", `<input name="memo" />`)}
         <tr><td></td><td><input type="checkbox" name="future" /> Future-dated
           <input name="futureDate" placeholder="MM/DD/YYYY" /></td></tr>
         <tr><td></td><td><input type="checkbox" name="recur" /> Recurring
           <select name="freq"><option>Weekly</option><option>Monthly</option></select>
           End: <input name="endDate" /></td></tr>
         <tr><td></td><td><input type="submit" value="Review" class="btn" /></td></tr>
       </form>`
    )
  );
});

tellerRouter.post("/app/teller/transfer/review", requireAuth, requirePerm("txn.transfer"), (req, res) => {
  res.send(
    pageShell(
      "Review Transfer",
      `<table class="grid">
         <tr><td>From</td><td>${esc(req.body.from)}</td></tr>
         <tr><td>To</td><td>${esc(req.body.to)}</td></tr>
         <tr><td>Amount</td><td>${money(Number(req.body.amount))}</td></tr>
         <tr><td>Memo</td><td>${esc(req.body.memo)}</td></tr>
       </table>
       <form method="POST" action="/app/teller/transfer/confirm">
         ${Object.entries(req.body)
           .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}" />`)
           .join("")}
         <input type="submit" value="Confirm" class="btn" />
       </form>`
    )
  );
});

tellerRouter.post("/app/teller/transfer/confirm", requireAuth, requirePerm("txn.transfer"), (req, res) => {
  const amount = Number(req.body.amount);
  getDb()
    .prepare(`UPDATE accounts SET current_bal=current_bal-?, available_bal=available_bal-? WHERE id=?`)
    .run(amount, amount, String(req.body.from));
  getDb()
    .prepare(`UPDATE accounts SET current_bal=current_bal+?, available_bal=available_bal+? WHERE id=?`)
    .run(amount, amount, String(req.body.to));
  logAction(req, "transfer", { from: req.body.from, to: req.body.to, amount });
  res.send(pageShell("Transfer OK", `<div class="banner-info">Transfer confirmed.</div>`));
});

function abaValid(aba: string): boolean {
  if (!/^\d{9}$/.test(aba)) return false;
  const d = aba.split("").map(Number);
  const sum =
    3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}

tellerRouter.get("/app/teller/wire", requireAuth, requirePerm("txn.wire"), (req, res) => {
  if (!can(req.user!.role, "txn.wire")) {
    return res.send(pageShell("Denied", `<div class="denied">Access Denied - Contact your security administrator</div>`));
  }
  res.send(
    pageShell(
      "Wire",
      `<h3>Wire Transfer Request</h3>
       <form method="POST" action="/app/teller/wire">
         ${fieldRow("From account:", `<input name="from" value="12345-S01" />`)}
         ${fieldRow("ABA / Routing:", `<input name="aba" />`)}
         ${fieldRow("Beneficiary acct:", `<input name="beneAcct" />`)}
         ${fieldRow("Beneficiary name:", `<input name="beneName" />`)}
         ${fieldRow("Amount:", `<input name="amount" />`)}
         <tr><td></td><td><input type="checkbox" name="callback" /> Call-back verification completed</td></tr>
         <tr><td></td><td><input type="submit" value="Submit for Approval" class="btn" /></td></tr>
       </form>`
    )
  );
});

tellerRouter.post("/app/teller/wire", requireAuth, requirePerm("txn.wire"), (req, res) => {
  const hour = new Date().getHours();
  // Business date cutoff simulation — use query forceCutoff for demos
  if (req.query.cutoff === "1" || hour >= 16) {
    return res.send(
      pageShell(
        "Cutoff",
        `<div class="banner-warn">Cutoff passed - will process next business day</div>
         <p>This is an expected business outcome (not a failure).</p>`
      )
    );
  }
  if (!abaValid(String(req.body.aba))) {
    return res.send(pageShell("Err", `<div class="banner-err">Invalid ABA routing number (checksum failed).</div>`));
  }
  if (!req.body.callback) {
    return res.send(pageShell("Err", `<div class="banner-err">Call-back verification required.</div>`));
  }
  // OFAC interstitial
  if (!req.body.ofac_done) {
    return res.send(
      pageShell(
        "OFAC",
        `<p>Running OFAC screening...</p>
         <meta http-equiv="refresh" content="2;url=" />
         <form method="POST" action="/app/teller/wire">
           ${Object.entries(req.body)
             .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}" />`)
             .join("")}
           <input type="hidden" name="ofac_done" value="1" />
           <input type="submit" value="Continue after OFAC" class="btn" />
         </form>`
      )
    );
  }
  const id = `AQ-WIRE-${Date.now().toString(36).toUpperCase()}`;
  getDb()
    .prepare(
      `INSERT INTO approval_queue (id, kind, payload, status, locked_by, created_by, created_at, expires_at)
       VALUES (?,'wire',?,'pending',NULL,?,?,?)`
    )
    .run(
      id,
      JSON.stringify(req.body),
      req.user!.username,
      new Date().toISOString().slice(0, 10),
      new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
    );
  logAction(req, "wire_request", { id });
  res.send(
    pageShell(
      "Queued",
      `<div class="banner-info">Wire request ${esc(id)} created in Approval Queue. NOT sent until approved (irreversible after approval).</div>
       <p><a href="/app/queues/approvals">Open Approval Queue</a></p>`
    )
  );
});

tellerRouter.get("/app/teller/loan-pay", requireAuth, requirePerm("loan.pay"), (req, res) => {
  const quote = req.query.quote === "1";
  const ts = Number(req.query.ts ?? Date.now());
  const age = Date.now() - ts;
  if (quote && age > 60000) {
    return res.send(
      pageShell(
        "Expired",
        `<div class="banner-err">Quote expired, recalculate</div>
         <p><a href="/app/teller/loan-pay">Recalculate</a></p>`
      )
    );
  }
  res.send(
    pageShell(
      "Loan Pay",
      `<h3>Loan Payment</h3>
       <form method="GET" action="/app/teller/loan-pay">
         ${fieldRow("Loan:", `<input name="loan" value="LN-12345" />`)}
         ${fieldRow("Type:", `<select name="ptype" onchange="this.form.submit()"><option value="regular">Regular</option><option value="principal">Principal-only</option><option value="payoff">Payoff</option></select>`)}
       </form>
       ${
         String(req.query.ptype) === "payoff"
           ? `<div class="banner-info">Payoff quote: $12,450.33 — expires in <span id="cd">60</span>s
                <a href="?ptype=payoff&quote=1&ts=${Date.now()}">Lock quote</a></div>
              <script>var s=60;setInterval(function(){s--;var e=document.getElementById('cd');if(e)e.innerHTML=s;},1000);</script>
              <form method="POST" action="/app/teller/loan-pay"><input type="hidden" name="ts" value="${Date.now()}" />
                <input type="submit" value="Pay Payoff" class="btn" /></form>`
           : `<form method="POST" action="/app/teller/loan-pay">${fieldRow("Amount:", `<input name="amount" />`)}<tr><td></td><td><input type="submit" value="Post Payment" class="btn" /></td></tr></form>`
       }`
    )
  );
});

tellerRouter.post("/app/teller/loan-pay", requireAuth, requirePerm("loan.pay"), (req, res) => {
  if (req.body.ts && Date.now() - Number(req.body.ts) > 60000) {
    return res.send(pageShell("Expired", `<div class="banner-err">Quote expired, recalculate</div>`));
  }
  logAction(req, "loan_pay", req.body);
  res.send(pageShell("Paid", `<div class="banner-info">Payment posted.</div>`));
});

tellerRouter.get("/app/teller/reversal", requireAuth, requirePerm("txn.reverse"), (req, res) => {
  res.send(
    pageShell(
      "Reversal",
      `<h3>Transaction Reversal (supervisor)</h3>
       <form method="POST" action="/app/teller/reversal">
         ${fieldRow("Txn ID:", `<input name="txnId" />`)}
         ${fieldRow("Reason code:", `<select name="reason"><option>Member dispute</option><option>Ops error</option><option>Fraud</option></select>`)}
         <tr><td></td><td><input type="submit" value="Reverse" class="btn" /></td></tr>
       </form>`
    )
  );
});

tellerRouter.post("/app/teller/reversal", requireAuth, requirePerm("txn.reverse"), (req, res) => {
  logAction(req, "txn_reversal", req.body);
  res.send(pageShell("Reversed", `<div class="banner-info">Offsetting entry created. Audit logged.</div>`));
});
