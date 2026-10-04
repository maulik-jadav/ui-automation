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
  cls,
  accessDenied,
} from "../lib/hostile.js";
import { requireAuth, requirePerm, logAction } from "../middleware/session.js";
import { can } from "../lib/tenants.js";

export const memberRouter = Router();

memberRouter.get(
  "/app/members/search",
  requireAuth,
  requirePerm("member.view"),
  (req, res) => {
    const tenant = getTenant(req.user!.tenant);
    const twoCol = tenant.searchTwoColumn;
    const q = req.query;
    const searched = q.searched === "1";

    let resultsHtml = "";
    if (searched) {
      const last = String(q.last ?? "");
      const memberNo = String(q.memberNo ?? "");
      const ssn4 = String(q.ssn4 ?? "");
      const first = String(q.first ?? "");
      const phone = String(q.phone ?? "");
      const acct = String(q.acct ?? "");

      let sql = `SELECT * FROM members WHERE 1=1`;
      const params: string[] = [];
      if (memberNo) {
        sql += ` AND id = ?`;
        params.push(memberNo);
      }
      if (last) {
        sql += ` AND last_name LIKE ?`;
        params.push(last + "%");
      }
      if (first) {
        sql += ` AND first_name LIKE ?`;
        params.push(first + "%");
      }
      if (ssn4) {
        sql += ` AND ssn_last4 = ?`;
        params.push(ssn4);
      }
      if (phone) {
        sql += ` AND phone LIKE ?`;
        params.push("%" + phone + "%");
      }
      if (acct) {
        sql += ` AND id IN (SELECT member_id FROM accounts WHERE id = ?)`;
        params.push(acct);
      }

      const rows = getDb().prepare(sql + ` ORDER BY last_name, first_name LIMIT 60`).all(
        ...params
      ) as Record<string, unknown>[];

      if (rows.length === 0) {
        resultsHtml = `<div class="banner-info">No records found</div>`;
      } else if (rows.length > 50) {
        resultsHtml = `<div class="banner-warn">More than 50 matches - refine search</div>`;
      } else {
        const page = Math.max(1, Number(q.page ?? 1));
        const pageRows = rows.slice((page - 1) * 10, page * 10);
        const sort = String(q.sort ?? "last_name");
        resultsHtml = `<table class="grid" id="${ctlId("grid")}">
          <tr>
            <th></th>
            <th><a href="?searched=1&last=${esc(last)}&sort=id">Member</a></th>
            <th><a href="?searched=1&last=${esc(last)}&sort=last_name">Name</a></th>
            <th>Phone</th><th>Status</th>
          </tr>
          ${pageRows
            .map(
              (r, i) => `<tr ondblclick="window.location='/app/members/${esc(String(r.id))}'">
              <td><input type="radio" name="sel" value="${esc(String(r.id))}" ${i === 0 ? "checked" : ""} /></td>
              <td>${esc(String(r.id))}</td>
              <td>${esc(r.last_name)}, ${esc(r.first_name)}</td>
              <td>${esc(String(r.phone))}</td>
              <td>${esc(String(r.status))}</td>
            </tr>`
            )
            .join("")}
        </table>
        <p>
          ${actionButton("Open Selected", {
            kind: "link",
            onclick: `var r=document.querySelector('input[name=sel]:checked');if(r)location='/app/members/'+r.value;return false;`,
          })}
          ${page * 10 < rows.length ? `<a href="?searched=1&last=${esc(last)}&page=${page + 1}">Next page →</a>` : ""}
        </p>
        <p style="font-size:10px;color:#666;">Sort hint: ${esc(sort)} · Double-click row to open</p>`;
      }
    }

    const fields = `
      ${fieldRow(tenant.labels.memberId + ":", `<input type="text" name="memberNo" id="${ctlId("mno")}" value="${esc(q.memberNo ?? "")}" />`)}
      ${fieldRow("SSN (last 4):", `<input type="text" name="ssn4" maxlength="4" id="${ctlId("ssn")}" />`)}
      ${fieldRow("Last Name:", `<input type="text" name="last" id="${ctlId("ln")}" value="${esc(q.last ?? "")}" />`)}
      ${fieldRow("First Name:", `<input type="text" name="first" id="${ctlId("fn")}" />`)}
      ${fieldRow("DOB:", `<input type="text" name="dob" id="${ctlId("dob")}" />`)}
      ${fieldRow("Phone:", `<input type="text" name="phone" id="${ctlId("ph")}" />`)}
      ${fieldRow(tenant.labels.account + ":", `<input type="text" name="acct" id="${ctlId("ac")}" />`)}
      <tr><td colspan="3">
        Search Type:
        <input type="radio" name="stype" value="exact" checked onclick="setType('exact')" /> Exact
        <input type="radio" name="stype" value="name" onclick="setType('name')" /> Name
        <input type="radio" name="stype" value="phone" onclick="setType('phone')" /> Phone
      </td></tr>`;

    const formInner = twoCol
      ? `<table width="100%"><tr><td width="50%"><table>${fields}</table></td>
         <td valign="top"><p style="font-size:10px;">Harborview two-column criteria layout (v7.4.0)</p>
         ${actionButton("Search", { kind: "submit", name: "search" })}</td></tr></table>`
      : `<table>${fields}
         <tr><td></td><td>
           ${actionButton("Search", { kind: "submit", name: "search" })}
           &nbsp;${actionButton("Search", { decoy: true })}
           &nbsp;${actionButton("Submit", { decoy: true })}
         </td></tr></table>`;

    res.send(
      pageShell(
        tenant.labels.memberSearchTitle,
        `<h3 style="font-size:12px;">${esc(tenant.labels.memberSearchTitle)}</h3>
         <form method="GET" action="/app/members/search">
           <input type="hidden" name="searched" value="1" />
           ${formInner}
         </form>
         <hr/>
         ${resultsHtml}
         <script>
         function setType(t){
           var ids=['${ctlId("mno")}','${ctlId("ssn")}','${ctlId("ln")}','${ctlId("fn")}','${ctlId("dob")}','${ctlId("ph")}','${ctlId("ac")}'];
           // enable/disable inconsistently by type
           document.querySelectorAll('input[type=text]').forEach(function(el){ el.disabled=false; });
           if(t==='name'){ var m=document.getElementById('${ctlId("mno")}'); if(m) m.disabled=true; }
           if(t==='phone'){ var s=document.getElementById('${ctlId("ssn")}'); if(s) s.disabled=true; }
         }
         </script>`
      )
    );
  }
);

