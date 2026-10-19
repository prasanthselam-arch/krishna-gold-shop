import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
export const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(root, "backups"));
export const dbPath = path.join(dataDir, "shop.db");

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });

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
  interest_adjustment REAL NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pledge_id INTEGER NOT NULL REFERENCES pledges(id),
  release_date TEXT NOT NULL,
  items_json TEXT NOT NULL,
  payment_details_json TEXT NOT NULL,
  otp_verified INTEGER NOT NULL,
  returned_to TEXT NOT NULL DEFAULT '',
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

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pledge_id INTEGER NOT NULL REFERENCES pledges(id),
  kind TEXT NOT NULL,
  file TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pledges_token ON pledges(token);
CREATE INDEX IF NOT EXISTS idx_photos_pledge ON photos(pledge_id);
CREATE INDEX IF NOT EXISTS idx_pledges_name ON pledges(customer_name);
CREATE INDEX IF NOT EXISTS idx_pledges_status ON pledges(status);
CREATE INDEX IF NOT EXISTS idx_payments_pledge ON payments(pledge_id);
CREATE INDEX IF NOT EXISTS idx_items_pledge ON gold_items(pledge_id);
`);

export const photosDir = path.join(dataDir, "photos");
fs.mkdirSync(photosDir, { recursive: true });

export const DEFAULT_PASSWORD = "KrishnaGold@123";

function columnExists(table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === column);
}

function migrate() {
  if (!columnExists("users", "must_change_password")) {
    db.exec("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0");
  }
  if (!columnExists("pledges", "rate_unit")) {
    db.exec("ALTER TABLE pledges ADD COLUMN rate_unit TEXT NOT NULL DEFAULT 'percent'");
    db.exec("ALTER TABLE pledges ADD COLUMN rate_amount REAL");
  }
  // ₹ interest is per this many rupees of loan; 0 = a fixed amount on the whole loan (older registrations).
  if (!columnExists("pledges", "rate_basis")) {
    db.exec("ALTER TABLE pledges ADD COLUMN rate_basis INTEGER NOT NULL DEFAULT 0");
  }
  if (!columnExists("payments", "interest_adjustment")) {
    db.exec("ALTER TABLE payments ADD COLUMN interest_adjustment REAL NOT NULL DEFAULT 0");
  }
  // 'renewal' = balance moved into a new loan (no cash changed hands).
  if (!columnExists("payments", "method")) {
    db.exec("ALTER TABLE payments ADD COLUMN method TEXT NOT NULL DEFAULT 'cash'");
  }
  if (!columnExists("releases", "returned_to")) {
    db.exec("ALTER TABLE releases ADD COLUMN returned_to TEXT NOT NULL DEFAULT ''");
  }
  if (!columnExists("pledges", "renewed_from")) {
    db.exec("ALTER TABLE pledges ADD COLUMN renewed_from INTEGER REFERENCES pledges(id)");
    db.exec("ALTER TABLE pledges ADD COLUMN carried_amount REAL NOT NULL DEFAULT 0");
  }
  if (!columnExists("pledges", "partial_month_policy")) {
    db.exec("ALTER TABLE pledges ADD COLUMN partial_month_policy TEXT");
    db.prepare("UPDATE pledges SET partial_month_policy = ? WHERE partial_month_policy IS NULL").run(
      getSetting("partial_month_policy") || "actual_days",
    );
  }
}

function seed() {
  const defaults: Record<string, string> = {
    shop_name: "KRISHNA GOLD SHOP",
    partial_month_policy: process.env.PARTIAL_MONTH_POLICY || "actual_days",
    rupee_basis: "100",
    rate_slabs: "[]",
    default_rate: "2",
    default_rate_unit: "percent",
    default_rate_period: "monthly",
    default_interest_type: "simple",
    timezone: "Asia/Kolkata",
    currency: "INR",
    jwt_secret: crypto.randomBytes(48).toString("hex"),
  };
  const insert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
  );
  for (const [k, v] of Object.entries(defaults)) insert.run(k, v);

  const username = process.env.SHOP_USERNAME || "owner";
  const password = process.env.SHOP_PASSWORD || DEFAULT_PASSWORD;
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username) as
    | { id: number }
    | undefined;
  if (!existing) {
    db.prepare(
      "INSERT INTO users (username, password_hash, created_at, must_change_password) VALUES (?, ?, ?, ?)",
    ).run(username, bcrypt.hashSync(password, 12), new Date().toISOString(), password === DEFAULT_PASSWORD ? 1 : 0);
  }
}

migrate();
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
