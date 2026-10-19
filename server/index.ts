import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { DEFAULT_PASSWORD, audit, db, getSetting, setSetting } from "./db.ts";
import { backupNow, maybeBackup } from "./backup.ts";
import { deliverOtp, generateOtp, storeChallenge, verifyChallenge } from "./otp.ts";
import { diffDays, isValidYmd, todayYmd, ymdStamp } from "./dates.ts";
import { calculateInterest, dateBreakdown, dueDateAfterMonths, repaymentChart } from "./interest.ts";
import {
  allocatePayment,
  hydrate,
  itemsFor,
  paymentsFor,
  pledgePolicy,
  policy,
  settle,
  type PledgeRow,
} from "./finance.ts";
import { PhotoError, decodePhoto, photoPath, savePhoto } from "./photos.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8787);
const JWT_SECRET = process.env.JWT_SECRET || getSetting("jwt_secret");
const COOKIE = "kgs_session";
const SHOP = () => getSetting("shop_name") || "KRISHNA GOLD SHOP";

type AuthUser = { id: number; username: string };
type AuthedRequest = express.Request & { user: AuthUser };

const app = express();
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  next();
});
app.use(express.json({ limit: "12mb" }));
app.use(cookieParser());

function setSession(res: express.Response, user: AuthUser) {
  res.cookie(COOKIE, jwt.sign(user, JWT_SECRET, { expiresIn: "12h" }), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.COOKIE_SECURE === "true",
    maxAge: 12 * 60 * 60 * 1000,
  });
}

function readUser(req: express.Request): AuthUser | null {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
    const exists = db.prepare("SELECT id FROM users WHERE id = ?").get(payload.id);
    return exists ? { id: payload.id, username: payload.username } : null;
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
  (req as AuthedRequest).user = user;
  next();
}

const userOf = (req: express.Request) => (req as AuthedRequest).user;

function money(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function firstIssue(err: z.ZodError, fallback: string): string {
  return err.issues[0]?.message || fallback;
}

function findPledge(token: string): PledgeRow | undefined {
  return db.prepare("SELECT * FROM pledges WHERE token = ?").get(token.trim().toUpperCase()) as
    | PledgeRow
    | undefined;
}

function nextSequence(table: "pledges" | "receipts", column: "token" | "receipt_no", prefix: string): string {
  const full = `${prefix}-${ymdStamp()}-`;
  const row = db
    .prepare(`SELECT ${column} AS v FROM ${table} WHERE ${column} LIKE ? ORDER BY length(${column}) DESC, ${column} DESC LIMIT 1`)
    .get(`${full}%`) as { v: string } | undefined;
  const seq = row ? Number(row.v.slice(full.length)) + 1 : 1;
  return `${full}${String(seq).padStart(4, "0")}`;
}

const nextToken = () => nextSequence("pledges", "token", "KGS");
const nextReceipt = () => nextSequence("receipts", "receipt_no", "RCP");

const loginAttempts = new Map<string, { n: number; until: number }>();

const photoField = (label: string) =>
  z.string({ required_error: `${label} is required.` }).min(30, `${label} is required.`);

const goldItemSchema = z.object({
  name: z.string().trim().min(1, "Enter the name of every gold item.").max(120),
  weight_grams: z
    .number({ invalid_type_error: "Enter gold weight in grams." })
    .positive("Gold weight must be more than 0 g.")
    .max(100000, "Gold weight looks too large."),
  quantity: z
    .number({ invalid_type_error: "Enter quantity." })
    .int("Quantity must be a whole number.")
    .positive("Quantity must be at least 1.")
    .max(10000),
  notes: z.string().max(500).optional().default(""),
});

const pledgeSchema = z.object({
  customer_name: z.string().trim().min(2, "Enter the customer's name.").max(120),
  additional_name: z.string().trim().max(120).optional().default(""),
  mobile: z.string().trim().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number."),
  email: z
    .union([z.literal(""), z.string().trim().email("Enter a valid email or leave it empty.")])
    .optional()
    .default(""),
  pledge_date: z.string().refine(isValidYmd, "Enter a valid pledge date."),
  principal: z
    .number({ invalid_type_error: "Enter the loan amount." })
    .positive("Loan amount must be more than ₹0.")
    .max(1e9, "Loan amount looks too large."),
  interest_rate: z
    .number({ invalid_type_error: "Enter the interest rate." })
    .positive("Interest rate must be more than 0%.")
    .max(100, "Interest rate looks too high."),
  rate_period: z.enum(["monthly", "annual"]),
  interest_type: z.enum(["simple", "compound"]),
  notes: z.string().max(2000).optional().default(""),
  gold: z.array(goldItemSchema).min(1, "Add at least one gold item."),
  photos: z.object(
    {
      customer: photoField("Customer photo"),
      jewel: photoField("Jewellery photo"),
    },
    { required_error: "Customer photo and jewellery photo are required." },
  ),
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, shop: SHOP() });
});

