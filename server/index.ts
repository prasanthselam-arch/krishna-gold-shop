import "dotenv/config";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { DEFAULT_PASSWORD, audit, dataDir, db, getSetting, setSetting } from "./db.ts";
import { backupNow, maybeBackup } from "./backup.ts";
import { diffDays, istYmd, isValidYmd, todayYmd, ymdStamp } from "./dates.ts";
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
import { PhotoError, copyPhoto, decodePhoto, photoPath, savePhoto } from "./photos.ts";

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
    .int("Loan amount must be in whole rupees (no paise).")
    .positive("Loan amount must be more than ₹0.")
    .max(1e9, "Loan amount looks too large."),
  interest_rate: z
    .number({ invalid_type_error: "Enter the interest rate." })
    .positive("Interest must be more than 0.")
    .max(1e9, "Interest looks too high."),
  rate_unit: z.enum(["percent", "rupees"]).optional().default("percent"),
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

/** Set once the HTTPS server is listening; the web app links to it for the camera. */
let httpsListeningPort = 0;

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, shop: SHOP(), httpsPort: httpsListeningPort || null });
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

/** Turns the entered rate (% or ₹ per period) into the effective percentage stored on the pledge. */
function resolveRate(
  principal: number,
  unit: "percent" | "rupees",
  value: number,
  period: "monthly" | "annual",
): { effectiveRate: number; rateAmount: number | null } | { error: string } {
  if (unit === "rupees" && !Number.isInteger(value)) {
    return { error: "Interest amount must be in whole rupees (no paise)." };
  }
  const rateAmount = unit === "rupees" ? money(value) : null;
  const effectiveRate = rateAmount === null ? value : (rateAmount / principal) * 100;
  if (effectiveRate > 100) {
    return {
      error:
        rateAmount === null
          ? "Interest rate looks too high."
          : `₹${rateAmount} per ${period === "monthly" ? "month" : "year"} is more than the loan amount. Please check it.`,
    };
  }
  return { effectiveRate, rateAmount };
}

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
  const principal = money(d.principal);
  const rate = resolveRate(principal, d.rate_unit, d.interest_rate, d.rate_period);
  if ("error" in rate) {
    res.status(400).json({ error: rate.error });
    return;
  }
  const { effectiveRate, rateAmount } = rate;

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
          interest_rate, rate_unit, rate_amount, rate_period, interest_type, partial_month_policy, notes,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
      )
      .run(
        token,
        d.customer_name,
        d.additional_name,
        d.mobile,
        d.email || "",
        d.pledge_date,
        principal,
        effectiveRate,
        d.rate_unit,
        rateAmount,
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

const extraDaysField = z
  .number({ invalid_type_error: "Extra days must be a number." })
  .int("Extra days must be a whole number.")
  .min(0, "Extra days cannot be negative.")
  .max(31, "Extra days can be at most 31.");

function lastPaymentYmd(pledgeId: number): string | null {
  const row = db.prepare("SELECT MAX(received_at) AS t FROM payments WHERE pledge_id = ?").get(pledgeId) as {
    t: string | null;
  };
  return row.t ? istYmd(row.t) : null;
}

/** Checks a closing date (renewal) is between the last activity on the pledge and today. */
function closingDateError(pledge: PledgeRow, date: string): string | null {
  if (date > todayYmd()) return "Date cannot be in the future.";
  if (date < pledge.pledge_date) return "Date cannot be before the pledge date.";
  const last = lastPaymentYmd(pledge.id);
  if (last && date < last) return `Date cannot be before the last payment (${last.split("-").reverse().join("/")}).`;
  return null;
}

/**
 * What is due on a date (default today) if the extra days are changed. Used by
 * the payment and renewal forms to preview amounts before saving.
 */
app.get("/api/pledges/:token/due", requireAuth, (req, res) => {
  const pledge = findPledge(req.params.token);
  if (!pledge) {
    res.status(404).json({ error: "Token not found." });
    return;
  }
  const raw = req.query.extra_days;
  const parsed = extraDaysField.optional().safeParse(raw === undefined || raw === "" ? undefined : Number(raw));
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error, "Invalid extra days.") });
    return;
  }
  const date = String(req.query.date || todayYmd());
  if (!isValidYmd(date)) {
    res.status(400).json({ error: "Enter a valid date." });
    return;
  }
  const dateError = pledge.status === "ACTIVE" ? closingDateError(pledge, date) : null;
  if (dateError) {
    res.status(400).json({ error: dateError });
    return;
  }
  res.json(settle(pledge, date, parsed.data));
});

