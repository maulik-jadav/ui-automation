/**
 * Deterministic seed — same HOSTILE_SEED => same data.
 */
import { createHash, randomBytes } from "node:crypto";
import { getDb, initSchema, wipeData, closeDb } from "../db/store.js";

const SEED = process.env.HOSTILE_SEED ?? "memberbank-v1";

function rng(i: number): number {
  const h = createHash("sha256").update(`${SEED}:n:${i}`).digest();
  return h.readUInt32BE(0) / 0xffffffff;
}

function pick<T>(arr: T[], i: number): T {
  return arr[Math.floor(rng(i) * arr.length) % arr.length];
}

const FIRST = [
  "James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda",
  "David", "Elizabeth", "William", "Barbara", "Richard", "Susan", "Joseph", "Jessica",
  "Thomas", "Sarah", "Charles", "Karen", "Alice", "Bob", "Carla", "Diego", "Elena",
];
const LAST = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
  "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson",
  "Chen", "Nguyen", "Patel", "Kim", "Lee", "OFACMATCH", "Diaz",
];
const STREETS = ["Main St", "Oak Ave", "Pine Rd", "Cedar Ln", "Maple Dr", "2nd St"];
const CITIES = [
  { city: "Tempe", state: "AZ", zip: "85281" },
  { city: "Mesa", state: "AZ", zip: "85201" },
  { city: "Phoenix", state: "AZ", zip: "85004" },
  { city: "Tucson", state: "AZ", zip: "85701" },
];

const PRODUCTS = [
  { code: "S01", name: "Share Savings" },
  { code: "D01", name: "Share Draft/Checking" },
  { code: "M01", name: "Money Market" },
  { code: "C01", name: "Certificate" },
  { code: "I01", name: "IRA" },
  { code: "Y01", name: "Youth Savings" },
];