app.post("/api/login", (req, res) => {
  const parsed = z
    .object({ username: z.string().trim().min(1), password: z.string().min(1) })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter username and password." });
    return;
  }

  const key = `${req.ip || "local"}|${parsed.data.username.toLowerCase()}`;
  const rec = loginAttempts.get(key);
  if (rec && rec.until > Date.now()) {
    const mins = Math.ceil((rec.until - Date.now()) / 60000);
    res.status(429).json({ error: `Too many wrong attempts. Try again in ${mins} minute(s).` });
    return;
  }

  const user = db
    .prepare("SELECT id, username, password_hash FROM users WHERE username = ?")
    .get(parsed.data.username) as { id: number; username: string; password_hash: string } | undefined;

  if (!user || !bcrypt.compareSync(parsed.data.password, user.password_hash)) {
    const n = (rec?.n || 0) + 1;
    loginAttempts.set(key, { n: n >= 5 ? 0 : n, until: n >= 5 ? Date.now() + 5 * 60_000 : 0 });
    res.status(401).json({ error: "Wrong username or password." });
    return;
  }

  loginAttempts.delete(key);
  if (parsed.data.password === DEFAULT_PASSWORD) {
    db.prepare("UPDATE users SET must_change_password = 1 WHERE id = ?").run(user.id);
  }
  const auth = { id: user.id, username: user.username };
  setSession(res, auth);
  audit(user.id, "login", "user", user.id);
  res.json({ user: auth });
});

app.post("/api/logout", (req, res) => {
  const user = readUser(req);
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: "strict", secure: process.env.COOKIE_SECURE === "true" });
  if (user) audit(user.id, "logout", "user", user.id);
  res.json({ ok: true });
});

app.get("/api/me", requireAuth, (req, res) => {
  const user = userOf(req);
  const row = db.prepare("SELECT must_change_password FROM users WHERE id = ?").get(user.id) as {
    must_change_password: number;
  };
  res.json({
    user,
    shop: SHOP(),
    mustChangePassword: row.must_change_password === 1,
    settings: {
      partial_month_policy: policy(),
      timezone: "Asia/Kolkata",
      currency: "INR",
    },
  });
});

app.post("/api/change-password", requireAuth, (req, res) => {
  const user = userOf(req);
  const parsed = z
    .object({
      current: z.string().min(1, "Enter your current password."),
      next: z
        .string()
        .min(8, "New password must be at least 8 characters.")
        .max(72)
        .refine((v) => v !== DEFAULT_PASSWORD, "Choose a password different from the default one."),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error, "Invalid password.") });
    return;
  }
  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id) as {
    password_hash: string;
  };
  if (!bcrypt.compareSync(parsed.data.current, row.password_hash)) {
    res.status(400).json({ error: "Current password is incorrect." });
    return;
  }
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(
    bcrypt.hashSync(parsed.data.next, 12),
    user.id,
  );
  audit(user.id, "change_password", "user", user.id);
  res.json({ ok: true });
});

