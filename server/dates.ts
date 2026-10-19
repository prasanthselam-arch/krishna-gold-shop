const TZ = "Asia/Kolkata";

const ymdFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayYmd(): string {
  return ymdFormatter.format(new Date());
}

/** Calendar date (Asia/Kolkata) of an ISO timestamp. */
export function istYmd(iso: string): string {
  return ymdFormatter.format(new Date(iso));
}

export function isValidYmd(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function formatDisplayDate(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}/${m}/${y}`;
}

export function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

export function addCalendarMonths(ymd: string, months: number): string {
  const dt = parseYmd(ymd);
  const day = dt.getUTCDate();
  dt.setUTCDate(1);
  dt.setUTCMonth(dt.getUTCMonth() + months);
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(day, last));
  return dt.toISOString().slice(0, 10);
}

export function diffDays(startYmd: string, endYmd: string): number {
  const a = parseYmd(startYmd).getTime();
  const b = parseYmd(endYmd).getTime();
  return Math.round((b - a) / 86400000);
}

/**
 * Whole calendar months and leftover days between two dates.
 * Months are always counted from the start date (31 Jan + 1 month = 28/29 Feb,
 * + 2 months = 31 Mar), so month-end start dates do not drift.
 */
export function monthsAndRemainingDays(startYmd: string, endYmd: string): {
  months: number;
  extraDays: number;
  totalDays: number;
} {
  const totalDays = diffDays(startYmd, endYmd);
  if (totalDays <= 0) return { months: 0, extraDays: 0, totalDays };

  let months = 0;
  while (addCalendarMonths(startYmd, months + 1) <= endYmd) months += 1;
  const extraDays = diffDays(addCalendarMonths(startYmd, months), endYmd);
  return { months, extraDays, totalDays };
}

export function ymdStamp(): string {
  return todayYmd().replaceAll("-", "");
}
