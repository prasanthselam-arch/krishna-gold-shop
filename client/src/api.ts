export class ApiError extends Error {
  status: number;
  payload: unknown;
  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data.error || "Request failed", res.status, data);
  }
  return data as T;
}

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
  received_at: string;
  notes: string;
};

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
  rate_period: "monthly" | "annual";
  interest_type: "simple" | "compound";
  notes: string;
  status: "ACTIVE" | "RELEASED";
  released_at: string | null;
  gold: GoldItem[];
  payments: Payment[];
  finance: {
    calc: { days: number; completedMonths: number; remainingDays: number; interest: number; totalPayable: number };
    totalPaid: number;
    interestPaid: number;
    principalPaid: number;
    unpaidInterest: number;
    outstandingPrincipal: number;
    outstanding: number;
    settled: boolean;
    elapsed: { days: number; completedMonths: number; remainingDays: number };
  };
};

export type Summary = {
  asOf: string;
  active: number;
  released: number;
  items: number;
  weight: number;
  principalOutstanding: number;
  accruedInterest: number;
  expectedCollection: number;
  paymentsReceived: number;
  amountPending: number;
};

export type HistoryRow = {
  token: string;
  customer_name: string;
  pledge_date: string;
  principal: number;
  payments: number;
  interest: number;
  balance: number;
  status: string;
};

export type Receipt = {
  shop: string;
  receipt_no: string;
  kind: string;
  created_at: string;
  policy: string;
  pledge: Pledge;
  chart: { month: number; dueDate: string; days: number; interest: number; total: number }[];
};

export const api = {
  login: (username: string, password: string) =>
    request<{ user: { id: number; username: string } }>("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request("/api/logout", { method: "POST" }),
  me: () =>
    request<{
      user: { id: number; username: string };
      shop: string;
      settings: { partial_month_policy: string };
    }>("/api/me"),
  changePassword: (current: string, next: string) =>
    request("/api/change-password", { method: "POST", body: JSON.stringify({ current, next }) }),
  saveSettings: (partial_month_policy: string) =>
    request("/api/settings", { method: "PUT", body: JSON.stringify({ partial_month_policy }) }),
  previewToken: () => request<{ token: string }>("/api/token/preview"),
  createPledge: (body: unknown) =>
    request<Pledge>("/api/pledges", { method: "POST", body: JSON.stringify(body) }),
  getPledge: (token: string) => request<Pledge>(`/api/pledges/${encodeURIComponent(token)}`),
  pay: (token: string, amount: number, notes = "") =>
    request<{
      applied: number;
      interest_portion: number;
      principal_portion: number;
      remaining_balance: number;
      pledge: Pledge;
    }>(`/api/pledges/${encodeURIComponent(token)}/payments`, {
      method: "POST",
      body: JSON.stringify({ amount, notes }),
    }),
  requestOtp: (token: string) =>
    request<{ sent: boolean; channel: string; message: string; demo: boolean; demoOtp?: string }>(
      `/api/pledges/${encodeURIComponent(token)}/otp`,
      { method: "POST" },
    ),
  release: (token: string, otp: string) =>
    request<Pledge>(`/api/pledges/${encodeURIComponent(token)}/release`, {
      method: "POST",
      body: JSON.stringify({ otp }),
    }),
  receipt: (token: string, kind: "pledge" | "payment" | "release") =>
    request<Receipt>("/api/receipts", { method: "POST", body: JSON.stringify({ token, kind }) }),
  calcInterest: (body: unknown) => request("/api/calc/interest", { method: "POST", body: JSON.stringify(body) }),
  calcDates: (body: unknown) => request("/api/calc/dates", { method: "POST", body: JSON.stringify(body) }),
  summary: () => request<Summary>("/api/summary"),
  history: (q = "") => request<HistoryRow[]>(`/api/history?q=${encodeURIComponent(q)}`),
  backup: () => request<{ file: string }>("/api/backup", { method: "POST" }),
};
