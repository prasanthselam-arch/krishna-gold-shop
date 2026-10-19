import { ApiError, type Policy } from "./api";

export const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

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

export const TOKEN_PATTERN = /^KGS-\d{8}-\d{4,}$/i;
