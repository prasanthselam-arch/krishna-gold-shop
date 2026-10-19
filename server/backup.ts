import fs from "node:fs";
import path from "node:path";
import { backupDir, db } from "./db.ts";

/** Uses SQLite's online backup API, which is safe while the shop is writing. */
export async function backupNow(reason = "manual"): Promise<string> {
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\..+$/, "");
  const dest = path.join(backupDir, `shop-${stamp}-${reason}.db`);
  await db.backup(dest);

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
  backupNow(reason).catch((err) => console.error("Backup failed:", err));
}