function daysAgo(n: number): string {
  const d = new Date("2026-09-15T12:00:00Z");
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function memberId(n: number): string {
  return String(100000 + n);
}

export function runSeed(): void {
  initSchema();
  wipeData();
  const db = getDb();

  const users = [
    ["teller1", "teller-pass", "teller", "Tina Teller", 0, 0],
    ["csr1", "csr-pass", "csr", "Casey CSR", 0, 0],
    ["supervisor1", "sup-pass", "supervisor", "Sam Supervisor", 0, 0],
    ["admin1", "admin-pass", "admin", "Ada Admin", 0, 0],
    ["readonly1", "ro-pass", "readonly", "Rita Readonly", 0, 0],
    ["forcechange1", "temp-pass", "csr", "Frank ForceChange", 1, 0],
    ["mfa1", "mfa-pass", "teller", "Mia MFA", 0, 1],
  ] as const;

  const ui = db.prepare(
    `INSERT INTO users (username, password, role, display_name, force_password_change, mfa_required)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const u of users) ui.run(...u);

  const insMem = db.prepare(`INSERT INTO members (
    id, first_name, last_name, ssn_last4, ssn_full, dob, phone, email,
    address1, address2, city, state, zip, status, deceased, fraud, do_not_mail,
    ofac_name, minor, custodian_name, branch, member_since, marital, employer, version
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  const insAcct = db.prepare(`INSERT INTO accounts (
    id, member_id, product_code, product_name, nickname, status,
    current_bal, available_bal, pending_bal, hold_bal, ledger_bal, interest_ytd,
    last_statement, maturity_date, od_protection_acct, joint_owners, frozen, dormant, opened_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  const insTxn = db.prepare(`INSERT INTO transactions (
    id, account_id, posted_at, description, amount, type, running_bal, check_number, is_check
  ) VALUES (?,?,?,?,?,?,?,?,?)`);

  const insLoan = db.prepare(
    `INSERT INTO loans (id, member_id, balance, payment_due, escrow, delinquency, payment_amount) VALUES (?,?,?,?,?,?,?)`
  );
  const insCard = db.prepare(
    `INSERT INTO cards (id, member_id, account_id, last4, status, travel_notice) VALUES (?,?,?,?,?,?)`
  );
  const insHold = db.prepare(
    `INSERT INTO holds (id, account_id, amount, reason, expiry, requires_supervisor, active, created_at) VALUES (?,?,?,?,?,?,?,?)`
  );
  const insQueue = db.prepare(
    `INSERT INTO approval_queue (id, kind, payload, status, locked_by, created_by, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)`
  );
  const insTask = db.prepare(
    `INSERT INTO work_tasks (id, title, assigned_to, status, notes, updated_at) VALUES (?,?,?,?,?,?)`
  );

  // Fixed known member 12345
  insMem.run(
    "12345",
    "Alice",
    "Chen",
    "1234",
    "900-11-1234",
    "1988-04-12",
    "480-555-0101",
    "alice.chen@example.test",
    "100 Desert Bloom Rd",
    "",
    "Tempe",
    "AZ",
    "85281",
    "active",
    0,
    0,
    0,
    0,
    0,
    null,
    "Tempe-01",
    "2014-03-01",
    "married",
    "Apex Systems",
    1
  );
  insAcct.run(
    "12345-S01",
    "12345",
    "S01",
    "Share Savings",
    "Primary Savings",
    "open",
    4321.09,
    4321.09,
    0,
    0,
    4321.09,
    18.4,
    daysAgo(12),
    null,
    "12345-D01",
    null,
    0,
    0,
    "2014-03-01"
  );
  insAcct.run(
    "12345-D01",
    "12345",
    "D01",
    "Share Draft/Checking",
    "Everyday Checking",
    "open",
    1185.5,
    1100.0,
    85.5,
    0,
    1185.5,
    0.12,
    daysAgo(12),
    null,
    null,
    null,
    0,
    0,
    "2014-03-01"
  );

  let bal = 4321.09;
  for (let t = 0; t < 80; t++) {
    const amt = Math.round((rng(9000 + t) * 400 - 150) * 100) / 100;
    bal = Math.round((bal - (amt > 0 && t % 3 === 0 ? amt : -Math.abs(amt) * 0.3)) * 100) / 100;
    const isCheck = t % 17 === 0;
    insTxn.run(
      `TXN-12345-${t}`,
      "12345-S01",
      `${daysAgo(t + 1)}T10:00:00Z`,
      isCheck ? `Check #${1000 + t}` : pick(["POS Purchase", "ACH Credit", "ATM Withdrawal", "Payroll Deposit", "Transfer"], t),
      Math.abs(amt) || 12.5,
      amt >= 0 ? "debit" : "credit",
      bal,
      isCheck ? String(1000 + t) : null,
      isCheck ? 1 : 0
    );
  }

  // ~200 members
  for (let i = 1; i <= 200; i++) {
    const id = memberId(i);
    if (id === "12345") continue;
    const first = pick(FIRST, i);
    const last =
      i <= 55
        ? "Smith" // collision cluster for "more than 50 matches"
        : pick(LAST, i * 3);
    const loc = pick(CITIES, i);
    const ofac = last === "OFACMATCH" || i === 77 ? 1 : 0;
    const deceased = i === 88 ? 1 : 0;
    const fraud = i === 99 ? 1 : 0;
    const minor = i === 66 ? 1 : 0;
    const ssnLast = String(1000 + (i % 9000)).slice(-4);
    insMem.run(
      id,
      first,
      last,
      ssnLast,
      `900-${String(10 + (i % 89)).padStart(2, "0")}-${ssnLast}`,
      daysAgo(8000 + i),
      `480-555-${String(1000 + i).slice(-4)}`,
      `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.test`,
      `${100 + i} ${pick(STREETS, i)}`,
      "",
      loc.city,
      loc.state,
      loc.zip,
      deceased ? "deceased" : fraud ? "restricted" : "active",
      deceased,
      fraud,
      i % 40 === 0 ? 1 : 0,
      ofac,
      minor,
      minor ? "Jordan Custodian" : null,
      pick(["Tempe-01", "Mesa-02", "Phoenix-HQ"], i),
      daysAgo(365 * (1 + (i % 12))),
      pick(["single", "married", "divorced"], i),
      pick(["Acme Corp", "Local Hospital", "Self-Employed", "State University"], i),
      1
    );

    const nAccts = 1 + Math.floor(rng(i) * 5);
    for (let a = 0; a < nAccts; a++) {
      const prod = PRODUCTS[a % PRODUCTS.length];
      const acctId = `${id}-${prod.code}`;
      const cur = Math.round(rng(i * 100 + a) * 8000 * 100) / 100;
      const frozen = i === 42 && a === 0 ? 1 : 0;
      const dormant = i === 50 && a === 0 ? 1 : 0;
      const maturingToday = prod.code === "C01" && i === 33;
      insAcct.run(
        acctId,
        id,
        prod.code,
        prod.name,
        null,
        frozen ? "frozen" : "open",
        cur,
        cur * 0.95,
        cur * 0.05,
        0,
        cur,
        Math.round(rng(i + a) * 40 * 100) / 100,
        daysAgo(10 + a),
        maturingToday ? daysAgo(0) : prod.code === "C01" ? daysAgo(-180) : null,
        null,
        i === 70 && a === 0 ? JSON.stringify(["Joint Owner Sample"]) : null,
        frozen,
        dormant,
        daysAgo(400 + a)
      );

      const nTxn = 50 + Math.floor(rng(i * 7 + a) * 250);
      let run = cur;
      for (let t = 0; t < Math.min(nTxn, 120); t++) {
        const amt = Math.round((10 + rng(i * 1000 + a * 50 + t) * 500) * 100) / 100;
        const debit = rng(i + t) > 0.45;
        run = Math.round((run + (debit ? -amt : amt)) * 100) / 100;
        const isCheck = t % 23 === 0;
        insTxn.run(
          `TXN-${acctId}-${t}`,
          acctId,
          `${daysAgo(t + 1)}T${String(9 + (t % 8)).padStart(2, "0")}:00:00Z`,
          isCheck ? `Check #${1040 + (t % 20)}` : pick(["POS", "ACH", "ATM", "Deposit", "Fee"], t + i),
          amt,
          debit ? "debit" : "credit",
          run,
          isCheck ? String(1040 + (t % 20)) : null,
          isCheck ? 1 : 0
        );
      }
    }

    if (rng(i) > 0.7) {
      insLoan.run(
        `LN-${id}`,
        id,
        Math.round(rng(i * 9) * 25000 * 100) / 100,
        daysAgo(-(i % 28)),
        Math.round(rng(i) * 200 * 100) / 100,
        i === 110 ? "30_days" : "current",
        350 + (i % 100)
      );
    }
    if (rng(i + 1) > 0.6) {
      insCard.run(
        `CD-${id}`,
        id,
        `${id}-D01`,
        String(4000 + (i % 5999)).slice(-4),
        i === 120 ? "blocked" : "active",
        null
      );
    }
  }

  // Special holds / stops / queue
  insHold.run("HLD-1", "12345-S01", 50, "Card Dispute", daysAgo(-30), 0, 1, daysAgo(5));
  insHold.run("HLD-2", "12345-D01", 200, "Suspected Fraud", daysAgo(-10), 1, 1, daysAgo(2));

  insQueue.run(
    "AQ-WIRE-1",
    "wire",
    JSON.stringify({
      amount: 5000,
      beneficiary: "Acme Vendors LLC",
      aba: "122400724",
      memberId: "12345",
    }),
    "pending",
    "supervisor2",
    "csr1",
    daysAgo(1),
    daysAgo(-7)
  );
  insQueue.run(
    "AQ-CLOSE-1",
    "account_close",
    JSON.stringify({ accountId: "100042-S01", reason: "Member request" }),
    "pending",
    null,
    "csr1",
    daysAgo(0),
    daysAgo(-3)
  );

  for (let t = 0; t < 12; t++) {
    insTask.run(
      `TASK-${t}`,
      pick(["Call member", "Review docs", "Follow up hold", "KYC refresh"], t),
      pick(["csr1", "teller1", "supervisor1"], t),
      t % 3 === 0 ? "done" : "open",
      "",
      new Date().toISOString()
    );
  }

  db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?)`).run(
    "seeded_at",
    new Date().toISOString()
  );
  db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?)`).run("seed", SEED);

  console.log(`Seeded CoreServ DB at data/coreserv.sqlite (seed=${SEED})`);
  console.log(`  users: ${users.length}, members: ~201, special: 12345 savings $4,321.09`);
  console.log(`  MFA demo user mfa1 — codes written to data/mfa.log on challenge`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("seed.ts")) {
  runSeed();
  closeDb();
}
