import { ApiError, type Pledge, type PledgeStatus, type Policy, type RateSlab, type RateUnit, type RupeeBasis, type ShopSettings } from "./api";

export const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export const STATUS_LABEL: Record<PledgeStatus, string> = {
  ACTIVE: "Active",
  RELEASED: "Closed",
  RENEWED: "Renewed",
};

/** Whole rupees only: keeps digits, drops paise and anything else typed. */
export function rupeesInput(v: string): string {
  return v.split(".")[0].replace(/\D/g, "");
}

/** Rupees with up to 2 decimals (paise), e.g. "1.50". */
export function paiseInput(v: string): string {
  const [whole, ...rest] = v.replace(/[^\d.]/g, "").split(".");
  return rest.length ? `${whole}.${rest.join("").slice(0, 2)}` : whole;
}

/** ₹ amount with paise shown only when there are any: ₹2, ₹1.50. */
export function rupeeRate(n: number): string {
  return Number.isInteger(n) ? inr.format(n) : `₹${n.toFixed(2)}`;
}

/** Interest per period as a percentage of the loan. NaN when it cannot be worked out yet. */
export function ratePercent(unit: RateUnit, value: number, basis: RupeeBasis, principal: number): number {
  if (unit === "percent") return value;
  if (basis > 0) return (value / basis) * 100;
  return principal > 0 ? (value / principal) * 100 : NaN;
}

/** "₹2 per ₹100", "2%", "₹1,000" (fixed on the whole loan). */
export function rateText(unit: RateUnit, value: number, basis: RupeeBasis): string {
  if (unit === "percent") return `${Number(value.toFixed(4))}%`;
  return basis > 0 ? `${rupeeRate(value)} per ${inr.format(basis)}` : inr.format(value);
}

/** The interest the owner set for this loan amount (Settings → Configuration). */
export function suggestedRate(s: ShopSettings, principal: number): { unit: RateUnit; rate: number; slab: RateSlab | null } {
  const slab = principal > 0 ? (s.rate_slabs.find((x) => principal <= x.upto) ?? null) : null;
  return slab ? { unit: slab.unit, rate: slab.rate, slab } : { unit: s.default_rate_unit, rate: s.default_rate, slab: null };
}

export function formatDate(ymd: string): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function todayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Parses user-typed numbers such as "1,00,000" or " 2.5 ". Returns NaN when invalid. */
export function num(v: string): number {
  const cleaned = v.replace(/[,\s₹]/g, "");
  if (cleaned === "") return NaN;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

export function grams(n: number): string {
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: 3 })} g`;
}

export function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}

export const POLICY_LABEL: Record<Policy, string> = {
  actual_days: "Exact days (days ÷ 30)",
  thirty_day_month: "Full months + extra days ÷ 30",
  round_up_month: "Extra days count as a full month",
};

export function rateLabel(
  p: Pick<Pledge, "interest_rate" | "rate_unit" | "rate_amount" | "rate_basis" | "rate_period" | "interest_type">,
): string {
  const per = p.rate_period === "monthly" ? "month" : "year";
  const rate =
    p.rate_unit === "rupees" && p.rate_amount != null
      ? `${rateText("rupees", p.rate_amount, p.rate_basis)} / ${per}`
      : `${Number(p.interest_rate.toFixed(4))}% / ${per}`;
  return p.interest_type === "compound" ? `${rate} (compound)` : rate;
}

export const TOKEN_PATTERN = /^KGS-\d{8}-\d{4,}$/i;