memberRouter.get(
  "/app/members/:id",
  requireAuth,
  requirePerm("member.view"),
  (req, res) => {
    const id = String(req.params.id);
    const member = getDb().prepare(`SELECT * FROM members WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    if (!member) {
      return res.send(
        pageShell("Not Found", `<div class="banner-info">Record not found</div>`)
      );
    }
    const tab = String(req.query.tab ?? "profile");
    const tabs = [
      "profile",
      "accounts",
      "loans",
      "cards",
      "holds",
      "notes",
      "documents",
      "relationships",
      "audit",
    ];
    const tabBar = tabs
      .map(
        (t) =>
          `<td bgcolor="${t === tab ? "#fff" : "#d4d0c8"}" style="border:1px solid #808080;padding:3px 8px;cursor:pointer;"
            onclick="location='?tab=${t}'"><font size="1">${esc(t)}</font></td>`
      )
      .join("");

    res.send(
      pageShell(
        `Member ${id}`,
        `<table cellpadding="0" cellspacing="0"><tr>${tabBar}</tr></table>
         <iframe name="detailPane" src="/app/members/${esc(id)}/tab/${esc(tab)}" width="100%" height="480" style="border:1px inset #808080;"></iframe>
         <p style="font-size:10px;">
           <a href="/app/members/${esc(id)}/edit">Edit Member</a> |
           ${actionButton("Submit", { decoy: true })} |
           ${actionButton("Search", { decoy: true })}
         </p>`
      )
    );
  }
);

memberRouter.get(
  "/app/members/:id/tab/:tab",
  requireAuth,
  requirePerm("member.view"),
  (req, res) => {
    const id = String(req.params.id);
    const tab = String(req.params.tab);
    const member = getDb().prepare(`SELECT * FROM members WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    if (!member) return res.send("No records found");

    if (tab === "profile") {
      const revealed = req.query.reveal === "1";
      const ssn = revealed
        ? String(member.ssn_full)
        : `***-**-${esc(String(member.ssn_last4))}`;
      return res.send(
        pageShell(
          "Profile",
          `<table class="grid">
            <tr><td>Name</td><td>${esc(member.first_name)} ${esc(member.last_name)}</td></tr>
            <tr><td>SSN</td><td>${ssn}
              ${
                !revealed
                  ? `<form method="GET" style="display:inline;">
                       <input type="hidden" name="reveal" value="1" />
                       <input type="submit" value="Reveal" class="btn" ${can(req.user!.role, "member.reveal_ssn") ? "" : "disabled"} />
                     </form>`
                  : ""
              }
            </td></tr>
            <tr><td>DOB</td><td>${esc(member.dob)}</td></tr>
            <tr><td>Phone</td><td>${esc(member.phone)}</td></tr>
            <tr><td>Email</td><td>${esc(member.email)}</td></tr>
            <tr><td>Address</td><td>${esc(member.address1)}, ${esc(member.city)} ${esc(member.state)} ${esc(member.zip)}</td></tr>
            <tr><td>Status</td><td>${esc(member.status)} ${member.deceased ? "(Deceased)" : ""} ${member.fraud ? "(Fraud Flag)" : ""}</td></tr>
            <tr><td>Branch</td><td>${esc(member.branch)}</td></tr>
          </table>
          ${
            revealed
              ? (() => {
                  logAction(req, "ssn_reveal", { memberId: id });
                  return `<div class="banner-warn">SSN reveal audit-logged. Supervisor override reason: MANUAL</div>`;
                })()
              : ""
          }`
        )
      );
    }

    if (tab === "accounts") {
      const accts = getDb()
        .prepare(`SELECT * FROM accounts WHERE member_id = ?`)
        .all(id) as Record<string, unknown>[];
      return res.send(
        pageShell(
          "Accounts",
          `<table class="grid">
            <tr><th>Account</th><th>Product</th><th>Status</th><th>Current</th><th>Available</th></tr>
            ${accts
              .map(
                (a) => `<tr>
                <td><a href="/app/accounts/inquiry?acct=${esc(String(a.id))}" target="_parent">${esc(String(a.id))}</a></td>
                <td>${esc(a.product_name)}</td>
                <td>${esc(a.status)}</td>
                <td>${money(Number(a.current_bal))}</td>
                <td>${money(Number(a.available_bal))}</td>
              </tr>`
              )
              .join("")}
          </table>`
        )
      );
    }

    if (tab === "loans") {
      const loans = getDb()
        .prepare(`SELECT * FROM loans WHERE member_id = ?`)
        .all(id) as Record<string, unknown>[];
      return res.send(
        pageShell(
          "Loans",
          loans.length
            ? `<table class="grid"><tr><th>Loan</th><th>Balance</th><th>Due</th><th>Status</th></tr>
               ${loans
                 .map(
                   (l) =>
                     `<tr><td>${esc(l.id)}</td><td>${money(Number(l.balance))}</td><td>${esc(l.payment_due)}</td><td>${esc(l.delinquency)}</td></tr>`
                 )
                 .join("")}</table>`
            : `<p>No loans on file.</p>`
        )
      );
    }

    if (tab === "cards") {
      const cards = getDb()
        .prepare(`SELECT * FROM cards WHERE member_id = ?`)
        .all(id) as Record<string, unknown>[];
      return res.send(
        pageShell(
          "Cards",
          `<table class="grid"><tr><th>Card</th><th>Last4</th><th>Status</th></tr>
           ${cards.map((c) => `<tr><td>${esc(c.id)}</td><td>${esc(c.last4)}</td><td>${esc(c.status)}</td></tr>`).join("") || "<tr><td colspan=3>None</td></tr>"}
           </table>`
        )
      );
    }

    return res.send(
      pageShell(
        tab,
        `<p class="banner-info">Tab "${esc(tab)}" — placeholder content for automation surface coverage.</p>`
      )
    );
  }
);

memberRouter.get(
  "/app/members/:id/edit",
  requireAuth,
  requirePerm("member.edit"),
  (req, res) => {
    const id = String(req.params.id);
    const m = getDb().prepare(`SELECT * FROM members WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    if (!m) return res.send(pageShell("Err", "Record not found"));
    const err = String(req.query.error ?? "");
    res.send(
      pageShell(
        "Edit Member",
        `${err ? `<div class="banner-err">${esc(err)}</div>` : ""}
         <form method="POST" action="/app/members/${esc(id)}/edit" onsubmit="return true;">
           <input type="hidden" name="version" value="${esc(m.version)}" />
           <table>
             ${fieldRow("Address:", `<input type="text" name="address1" value="${esc(m.address1)}" id="${ctlId("addr")}" />`, err.includes("address") ? "Invalid address format" : undefined)}
             ${fieldRow("City:", `<input type="text" name="city" value="${esc(m.city)}" />`)}
             ${fieldRow("State:", `<input type="text" name="state" value="${esc(m.state)}" size="2" />`)}
             ${fieldRow("ZIP:", `<input type="text" name="zip" value="${esc(m.zip)}" size="10" />`)}
             ${fieldRow("Phone:", `<input type="text" name="phone" value="${esc(m.phone)}" />`)}
             ${fieldRow("Email:", `<input type="text" name="email" value="${esc(m.email)}" />`)}
             ${fieldRow("Employer:", `<input type="text" name="employer" value="${esc(m.employer ?? "")}" />`)}
             <tr><td></td><td>
               <input type="checkbox" name="estatement" /> e-statement opt-in<br/>
               ${actionButton(req.query.dirty === "1" ? "Save Changes" : "Save", { kind: "submit" })}
               ${actionButton("Submit", { decoy: true })}
             </td></tr>
           </table>
         </form>
         <script>
         document.querySelectorAll('input').forEach(function(el){
           el.addEventListener('change', function(){ /* label becomes Save Changes after edit */ });
         });
         window.onbeforeunload = function(){ return 'Unsaved changes - leave page?'; };
         </script>`
      )
    );
  }
);

memberRouter.post(
  "/app/members/:id/edit",
  requireAuth,
  requirePerm("member.edit"),
  (req, res) => {
    const id = String(req.params.id);
    const m = getDb().prepare(`SELECT version FROM members WHERE id = ?`).get(id) as
      | { version: number }
      | undefined;
    if (!m) return res.send("Record not found");
    if (Number(req.body.version) !== m.version) {
      return res.send(
        pageShell(
          "Stale",
          `<div class="banner-err">Record was changed by another user, reload</div>
           <p><a href="/app/members/${esc(id)}/edit">Reload</a></p>`
        )
      );
    }
    // USPS-style interstitial
    if (!req.body.address_choice) {
      return res.send(
        pageShell(
          "Address Validation",
          `<div class="banner-info">USPS suggested address available.</div>
           <form method="POST" action="/app/members/${esc(id)}/edit">
             <input type="hidden" name="version" value="${esc(req.body.version)}" />
             <input type="hidden" name="phone" value="${esc(req.body.phone)}" />
             <input type="hidden" name="email" value="${esc(req.body.email)}" />
             <input type="hidden" name="employer" value="${esc(req.body.employer)}" />
             <input type="hidden" name="city" value="${esc(req.body.city)}" />
             <input type="hidden" name="state" value="${esc(req.body.state)}" />
             <input type="hidden" name="zip" value="${esc(req.body.zip)}" />
             <p><label><input type="radio" name="address_choice" value="suggested" checked /> Suggested: ${esc(req.body.address1)} (standardized)</label></p>
             <p><label><input type="radio" name="address_choice" value="as_entered" /> Keep as entered: ${esc(req.body.address1)}</label></p>
             <input type="hidden" name="address1" value="${esc(req.body.address1)}" />
             <input type="submit" value="Continue" class="btn" />
           </form>`
        )
      );
    }
    getDb()
      .prepare(
        `UPDATE members SET address1=?, city=?, state=?, zip=?, phone=?, email=?, employer=?, version=version+1 WHERE id=?`
      )
      .run(
        String(req.body.address1),
        String(req.body.city),
        String(req.body.state),
        String(req.body.zip),
        String(req.body.phone),
        String(req.body.email),
        String(req.body.employer ?? ""),
        id
      );
    logAction(req, "member_edit", { memberId: id });
    res.redirect(`/app/members/${id}?tab=profile`);
  }
);

/* Onboarding wizard */
memberRouter.get("/app/members/onboard/:step", requireAuth, requirePerm("member.create"), (req, res) => {
  const step = Number(req.params.step);
  if (step === 5) {
    const name = String(req.query.last ?? "");
    if (req.query.done === "1") {
      if (/OFACMATCH/i.test(name)) {
        return res.send(
          pageShell(
            "OFAC",
            `<div class="banner-err">Potential OFAC match - Referred to compliance</div>
             <p>Expected business outcome — escalate to human/compliance.</p>`
          )
        );
      }
      return res.redirect(
        `/app/members/onboard/6?first=${encodeURIComponent(String(req.query.first ?? ""))}&last=${encodeURIComponent(name)}`
      );
    }
    const delaySec = 2 + Math.floor(Math.random() * 5);
    return res.send(
      pageShell(
        "Compliance",
        `<p>Running compliance check...</p>
         <meta http-equiv="refresh" content="${delaySec};url=?done=1&first=${esc(req.query.first)}&last=${esc(name)}" />`
      )
    );
  }

  const titles = [
    "",
    "Identity",
    "Address",
    "Employment",
    "Beneficial Owner",
    "OFAC/KYC",
    "Review / Confirm",
  ];
  res.send(
    pageShell(
      `Onboard ${step}`,
      `<h3>New Member — Step ${step} of 6: ${titles[step] ?? ""}</h3>
       ${step === 4 ? `<div class="banner-warn">No back button on this step.</div>` : ""}
       <form method="GET" action="/app/members/onboard/${step >= 6 ? 6 : step + 1}">
         ${step === 1 ? fieldRow("First Name:", `<input name="first" />`) + fieldRow("Last Name:", `<input name="last" />`) + fieldRow("SSN:", `<input name="ssn" />`) : ""}
         ${step === 2 ? fieldRow("Address:", `<input name="address1" />`) + fieldRow("City:", `<input name="city" />`) : ""}
         ${step === 3 ? fieldRow("Employer:", `<input name="employer" />`) : ""}
         ${step === 4 ? fieldRow("Beneficial Owner (if any):", `<input name="bo" />`) : ""}
         ${step === 6 ? `<div class="banner-info">Member created. Reference #: ${100000 + Math.floor(Math.random() * 89999)}</div>` : ""}
         ${step < 6 ? `<input type="hidden" name="first" value="${esc(req.query.first ?? "")}" /><input type="hidden" name="last" value="${esc(req.query.last ?? "")}" /><input type="submit" value="Next" class="btn" />` : ""}
         ${step > 1 && step !== 4 && step < 6 ? `<a href="/app/members/onboard/${step - 1}">Back</a>` : ""}
       </form>`
    )
  );
});

memberRouter.get("/app/members/merge", requireAuth, requirePerm("member.merge"), (req, res) => {
  if (!can(req.user!.role, "member.merge")) {
    return res.status(200).send(accessDenied());
  }
  res.send(
    pageShell(
      "Merge",
      `<h3>Member Merge / Duplicate Resolution</h3>
       <table class="grid" width="100%">
         <tr><th>Field</th><th>Left (12345)</th><th>Right (100001)</th><th>Keep</th></tr>
         <tr><td>Name</td><td>Alice Chen</td><td>Alice Chen</td><td>
           <input type="radio" name="name" value="L" checked /> L
           <input type="radio" name="name" value="R" /> R</td></tr>
         <tr><td>Phone</td><td>480-555-0101</td><td>480-555-0199</td><td>
           <input type="radio" name="phone" value="L" checked /> L
           <input type="radio" name="phone" value="R" /> R</td></tr>
       </table>
       <form method="POST" action="/app/members/merge/confirm">
         <div class="banner-warn">This action is irreversible.</div>
         <input type="submit" value="Confirm Merge" class="btn" />
       </form>`
    )
  );
});

memberRouter.post("/app/members/merge/confirm", requireAuth, requirePerm("member.merge"), (req, res) => {
  logAction(req, "member_merge", { left: "12345", right: "100001" });
  res.send(pageShell("Merged", `<div class="banner-info">Members merged. Audit logged.</div>`));
});
