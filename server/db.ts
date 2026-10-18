import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const dataDir = path.join(root, "data");
export const dbPath = path.join(dataDir, "shop.db");

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(root, "backups"), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pledges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  additional_name TEXT NOT NULL DEFAULT '',
  mobile TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  pledge_date TEXT NOT NULL,
  principal REAL NOT NULL,
  interest_rate REAL NOT NULL,
  rate_period TEXT NOT NULL,
  interest_type TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  released_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gold_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pledge_id INTEGER NOT NULL REFERENCES pledges(id),
  name TEXT NOT NULL,
  weight_grams REAL NOT NULL,
  quantity INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pledge_id INTEGER NOT NULL REFERENCES pledges(id),
  amount REAL NOT NULL,
  interest_portion REAL NOT NULL,
  principal_portion REAL NOT NULL,
  balance_after REAL NOT NULL,
  received_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS otp_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pledge_id INTEGER NOT NULL REFERENCES pledges(id),
  code_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  delivery TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pledge_id INTEGER NOT NULL REFERENCES pledges(id),
  release_date TEXT NOT NULL,
  items_json TEXT NOT NULL,
  payment_details_json TEXT NOT NULL,
  otp_verified INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no TEXT NOT NULL UNIQUE,
  pledge_id INTEGER NOT NULL REFERENCES pledges(id),
  kind TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pledges_token ON pledges(token);
CREATE INDEX IF NOT EXISTS idx_pledges_name ON pledges(customer_name);
CREATE INDEX IF NOT EXISTS idx_pledges_status ON pledges(status);
CREATE INDEX IF NOT EXISTS idx_payments_pledge ON payments(pledge_id);
CREATE INDEX IF NOT EXISTS idx_items_pledge ON gold_items(pledge_id);
`);

function seed() {
  const username = process.env.SHOP_USERNAME || "owner";
  const password = process.env.SHOP_PASSWORD || "KrishnaGold@123";
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username) as
    | { id: number }
    | undefined;
  if (!existing) {
    db.prepare("INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)").run(
      username,
      bcrypt.hashSync(password, 12),
      new Date().toISOString(),
    );
  }

  const defaults: Record<string, string> = {
    shop_name: "KRISHNA GOLD SHOP",
    partial_month_policy: process.env.PARTIAL_MONTH_POLICY || "actual_days",
    timezone: "Asia/Kolkata",
    currency: "INR",
  };
  const insert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
  );
  for (const [k, v] of Object.entries(defaults)) insert.run(k, v);
}

seed();

export function getSetting(key: string): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? "";
}

export function setSetting(key: string, value: string) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

export function audit(
  userId: number | null,
  action: string,
  entityType: string,
  entityId: string | number | null,
  details: unknown = {},
) {
  db.prepare(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    userId,
    action,
    entityType,
    entityId == null ? null : String(entityId),
    JSON.stringify(details),
    new Date().toISOString(),
  );
}
