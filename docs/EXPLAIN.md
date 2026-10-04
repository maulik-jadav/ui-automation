# EXPLAIN — Interview walkthrough

Companion to [`AUDIT.md`](AUDIT.md), [`VERIFY.md`](VERIFY.md), [`REPORT.md`](REPORT.md).  
**Do not overstate.** Discovery end-to-end was blocked by Gemini API on verify day.

---

## 1. Audit before → after

| # | Requirement | Before (Phase 1) | After (Phase 2–3) |
|---|-------------|------------------|-------------------|
| 1 | Artifact schema | PARTIAL | **PASS** |
| 2 | Deterministic replay | PARTIAL | **PASS** |
| 3 | Result taxonomy | PARTIAL | **PASS** |
| 4 | Real discovery evidence | PARTIAL→MISSING | **PARTIAL** (API 503/404; escalations only) |
| 5 | Human handoff | PARTIAL | **PASS** |
| 6 | Safety | PARTIAL | **PASS** |
| 7 | Observability | PARTIAL | **PARTIAL** (no Playwright trace zip) |
| 8 | Heterogeneity / tenants | PARTIAL | **PASS** |
| 9 | Tier 3 (a)+(b)+keep (c) | PARTIAL | **PASS** |
| 10 | CoreServ hostile target | PARTIAL | **PASS** (seeded `/app/*` path) |

---

## 2. How to use (commands in order)

**(a) Setup**
```bash
cp .env.example .env   # GEMINI_API_KEY + GEMINI_MODEL=gemini-3.8-flash
npm install
npx playwright install chromium
npm run seed
```

**(b) Start CoreServ**
```bash
ENABLE_TEST_HARNESS=1 npm start
# → http://localhost:4000/login
```

**(c) Discovery** (needs healthy Gemini; may escalate on API errors)
```bash
npm run discover -- --memberId 12345 --username csr1 --password csr-pass --headless
```

**(d) Happy replay**
```bash
npm run replay -- --seeded --memberId 12345 --headless
# → success, savingsBalance "$4,321.09"
```

**(e) Error / business / fault scenarios**
```bash
npm run replay -- --seeded --memberId 99999 --headless
# → business_outcome MEMBER_NOT_FOUND

curl -X POST http://localhost:4000/__test/faults -H 'content-type: application/json' \
  -d '{"fault":"http500","route":"/app/accounts/inquiry","once":true,"session_sid":"*"}'
npm run replay -- --seeded --memberId 12345 --headless
# → hard_failure http_5xx
curl -X POST http://localhost:4000/__test/reset
```

**(f) Handoff as operator**
```bash
# When agent prints NEEDS_HUMAN / Escalated (runId=…):
npm run interventions
npm run claim -- --runId <id>
# Act in the SAME headful Playwright window (use --headless false for live handoff)
npm run resume -- --runId <id>
```

**(g) Tests**
```bash
npm test
npm run build
```

**(h) Stability + cross-tenant**
```bash
npm run stability -- --seeded --n 5 --memberId 12345
npm run replay -- --seeded --memberId 12345 --tenant harborview --headless
```

---

## 3. Requirements in plain language

**Discovery.** Gemini sees a flattened accessibility tree and must call `take_action` once per turn. The loop records decisions into a transcript, then `artifactBuilder` compiles a typed capability (no LLM in that compile step). Start URL defaults to `/login` for CoreServ.

**Artifact shape.** Schema 1.1 separates `schema_version` from capability version; steps carry ranked locators + rationale, `risk_class`, placeholders (`inputs.memberId`), optional known interstitials, preconditions, checkpoint, fingerprint, tenant overrides. Validated on load so bad JSON fails loud.

**Determinism.** Replay never imports the LLM client. Locators try primary→fallbacks; ambiguous matches fail (extract may take first). Waits are condition/timeout based. Checkpoint asserted after steps. Inputs validated first.

**Errors.** Declared outcomes (`assertOutcome` + detectors) → `business_outcome`. Transient session/busy → recover + maybe `recovered`. Crashes/5xx/allowlist/unresolved → `hard_failure` with evidence. Stuck with handoff → `needs_human`.

**Stuck detection.** Discovery: max steps, consecutive failures, repeated observation hash. Replay: unresolved/ambiguous locator; irreversible gate; optional handoff pause.

**Handoff.** Pause keeps the Playwright context open. Intervention stores URL, redacted params, screenshot/AX, live-session hint. Claim → HUMAN; resume → RESUMING → AUTOMATION; re-observe/re-resolve. Human navigations logged to `human-actions.jsonl`.

**Safety.** Allowlist at executor in discovery and replay. Irreversible names → draft until `approve`. Redaction on strings/objects before evidence write; screenshots not pixel-scrubbed (honest limit).

**Extend.** New surface = implement `SurfaceAdapter`. New tenant = `tenant_overrides` + fingerprint drift, not a tenant platform. Scale to many tenants is override packs + stability reports, not new infra.

---

## 4. Interview defense (10 hard questions)

| Q | Honest A | Proof |
|---|----------|-------|
| Does replay ever call Gemini? | No. Dedicated engine; unit test asserts no LLM import. | `src/core/replay/replayEngine.ts`, `tests/replayEngine.test.ts` |
| Why not CSS-first locators? | Hostile IDs churn; role/name + rationale, CSS last. | `artifactBuilder.ts`, seeded artifact |
| Is “no member” a failure? | No — `business_outcome` / `MEMBER_NOT_FOUND`. | `VERIFY.md`, replay not-found log |
| How do you stop automation+human racing? | Claim sets HUMAN; automation waits on resume. Thin lock via intervention status. | `interventionStore.ts` |
| Same browser on handoff? | Yes — context not closed while paused; headful window. | `discoveryAgent.ts` / `replayEngine.ts` escalate paths |
| Multi-tenant without infra? | Artifact `tenant_overrides` + `--tenant`; drift fingerprint. | `drift.ts`, VERIFY harborview |
| What if Gemini is down? | Escalate with reason; replay still works from seeded/approved artifacts. | VERIFY discovery logs; `llmClient.ts` retries |
| Allowlist only in the prompt? | No — executor `assertAllowedUrl/Action` both paths. | `allowlist.ts`, discovery + replay |
| Frames? | Adapter scrapes iframes; `/console` has 4 named frames. Seeded path uses top-level `/app/*` on purpose (thin). | `PlaywrightWebAdapter.ts`, VERIFY curl |
| Production-ready? | Demo-grade: file interventions, no remote co-browse, no screenshot DLP, discovery not E2E-verified that day. | `REPORT.md` cuts, `VERIFY.md` |

---

## 5. Known limitations / unverified

- **No successful Gemini `transcript.json`** on 2026-09-29 (model retirement + 503). Escalation evidence only.
- Seeded capability **does not drive the 4-frame console shell** end-to-end.
- **Handoff MFA/supervisor live demo** not fully walked in VERIFY (LLM-blocked discovery; claim/resume exercised via store tests + escalation payloads).
- No Playwright **trace zip**; screenshots **not** pixel-redacted.
- `TASKS.md` suite largely **aspirational** vs one seeded lookup artifact.
- CoreServ SQLite is a **mock bank**, not a real core.

---

**Phase 5 complete.**