app.put("/api/settings", requireAuth, (req, res) => {
  const user = userOf(req);
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
  const user = userOf(req);
  const parsed = pledgeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error, "Please check the pledge details.") });
    return;
  }
  const d = parsed.data;
  const today = todayYmd();
  if (d.pledge_date > today) {
    res.status(400).json({ error: "Pledge date cannot be in the future." });
    return;
  }
  if (diffDays(d.pledge_date, today) > 3650) {
    res.status(400).json({ error: "Pledge date is more than 10 years old. Please check it." });
    return;
  }

  let customerPhoto, jewelPhoto;
  try {
    customerPhoto = decodePhoto(d.photos.customer, "Customer photo");
    jewelPhoto = decodePhoto(d.photos.jewel, "Jewellery photo");
  } catch (err) {
    if (err instanceof PhotoError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const token = nextToken();
    const info = db
      .prepare(
        `INSERT INTO pledges (
          token, customer_name, additional_name, mobile, email, pledge_date, principal,
          interest_rate, rate_period, interest_type, partial_month_policy, notes, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
      )
      .run(
        token,
        d.customer_name,
        d.additional_name,
        d.mobile,
        d.email || "",
        d.pledge_date,
        money(d.principal),
        d.interest_rate,
        d.rate_period,
        d.interest_type,
        policy(),
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
    savePhoto(pledgeId, "customer", customerPhoto);
    savePhoto(pledgeId, "jewel", jewelPhoto);
    return { pledgeId, token };
  });

  const { pledgeId, token } = tx();
  audit(user.id, "create_pledge", "pledge", token, { token, principal: d.principal });
  maybeBackup("pledge");
  const pledge = db.prepare("SELECT * FROM pledges WHERE id = ?").get(pledgeId) as PledgeRow;
  res.status(201).json(hydrate(pledge));
});

app.get("/api/pledges/:token", requireAuth, (req, res) => {
  const pledge = findPledge(req.params.token);
  if (!pledge) {
    res.status(404).json({ error: `No pledge found for "${req.params.token}".` });
    return;
  }
  res.json(hydrate(pledge));
});

app.get("/api/photos/:id", requireAuth, (req, res) => {
  const file = photoPath(Number(req.params.id));
  if (!file) {
    res.status(404).json({ error: "Photo not found." });
    return;
  }
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.sendFile(file);
});

app.post("/api/pledges/:token/payments", requireAuth, (req, res) => {
  const user = userOf(req);
  const parsed = z
    .object({
      amount: z
        .number({ invalid_type_error: "Enter the amount received." })
        .positive("Amount must be more than ₹0.")
        .max(1e9),
      notes: z.string().max(500).optional().default(""),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error, "Enter a valid payment amount.") });
    return;
  }

  const pledge = findPledge(req.params.token);
  if (!pledge) {
    res.status(404).json({ error: "Token not found." });
    return;
  }
  if (pledge.status !== "ACTIVE") {
    res.status(400).json({ error: "This pledge is already closed. Payments are not allowed." });
    return;
  }

  const amount = money(parsed.data.amount);
  const current = settle(pledge);
  if (current.settled) {
    res.status(400).json({ error: "Nothing is due on this pledge. You can release the gold." });
    return;
  }
  if (amount > current.outstanding + 0.009) {
    res.status(400).json({
      error: `Amount is more than the total due. Maximum you can collect today is ₹${current.outstanding.toFixed(2)}.`,
      outstanding: current.outstanding,
    });
    return;
  }

  const alloc = allocatePayment(pledge, amount);
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
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
  });
  tx();
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
    pledge: hydrate(fresh),
  });
});

app.post("/api/pledges/:token/otp", requireAuth, async (req, res) => {
  const user = userOf(req);
  const pledge = findPledge(req.params.token);
  if (!pledge) {
    res.status(404).json({ error: "Token not found." });
    return;
  }
  if (pledge.status !== "ACTIVE") {
    res.status(400).json({ error: "Gold is already released for this pledge." });
    return;
  }
  const fin = settle(pledge);
  if (!fin.settled) {
    res.status(400).json({
      error: `Collect the full balance of ₹${fin.outstanding.toFixed(2)} before releasing gold.`,
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

  const d = delivered.delivery;
  const sent = d.sent === true;
  res.json({
    sent,
    channel: d.channel,
    message: d.sent
      ? `OTP sent to the customer by ${d.channel === "sms" ? "SMS" : "email"}.`
      : d.reason,
    demo: !sent,
    demoOtp: !sent ? delivered.demoCode : undefined,
    expiresInSeconds: 300,
  });
});

app.post("/api/pledges/:token/release", requireAuth, (req, res) => {
  const user = userOf(req);
  const parsed = z
    .object({
      otp: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit OTP."),
      photos: z.object(
        {
          customer: photoField("Photo of the person collecting the gold"),
          jewel: photoField("Photo of the jewellery being returned"),
        },
        { required_error: "Take photos of the person and the jewellery before returning gold." },
      ),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error, "Enter the OTP.") });
    return;
  }

  let customerPhoto, jewelPhoto;
  try {
    customerPhoto = decodePhoto(parsed.data.photos.customer, "Collector photo");
    jewelPhoto = decodePhoto(parsed.data.photos.jewel, "Returned jewellery photo");
  } catch (err) {
    if (err instanceof PhotoError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  const pledge = findPledge(req.params.token);
  if (!pledge) {
    res.status(404).json({ error: "Token not found." });
    return;
  }
  if (pledge.status !== "ACTIVE") {
    res.status(400).json({ error: "Gold is already released for this pledge." });
    return;
  }

  const fin = settle(pledge);
  if (!fin.settled) {
    res.status(400).json({
      error: `Balance of ₹${fin.outstanding.toFixed(2)} is still due. Gold cannot be released.`,
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
    savePhoto(pledge.id, "release_customer", customerPhoto);
    savePhoto(pledge.id, "release_jewel", jewelPhoto);
  });
  tx();
  audit(user.id, "release_gold", "pledge", pledge.token, { otp_verified: true, release_date: releaseDate });
  maybeBackup("release");
  const fresh = db.prepare("SELECT * FROM pledges WHERE id = ?").get(pledge.id) as PledgeRow;
  res.json(hydrate(fresh));
});

app.post("/api/receipts", requireAuth, (req, res) => {
  const user = userOf(req);
  const parsed = z
    .object({ token: z.string().min(1), kind: z.enum(["pledge", "payment", "release"]).default("pledge") })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Token required." });
    return;
  }
  const pledge = findPledge(parsed.data.token);
  if (!pledge) {
    res.status(404).json({ error: "Token not found." });
    return;
  }
  const full = hydrate(pledge);
  const kind = parsed.data.kind;
  if (kind === "payment" && full.payments.length === 0) {
    res.status(400).json({ error: "No payment recorded yet for this pledge." });
    return;
  }
  if (kind === "release" && pledge.status !== "RELEASED") {
    res.status(400).json({ error: "Gold is not released yet." });
    return;
  }

  const receipt_no = nextReceipt();
  const snapshot = {
    shop: SHOP(),
    receipt_no,
    kind,
    created_at: new Date().toISOString(),
    pledge: full,
    lastPayment: full.payments.at(-1) ?? null,
    chart: repaymentChart(
      pledge.principal,
      pledge.interest_rate,
      pledge.rate_period,
      pledge.interest_type,
      pledge.pledge_date,
      pledgePolicy(pledge),
    ),
    policy: pledgePolicy(pledge),
  };
  db.prepare(
    "INSERT INTO receipts (receipt_no, pledge_id, kind, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(receipt_no, pledge.id, kind, JSON.stringify(snapshot), snapshot.created_at);
  audit(user.id, "issue_receipt", "receipt", receipt_no, { token: pledge.token, kind });
  res.json(snapshot);
});

const ymd = z.string().refine(isValidYmd, "Enter valid dates.");

app.post("/api/calc/interest", requireAuth, (req, res) => {
  const parsed = z
    .object({
      principal: z.number().nonnegative().max(1e9),
      ratePercent: z.number().nonnegative().max(100),
      ratePeriod: z.enum(["monthly", "annual"]),
      interestType: z.enum(["simple", "compound"]),
      startDate: ymd,
      endDate: ymd,
      partialMonthPolicy: z.enum(["actual_days", "thirty_day_month", "round_up_month"]).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error, "Invalid calculator input.") });
    return;
  }
  const pol = parsed.data.partialMonthPolicy || policy();
  res.json({
    ...calculateInterest({ ...parsed.data, partialMonthPolicy: pol }),
    chart: repaymentChart(
      parsed.data.principal,
      parsed.data.ratePercent,
      parsed.data.ratePeriod,
      parsed.data.interestType,
      parsed.data.startDate,
      pol,
    ),
  });
});

app.post("/api/calc/dates", requireAuth, (req, res) => {
  const parsed = z
    .object({
      startDate: ymd,
      endDate: ymd,
      addMonths: z.number().int().min(1).max(36).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error, "Invalid dates.") });
    return;
  }
  const br = dateBreakdown(parsed.data.startDate, parsed.data.endDate);
  res.json({
    ...br,
    dueDate: dueDateAfterMonths(parsed.data.startDate, parsed.data.addMonths ?? 1),
  });
});

app.get("/api/summary", requireAuth, (_req, res) => {
  const asOf = todayYmd();
  const active = db.prepare("SELECT * FROM pledges WHERE status = 'ACTIVE'").all() as PledgeRow[];
  const released = (db.prepare("SELECT COUNT(*) AS n FROM pledges WHERE status = 'RELEASED'").get() as { n: number }).n;
  const gold = db
    .prepare(
      `SELECT COALESCE(SUM(g.quantity), 0) AS items, COALESCE(SUM(g.weight_grams * g.quantity), 0) AS weight
       FROM gold_items g JOIN pledges p ON p.id = g.pledge_id WHERE p.status = 'ACTIVE'`,
    )
    .get() as { items: number; weight: number };
  const paySum = db.prepare("SELECT COALESCE(SUM(amount), 0) AS t FROM payments").get() as { t: number };
  const todayPay = db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS t FROM payments WHERE received_at >= ?")
    .get(new Date(`${asOf}T00:00:00+05:30`).toISOString()) as { t: number };

  let principalOut = 0;
  let accrued = 0;
  let pending = 0;
  for (const p of active) {
    const fin = settle(p, asOf);
    principalOut += fin.outstandingPrincipal;
    accrued += fin.unpaidInterest;
    pending += fin.outstanding;
  }

  res.json({
    asOf,
    active: active.length,
    released,
    items: gold.items,
    weight: money(gold.weight),
    principalOutstanding: money(principalOut),
    accruedInterest: money(accrued),
    amountPending: money(pending),
    paymentsReceived: money(paySum.t),
    paymentsToday: money(todayPay.t),
  });
});

app.get("/api/history", requireAuth, (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 60);
  const status = String(req.query.status || "");
  const asOf = todayYmd();
  const where: string[] = [];
  const args: string[] = [];
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
    where.push("(token LIKE ? ESCAPE '\\' OR customer_name LIKE ? ESCAPE '\\' OR mobile LIKE ? ESCAPE '\\')");
    args.push(like, like, like);
  }
  if (status === "ACTIVE" || status === "RELEASED") {
    where.push("status = ?");
    args.push(status);
  }
  const pledges = db
    .prepare(`SELECT * FROM pledges ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT 200`)
    .all(...args) as PledgeRow[];

  res.json(
    pledges.map((p) => {
      const fin = settle(p, asOf);
      return {
        token: p.token,
        customer_name: p.customer_name,
        mobile: p.mobile,
        pledge_date: p.pledge_date,
        principal: p.principal,
        payments: fin.totalPaid,
        interest: fin.calc.interest,
        balance: fin.outstanding,
        status: p.status,
      };
    }),
  );
});

app.post("/api/backup", requireAuth, async (req, res, next) => {
  try {
    const user = userOf(req);
    const dest = await backupNow("manual");
    audit(user.id, "backup", "database", path.basename(dest));
    res.json({ file: path.basename(dest) });
  } catch (err) {
    next(err);
  }
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found." });
});

const dist = path.join(root, "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(dist, "index.html"));
  });
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if ((err as { type?: string })?.type === "entity.too.large") {
    res.status(413).json({ error: "Photos are too large. Please retake them." });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Server error. Check the terminal log." });
});

app.listen(PORT, () => {
  console.log(`Krishna Gold Shop API http://127.0.0.1:${PORT}`);
  if (!process.env.JWT_SECRET) console.log("Using the session secret stored in data/shop.db.");
  backupNow("startup").catch((err) => console.error("Startup backup failed:", err));
});
