import { useEffect, useState } from "react";
import { api, type Collections, type HistoryRow, type Summary } from "../api";
import { STATUS_LABEL, errMsg, formatDate, formatDateTime, grams, inr, todayYmd } from "../format";

function shiftYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function quickRanges(): [string, string, string][] {
  const today = todayYmd();
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthEnd = shiftYmd(monthStart, -1);
  return [
    ["Today", today, today],
    ["Yesterday", shiftYmd(today, -1), shiftYmd(today, -1)],
    ["Last 7 days", shiftYmd(today, -6), today],
    ["This month", monthStart, today],
    ["Last month", `${lastMonthEnd.slice(0, 8)}01`, lastMonthEnd],
  ];
}

/** Cash collected (and loans given) between two dates. */
function CollectionsPanel({
  active,
  refreshKey,
  onOpen,
}: {
  active: boolean;
  refreshKey: number;
  onOpen: (token: string) => void;
}) {
  const [from, setFrom] = useState(() => `${todayYmd().slice(0, 8)}01`);
  const [to, setTo] = useState(todayYmd);
  const [data, setData] = useState<Collections | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!active || !from || !to) return;
    let live = true;
    api
      .collections(from, to)
      .then((d) => {
        if (!live) return;
        setData(d);
        setError("");
      })
      .catch((err) => live && setError(errMsg(err)));
    return () => {
      live = false;
    };
  }, [active, refreshKey, from, to]);

  return (
    <section className="panel">
      <div className="records-head">
        <h3>Collections between dates</h3>
        <div className="range">
          <label>
            From <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To <input type="date" value={to} min={from || undefined} max={todayYmd()} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      </div>
      <div className="chips">
        {quickRanges().map(([label, f, t]) => (
          <button
            type="button"
            key={label}
            className={`chip ${from === f && to === t ? "active" : ""}`}
            onClick={() => {
              setFrom(f);
              setTo(t);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <div className="notice err">{error}</div>}
      {data && (
        <>
          <div className="summary-grid compact">
            <div className="card highlight">
              <div className="lbl">Collected</div>
              <div className="val">{inr.format(data.collected)}</div>
            </div>
            <div className="card">
              <div className="lbl">Interest collected</div>
              <div className="val">{inr.format(data.interest)}</div>
            </div>
            <div className="card">
              <div className="lbl">Loan repaid</div>
              <div className="val">{inr.format(data.principal)}</div>
            </div>
            <div className="card">
              <div className="lbl">Payments</div>
              <div className="val">{data.payments}</div>
            </div>
            <div className="card">
              <div className="lbl">Cash given (new loans{data.renewals ? " + top-ups" : ""})</div>
              <div className="val">{inr.format(data.cashGiven)}</div>
            </div>
            <div className="card">
              <div className="lbl">New loans</div>
              <div className="val">
                {data.loansGiven}
                {data.renewals > 0 && <small> ({data.renewals} renewed)</small>}
              </div>
            </div>
            <div className="card">
              <div className="lbl">Gold returned</div>
              <div className="val">{data.goldReturned}</div>
            </div>
            {data.adjustments !== 0 && (
              <div className="card">
                <div className="lbl">Interest {data.adjustments < 0 ? "waived" : "added"} (rounded days)</div>
                <div className="val">{inr.format(Math.abs(data.adjustments))}</div>
              </div>
            )}
          </div>
          <div className="table-wrap">
            <table className="table clickable">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Token</th>
                  <th>Customer</th>
                  <th>Paid</th>
                  <th>Interest</th>
                  <th>Loan</th>
                  <th>Balance after</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} onClick={() => onOpen(r.token)}>
                    <td>{formatDateTime(r.received_at)}</td>
                    <td className="mono">{r.token}</td>
                    <td>
                      {r.customer_name} <span className="muted small">{r.mobile}</span>
                    </td>
                    <td>
                      <b>{inr.format(r.amount)}</b>
                    </td>
                    <td>{inr.format(r.interest_portion)}</td>
                    <td>{inr.format(r.principal_portion)}</td>
                    <td>{inr.format(r.balance_after)}</td>
                  </tr>
                ))}
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted center">
                      No payments between {formatDate(data.from)} and {formatDate(data.to)}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

export function Records({
  active,
  refreshKey,
  onOpen,
}: {
  active: boolean;
  refreshKey: number;
  onOpen: (token: string) => void;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!active) return;
    api.summary().then(setSummary).catch(() => undefined);
  }, [active, refreshKey]);

  useEffect(() => {
    if (!active) return;
    const t = window.setTimeout(() => {
      api.history(q, status).then(setRows).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(t);
  }, [active, refreshKey, q, status]);

  const cards: [string, string][] = summary
    ? [
        ["Active pledges", String(summary.active)],
        ["Gold in locker", `${summary.items} pcs · ${grams(summary.weight)}`],
        ["Loan outstanding", inr.format(summary.principalOutstanding)],
        ["Interest due", inr.format(summary.accruedInterest)],
        ["Total to collect", inr.format(summary.amountPending)],
        ["Collected today", inr.format(summary.paymentsToday)],
        ["Collected (all time)", inr.format(summary.paymentsReceived)],
        ["Closed (gold returned)", String(summary.released)],
        ["Renewed", String(summary.renewed)],
      ]
    : [];

  return (
    <div className="page">
      <section className="summary-grid">
        {cards.map(([label, value]) => (
          <div className="card" key={label}>
            <div className="lbl">{label}</div>
            <div className="val">{value}</div>
          </div>
        ))}
      </section>

      <CollectionsPanel active={active} refreshKey={refreshKey} onOpen={onOpen} />

      <section className="panel">
        <div className="records-head">
          <h3>All pledges</h3>
          <div className="seg">
            {[
              ["", "All"],
              ["ACTIVE", "Active"],
              ["RELEASED", "Closed"],
              ["RENEWED", "Renewed"],
            ].map(([v, l]) => (
              <button type="button" key={v} className={status === v ? "active" : ""} onClick={() => setStatus(v)}>
                {l}
              </button>
            ))}
          </div>
          <input placeholder="Search token, name or mobile" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="table-wrap">
          <table className="table clickable">
            <thead>
              <tr>
                <th>Token</th>
                <th>Customer</th>
                <th>Mobile</th>
                <th>Date</th>
                <th>Loan</th>
                <th>Interest</th>
                <th>Paid</th>
                <th>Balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.token} onClick={() => onOpen(r.token)}>
                  <td className="mono">{r.token}</td>
                  <td>{r.customer_name}</td>
                  <td>{r.mobile}</td>
                  <td>{formatDate(r.pledge_date)}</td>
                  <td>{inr.format(r.principal)}</td>
                  <td>{inr.format(r.interest)}</td>
                  <td>{inr.format(r.payments)}</td>
                  <td>
                    <b>{inr.format(r.balance)}</b>
                  </td>
                  <td>
                    <span className={`status status-${r.status}`}>{STATUS_LABEL[r.status]}</span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted center">
                    No records.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
