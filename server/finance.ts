import { db, getSetting } from "./db.ts";
import { istYmd, todayYmd } from "./dates.ts";
import {
  roundRupee,
  runLedger,
  timeInMonths,
  type InterestType,
  type PartialMonthPolicy,
  type RatePeriod,
} from "./interest.ts";

export type PledgeRow = {
  id: number;
  token: string;
  customer_name: string;
  additional_name: string;
  mobile: string;
  email: string;
  pledge_date: string;
  principal: number;
  /** Always the effective percentage used for calculation. */
  interest_rate: number;
  /** "rupees" when the shop entered a ₹ amount per period (kept in rate_amount). */
  rate_unit: "percent" | "rupees";
  rate_amount: number | null;
  /** ₹ amount is per this many rupees of loan (100 = "₹2 per ₹100"); 0 = on the whole loan. */
  rate_basis: number;
  rate_period: RatePeriod;
  interest_type: InterestType;
  partial_month_policy: PartialMonthPolicy | null;
  notes: string;
  status: "ACTIVE" | "RELEASED" | "RENEWED";
  /** Previous loan whose balance was carried into this one. */
  renewed_from: number | null;
  carried_amount: number;
  released_at: string | null;
  created_at: string;
  updated_at: string;
};

export type GoldItem = {
  id: number;
  pledge_id: number;
  name: string;
  weight_grams: number;
  quantity: number;
  notes: string;
};

export type PaymentRow = {
  id: number;
  pledge_id: number;
  amount: number;
  interest_portion: number;
  principal_portion: number;
  balance_after: number;
  /** Interest added (+) or waived (−) when the extra days were changed for this payment. */
  interest_adjustment: number;
  method: "cash" | "renewal";
  received_at: string;
  notes: string;
};

export type PhotoKind = "customer" | "jewel" | "release_customer" | "release_jewel";

export type PhotoRow = {
  id: number;
  pledge_id: number;
  kind: PhotoKind;
  file: string;
  created_at: string;
};

function asPolicy(v: string | null | undefined): PartialMonthPolicy | null {
  return v === "thirty_day_month" || v === "round_up_month" || v === "actual_days" ? v : null;
}

/** Shop-wide policy applied to newly created pledges. */
export function policy(): PartialMonthPolicy {
  return asPolicy(getSetting("partial_month_policy")) ?? "actual_days";
}

export function pledgePolicy(pledge: PledgeRow): PartialMonthPolicy {
  return asPolicy(pledge.partial_month_policy) ?? policy();
}

