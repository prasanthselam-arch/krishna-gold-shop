import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, dbPath } from "./db.ts";

const backupDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "backups");

export function backupNow(reason = "manual"): string {
  fs.mkdirSync(backupDir, { recursive: true });
  db.pragma("wal_checkpoint(PASSIVE)");
  const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\..+$/, "");
  const dest = path.join(backupDir, `shop-${stamp}-${reason}.db`);
  fs.copyFileSync(dbPath, dest);

  const files = fs
    .readdirSync(backupDir)
    .filter((f) => f.endsWith(".db"))
    .map((f) => ({ f, t: fs.statSync(path.join(backupDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const extra of files.slice(30)) {
    fs.unlinkSync(path.join(backupDir, extra.f));
  }
  return dest;
}

let lastBackup = 0;
export function maybeBackup(reason: string) {
  const now = Date.now();
  if (now - lastBackup < 5 * 60 * 1000) return;
  lastBackup = now;
  backupNow(reason);
}
