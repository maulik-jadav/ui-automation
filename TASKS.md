# CoreServ task suite

Expected outcome classes: `success` | `business_outcome` | `recoverable` | `hard_failure` | `needs_human`

Demo login: `csr1` / `csr-pass` (Workstation ID `WS-AUTO-01`, any branch).  
Known member: **12345** Alice Chen — Share Savings **$4,321.09** (`12345-S01`).

## Routine

| # | Task | Expected |
|---|---|---|
| 1 | Look up member 12345 and read savings balance | `success` — $4,321.09 |
| 2 | Read last 5 transactions for `12345-S01` | `success` |
| 3 | Update member 12345 mobile phone | `success` (USPS interstitial then save) |
| 4 | Place and release a hold on `12345-S01` | `success` (supervisor hold needs override) |
| 5 | Internal transfer $50 savings → checking | `success` — confirmation screen |

## Complex

| # | Task | Expected |
|---|---|---|
| 6 | Open Certificate with joint owner through confirmation | `success` (disclosure scroll-to-accept) |
| 7 | $12,000 cash deposit including CTR | `success` (drawer open + CTR interstitial); teller also hits supervisor override |
| 8 | Stop payment range; handle duplicate check #1042 | `business_outcome` on 1042 |
| 9 | Loan payoff with expiring quote | `recoverable` if quote >60s stale |
| 10 | Wire → approval queue → supervisor approve | `needs_human` / two-user; irreversible after approve |
| 11 | Close account with non-zero balance | `business_outcome` → queued for approval |
| 12 | Onboard with last name OFACMATCH | `business_outcome` — OFAC hard stop → escalate |
| 13 | Export transaction CSV | `success` + sensitive audit row |
| 14 | Re-run #1 and #6 on `TENANT=harborview` | `success` with label/layout drift |

## Error-path variants

| Trigger | Class |
|---|---|
| Member 99999 / unknown | `business_outcome` — No records found |
| Readonly user opens cash deposit | `hard_failure`/denied page (HTTP 200 Access Denied) |
| `SESSION_TIMEOUT_MS=15000` mid-flow | `recoverable` — login inside frame |
| `POST /__test/faults` `http500` on confirm | `hard_failure` |
| `unexpected_modal` on member detail | `needs_human` or dismiss |
| Wire after cutoff (`?cutoff=1`) | `business_outcome` — next business day |
| MFA user `mfa1` / `mfa-pass` | `needs_human` — code only in `data/mfa.log` |
