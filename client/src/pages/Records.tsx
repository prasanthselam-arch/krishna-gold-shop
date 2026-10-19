import { useEffect, useState } from "react";
import { api, type HistoryRow, type Summary } from "../api";
import { formatDate, grams, inr } from "../format";

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
        ["Closed pledges", String(summary.released)],
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

      <section className="panel">
        <div className="records-head">
          <h3>All pledges</h3>
          <div className="seg">
            {[
              ["", "All"],
              ["ACTIVE", "Active"],
              ["RELEASED", "Closed"],
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
                    <span className={`status status-${r.status}`}>{r.status === "ACTIVE" ? "Active" : "Closed"}</span>
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
