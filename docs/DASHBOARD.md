# Automation Control Dashboard

Browser UI for operators (non-technical bank employees) to use every automation feature without the terminal. **CoreServ** (`src/mock-app`) is unchanged — it remains the hostile legacy test target on port **4000**. The dashboard is a separate app on port **5000**.

Screen ↔ brief mapping (requirements 3.1–3.7 style coverage):

| Screen | Route | Brief coverage |
|--------|-------|----------------|
| Home / Overview | `/` | Stats, action cards, recent runs, system health |
| Teach a new task | `/teach` | Discovery form, preflight, live SSE run view |
| Task library | `/library`, `/library/:id` | Artifacts, detail tabs, approve, drift, provenance |
| Run a task | `/run`, `/run/:runId` | Replay form, live view, five result cards, stability |
| Needs your help | `/handoff`, `/handoff/:id` | Inbox, SSE alerts, claim/resume, live screenshot |
| Safety center | `/safety` | Allowlist, test URL, redaction, approvals, blocked log |
| Run history & reports | `/history`, `/history/:id`, `.../report` | Filters, evidence, printable report |
| Test lab | `/lab` | Simulated faults + guided demo checklist |

## Run

```bash
# Terminal 1 — CoreServ
ENABLE_TEST_HARNESS=1 npm start

# Terminal 2 — Dashboard (builds UI then serves API + static on :5000)
npm run dashboard
```

Open **http://localhost:5000** (or **:5050** if macOS AirPlay is using 5000). Demo mode banner is always on (no auth system).

```bash
# Pin a free port if needed
DASHBOARD_PORT=5050 npm run dashboard
```

Dev (hot reload UI):

```bash
npm run dashboard:dev
```

## Architecture

- **Thin wrapper** around existing engine: `runDiscovery`, `runReplay`, `artifactStore`, `interventionStore`, `allowlist`, `redactDeep`, drift check.
- **One Node process** (`src/dashboard/server`) serves `/api/*` and the Vite build from `src/dashboard/web/dist`.
- **No database** — reads `artifacts/`, `evidence/`, interventions file.
- **SSE** for run progress (`/api/runs/:id/events`) and handoff inbox (`/api/interventions/events`).
- **Busy lock** — one active browser session at a time; API returns 409 if busy.
- Progress callbacks (`onEvent`) were added to replay/discovery; replay still never imports the LLM client.

## Interview guided demo (`/lab`)

1. Teach a new task (or skip if library already has lookup).
2. Review task in Task library.
3. Run a task with member `12345` → Success **$4,321.09**.
4. Run with member `99999` → blue business outcome.
5. Arm a simulated problem / Demo handoff → Needs your help.
6. Claim → hand back → Safety center → printable report.

## Tests

```bash
npm test                    # includes tests/dashboard/api.test.ts
npm run test:dashboard      # API layer only
# Optional UI smoke (needs dashboard + CoreServ up + Playwright test runner):
npx playwright test tests/dashboard/ui.smoke.spec.ts
```

## Security notes

- Credentials only from `.env`; never rendered in the UI.
- All JSON responses pass through `redactDeep` where applicable.
- Evidence paths are path-traversal safe.
