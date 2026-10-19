import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, photosDir } from "./db.ts";
import type { PhotoKind, PhotoRow } from "./finance.ts";

const MAX_BYTES = 3 * 1024 * 1024;

const SIGNATURES: { ext: string; test: (b: Buffer) => boolean }[] = [
  { ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: "webp", test: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
];

export class PhotoError extends Error {}

/** Decodes a data URL and returns the image bytes plus a safe extension. */
export function decodePhoto(dataUrl: string, label: string): { bytes: Buffer; ext: string } {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new PhotoError(`${label}: unsupported image. Use the camera or a JPG/PNG photo.`);
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > MAX_BYTES) throw new PhotoError(`${label} is too large (max 3 MB).`);
  const sig = SIGNATURES.find((s) => s.test(bytes));
  if (!sig) throw new PhotoError(`${label}: file is not a valid image.`);
  return { bytes, ext: sig.ext };
}

export function savePhoto(pledgeId: number, kind: PhotoKind, photo: { bytes: Buffer; ext: string }) {
  const dir = path.join(photosDir, String(pledgeId));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(String(pledgeId), `${kind}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${photo.ext}`);
  fs.writeFileSync(path.join(photosDir, file), photo.bytes);
  db.prepare("INSERT INTO photos (pledge_id, kind, file, created_at) VALUES (?, ?, ?, ?)").run(
    pledgeId,
    kind,
    file,
    new Date().toISOString(),
  );
}

/** Copies the latest photo of `kind` from one pledge to another (used when a loan is renewed). */
export function copyPhoto(fromPledgeId: number, toPledgeId: number, kind: PhotoKind) {
  const row = db
    .prepare("SELECT id FROM photos WHERE pledge_id = ? AND kind = ? ORDER BY id DESC LIMIT 1")
    .get(fromPledgeId, kind) as { id: number } | undefined;
  const src = row ? photoPath(row.id) : null;
  if (!src) return;
  savePhoto(toPledgeId, kind, { bytes: fs.readFileSync(src), ext: path.extname(src).slice(1) || "jpg" });
}

export function photoPath(id: number): string | null {
  const row = db.prepare("SELECT * FROM photos WHERE id = ?").get(id) as PhotoRow | undefined;
  if (!row) return null;
  const full = path.resolve(photosDir, row.file);
  if (!full.startsWith(path.resolve(photosDir) + path.sep) || !fs.existsSync(full)) return null;
  return full;
}
