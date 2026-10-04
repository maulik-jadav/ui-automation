# Design Report

## 1. Architecture

One Node process, JSON on disk (no automation DB):

| Piece | Role |
|-------|------|
| **CoreServ** (`src/mock-app`) | Hostile legacy console: login interstitials, frames, decoys, tenants, SQLite seed, `/__test` faults |
| **SurfaceAdapter** | `observe` / `act` / `locate` / `snapshot` / `screenshot` — `PlaywrightWebAdapter` + `DesktopSurfaceStub` |
| **Discovery** | AX tree → Gemini `take_action` → act; transcript under `evidence/<runId>/`; start default `/login` |
| **Artifact** | Schema **1.1.0** — validate-on-load, typed inputs (validation/sensitivity), ranked locators + rationale, `risk_class`, `preconditions`, `fingerprint`, `tenant_overrides` |
| **Replay** | No LLM; uniqueness on locators; detectors; retry policy; drift check; optional handoff |
| **Safety** | Allowlist at executor; irreversible → draft until approve; redaction on evidence/writes |
| **Escalation** | Keep browser; `InterventionRequest`; claim/resume CLI; `human-actions.jsonl` |

Trade-off: complexity lives in the **target UI**, not queues/orchestrators — matches the brief’s thin-but-real constraint.

## 2. Artifact schema

Load-bearing choices (`src/core/types.ts`, `schemas/capability.schema.json`):

- **Ranked locators** with written `rationale` and confidence; fail on ambiguous matches (extract may take first).
- **`assertOutcome` as a step** so “No records found” is a declared business outcome, not a crash.
- **`inputs.*` placeholders** (not raw member IDs in type steps); required inputs validated before replay.
- **`risk_class`** assigned at record time from action kind + page context (not guessed only from button labels); human confirms on approve. Irreversible steps gate unattended replay via `reviewStatus`.
- **`fingerprint` + `tenant_overrides`** for drift and harborview-style label/startPath patches.
- **Provenance** without embedding the raw LLM transcript in the artifact file.

Capabilities: (1) seeded/discovered **lookup** (read); (2) seeded **open account to confirmation** (write / irreversible confirm) as draft until approved.

## 3. Determinism & error handling

`ReplayResult`: `success` | `business_outcome` | `recovered` | `needs_human` | `hard_failure`.

| Condition | Classification |
|-----------|----------------|
| Member 12345 balance extract | `success` |
| Member 99999 / “No records found” | `business_outcome` (`MEMBER_NOT_FOUND`) |
| Access Denied copy | `business_outcome` (`PERMISSION_DENIED`) |
| Session expired copy | recoverable → reauthenticate → may yield `recovered` |
| `/__test` HTTP 500 error page | `hard_failure` (`http_5xx`) |
| Allowlist violation | `hard_failure` (`allowlist`) |
| Unresolved/ambiguous locator (no handoff) | `hard_failure` |
| Draft irreversible / stuck with `--allowHandoff` | `needs_human` |

Waits are load/locator/outcome bound. Retry backoff uses a bounded timer between attempts, not as a substitute for waiting on UI state. Built-in detectors cover 5xx pages, not-found, permission, session text, busy/cutoff heuristics; dialogs auto-accept and log. On hard failure, Playwright tracing can emit a zip under `/evidence`.

## 4. Heterogeneity & multi-tenant

- **SurfaceAdapter** is the seam for a future OS-accessibility desktop path (`DesktopSurfaceStub` documents the gap).
- **Frames:** adapter can scrape iframe AX and CoreServ `/console` exposes four named frames (`topFrame` / `leftFrame` / `mainFrame` / `bottomFrame`). **Frame-driven end-to-end flows are untested in the seeded lookup path**, which uses top-level `/app/*` routes after login to stay thin. Discovery may enter `/console`; treat full frameset automation as a follow-on, not a verified claim.
- **Tenant overrides:** `--tenant harborview` applies `startPath` + label rewrites from the artifact.
- **Drift:** fingerprint `screenSignature` checked after landing on start URL.

## 5. Escalation & handoff

**Triggers:** discovery consecutive failures / no-progress hash; replay locator stuck (opt-in); approval gate; LLM API errors (escalate with reason).

**Machine:** `PAUSED` → `claim` → `HUMAN` → `resume` → `RESUMING` → `AUTOMATION`. Single-owner claim. Payload includes URL, redacted params, screenshot/AX paths, live-session hint. On resume, re-observe and re-resolve. Human clicks, inputs, and navigations are appended to `human-actions.jsonl` while paused.

Operator surface: CLI (`claim` / `resume` / `interventions`) + thin `operator.html` (serve the escalation folder; `file://` polling is unreliable).

## 6. Safety

- Allowlist domains + action kinds in discovery and replay; violations → structured `hard_failure`.
- **Risk class is recorded with the step** (from action + context at discovery/seed time). Name heuristics are only a discovery aid; a button labeled “Submit” on a confirmation screen is marked irreversible because of **page context**, and the human reviewer confirms via `draft` → `approve` before unattended replay.
- Credentials (`GEMINI_API_KEY`, `CORESERV_USER`, `CORESERV_PASS`) come from the environment / `.env` (gitignored), not from CLI flags that land in shell history.
- Redaction: SSN, email, phone, DOB, PAN-ish, passwordish, cookie/auth keys. **Honest limit:** screenshots are not pixel-scrubbed.

## 7. Cuts

| Cut | Status |
|-----|--------|
| Remote co-browse console | CLI + local HTML only |
| Full desktop adapter | Stub only |
| Full `TASKS.md` suite as artifacts | Lookup + open-account-to-confirm seeded; rest aspirational |
| Frame-driven `/console` E2E | Untested (top-level `/app/*` used instead) |
