const TZ = "Asia/Kolkata";

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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

export function monthsAndRemainingDays(startYmd: string, endYmd: string): {
  months: number;
  extraDays: number;
  totalDays: number;
} {
  const totalDays = diffDays(startYmd, endYmd);
  if (totalDays <= 0) return { months: 0, extraDays: 0, totalDays };

  let months = 0;
  let cursor = startYmd;
  while (true) {
    const next = addCalendarMonths(cursor, 1);
    if (next > endYmd) break;
    months += 1;
    cursor = next;
  }
  const extraDays = diffDays(cursor, endYmd);
  return { months, extraDays, totalDays };
}

export function ymdStamp(): string {
  return todayYmd().replaceAll("-", "");
}
