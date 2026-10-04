import express from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { healthRouter } from "./routes/health.js";
import { artifactsRouter } from "./routes/artifacts.js";
import { runsRouter } from "./routes/runs.js";
import { interventionsRouter } from "./routes/interventions.js";
import { safetyRouter } from "./routes/safety.js";
import { testlabRouter } from "./routes/testlab.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.use("/api", healthRouter);
  app.use("/api", artifactsRouter);
  app.use("/api", runsRouter);
  app.use("/api", interventionsRouter);
  app.use("/api", safetyRouter);
  app.use("/api", testlabRouter);

  app.get("/api/preflight", async (_req, res) => {
    const { loadAllowlist, assertAllowedUrl } = await import(
      "../../core/safety/allowlist.js"
    );
    const url = process.env.MOCK_APP_BASE_URL ?? "http://localhost:4000";
    const checks: { id: string; ok: boolean; label: string; detail?: string }[] =
      [];
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      checks.push({
        id: "coreserv",
        ok: r.ok || r.status < 500,
        label: "CoreServ is reachable",
        detail: `HTTP ${r.status}`,
      });
    } catch (err) {
      checks.push({
        id: "coreserv",
        ok: false,
        label: "CoreServ is reachable",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    const key = process.env.GEMINI_API_KEY;
    checks.push({
      id: "gemini_key",
      ok: Boolean(key && !key.includes("your_gemini")),
      label: "Gemini API key present",
      detail: key && !key.includes("your_gemini") ? "Set in .env" : "Missing",
    });
    try {
      assertAllowedUrl(url);
      checks.push({
        id: "allowlist",
        ok: true,
        label: "Start URL is allowlisted",
        detail: url,
      });
    } catch (err) {
      checks.push({
        id: "allowlist",
        ok: false,
        label: "Start URL is allowlisted",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    const user = process.env.CORESERV_USER ?? process.env.CORESERV_USERNAME;
    const pass = process.env.CORESERV_PASS ?? process.env.CORESERV_PASSWORD;
    checks.push({
      id: "credentials",
      ok: Boolean(user && pass),
      label: "CoreServ credentials present",
      detail: user && pass ? "Present (not shown)" : "Missing in .env",
    });
    try {
      loadAllowlist();
      checks.push({ id: "safety", ok: true, label: "Safety rules loaded" });
    } catch (err) {
      checks.push({
        id: "safety",
        ok: false,
        label: "Safety rules loaded",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    res.json({ ok: checks.every((c) => c.ok), checks });
  });

  const webDist = join(__dirname, "../web/dist");
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(join(webDist, "index.html"));
    });
  } else {
    app.get("/", (_req, res) => {
      res
        .status(503)
        .send(
          "Dashboard UI not built yet. Run: npm run dashboard:build"
        );
    });
  }

  return app;
}
