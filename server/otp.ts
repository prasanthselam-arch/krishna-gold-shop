import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { db } from "./db.ts";

export function hashOtp(salt: string, code: string): string {
  return crypto.createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

export function generateOtp(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

export type DeliveryResult =
  | { channel: "demo"; sent: false; reason: string }
  | { channel: "email" | "sms"; sent: true }
  | { channel: "email" | "sms"; sent: false; reason: string };

async function sendEmail(to: string, code: string): Promise<DeliveryResult> {
  const host = process.env.SMTP_HOST;
  if (!host) {
    return { channel: "email", sent: false, reason: "SMTP_HOST is not configured" };
  }
  try {
    const transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM || "Krishna Gold Shop <noreply@localhost>",
      to,
      subject: "Krishna Gold Shop — gold release OTP",
      text: `Your one-time verification code is ${code}. It expires in 5 minutes.`,
    });
    return { channel: "email", sent: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Email send failed";
    return { channel: "email", sent: false, reason };
  }
}

async function sendSms(to: string, code: string): Promise<DeliveryResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from) {
    return { channel: "sms", sent: false, reason: "Twilio is not fully configured" };
  }
  try {
    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const body = new URLSearchParams({
      To: to,
      From: from,
      Body: `Krishna Gold Shop OTP: ${code}. Valid 5 minutes.`,
    });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      return { channel: "sms", sent: false, reason: `Twilio rejected the message (${res.status}): ${text.slice(0, 180)}` };
    }
    return { channel: "sms", sent: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "SMS send failed";
    return { channel: "sms", sent: false, reason };
  }
}

export async function deliverOtp(opts: {
  email?: string;
  mobile?: string;
  code: string;
}): Promise<{ delivery: DeliveryResult; demoCode?: string }> {
  if (opts.email && process.env.SMTP_HOST) {
    const result = await sendEmail(opts.email, opts.code);
    if (result.sent) return { delivery: result };
    return { delivery: result, demoCode: opts.code };
  }
  if (opts.mobile && process.env.TWILIO_ACCOUNT_SID) {
    const result = await sendSms(opts.mobile, opts.code);
    if (result.sent) return { delivery: result };
    return { delivery: result, demoCode: opts.code };
  }
  return {
    delivery: {
      channel: "demo",
      sent: false,
      reason: "No SMS or email provider is configured. This is a DEMO OTP and was not sent.",
    },
    demoCode: opts.code,
  };
}

export function storeChallenge(pledgeId: number, code: string, delivery: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const code_hash = hashOtp(salt, code);
  const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const info = db
    .prepare(
      `INSERT INTO otp_challenges (pledge_id, code_hash, salt, expires_at, created_at, delivery)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(pledgeId, code_hash, salt, expires, new Date().toISOString(), delivery);
  return { id: Number(info.lastInsertRowid), expires_at: expires };
}

export function verifyChallenge(pledgeId: number, code: string): { ok: true } | { ok: false; error: string } {
  const row = db
    .prepare(
      `SELECT * FROM otp_challenges
       WHERE pledge_id = ? AND consumed_at IS NULL
       ORDER BY id DESC LIMIT 1`,
    )
    .get(pledgeId) as
    | {
        id: number;
        code_hash: string;
        salt: string;
        expires_at: string;
        attempts: number;
      }
    | undefined;

  if (!row) return { ok: false, error: "No active OTP. Generate a new one." };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, error: "OTP expired. Generate a new one." };
  }
  if (row.attempts >= 5) {
    return { ok: false, error: "Too many incorrect attempts. Generate a new OTP." };
  }

  const hash = hashOtp(row.salt, code.trim());
  if (hash !== row.code_hash) {
    db.prepare("UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ?").run(row.id);
    return { ok: false, error: "Incorrect OTP." };
  }

  db.prepare("UPDATE otp_challenges SET consumed_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    row.id,
  );
  return { ok: true };
}