/**
 * Top-up / renewal: the balance on this pledge (loan left + unpaid interest) is
 * carried into a new pledge on the same items, plus any extra cash given now.
 * The owner chooses the new date, rate and rules. The old pledge is closed as RENEWED.
 */
app.post("/api/pledges/:token/renew", requireAuth, (req, res) => {
  const user = userOf(req);
  const parsed = z
    .object({
      extra_amount: z
        .number({ invalid_type_error: "Enter the extra amount to give." })
        .int("Extra amount must be in whole rupees (no paise).")
        .min(0, "Extra amount cannot be negative.")
        .max(1e9),
      pledge_date: z.string().refine(isValidYmd, "Enter a valid date for the new loan."),
      interest_rate: z
        .number({ invalid_type_error: "Enter the interest rate." })
        .positive("Interest must be more than 0.")
        .max(1e9),
      rate_unit: z.enum(["percent", "rupees"]).optional().default("percent"),
      rate_period: z.enum(["monthly", "annual"]),
      interest_type: z.enum(["simple", "compound"]),
      partial_month_policy: z.enum(["actual_days", "thirty_day_month", "round_up_month"]).optional(),
      extra_days: extraDaysField.optional(),
      notes: z.string().max(2000).optional().default(""),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error, "Please check the new loan details.") });
    return;
  }
  const d = parsed.data;

  const old = findPledge(req.params.token);
  if (!old) {
    res.status(404).json({ error: "Token not found." });
    return;
  }
  if (old.status !== "ACTIVE") {
    res.status(400).json({ error: "This pledge is already closed." });
    return;
  }
  const dateError = closingDateError(old, d.pledge_date);
  if (dateError) {
    res.status(400).json({ error: dateError });
    return;
  }

  const current = settle(old, d.pledge_date, d.extra_days);
  const carried = current.outstanding;
  const principal = Math.round(carried + d.extra_amount);
  if (principal <= 0) {
    res.status(400).json({ error: "Nothing is due and no extra amount was entered. Enter the amount to give." });
    return;
  }
  const rate = resolveRate(principal, d.rate_unit, d.interest_rate, d.rate_period);
  if ("error" in rate) {
    res.status(400).json({ error: rate.error });
    return;
  }

  const now = new Date().toISOString();
  const closedAt = d.pledge_date === todayYmd() ? now : new Date(`${d.pledge_date}T12:00:00+05:30`).toISOString();
  const tx = db.transaction(() => {
    const token = nextToken();
    const info = db
      .prepare(
        `INSERT INTO pledges (
          token, customer_name, additional_name, mobile, email, pledge_date, principal,
          interest_rate, rate_unit, rate_amount, rate_period, interest_type, partial_month_policy, notes,
          status, renewed_from, carried_amount, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)`,
      )
      .run(
        token,
        old.customer_name,
        old.additional_name,
        old.mobile,
        old.email,
        d.pledge_date,
        principal,
        rate.effectiveRate,
        d.rate_unit,
        rate.rateAmount,
        d.rate_period,
        d.interest_type,
        d.partial_month_policy ?? pledgePolicy(old),
        d.notes || `Renewed from ${old.token}`,
        old.id,
        carried,
        now,
        now,
      );
    const newId = Number(info.lastInsertRowid);
    const insItem = db.prepare(
      "INSERT INTO gold_items (pledge_id, name, weight_grams, quantity, notes) VALUES (?, ?, ?, ?, ?)",
    );
    for (const g of itemsFor(old.id)) insItem.run(newId, g.name, g.weight_grams, g.quantity, g.notes);
    copyPhoto(old.id, newId, "customer");
    copyPhoto(old.id, newId, "jewel");

    if (carried > 0 || current.adjustment !== 0) {
      db.prepare(
        `INSERT INTO payments (pledge_id, amount, interest_portion, principal_portion, balance_after, interest_adjustment, method, received_at, notes)
         VALUES (?, ?, ?, ?, 0, ?, 'renewal', ?, ?)`,
      ).run(
        old.id,
        carried,
        current.unpaidInterest,
        current.outstandingPrincipal,
        current.adjustment,
        closedAt,
        `Moved to new loan ${token}`,
      );
    }
    db.prepare("UPDATE pledges SET status = 'RENEWED', released_at = ?, updated_at = ? WHERE id = ?").run(
      closedAt,
      now,
      old.id,
    );
    return { newId, token };
  });
  const { newId, token } = tx();
  audit(user.id, "renew_pledge", "pledge", old.token, {
    new_token: token,
    carried,
    extra_amount: d.extra_amount,
    principal,
    ...(current.adjustment === 0 ? {} : { extra_days: d.extra_days, interest_adjustment: current.adjustment }),
  });
  maybeBackup("renew");
  const fresh = db.prepare("SELECT * FROM pledges WHERE id = ?").get(newId) as PledgeRow;
  res.status(201).json(hydrate(fresh));
});