function money(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function itemsFor(pledgeId: number): GoldItem[] {
  return db.prepare("SELECT * FROM gold_items WHERE pledge_id = ? ORDER BY id").all(pledgeId) as GoldItem[];
}

export function paymentsFor(pledgeId: number): PaymentRow[] {
  return db
    .prepare("SELECT * FROM payments WHERE pledge_id = ? ORDER BY id")
    .all(pledgeId) as PaymentRow[];
}

export function photosFor(pledgeId: number): Omit<PhotoRow, "file" | "pledge_id">[] {
  return db
    .prepare("SELECT id, kind, created_at FROM photos WHERE pledge_id = ? ORDER BY id")
    .all(pledgeId) as Omit<PhotoRow, "file" | "pledge_id">[];
}

/** Interest stops at the release date for released pledges. */
function effectiveAsOf(pledge: PledgeRow, asOf: string): string {
  if (pledge.status !== "ACTIVE" && pledge.released_at) {
    const released = istYmd(pledge.released_at);
    return released < asOf ? released : asOf;
  }
  return asOf;
}

/**
 * Amounts due on `asOf`. When `extraDays` is given, interest is charged for the
 * completed months plus that many days instead of the real extra days; the
 * difference is returned as `adjustment` (negative = waived).
 */
export function settle(pledge: PledgeRow, asOf = todayYmd(), extraDays?: number) {
  const until = effectiveAsOf(pledge, asOf);
  const pol = pledgePolicy(pledge);
  const pays = paymentsFor(pledge.id);
  const loan = {
    principal: pledge.principal,
    ratePercent: pledge.interest_rate,
    ratePeriod: pledge.rate_period,
    interestType: pledge.interest_type,
    startDate: pledge.pledge_date,
    partialMonthPolicy: pol,
  };
  const ledgerPays = pays.map((p) => ({ date: istYmd(p.received_at), amount: p.amount, adjust: p.interest_adjustment || 0 }));
  const elapsed = timeInMonths(pledge.pledge_date, until, pol);
  const actual = runLedger(loan, ledgerPays, until);
  const override = extraDays !== undefined && extraDays !== elapsed.remainingDays;
  const ledger = override ? runLedger(loan, ledgerPays, until, elapsed.completedMonths + extraDays / 30) : actual;
  const totalPaid = money(pays.reduce((s, p) => s + p.amount, 0));

  return {
    asOf: until,
    policy: pol,
    extraDays: extraDays ?? elapsed.remainingDays,
    adjustment: money(ledger.unpaidInterest - actual.unpaidInterest),
    calc: {
      days: elapsed.days,
      completedMonths: elapsed.completedMonths,
      remainingDays: elapsed.remainingDays,
      interest: ledger.interestCharged,
      totalPayable: money(pledge.principal + ledger.interestCharged),
    },
    totalPaid,
    interestPaid: ledger.interestPaid,
    principalPaid: ledger.principalPaid,
    unpaidInterest: ledger.unpaidInterest,
    outstandingPrincipal: ledger.outstandingPrincipal,
    outstanding: ledger.outstanding,
    settled: ledger.outstanding <= 0.009,
    monthlyInterest: roundRupee(
      ledger.outstandingPrincipal *
        (pledge.rate_period === "monthly" ? pledge.interest_rate : pledge.interest_rate / 12) /
        100,
    ),
    elapsed: {
      days: elapsed.days,
      completedMonths: elapsed.completedMonths,
      remainingDays: elapsed.remainingDays,
    },
  };
}

export function allocatePayment(pledge: PledgeRow, amount: number, extraDays?: number, asOf = todayYmd()) {
  const current = settle(pledge, asOf, extraDays);
  const pay = money(Math.min(amount, current.outstanding));
  const interestPortion = money(Math.min(pay, current.unpaidInterest));
  const principalPortion = money(pay - interestPortion);
  const outstandingAfter = money(current.outstanding - pay);
  return { pay, interestPortion, principalPortion, outstandingAfter, current };
}

export function hydrate(pledge: PledgeRow, asOf = todayYmd()) {
  const gold = itemsFor(pledge.id);
  const payments = paymentsFor(pledge.id);
  const photos = photosFor(pledge.id);
  const finance = settle(pledge, asOf);
  const total_weight = money(gold.reduce((s, g) => s + g.weight_grams * g.quantity, 0));
  const tokenOf = (sql: string, id: number) => (db.prepare(sql).get(id) as { token: string } | undefined)?.token ?? null;
  return {
    ...pledge,
    partial_month_policy: finance.policy,
    gold,
    payments,
    photos,
    finance,
    total_weight,
    renewed_from_token: pledge.renewed_from ? tokenOf("SELECT token FROM pledges WHERE id = ?", pledge.renewed_from) : null,
    renewed_to_token: tokenOf("SELECT token FROM pledges WHERE renewed_from = ? ORDER BY id DESC LIMIT 1", pledge.id),
    returned_to:
      pledge.status === "RELEASED"
        ? ((db.prepare("SELECT returned_to FROM releases WHERE pledge_id = ? ORDER BY id DESC LIMIT 1").get(pledge.id) as
            | { returned_to: string }
            | undefined)?.returned_to ?? "")
        : "",
  };
}
