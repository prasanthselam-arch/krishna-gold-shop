import { addCalendarMonths, diffDays, monthsAndRemainingDays } from "./dates.ts";

export type RatePeriod = "monthly" | "annual";
export type InterestType = "simple" | "compound";
export type PartialMonthPolicy = "actual_days" | "thirty_day_month" | "round_up_month";

export interface CalcInput {
  principal: number;
  ratePercent: number;
  ratePeriod: RatePeriod;
  interestType: InterestType;
  startDate: string;
  endDate: string;
  partialMonthPolicy: PartialMonthPolicy;
}

export interface CalcResult {
  days: number;
  completedMonths: number;
  remainingDays: number;
  timeFactor: number;
  interest: number;
  totalPayable: number;
}

function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Convert configured rate into a monthly decimal rate. */
function monthlyRate(ratePercent: number, ratePeriod: RatePeriod): number {
  const r = ratePercent / 100;
  return ratePeriod === "monthly" ? r : r / 12;
}

/**
 * Time in months used for interest, applying the shop's partial-month policy.
 * actual_days: every day counts as 1/30 of a month (standard gold-loan shop method)
 * thirty_day_month: completed calendar months + remaining days / 30
 * round_up_month: any leftover days round up to a full extra month
 */
export function timeInMonths(
  startDate: string,
  endDate: string,
  policy: PartialMonthPolicy,
): { days: number; completedMonths: number; remainingDays: number; timeFactor: number } {
  const { months, extraDays, totalDays } = monthsAndRemainingDays(startDate, endDate);
  if (totalDays <= 0) {
    return { days: Math.max(0, totalDays), completedMonths: 0, remainingDays: 0, timeFactor: 0 };
  }

  let timeFactor: number;
  if (policy === "actual_days") {
    timeFactor = totalDays / 30;
  } else if (policy === "thirty_day_month") {
    timeFactor = months + extraDays / 30;
  } else {
    timeFactor = extraDays > 0 ? months + 1 : months;
  }

  return {
    days: totalDays,
    completedMonths: months,
    remainingDays: extraDays,
    timeFactor,
  };
}

export function calculateInterest(input: CalcInput): CalcResult {
  const principal = Number(input.principal) || 0;
  const rate = Number(input.ratePercent) || 0;
  const elapsed = timeInMonths(input.startDate, input.endDate, input.partialMonthPolicy);
  const mRate = monthlyRate(rate, input.ratePeriod);

  let interest = 0;
  if (input.interestType === "simple") {
    interest = principal * mRate * elapsed.timeFactor;
  } else {
    interest = principal * (Math.pow(1 + mRate, elapsed.timeFactor) - 1);
  }

  interest = roundMoney(Math.max(0, interest));
  return {
    days: elapsed.days,
    completedMonths: elapsed.completedMonths,
    remainingDays: elapsed.remainingDays,
    timeFactor: roundMoney(elapsed.timeFactor),
    interest,
    totalPayable: roundMoney(principal + interest),
  };
}

export interface LedgerPayment {
  date: string;
  amount: number;
}

export interface LedgerAllocation {
  amount: number;
  interest: number;
  principal: number;
  balanceAfter: number;
}

export interface LedgerResult {
  interestCharged: number;
  interestPaid: number;
  principalPaid: number;
  unpaidInterest: number;
  outstandingPrincipal: number;
  outstanding: number;
  allocations: LedgerAllocation[];
}

/**
 * Replays a loan day by day through its payments. Interest accrues only on the
 * principal still outstanding (plus unpaid interest when compounding), and each
 * payment clears unpaid interest first, then principal. The partial-month policy
 * is always measured from the pledge date, so a loan with no payments gives
 * exactly the same interest as calculateInterest().
 */
export function runLedger(
  loan: Omit<CalcInput, "endDate">,
  payments: LedgerPayment[],
  asOf: string,
): LedgerResult {
  const mRate = monthlyRate(Number(loan.ratePercent) || 0, loan.ratePeriod);
  let principal = Number(loan.principal) || 0;
  let unpaid = 0;
  let charged = 0;
  let interestPaid = 0;
  let principalPaid = 0;
  let lastFactor = 0;

  const advanceTo = (date: string) => {
    const factor = timeInMonths(loan.startDate, date, loan.partialMonthPolicy).timeFactor;
    const delta = factor - lastFactor;
    if (delta <= 0) return;
    const add =
      loan.interestType === "simple"
        ? principal * mRate * delta
        : (principal + unpaid) * (Math.pow(1 + mRate, delta) - 1);
    unpaid = roundMoney(unpaid + add);
    charged = roundMoney(charged + add);
    lastFactor = factor;
  };

  const allocations: LedgerAllocation[] = [];
  for (const p of [...payments].sort((a, b) => a.date.localeCompare(b.date))) {
    if (p.date > asOf) break;
    advanceTo(p.date);
    const amount = roundMoney(Math.min(p.amount, principal + unpaid));
    const toInterest = roundMoney(Math.min(amount, unpaid));
    const toPrincipal = roundMoney(amount - toInterest);
    unpaid = roundMoney(unpaid - toInterest);
    principal = roundMoney(principal - toPrincipal);
    interestPaid = roundMoney(interestPaid + toInterest);
    principalPaid = roundMoney(principalPaid + toPrincipal);
    allocations.push({
      amount,
      interest: toInterest,
      principal: toPrincipal,
      balanceAfter: roundMoney(principal + unpaid),
    });
  }
  advanceTo(asOf);

  return {
    interestCharged: charged,
    interestPaid,
    principalPaid,
    unpaidInterest: unpaid,
    outstandingPrincipal: principal,
    outstanding: roundMoney(principal + unpaid),
    allocations,
  };
}

export function repaymentChart(
  principal: number,
  ratePercent: number,
  ratePeriod: RatePeriod,
  interestType: InterestType,
  startDate: string,
  policy: PartialMonthPolicy,
): { month: number; dueDate: string; days: number; interest: number; total: number }[] {
  const rows = [];
  for (let month = 1; month <= 12; month += 1) {
    const dueDate = addCalendarMonths(startDate, month);
    const calc = calculateInterest({
      principal,
      ratePercent,
      ratePeriod,
      interestType,
      startDate,
      endDate: dueDate,
      partialMonthPolicy: policy,
    });
    rows.push({
      month,
      dueDate,
      days: calc.days,
      interest: calc.interest,
      total: calc.totalPayable,
    });
  }
  return rows;
}

export function dueDateAfterMonths(startDate: string, months: number): string {
  return addCalendarMonths(startDate, months);
}

export function dateBreakdown(startDate: string, endDate: string) {
  const days = diffDays(startDate, endDate);
  const md = monthsAndRemainingDays(startDate, endDate);
  return { days, completedMonths: md.months, remainingDays: md.extraDays };
}