app.post("/api/pledges/:token/payments", requireAuth, (req, res) => {
  const user = userOf(req);
  const parsed = z
    .object({
      amount: z
        .number({ invalid_type_error: "Enter the amount received." })
        .int("Enter the amount in whole rupees (no paise).")
        .positive("Amount must be more than ₹0.")
        .max(1e9),
      extra_days: extraDaysField.optional(),
      notes: z.string().max(500).optional().default(""),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error, "Enter a valid payment amount.") });
    return;
  }
  const extraDays = parsed.data.extra_days;

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
  const current = settle(pledge, todayYmd(), extraDays);
  if (current.settled) {
    res.status(400).json({ error: "Nothing is due on this pledge. You can release the gold." });
    return;
  }
  // Older records may carry paise; the next whole rupee still closes them.
  const maxToday = Math.ceil(current.outstanding - 0.009);
  if (amount > maxToday) {
    res.status(400).json({
      error: `Amount is more than the total due. Maximum you can collect today is ₹${maxToday}.`,
      outstanding: current.outstanding,
    });
    return;
  }

  const alloc = allocatePayment(pledge, amount, extraDays);
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO payments (pledge_id, amount, interest_portion, principal_portion, balance_after, interest_adjustment, received_at, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      pledge.id,
      alloc.pay,
      alloc.interestPortion,
      alloc.principalPortion,
      alloc.outstandingAfter,
      alloc.current.adjustment,
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
    ...(alloc.current.adjustment === 0 ? {} : { extra_days: extraDays, interest_adjustment: alloc.current.adjustment }),
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

app.post("/api/pledges/:token/release", requireAuth, (req, res) => {
  const user = userOf(req);
  const parsed = z
    .object({
      returned_to: z
        .string({ required_error: "Enter the name of the person collecting the gold." })
        .trim()
        .min(2, "Enter the name of the person collecting the gold.")
        .max(120, "Name is too long."),
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
    res.status(400).json({ error: firstIssue(parsed.error, "Take photos of the person and the jewellery.") });
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

  const now = new Date().toISOString();
  const releaseDate = todayYmd();
  const items = itemsFor(pledge.id);
  const pays = paymentsFor(pledge.id);

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO releases (pledge_id, release_date, items_json, payment_details_json, otp_verified, returned_to, created_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    ).run(
      pledge.id,
      releaseDate,
      JSON.stringify(items),
      JSON.stringify({ finance: fin, payments: pays }),
      parsed.data.returned_to,
      now,
    );
    db.prepare("UPDATE pledges SET status = 'RELEASED', released_at = ?, updated_at = ? WHERE id = ?").run(
      now,
      now,
      pledge.id,
    );
    savePhoto(pledge.id, "release_customer", customerPhoto);
    savePhoto(pledge.id, "release_jewel", jewelPhoto);
  });
  tx();
  audit(user.id, "release_gold", "pledge", pledge.token, { release_date: releaseDate, returned_to: parsed.data.returned_to });
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
  const renewed = (db.prepare("SELECT COUNT(*) AS n FROM pledges WHERE status = 'RENEWED'").get() as { n: number }).n;
  const gold = db
    .prepare(
      `SELECT COALESCE(SUM(g.quantity), 0) AS items, COALESCE(SUM(g.weight_grams * g.quantity), 0) AS weight
       FROM gold_items g JOIN pledges p ON p.id = g.pledge_id WHERE p.status = 'ACTIVE'`,
    )
    .get() as { items: number; weight: number };
  const paySum = db.prepare("SELECT COALESCE(SUM(amount), 0) AS t FROM payments WHERE method = 'cash'").get() as {
    t: number;
  };
  const todayPay = db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS t FROM payments WHERE method = 'cash' AND received_at >= ?")
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
    renewed,
    items: gold.items,
    weight: money(gold.weight),
    principalOutstanding: money(principalOut),
    accruedInterest: money(accrued),
    amountPending: money(pending),
    paymentsReceived: money(paySum.t),
    paymentsToday: money(todayPay.t),
  });
});

