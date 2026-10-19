import { db, getSetting } from "./db.ts";
import { istYmd, todayYmd } from "./dates.ts";
import {
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
  interest_rate: number;
  rate_period: RatePeriod;
  interest_type: InterestType;
  partial_month_policy: PartialMonthPolicy | null;
  notes: string;
  status: "ACTIVE" | "RELEASED";
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
  if (pledge.status === "RELEASED" && pledge.released_at) {
    const released = istYmd(pledge.released_at);
    return released < asOf ? released : asOf;
  }
  return asOf;
}

export function settle(pledge: PledgeRow, asOf = todayYmd()) {
  const until = effectiveAsOf(pledge, asOf);
  const pol = pledgePolicy(pledge);
  const pays = paymentsFor(pledge.id);
  const ledger = runLedger(
    {
      principal: pledge.principal,
      ratePercent: pledge.interest_rate,
      ratePeriod: pledge.rate_period,
      interestType: pledge.interest_type,
      startDate: pledge.pledge_date,
      partialMonthPolicy: pol,
    },
    pays.map((p) => ({ date: istYmd(p.received_at), amount: p.amount })),
    until,
  );
  const elapsed = timeInMonths(pledge.pledge_date, until, pol);
  const totalPaid = money(pays.reduce((s, p) => s + p.amount, 0));

  return {
    asOf: until,
    policy: pol,
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
    monthlyInterest: money(
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

export function allocatePayment(pledge: PledgeRow, amount: number, asOf = todayYmd()) {
  const current = settle(pledge, asOf);
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
  return { ...pledge, partial_month_policy: finance.policy, gold, payments, photos, finance, total_weight };
}
