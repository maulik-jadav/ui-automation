# ui-automation + CoreServ Console

Gemini **discovery** → typed **capability artifact** → **deterministic replay** (no LLM), with human handoff, allowlist/redaction, and an adversarial legacy bank console (**CoreServ**) as the target.

Verified live results: see [`VERIFY.md`](VERIFY.md). Design rationale: [`REPORT.md`](REPORT.md). Graded task list: [`TASKS.md`](TASKS.md).

**Operator UI:** [Automation Control Dashboard](docs/DASHBOARD.md) on **http://localhost:5000** (`npm run dashboard`; CoreServ stays on **:4000**).

## Requirements

- Node ≥ 22
- Playwright browsers: `npx playwright install chromium`
- Gemini API key only for **discovery** (replay does not call an LLM)

## Quick start

```bash
cp .env.example .env          # GEMINI_API_KEY, GEMINI_MODEL, CORESERV_USER, CORESERV_PASS
npm install
npx playwright install chromium
npm run seed
ENABLE_TEST_HARNESS=1 npm start   # http://localhost:4000
# Optional: npm run list-models   # prints generateContent models for your key

# Dashboard (API + UI) — separate process, does not restyle CoreServ
npm run dashboard                 # http://localhost:5000
```

Login: http://localhost:4000/login

Screenshots / screen map: [`docs/DASHBOARD.md`](docs/DASHBOARD.md) (Home, Run a task, Needs your help, Guided demo in Test lab).

### Demo credentials

| User | Password | Notes |
|------|----------|--------|
| `csr1` | `csr-pass` | Default for seeded replay |
| `teller1` | `teller-pass` | Cash drawer limits |
| `supervisor1` | `sup-pass` | Overrides / approvals |
| `admin1` | `admin-pass` | Admin |
| `readonly1` | `ro-pass` | Access Denied on writes |
| `forcechange1` | `temp-pass` | Password-change interstitial |
| `mfa1` | `mfa-pass` | Code in server log + `data/mfa.log` |

Fixture: member **12345** → savings `12345-S01` → **$4,321.09**. Synthetic SSNs use `900-xx-xxxx`.

## Automation CLI

Credentials come from `.env` only (`CORESERV_USER` / `CORESERV_PASS` / `GEMINI_API_KEY`). Do not pass `--password` on the CLI.

```bash
# Discovery (Gemini) → artifact under artifacts/ + transcript under evidence/<runId>/
npm run discover -- --memberId 12345 --headless

# Replay the discovery artifact (preferred) or labeled seeded fixture
npm run replay -- --artifact <artifactId-or-path> --memberId 12345 --headless
npm run replay -- --seeded --memberId 12345 --headless          # lookup fixture
npm run replay -- --seeded-write --memberId 12345 --headless    # needs_human until approve
npm run approve -- --artifact seeded-open-account-draft

# Business outcome / tenant / stability / handoff
npm run replay -- --seeded --memberId 99999 --headless
npm run replay -- --seeded --memberId 12345 --tenant harborview --headless
npm run stability -- --seeded --n 5 --memberId 12345
npm run demo-handoff                                            # headed claim/resume demo

npm run claim -- --runId <id>
npm run resume -- --runId <id>
npm test
```

### Result taxonomy

| Status | Meaning |
|--------|---------|
| `success` | Checkpoint + typed outputs |
| `business_outcome` | Expected domain result (e.g. `MEMBER_NOT_FOUND`) |
| `recovered` | Success after bounded recoverable handling |
| `needs_human` | Intervention id; claim → fix → resume |
| `hard_failure` | Crash / locator / allowlist / HTTP 5xx with evidence paths |

## Architecture (thin)

```
src/core/agent/       Gemini discovery → transcript → artifact
src/core/artifact/    schema 1.1 builder + validate-on-load
src/core/replay/      locator resolve, outcomes, drift, tenant overrides
src/core/surface/     SurfaceAdapter + PlaywrightWebAdapter (+ DesktopSurfaceStub)
src/core/escalation/  PAUSED → claim HUMAN → resume RESUMING → AUTOMATION
src/core/safety/      allowlist + redaction + irreversible draft gate
src/dashboard/        Automation Control Dashboard (Express + React) on :5000
src/mock-app/         CoreServ (SQLite, frames, faults, tenants) — do not restyle
artifacts/            capability JSON
evidence/             run logs, screenshots, VERIFY outputs
schemas/              capability.schema.json
```

Replay never imports the LLM client (enforced by unit test).

## CoreServ target

```bash
TENANT=meridian npm start       # default
TENANT=harborview npm start     # label/menu drift
TENANT=tiny_cu npm start        # lite shell
```

- `/console` — named iframes: `topFrame` / `leftFrame` / `mainFrame` / `bottomFrame`
- Seeded lookup uses top-level `/app/members/search` + `/app/accounts/inquiry` after login (thin path)
- `ENABLE_TEST_HARNESS=1` enables `/__test/faults`, `/__test/clear-sessions`, `/__test/reset`, …

```bash
curl -X POST http://localhost:4000/__test/faults -H 'content-type: application/json' \
  -d '{"fault":"http500","route":"/app/accounts/inquiry","once":true,"session_sid":"*"}'
```

## What VERIFY showed

- **Discovery → artifact → replay** on CoreServ: **PASS** (`evidence/3bb6d11f/transcript.json`, artifact `9ad5ae0b`)
- Seeded fixture, business outcome, harborview, stability, fault→`http_5xx`, live handoff, write draft gate: **PASS**
- Frame-driven `/console` E2E: **untested** (documented in REPORT)

Details: [`VERIFY.md`](VERIFY.md).

## Honest limits

- Screenshots are not pixel-scrubbed
- Discovery depends on a live Gemini model (`GEMINI_MODEL`, default `gemini-3.8-flash`)
- Full console-frame automation and the broader `TASKS.md` suite are not all covered by the seeded artifact