/**
 * Cash collected and loans given between two dates (inclusive, shop time).
 * Balances moved into a renewed loan are not cash, so they are left out.
 */
app.get("/api/collections", requireAuth, (req, res) => {
  const from = String(req.query.from || todayYmd());
  const to = String(req.query.to || from);
  if (!isValidYmd(from) || !isValidYmd(to)) {
    res.status(400).json({ error: "Enter valid From and To dates." });
    return;
  }
  if (from > to) {
    res.status(400).json({ error: "From date must be on or before To date." });
    return;
  }
  const start = new Date(`${from}T00:00:00+05:30`).toISOString();
  const end = new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 86_400_000).toISOString();

  const rows = db
    .prepare(
      `SELECT pay.id, pay.received_at, pay.amount, pay.interest_portion, pay.principal_portion,
              pay.interest_adjustment, pay.balance_after, p.token, p.customer_name, p.mobile
       FROM payments pay JOIN pledges p ON p.id = pay.pledge_id
       WHERE pay.method = 'cash' AND pay.received_at >= ? AND pay.received_at < ?
       ORDER BY pay.received_at DESC, pay.id DESC`,
    )
    .all(start, end) as {
    id: number;
    received_at: string;
    amount: number;
    interest_portion: number;
    principal_portion: number;
    interest_adjustment: number;
    balance_after: number;
    token: string;
    customer_name: string;
    mobile: string;
  }[];
  const loans = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(principal - carried_amount), 0) AS cash,
              COALESCE(SUM(CASE WHEN renewed_from IS NOT NULL THEN 1 ELSE 0 END), 0) AS renewals
       FROM pledges WHERE pledge_date >= ? AND pledge_date <= ?`,
    )
    .get(from, to) as { n: number; cash: number; renewals: number };
  const returned = (
    db
      .prepare("SELECT COUNT(*) AS n FROM pledges WHERE status = 'RELEASED' AND released_at >= ? AND released_at < ?")
      .get(start, end) as { n: number }
  ).n;

  const sum = (k: "amount" | "interest_portion" | "principal_portion" | "interest_adjustment") =>
    money(rows.reduce((s, r) => s + r[k], 0));
  res.json({
    from,
    to,
    payments: rows.length,
    collected: sum("amount"),
    interest: sum("interest_portion"),
    principal: sum("principal_portion"),
    adjustments: sum("interest_adjustment"),
    loansGiven: loans.n,
    renewals: loans.renewals,
    cashGiven: money(loans.cash),
    goldReturned: returned,
    rows: rows.slice(0, 500),
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
  if (status === "ACTIVE" || status === "RELEASED" || status === "RENEWED") {
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

// Phones and other computers need HTTPS before the browser allows the camera.
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 8443);
const certFile = process.env.HTTPS_CERT || path.join(dataDir, "certs", "cert.pem");
const keyFile = process.env.HTTPS_KEY || path.join(dataDir, "certs", "key.pem");
if (HTTPS_PORT > 0 && fs.existsSync(certFile) && fs.existsSync(keyFile)) {
  https
    .createServer({ cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) }, app)
    .listen(HTTPS_PORT, () => {
      httpsListeningPort = HTTPS_PORT;
      console.log(`Krishna Gold Shop HTTPS https://localhost:${HTTPS_PORT}`);
    })
    .on("error", (err) => console.error(`HTTPS not started: ${err.message}`));
}
