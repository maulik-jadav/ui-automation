import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { initSchema, getDb } from "./db/store.js";
import { runSeed } from "./seed/seed.js";
import { sessionMiddleware } from "./middleware/session.js";
import { faultMiddleware, registerTestRoutes } from "./middleware/faults.js";
import { authRouter } from "./routes/auth.js";
import { consoleRouter } from "./routes/console.js";
import { memberRouter } from "./routes/members.js";
import { accountRouter } from "./routes/accounts.js";
import { tellerRouter } from "./routes/teller.js";
import { miscRouter } from "./routes/misc.js";
import { getTenant } from "./lib/tenants.js";
import { pageShell, esc } from "./lib/hostile.js";

const PORT = Number(process.env.MOCK_APP_PORT ?? 4000);

initSchema();
const meta = getDb().prepare(`SELECT value FROM meta WHERE key='seeded_at'`).get() as
  | { value: string }
  | undefined;
if (!meta) {
  console.log("No seed found — running seed…");
  runSeed();
}

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(sessionMiddleware);
app.use(faultMiddleware);

app.get("/", (_req, res) => res.redirect("/login"));

app.get("/__meta", (req, res) => {
  const tenant = getTenant(
    (req.user?.tenant as string) ||
      String(req.query.tenant ?? process.env.TENANT ?? "meridian")
  );
  res.json({
    tenantId: tenant.id,
    vendorProduct: tenant.vendorProduct,
    vendorVersion: tenant.vendorVersion,
    name: tenant.name,
  });
});

registerTestRoutes(app);

app.use(authRouter);
app.use(consoleRouter);
app.use(memberRouter);
app.use(accountRouter);
app.use(tellerRouter);
app.use(miscRouter);

// Legacy compatibility redirects for older automation demos
app.get("/search", (req, res) => {
  if (!req.user) return res.redirect("/login");
  res.redirect("/app/members/search");
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).send(
    pageShell(
      "Server Error",
      `<h3>Server Error in '/' Application.</h3>
       <pre style="font-size:10px;">${esc(err.message)}\n${esc(err.stack ?? "")}</pre>`
    )
  );
});

app.listen(PORT, () => {
  const tenant = getTenant(process.env.TENANT);
  console.log(`CoreServ Console listening on http://localhost:${PORT}`);
  console.log(`  tenant=${tenant.id} (${tenant.vendorProduct} ${tenant.vendorVersion})`);
  console.log(`  SESSION_TIMEOUT_MS=${process.env.SESSION_TIMEOUT_MS ?? 180000}`);
  console.log(`  ENABLE_TEST_HARNESS=${process.env.ENABLE_TEST_HARNESS ?? "0"}`);
  console.log(`  HOSTILE=${process.env.HOSTILE ?? "1"} seed=${process.env.HOSTILE_SEED ?? "memberbank-v1"}`);
  if (!existsSync(join(process.cwd(), "data", "coreserv.sqlite"))) {
    console.warn("  WARNING: DB file missing after init");
  }
});
