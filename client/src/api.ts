export class ApiError extends Error {
  status: number;
  payload: unknown;
  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "include",
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
  } catch {
    throw new ApiError("Cannot reach the shop server. Is it running?", 0, null);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/api/login") && !path.startsWith("/api/me")) onUnauthorized?.();
    throw new ApiError(data.error || "Request failed", res.status, data);
  }
  return data as T;
}

export type RatePeriod = "monthly" | "annual";
export type RateUnit = "percent" | "rupees";
export type InterestType = "simple" | "compound";
export type Policy = "actual_days" | "thirty_day_month" | "round_up_month";
export type PhotoKind = "customer" | "jewel" | "release_customer" | "release_jewel";

export type GoldItem = {
  id?: number;
  name: string;
  weight_grams: number;
  quantity: number;
  notes?: string;
};

export type Payment = {
  id: number;
  amount: number;
  interest_portion: number;
  principal_portion: number;
  balance_after: number;
  interest_adjustment: number;
  method: "cash" | "renewal";
  received_at: string;
  notes: string;
};

export type Photo = { id: number; kind: PhotoKind; created_at: string };

export type Finance = {
  asOf: string;
  policy: Policy;
  extraDays: number;
  adjustment: number;
  calc: { days: number; completedMonths: number; remainingDays: number; interest: number; totalPayable: number };
  totalPaid: number;
  interestPaid: number;
  principalPaid: number;
  unpaidInterest: number;
  outstandingPrincipal: number;
  outstanding: number;
  settled: boolean;
  monthlyInterest: number;
  elapsed: { days: number; completedMonths: number; remainingDays: number };
};

export type PledgeStatus = "ACTIVE" | "RELEASED" | "RENEWED";

export type Pledge = {
  id: number;
  token: string;
  customer_name: string;
  additional_name: string;
  mobile: string;
  email: string;
  pledge_date: string;
  principal: number;
  interest_rate: number;
  rate_unit: RateUnit;
  rate_amount: number | null;
  rate_period: RatePeriod;
  interest_type: InterestType;
  partial_month_policy: Policy;
  notes: string;
  status: PledgeStatus;
  released_at: string | null;
  carried_amount: number;
  renewed_from_token: string | null;
  renewed_to_token: string | null;
  /** Name of the person the gold was handed to (released pledges only). */
  returned_to: string;
  gold: GoldItem[];
  payments: Payment[];
  photos: Photo[];
  finance: Finance;
  total_weight: number;
};

export type Summary = {
  asOf: string;
  active: number;
  released: number;
  renewed: number;
  items: number;
  weight: number;
  principalOutstanding: number;
  accruedInterest: number;
  amountPending: number;
  paymentsReceived: number;
  paymentsToday: number;
};

export type HistoryRow = {
  token: string;
  customer_name: string;
  mobile: string;
  pledge_date: string;
  principal: number;
  payments: number;
  interest: number;
  balance: number;
  status: PledgeStatus;
};

export type Collections = {
  from: string;
  to: string;
  payments: number;
  collected: number;
  interest: number;
  principal: number;
  adjustments: number;
  loansGiven: number;
  renewals: number;
  cashGiven: number;
  goldReturned: number;
  rows: {
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
};

export type ReceiptKind = "pledge" | "payment" | "release";

export type Receipt = {
  shop: string;
  receipt_no: string;
  kind: ReceiptKind;
  created_at: string;
  policy: Policy;
  pledge: Pledge;
  lastPayment: Payment | null;
  chart: ChartRow[];
};

export type ChartRow = { month: number; dueDate: string; days: number; interest: number; total: number };

export type CalcResult = {
  days: number;
  completedMonths: number;
  remainingDays: number;
  timeFactor: number;
  interest: number;
  totalPayable: number;
  chart: ChartRow[];
};

export type Me = {
  user: { id: number; username: string };
  shop: string;
  mustChangePassword: boolean;
  settings: { partial_month_policy: Policy };
};

export type NewPledge = {
  customer_name: string;
  additional_name: string;
  mobile: string;
  email: string;
  pledge_date: string;
  principal: number;
  interest_rate: number;
  rate_unit: RateUnit;
  rate_period: RatePeriod;
  interest_type: InterestType;
  notes: string;
  gold: GoldItem[];
  photos: { customer: string; jewel: string };
};

export type Renewal = {
  extra_amount: number;
  pledge_date: string;
  interest_rate: number;
  rate_unit: RateUnit;
  rate_period: RatePeriod;
  interest_type: InterestType;
  partial_month_policy: Policy;
  extra_days?: number;
};

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const tok = (t: string) => encodeURIComponent(t.trim().toUpperCase());

export const photoUrl = (id: number) => `/api/photos/${id}`;

export const api = {
  login: (username: string, password: string) =>
    request<{ user: { id: number; username: string } }>("/api/login", post({ username, password })),
  logout: () => request("/api/logout", { method: "POST" }),
  me: () => request<Me>("/api/me"),
  changePassword: (current: string, next: string) => request("/api/change-password", post({ current, next })),
  saveSettings: (partial_month_policy: Policy) =>
    request("/api/settings", { method: "PUT", body: JSON.stringify({ partial_month_policy }) }),
  previewToken: () => request<{ token: string }>("/api/token/preview"),
  createPledge: (body: NewPledge) => request<Pledge>("/api/pledges", post(body)),
  getPledge: (token: string) => request<Pledge>(`/api/pledges/${tok(token)}`),
  due: (token: string, opts: { extraDays?: number; date?: string } = {}) =>
    request<Finance>(
      `/api/pledges/${tok(token)}/due?extra_days=${opts.extraDays ?? ""}&date=${encodeURIComponent(opts.date ?? "")}`,
    ),
  pay: (token: string, amount: number, extraDays?: number) =>
    request<{
      applied: number;
      interest_portion: number;
      principal_portion: number;
      remaining_balance: number;
      pledge: Pledge;
    }>(`/api/pledges/${tok(token)}/payments`, post({ amount, extra_days: extraDays })),
  renew: (token: string, body: Renewal) => request<Pledge>(`/api/pledges/${tok(token)}/renew`, post(body)),
  release: (token: string, returnedTo: string, photos: { customer: string; jewel: string }) =>
    request<Pledge>(`/api/pledges/${tok(token)}/release`, post({ returned_to: returnedTo, photos })),
  receipt: (token: string, kind: ReceiptKind) => request<Receipt>("/api/receipts", post({ token, kind })),
  calcInterest: (body: {
    principal: number;
    ratePercent: number;
    ratePeriod: RatePeriod;
    interestType: InterestType;
    startDate: string;
    endDate: string;
    partialMonthPolicy?: Policy;
  }) => request<CalcResult>("/api/calc/interest", post(body)),
  calcDates: (body: { startDate: string; endDate: string; addMonths?: number }) =>
    request<{ days: number; completedMonths: number; remainingDays: number; dueDate: string }>(
      "/api/calc/dates",
      post(body),
    ),
  summary: () => request<Summary>("/api/summary"),
  history: (q = "", status = "") =>
    request<HistoryRow[]>(`/api/history?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}`),
  collections: (from: string, to: string) =>
    request<Collections>(`/api/collections?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  backup: () => request<{ file: string }>("/api/backup", { method: "POST" }),
};
