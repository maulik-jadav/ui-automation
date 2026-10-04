import { Router } from "express";
import { getTenant } from "../lib/tenants.js";
import { esc, pageShell } from "../lib/hostile.js";
import { getSessionTimeoutMs, requireAuth } from "../middleware/session.js";

export const consoleRouter = Router();

consoleRouter.get("/console", requireAuth, (req, res) => {
  const tenant = getTenant(req.user!.tenant);
  const warnMs = Math.max(5000, getSessionTimeoutMs() - 30000);

  if (tenant.frameCount === 2) {
    return res.send(`<!DOCTYPE html>
<html><head><title>${esc(tenant.name)} Console</title>
<style>html,body{margin:0;height:100%;overflow:hidden;background:#808080}
.shell{display:grid;grid-template-columns:200px 1fr;height:100vh;gap:2px}
iframe{border:0;width:100%;height:100%;background:#fff}
</style></head>
<body>
<div class="shell">
  <iframe name="leftFrame" src="/frames/nav"></iframe>
  <iframe name="mainFrame" src="/app/home"></iframe>
</div>
<script>
setTimeout(function(){ alert('Your session will expire'); }, ${warnMs});
</script>
</body></html>`);
  }

  res.send(`<!DOCTYPE html>
<html><head><title>${esc(tenant.name)} Console</title>
<style>
html,body{margin:0;height:100%;overflow:hidden;background:#808080}
.shell{display:grid;grid-template-rows:42px 1fr 22px;grid-template-columns:200px 1fr;height:100vh;gap:2px}
.top{grid-column:1/-1}
.bot{grid-column:1/-1}
iframe{border:0;width:100%;height:100%;background:#fff;display:block}
</style></head>
<body>
<div class="shell">
  <iframe class="top" name="topFrame" src="/frames/top" title="top"></iframe>
  <iframe name="leftFrame" src="/frames/nav" title="nav"></iframe>
  <iframe name="mainFrame" src="/app/home" title="main"></iframe>
  <iframe class="bot" name="bottomFrame" src="/frames/status" title="status"></iframe>
</div>
<script>
setTimeout(function(){ try{alert('Your session will expire');}catch(e){} }, ${warnMs});
</script>
</body></html>`);
});

consoleRouter.get("/frames/top", requireAuth, (req, res) => {
  const tenant = getTenant(req.user!.tenant);
  const timeoutSec = Math.round(getSessionTimeoutMs() / 1000);
  const bizDate = "09/15/2026";
  res.send(`<!DOCTYPE html><html><head><style>
body{margin:0;font-family:Tahoma;font-size:11px;color:#fff;background:${tenant.colors.top}}
table{width:100%;border-collapse:collapse}td{padding:6px 8px}
a{color:#fff}
</style></head><body>
<table><tr>
  <td><b>${esc(tenant.name)}</b> — CoreServ &nbsp;<span style="opacity:.85">${esc(tenant.vendorProduct)} ${esc(tenant.vendorVersion)}</span></td>
  <td align="right">
    ${esc(req.user!.username)} (${esc(req.user!.role)}) |
    Branch: ${esc(req.user!.branch)} |
    WS: ${esc(req.user!.workstationId)} |
    Biz Date: ${bizDate} |
    Session: <span id="clk">${timeoutSec}s</span> |
    <a href="/logout" target="_top">Logout</a>
  </td>
</tr></table>
<script>
var s=${timeoutSec};
setInterval(function(){ s--; var e=document.getElementById('clk'); if(e) e.innerHTML=s+'s'; if(s<=0) top.location='/login?expired=1'; },1000);
</script>
</body></html>`);
});

consoleRouter.get("/frames/status", requireAuth, (_req, res) => {
  res.send(`<!DOCTYPE html><html><head><style>
body{margin:0;font-family:Tahoma;font-size:10px;background:#ece9d8;border-top:1px solid #808080}
#st{padding:3px 8px}
</style></head><body>
<div id="st">Ready &nbsp;|&nbsp; Last action: ${new Date().toLocaleTimeString()}</div>
<script>
setInterval(function(){
  var msgs=['Ready','Processing...','Ready','Idle'];
  document.getElementById('st').innerHTML = msgs[Math.floor(Math.random()*msgs.length)] +
    ' &nbsp;|&nbsp; Last action: ' + new Date().toLocaleTimeString();
}, 4000);
</script>
</body></html>`);
});

