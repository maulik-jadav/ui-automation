# VERIFY — results (updated after submission fixes)

**Date:** 2026-10-01  
**Target:** CoreServ `http://localhost:4000`  
**Rule:** observed outcomes only.

---

## Matrix

| Check | Result | Evidence |
|-------|--------|----------|
| Gemini ListModels + fallbacks | **PASS** | `npm run list-models`; `llmClient.ts` fallback chain |
| **Discovery → transcript** | **PASS** | `evidence/3bb6d11f/transcript.json` (model rotated to `gemini-3.6-flash`) |
| **Replay discovered artifact** | **PASS** | `artifacts/lookup_member_savings_balance-9ad5ae0b.json` → `evidence/verify/replay-discovered.log` (`$4,321.09`) |
| Seeded lookup fixture | **PASS** | labeled `--seeded` only |
| Business outcome 99999 | **PASS** | prior VERIFY |
| Harborview tenant | **PASS** | prior VERIFY |
| Stability | **PASS** | prior VERIFY |
| Fault http500 | **PASS** | prior VERIFY |
| **Handoff live** | **PASS** | `npm run demo-handoff` → claim/act/resume → success; `evidence/replay-b4316e09/`, `evidence/verify/handoff-demo.log` |
| **Write draft → needs_human** | **PASS** | `--seeded-write` → approval gate (`evidence/verify/replay-write-draft.log`) |
| Credentials CLI | **PASS** | env-only; refuses `--password` |
| No `waitForTimeout` in replay/surface | **PASS** | ripgrep clean |
| Unit tests | **PASS** | 17/17 (live smoke no longer skipped when server up) |
| Frame-driven `/console` E2E | **UNTESTED** | stated in REPORT §4 — seeded/discovered use top-level `/app/*` |

---

## Discovery chain (blocker closed)

1. `npm run list-models` — key can call `generateContent` on listed models.  
2. `npm run discover -- --memberId 12345 --headless` — bootstrap auth + Gemini navigates to inquiry + done with `$4,321.09`.  
3. Rebuild artifact from transcript → `9ad5ae0b`.  
4. `npm run replay -- --artifact 9ad5ae0b --memberId 12345 --headless` → **success**.

Auth bootstrap is recorded in the transcript with reasoning (hostile unlabeled login). Gemini drove post-login navigation and completion.

---

## Honest limits remaining

- Full frameset (`/console` iframes) E2E still untested.  
- Screenshot pixel redaction still not done.  
- Open-account write fixture gates on approve; full disclosure→confirm UI path is not fully automated end-to-end.
