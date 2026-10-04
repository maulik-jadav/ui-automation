# Interview demo — step-by-step commands

Use **two terminals**. Leave Terminal A running. Run everything else in Terminal B.

**Talking line:** “Gemini discovers once; replay never calls an LLM. Business outcomes aren’t crashes. Stuck → human on the same browser.”

Credentials are in `.env` (`CORESERV_USER` / `CORESERV_PASS` / `GEMINI_API_KEY`). Do **not** pass `--password` on the CLI.

---

## 0. Prep (once)

```bash
cd ~/Desktop/ui-automation
# .env already has GEMINI_API_KEY, GEMINI_MODEL=gemini-3.6-flash, CORESERV_*
npm install
npx playwright install chromium
npm run seed
```

**Terminal A** (leave open):
```bash
cd ~/Desktop/ui-automation
ENABLE_TEST_HARNESS=1 npm start
```
Open browser: http://localhost:4000/login

**Terminal B** — all demos below.

Optional key check:
```bash
npx tsx scripts/ping-gemini.ts
```

---

## 1. Hostile UI (browser, ~2 min)

1. Go to http://localhost:4000/login  
2. Login: `csr1` / `csr-pass` → check terms → Login → Continue (maintenance)  
3. Show `/console` frames (top / nav / main / status)

**Say:** decoys, interstitials, frames, no test IDs.

---

## 2. Tests + “replay never uses Gemini” (~1 min)

```bash
npm test
npm run build
```

Point at: handoff test, redaction, “replay never imports LLM”.

---

## 3. Artifact schema (~2 min)

```bash
npm run seed-artifact
open artifacts/lookup_member_savings_balance-seeded-lookup.json
# also show write fixture:
open artifacts/open_share_certificate_to_confirm-seeded-open-account-draft.json
```

Scroll: `schema_version`, inputs/sensitivity, ranked locators + `rationale`, `risk_class`, `fingerprint`, `tenant_overrides`, `reviewStatus: draft` on write artifact.

---

## 4. Happy replay — seeded fixture (~1 min)

```bash
npm run replay -- --seeded --memberId 12345 --headless
```

**Expect:** `"status": "success"`, `"savingsBalance": "$4,321.09"`

Then show evidence:
```bash
ls -lt evidence/replay-* | head -5
# open newest result.json + screenshots/
```

---

## 5. Business outcome ≠ crash (~1 min)

```bash
npm run replay -- --seeded --memberId 99999 --headless
```

**Expect:** `"status": "business_outcome"`, `"code": "MEMBER_NOT_FOUND"`

---

## 6. Fault → hard_failure (~2 min)

```bash
curl -s -X POST http://localhost:4000/__test/clear-sessions
curl -s -X POST http://localhost:4000/__test/faults -H 'content-type: application/json' \
  -d '{"fault":"http500","route":"/app/accounts/inquiry","once":true,"session_sid":"*"}'

npm run replay -- --seeded --memberId 12345 --headless
```

**Expect:** `"hard_failure"`, `"error_class": "http_5xx"` + screenshot path

Cleanup:
```bash
curl -s -X POST http://localhost:4000/__test/reset
curl -s -X POST http://localhost:4000/__test/clear-sessions
```

---

## 7. Cross-tenant (~1 min)

```bash
npm run replay -- --seeded --memberId 12345 --tenant harborview --headless
```

**Expect:** success + `$4,321.09`  
**Say:** same artifact, overrides only — no multi-tenant infra.

---

## 8. Stability (~1 min)

```bash
npm run stability -- --seeded --n 3 --memberId 12345
```

**Expect:** `successRate: 1` → file under `evidence/stability/`

---

## 9. Safety — allowlist + redaction (~1 min)

```bash
npx tsx -e '
import { assertAllowedUrl, AllowlistViolation } from "./src/core/safety/allowlist.ts";
import { redactDeep } from "./src/core/safety/redaction.ts";
try { assertAllowedUrl("https://evil.example/"); } catch (e) {
  console.log("blocked:", e instanceof AllowlistViolation);
}
console.log(redactDeep({ password: "x", ssn: "123-45-6789", email: "a@b.co" }));
'
```

---

## 10. Irreversible write gate — draft → approve (~2 min)

```bash
# Blocked while draft:
npm run replay -- --seeded-write --memberId 12345 --headless
# Expect: needs_human — "requires approval before unattended replay"

npm run approve -- --artifact seeded-open-account-draft
# After approve, unattended replay is allowed (flow may still be thin past Confirm)
```

---

## 11. Live handoff — same browser (~3 min)

```bash
npm run demo-handoff
```

**Expect:** pause `NEEDS_HUMAN` → auto claim → operator acts via CDP → resume → `success`  
Show: `evidence/replay-*/human-actions.jsonl` and the headed Chromium window.

Manual alternative:
```bash
npm run discover -- --memberId 12345          # headed, no --headless
# when escalated:
npm run claim -- --runId <id>
# act in the open window
npm run resume -- --runId <id>
```

---

## 12. Discovery → artifact → replay (the chain) (~5–10 min)

```bash
# A) Fresh discovery (needs Gemini)
npm run discover -- --memberId 12345 --headless
# Note printed artifactPath + evidence/<runId>/transcript.json

# B) Or use the verified discovery run already in the repo:
open evidence/3bb6d11f/transcript.json
npm run replay -- --artifact 9ad5ae0b --memberId 12345 --headless
```

**Expect:** success + `$4,321.09`  
**Say:** “This is the discovered artifact, not the hand-seeded fixture.”

If Gemini is slow/503, show existing `transcript.json` + replay `9ad5ae0b`, then retry discover later.

---

## Suggested order on the day

| Order | Segment | Needs Gemini? |
|------|---------|----------------|
| 1 | Hostile UI | No |
| 2 | `npm test` | No |
| 3 | Artifact JSON | No |
| 4 | Seeded happy path | No |
| 5 | Member not found | No |
| 6 | HTTP 500 fault | No |
| 7 | Harborview | No |
| 8 | Stability | No |
| 9 | Allowlist/redaction | No |
| 10 | Draft write gate | No |
| 11 | `demo-handoff` | No |
| 12 | Discover + replay discovered | Yes (or show saved transcript) |

Do **1–11 first**; save discovery for last so API issues don’t kill the interview.