consoleRouter.get("/frames/nav", requireAuth, (req, res) => {
  const tenant = getTenant(req.user!.tenant);
  const items: Record<string, { label: string; children: { label: string; href: string }[] }> = {
    members: {
      label: "Members",
      children: [
        { label: "Member Search", href: "/app/members/search" },
        { label: "New Member", href: "/app/members/onboard/1" },
        { label: "Merge / Duplicates", href: "/app/members/merge" },
      ],
    },
    accounts: {
      label: "Accounts",
      children: [
        { label: "Account Inquiry", href: "/app/accounts/inquiry" },
        { label: "Open New Account", href: "/app/accounts/open" },
        { label: "Holds & Flags", href: "/app/accounts/holds" },
        { label: "Stop Payment", href: "/app/accounts/stop" },
        { label: "Close Account", href: "/app/accounts/close" },
      ],
    },
    teller: {
      label: "Teller",
      children: [
        { label: "Open Drawer", href: "/app/teller/drawer" },
        { label: "Cash Deposit", href: "/app/teller/deposit" },
        { label: "Cash Withdrawal", href: "/app/teller/withdrawal" },
        { label: "Internal Transfer", href: "/app/teller/transfer" },
        { label: "Wire Transfer", href: "/app/teller/wire" },
        { label: "Loan Payment", href: "/app/teller/loan-pay" },
        { label: "Reversal", href: "/app/teller/reversal" },
      ],
    },
    loans: {
      label: "Loans",
      children: [{ label: "Loan Inquiry", href: "/app/loans/inquiry" }],
    },
    cards: {
      label: "Cards",
      children: [{ label: "Card Maintenance", href: "/app/cards/maintain" }],
    },
    queues: {
      label: "Queues",
      children: [
        { label: "Approval Queue", href: "/app/queues/approvals" },
        { label: "Work Queue", href: "/app/queues/work" },
      ],
    },
    reports: {
      label: "Reports",
      children: [{ label: "Daily Reports", href: "/app/reports" }],
    },
    admin: {
      label: "Admin",
      children: [
        { label: "User Management", href: "/app/admin/users" },
        { label: "Tenant Config", href: "/app/admin/tenant" },
        { label: "Audit Log", href: "/app/admin/audit" },
      ],
    },
  };

  const tree = tenant.menuOrder
    .map((key) => {
      const node = items[key];
      if (!node) return "";
      const kids = node.children
        .map(
          (c) =>
            `<div class="leaf"><a href="${c.href}" target="mainFrame">${esc(c.label)}</a></div>`
        )
        .join("");
      return `<div class="node">
        <div class="hdr" onclick="this.parentNode.classList.toggle('open')">${esc(node.label)}</div>
        <div class="kids">${kids}</div>
      </div>`;
    })
    .join("");

  res.send(`<!DOCTYPE html><html><head><style>
body{margin:0;font-family:Tahoma;font-size:11px;background:#ece9d8}
.hdr{padding:4px 6px;background:#d4d0c8;border-bottom:1px solid #808080;cursor:pointer;font-weight:bold}
.kids{display:none;padding-left:10px}
.open .kids{display:block}
.leaf{padding:3px 4px}
.leaf a{color:#0000ee;text-decoration:none}
.searchbox{padding:6px;border-bottom:1px solid #808080}
</style></head><body>
<div class="searchbox">Search <input type="text" size="12" /> <a href="javascript:void(0)">Search</a></div>
${tree}
<p style="padding:6px;font-size:9px;color:#666;">Duplicate "Search" decoy in header above.</p>
<script>
document.querySelectorAll('.node')[0]?.classList.add('open');
</script>
</body></html>`);
});

consoleRouter.get("/app/home", requireAuth, (req, res) => {
  const tenant = getTenant(req.user!.tenant);
  res.send(
    pageShell(
      "Home",
      `<h3 style="font-size:13px;margin:8px;">Welcome to ${esc(tenant.name)}</h3>
       <p style="margin:8px;font-size:11px;">Use the navigation tree to open modules. Address bar stays on /console.</p>
       <p style="margin:8px;"><a href="/app/members/search" target="mainFrame">Go to Member Search</a></p>
       <p style="margin:8px;font-size:10px;color:#666;">Known demo member: <b>12345</b> Alice Chen — savings $4,321.09</p>`
    )
  );
});
