import { db, getSetting } from "./db.ts";
import { todayYmd } from "./dates.ts";
import {
  calculateInterest,
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

export function policy(): PartialMonthPolicy {
  const v = getSetting("partial_month_policy") as PartialMonthPolicy;
  if (v === "thirty_day_month" || v === "round_up_month" || v === "actual_days") return v;
  return "actual_days";
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

export function settle(pledge: PledgeRow, asOf = todayYmd()) {
  const calc = calculateInterest({
    principal: pledge.principal,
    ratePercent: pledge.interest_rate,
    ratePeriod: pledge.rate_period,
    interestType: pledge.interest_type,
    startDate: pledge.pledge_date,
    endDate: asOf,
    partialMonthPolicy: policy(),
  });

  const pays = paymentsFor(pledge.id);
  const totalPaid = money(pays.reduce((s, p) => s + p.amount, 0));
  const interestPaid = money(pays.reduce((s, p) => s + p.interest_portion, 0));
  const principalPaid = money(pays.reduce((s, p) => s + p.principal_portion, 0));

  const unpaidInterest = money(Math.max(0, calc.interest - interestPaid));
  const outstandingPrincipal = money(Math.max(0, pledge.principal - principalPaid));
  const outstanding = money(outstandingPrincipal + unpaidInterest);
  const settled = outstanding <= 0.009;

  return {
    calc,
    totalPaid,
    interestPaid,
    principalPaid,
    unpaidInterest,
    outstandingPrincipal,
    outstanding,
    settled,
    elapsed: {
      days: calc.days,
      completedMonths: calc.completedMonths,
      remainingDays: calc.remainingDays,
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
  const finance = settle(pledge, asOf);
  return { ...pledge, gold, payments, finance };
}
