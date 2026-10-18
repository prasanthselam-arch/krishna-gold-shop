import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { audit, db, getSetting, setSetting } from "./db.ts";
import { backupNow, maybeBackup } from "./backup.ts";
import { deliverOtp, generateOtp, storeChallenge, verifyChallenge } from "./otp.ts";
import { todayYmd, ymdStamp } from "./dates.ts";
import { calculateInterest, dateBreakdown, dueDateAfterMonths, repaymentChart } from "./interest.ts";
import { allocatePayment, hydrate, itemsFor, paymentsFor, policy, settle, type PledgeRow } from "./finance.ts";

dotenv.config();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8787);
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-change-me";
const COOKIE = "kgs_session";

type AuthUser = { id: number; username: string };

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);

function sign(user: AuthUser) {
  return jwt.sign(user, JWT_SECRET, { expiresIn: "12h" });
}

function setSession(res: express.Response, user: AuthUser) {
  res.cookie(COOKIE, sign(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    maxAge: 12 * 60 * 60 * 1000,
  });
}

function readUser(req: express.Request): AuthUser | null {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET) as AuthUser;
  } catch {
    return null;
  }
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = readUser(req);
  if (!user) {
    res.status(401).json({ error: "Please sign in." });
    return;
  }
  (req as express.Request & { user: AuthUser }).user = user;
  next();
}

const loginAttempts = new Map<string, { n: number; until: number }>();

function nextToken(): string {
  const stamp = ymdStamp();
  const prefix = `KGS-${stamp}-`;
  const row = db
    .prepare("SELECT token FROM pledges WHERE token LIKE ? ORDER BY token DESC LIMIT 1")
    .get(`${prefix}%`) as { token: string } | undefined;
  const seq = row ? Number(row.token.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

function nextReceipt(): string {
  const stamp = ymdStamp();
  const prefix = `RCP-${stamp}-`;
  const row = db
    .prepare("SELECT receipt_no FROM receipts WHERE receipt_no LIKE ? ORDER BY receipt_no DESC LIMIT 1")
    .get(`${prefix}%`) as { receipt_no: string } | undefined;
  const seq = row ? Number(row.receipt_no.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

const goldItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  weight_grams: z.number().positive().max(100000),
  quantity: z.number().int().positive().max(10000),
  notes: z.string().max(500).optional().default(""),
});

const pledgeSchema = z.object({
  customer_name: z.string().trim().min(2).max(120),
  additional_name: z.string().trim().max(120).optional().default(""),
  mobile: z.string().trim().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number"),
  email: z
    .union([z.literal(""), z.string().trim().email()])
    .optional()
    .default(""),
  pledge_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  principal: z.number().positive().max(1e9),
  interest_rate: z.number().positive().max(1000),
  rate_period: z.enum(["monthly", "annual"]),
  interest_type: z.enum(["simple", "compound"]),
  notes: z.string().max(2000).optional().default(""),
  gold: z.array(goldItemSchema).min(1),
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, shop: "KRISHNA GOLD SHOP" });
});

app.post("/api/login", (req, res) => {
  const ip = req.ip || "local";
  const rec = loginAttempts.get(ip);
  if (rec && rec.until > Date.now()) {
    res.status(429).json({ error: "Too many login attempts. Wait a minute." });
    return;
  }

  const parsed = z.object({ username: z.string().min(1), password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Username and password required." });
    return;
  }

  const user = db
    .prepare("SELECT id, username, password_hash FROM users WHERE username = ?")
    .get(parsed.data.username) as { id: number; username: string; password_hash: string } | undefined;

  if (!user || !bcrypt.compareSync(parsed.data.password, user.password_hash)) {
    const n = (rec?.n || 0) + 1;
    loginAttempts.set(ip, { n, until: n >= 8 ? Date.now() + 60_000 : 0 });
    res.status(401).json({ error: "Invalid username or password." });
    return;
  }

  loginAttempts.delete(ip);
  const auth = { id: user.id, username: user.username };
  setSession(res, auth);
  audit(user.id, "login", "user", user.id);
  res.json({ user: auth });
});

app.post("/api/logout", (req, res) => {
  const user = readUser(req);
  res.clearCookie(COOKIE);
  if (user) audit(user.id, "logout", "user", user.id);
  res.json({ ok: true });
});

app.get("/api/me", requireAuth, (req, res) => {
  const user = (req as express.Request & { user: AuthUser }).user;
  res.json({
    user,
    shop: getSetting("shop_name") || "KRISHNA GOLD SHOP",
    settings: {
      partial_month_policy: policy(),
      timezone: "Asia/Kolkata",
      currency: "INR",
    },
  });
});

app.post("/api/change-password", requireAuth, (req, res) => {
  const user = (req as express.Request & { user: AuthUser }).user;
  const parsed = z
    .object({ current: z.string().min(1), next: z.string().min(8).max(72) })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "New password must be at least 8 characters." });
    return;
  }
  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id) as {
    password_hash: string;
  };
  if (!bcrypt.compareSync(parsed.data.current, row.password_hash)) {
    res.status(400).json({ error: "Current password is incorrect." });
    return;
  }
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    bcrypt.hashSync(parsed.data.next, 12),
    user.id,
  );
  audit(user.id, "change_password", "user", user.id);
  res.json({ ok: true });
});

