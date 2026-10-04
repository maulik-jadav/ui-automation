import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(process.cwd(), "data");
const DB_PATH = join(DATA_DIR, "coreserv.sqlite");

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}

export function initSchema(): void {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      display_name TEXT NOT NULL,
      force_password_change INTEGER DEFAULT 0,
      mfa_required INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      role TEXT NOT NULL,
      branch TEXT,
      workstation_id TEXT,
      tenant TEXT,
      csrf TEXT,
      last_seen INTEGER,
      drawer_open INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      first_name TEXT,
      last_name TEXT,
      ssn_last4 TEXT,
      ssn_full TEXT,
      dob TEXT,
      phone TEXT,
      email TEXT,
      address1 TEXT,
      address2 TEXT,
      city TEXT,
      state TEXT,
      zip TEXT,
      status TEXT,
      deceased INTEGER DEFAULT 0,
      fraud INTEGER DEFAULT 0,
      do_not_mail INTEGER DEFAULT 0,
      ofac_name INTEGER DEFAULT 0,
      minor INTEGER DEFAULT 0,
      custodian_name TEXT,
      branch TEXT,
      member_since TEXT,
      marital TEXT,
      employer TEXT,
      version INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL,
      product_code TEXT,
      product_name TEXT,
      nickname TEXT,
      status TEXT,
      current_bal REAL,
      available_bal REAL,
      pending_bal REAL,
      hold_bal REAL,
      ledger_bal REAL,
      interest_ytd REAL,
      last_statement TEXT,
      maturity_date TEXT,
      od_protection_acct TEXT,
      joint_owners TEXT,
      frozen INTEGER DEFAULT 0,
      dormant INTEGER DEFAULT 0,
      opened_at TEXT
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      posted_at TEXT,
      description TEXT,
      amount REAL,
      type TEXT,
      running_bal REAL,
      check_number TEXT,
      is_check INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS loans (
      id TEXT PRIMARY KEY,
      member_id TEXT,
      balance REAL,
      payment_due TEXT,
      escrow REAL,
      delinquency TEXT,
      payment_amount REAL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      member_id TEXT,
      account_id TEXT,
      last4 TEXT,
      status TEXT,
      travel_notice TEXT
    );

    CREATE TABLE IF NOT EXISTS holds (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      amount REAL,
      reason TEXT,
      expiry TEXT,
      requires_supervisor INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS stop_payments (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      check_start TEXT,
      check_end TEXT,
      fee_acked INTEGER,
      created_at TEXT,
      expires_at TEXT
    );

    CREATE TABLE IF NOT EXISTS approval_queue (
      id TEXT PRIMARY KEY,
      kind TEXT,
      payload TEXT,
      status TEXT,
      locked_by TEXT,
      created_by TEXT,
      created_at TEXT,
      expires_at TEXT
    );

    CREATE TABLE IF NOT EXISTS work_tasks (
      id TEXT PRIMARY KEY,
      title TEXT,
      assigned_to TEXT,
      status TEXT,
      notes TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT,
      username TEXT,
      workstation_id TEXT,
      action TEXT,
      payload_masked TEXT
    );

    CREATE TABLE IF NOT EXISTS faults (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_sid TEXT,
      fault_json TEXT
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS active_logins (
      username TEXT PRIMARY KEY,
      sid TEXT,
      since INTEGER
    );
  `);
}

export function wipeData(): void {
  const d = getDb();
  const tables = [
    "users",
    "sessions",
    "members",
    "accounts",
    "transactions",
    "loans",
    "cards",
    "holds",
    "stop_payments",
    "approval_queue",
    "work_tasks",
    "audit_log",
    "faults",
    "meta",
    "active_logins",
  ];
  for (const t of tables) {
    try {
      d.prepare(`DELETE FROM ${t}`).run();
    } catch {
      /* ignore */
    }
  }
}

export function audit(
  username: string,
  workstation: string,
  action: string,
  payload: unknown
): void {
  const masked = JSON.stringify(payload).replace(
    /\b\d{3}-\d{2}-\d{4}\b/g,
    "***-**-****"
  );
  getDb()
    .prepare(
      `INSERT INTO audit_log (ts, username, workstation_id, action, payload_masked)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(new Date().toISOString(), username, workstation, action, masked);
}