app.put("/api/settings", requireAuth, (req, res) => {
  const user = (req as express.Request & { user: AuthUser }).user;
  const parsed = z
    .object({
      partial_month_policy: z.enum(["actual_days", "thirty_day_month", "round_up_month"]),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid settings." });
    return;
  }
  setSetting("partial_month_policy", parsed.data.partial_month_policy);
  audit(user.id, "update_settings", "settings", "partial_month_policy", parsed.data);
  res.json({ partial_month_policy: parsed.data.partial_month_policy });
});

app.get("/api/token/preview", requireAuth, (_req, res) => {
  res.json({ token: nextToken() });
});

app.post("/api/pledges", requireAuth, (req, res) => {
  const user = (req as express.Request & { user: AuthUser }).user;
  const parsed = pledgeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid pledge data." });
    return;
  }
  const d = parsed.data;
  const token = nextToken();
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO pledges (
          token, customer_name, additional_name, mobile, email, pledge_date,
          principal, interest_rate, rate_period, interest_type, notes, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
      )
      .run(
        token,
        d.customer_name,
        d.additional_name,
        d.mobile,
        d.email || "",
        d.pledge_date,
        d.principal,
        d.interest_rate,
        d.rate_period,
        d.interest_type,
        d.notes || "",
        now,
        now,
      );
    const pledgeId = Number(info.lastInsertRowid);
    const insItem = db.prepare(
      "INSERT INTO gold_items (pledge_id, name, weight_grams, quantity, notes) VALUES (?, ?, ?, ?, ?)",
    );
    for (const g of d.gold) {
      insItem.run(pledgeId, g.name, g.weight_grams, g.quantity, g.notes || "");
    }
    return pledgeId;
  });

  const pledgeId = tx();
  audit(user.id, "create_pledge", "pledge", token, { token, principal: d.principal });
  maybeBackup("pledge");
  const pledge = db.prepare("SELECT * FROM pledges WHERE id = ?").get(pledgeId) as PledgeRow;
  res.status(201).json(hydrate(pledge));
});

app.get("/api/pledges/:token", requireAuth, (req, res) => {
  const pledge = db.prepare("SELECT * FROM pledges WHERE token = ?").get(req.params.token.toUpperCase()) as
    | PledgeRow
    | undefined;
  if (!pledge) {
    res.status(404).json({ error: "Token not found." });
    return;
  }
  res.json(hydrate(pledge));
});

app.post("/api/pledges/:token/payments", requireAuth, (req, res) => {
  const user = (req as express.Request & { user: AuthUser }).user;
  const parsed = z
    .object({
      amount: z.number().positive().max(1e9),
      notes: z.string().max(500).optional().default(""),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid payment amount." });
    return;
  }

  const pledge = db.prepare("SELECT * FROM pledges WHERE token = ?").get(req.params.token.toUpperCase()) as
    | PledgeRow
    | undefined;
  if (!pledge) {
    res.status(404).json({ error: "Token not found." });
    return;
  }
  if (pledge.status !== "ACTIVE") {
    res.status(400).json({ error: "This pledge is already released. Payments are closed." });
    return;
  }

  const alloc = allocatePayment(pledge, parsed.data.amount);
  if (alloc.pay <= 0) {
    res.status(400).json({ error: "Nothing is outstanding on this pledge." });
    return;
  }

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO payments (pledge_id, amount, interest_portion, principal_portion, balance_after, received_at, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    pledge.id,
    alloc.pay,
    alloc.interestPortion,
    alloc.principalPortion,
    alloc.outstandingAfter,
    now,
    parsed.data.notes || "",
  );
  db.prepare("UPDATE pledges SET updated_at = ? WHERE id = ?").run(now, pledge.id);
  audit(user.id, "record_payment", "pledge", pledge.token, {
    amount: alloc.pay,
    interest: alloc.interestPortion,
    principal: alloc.principalPortion,
  });
  maybeBackup("payment");
  const fresh = db.prepare("SELECT * FROM pledges WHERE id = ?").get(pledge.id) as PledgeRow;
  res.json({
    applied: alloc.pay,
    interest_portion: alloc.interestPortion,
    principal_portion: alloc.principalPortion,
    remaining_balance: alloc.outstandingAfter,
    overpay_ignored: moneySafe(parsed.data.amount - alloc.pay),
    pledge: hydrate(fresh),
  });
});

function moneySafe(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

app.post("/api/pledges/:token/otp", requireAuth, async (req, res) => {
  const user = (req as express.Request & { user: AuthUser }).user;
  const pledge = db.prepare("SELECT * FROM pledges WHERE token = ?").get(req.params.token.toUpperCase()) as
    | PledgeRow
    | undefined;
  if (!pledge) {
    res.status(404).json({ error: "Token not found." });
    return;
  }
  if (pledge.status !== "ACTIVE") {
    res.status(400).json({ error: "Already released." });
    return;
  }
  const fin = settle(pledge);
  if (!fin.settled) {
    res.status(400).json({
      error: "Gold cannot be released until the outstanding balance is fully paid.",
      outstanding: fin.outstanding,
    });
    return;
  }

  const code = generateOtp();
  const delivered = await deliverOtp({ email: pledge.email, mobile: pledge.mobile, code });
  const deliveryLabel = delivered.delivery.sent
    ? delivered.delivery.channel
    : delivered.delivery.channel === "demo"
      ? "demo"
      : `failed:${delivered.delivery.channel}`;
  storeChallenge(pledge.id, code, deliveryLabel);
  audit(user.id, "otp_requested", "pledge", pledge.token, {
    sent: delivered.delivery.sent,
    channel: delivered.delivery.channel,
  });

  const sent = delivered.delivery.sent === true;
  res.json({
    sent,
    channel: delivered.delivery.channel,
    message: sent
      ? `OTP sent via ${delivered.delivery.channel}.`
      : delivered.delivery.reason,
    demo: !sent,
    demoOtp: !sent ? delivered.demoCode : undefined,
    expiresInSeconds: 300,
  });
});

app.post("/api/pledges/:token/release", requireAuth, (req, res) => {
  const user = (req as express.Request & { user: AuthUser }).user;
  const parsed = z.object({ otp: z.string().trim().min(4).max(8) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter the OTP." });
    return;
  }

  const pledge = db.prepare("SELECT * FROM pledges WHERE token = ?").get(req.params.token.toUpperCase()) as
    | PledgeRow
    | undefined;
  if (!pledge) {
    res.status(404).json({ error: "Token not found." });
    return;
  }
  if (pledge.status !== "ACTIVE") {
    res.status(400).json({ error: "Already released." });
    return;
  }

  const fin = settle(pledge);
  if (!fin.settled) {
    res.status(400).json({
      error: "Partial payment cannot release gold. Outstanding balance must be zero.",
      outstanding: fin.outstanding,
    });
    return;
  }

  const check = verifyChallenge(pledge.id, parsed.data.otp);
  if (!check.ok) {
    res.status(400).json({ error: check.error });
    return;
  }

  const now = new Date().toISOString();
  const releaseDate = todayYmd();
  const items = itemsFor(pledge.id);
  const pays = paymentsFor(pledge.id);

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO releases (pledge_id, release_date, items_json, payment_details_json, otp_verified, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`,
    ).run(pledge.id, releaseDate, JSON.stringify(items), JSON.stringify({ finance: fin, payments: pays }), now);
    db.prepare("UPDATE pledges SET status = 'RELEASED', released_at = ?, updated_at = ? WHERE id = ?").run(
      now,
      now,
      pledge.id,
    );
  });
  tx();
  audit(user.id, "release_gold", "pledge", pledge.token, { otp_verified: true, release_date: releaseDate });
  maybeBackup("release");
  const fresh = db.prepare("SELECT * FROM pledges WHERE id = ?").get(pledge.id) as PledgeRow;
  res.json(hydrate(fresh));
});

app.post("/api/receipts", requireAuth, (req, res) => {
  const user = (req as express.Request & { user: AuthUser }).user;
  const parsed = z
    .object({ token: z.string().min(1), kind: z.enum(["pledge", "payment", "release"]).default("pledge") })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Token required." });
    return;
  }
  const pledge = db.prepare("SELECT * FROM pledges WHERE token = ?").get(parsed.data.token.toUpperCase()) as
    | PledgeRow
    | undefined;
  if (!pledge) {
    res.status(404).json({ error: "Token not found." });
    return;
  }
  const full = hydrate(pledge);
  const chart = repaymentChart(
    pledge.principal,
    pledge.interest_rate,
    pledge.rate_period,
    pledge.interest_type,
    pledge.pledge_date,
    policy(),
  );
  const receipt_no = nextReceipt();
  const snapshot = {
    shop: "KRISHNA GOLD SHOP",
    receipt_no,
    kind: parsed.data.kind,
    created_at: new Date().toISOString(),
    pledge: full,
    chart,
    policy: policy(),
  };
  db.prepare(
    "INSERT INTO receipts (receipt_no, pledge_id, kind, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(receipt_no, pledge.id, parsed.data.kind, JSON.stringify(snapshot), snapshot.created_at);
  audit(user.id, "issue_receipt", "receipt", receipt_no, { token: pledge.token, kind: parsed.data.kind });
  res.json(snapshot);
});

app.post("/api/calc/interest", requireAuth, (req, res) => {
  const parsed = z
    .object({
      principal: z.number().nonnegative(),
      ratePercent: z.number().nonnegative(),
      ratePeriod: z.enum(["monthly", "annual"]),
      interestType: z.enum(["simple", "compound"]),
      startDate: z.string(),
      endDate: z.string(),
      partialMonthPolicy: z.enum(["actual_days", "thirty_day_month", "round_up_month"]).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid calculator input." });
    return;
  }
  res.json(
    calculateInterest({
      ...parsed.data,
      partialMonthPolicy: parsed.data.partialMonthPolicy || policy(),
    }),
  );
});

app.post("/api/calc/dates", requireAuth, (req, res) => {
  const parsed = z
    .object({
      startDate: z.string(),
      endDate: z.string(),
      addMonths: z.number().int().min(1).max(12).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid dates." });
    return;
  }
  const br = dateBreakdown(parsed.data.startDate, parsed.data.endDate);
  res.json({
    ...br,
    dueDate: parsed.data.addMonths
      ? dueDateAfterMonths(parsed.data.startDate, parsed.data.addMonths)
      : dueDateAfterMonths(parsed.data.startDate, 1),
    dueDates: Array.from({ length: 12 }, (_, i) => ({
      months: i + 1,
      date: dueDateAfterMonths(parsed.data.startDate, i + 1),
    })),
  });
});

app.get("/api/summary", requireAuth, (_req, res) => {
  const asOf = todayYmd();
  const pledges = db.prepare("SELECT * FROM pledges").all() as PledgeRow[];
  let active = 0;
  let released = 0;
  let items = 0;
  let weight = 0;
  let principalOut = 0;
  let accrued = 0;
  let expected = 0;
  let pending = 0;
  let payments = 0;

  const paySum = db.prepare("SELECT COALESCE(SUM(amount), 0) as t FROM payments").get() as { t: number };
  payments = moneySafe(paySum.t);

  for (const p of pledges) {
    const gold = itemsFor(p.id);
    if (p.status === "RELEASED") {
      released += 1;
      continue;
    }
    active += 1;
    items += gold.reduce((s, g) => s + g.quantity, 0);
    weight += gold.reduce((s, g) => s + g.weight_grams * g.quantity, 0);
    const fin = settle(p, asOf);
    principalOut += fin.outstandingPrincipal;
    accrued += fin.unpaidInterest;
    expected += fin.outstanding;
    pending += fin.outstanding;
  }

  res.json({
    asOf,
    active,
    released,
    items,
    weight: moneySafe(weight),
    principalOutstanding: moneySafe(principalOut),
    accruedInterest: moneySafe(accrued),
    expectedCollection: moneySafe(expected),
    paymentsReceived: payments,
    amountPending: moneySafe(pending),
  });
});

app.get("/api/history", requireAuth, (req, res) => {
  const q = String(req.query.q || "").trim();
  const asOf = todayYmd();
  let pledges: PledgeRow[];
  if (q) {
    const like = `%${q}%`;
    pledges = db
      .prepare(
        `SELECT * FROM pledges
         WHERE token LIKE ? OR customer_name LIKE ? OR mobile LIKE ?
         ORDER BY id DESC LIMIT 200`,
      )
      .all(like, like, like) as PledgeRow[];
  } else {
    pledges = db.prepare("SELECT * FROM pledges ORDER BY id DESC LIMIT 200").all() as PledgeRow[];
  }

  const rows = pledges.map((p) => {
    const fin = settle(p, asOf);
    return {
      token: p.token,
      customer_name: p.customer_name,
      pledge_date: p.pledge_date,
      principal: p.principal,
      payments: fin.totalPaid,
      interest: p.status === "RELEASED" ? fin.interestPaid : fin.calc.interest,
      balance: p.status === "RELEASED" ? 0 : fin.outstanding,
      status: p.status,
    };
  });
  res.json(rows);
});

app.post("/api/backup", requireAuth, (req, res) => {
  const user = (req as express.Request & { user: AuthUser }).user;
  const dest = backupNow("manual");
  audit(user.id, "backup", "database", path.basename(dest));
  res.json({ file: path.basename(dest) });
});

const dist = path.join(root, "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(dist, "index.html"));
  });
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Server error. Check the terminal log." });
});

app.listen(PORT, () => {
  console.log(`Krishna Gold Shop API http://127.0.0.1:${PORT}`);
  backupNow("startup");
});
