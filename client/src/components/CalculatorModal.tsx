import { useEffect, useState } from "react";
import { api, type CalcResult, type InterestType, type Policy, type RatePeriod } from "../api";
import { POLICY_LABEL, errMsg, formatDate, inr, num, todayYmd } from "../format";
import { Modal } from "./Modal";

export type CalcPrefill = {
  principal: number;
  rate: number;
  period: RatePeriod;
  type: InterestType;
  start: string;
  policy: Policy;
  label?: string;
};

export function CalculatorModal({
  prefill,
  defaultPolicy,
  onClose,
}: {
  prefill?: CalcPrefill | null;
  defaultPolicy: Policy;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"interest" | "dates">("interest");
  const [principal, setPrincipal] = useState(prefill ? String(prefill.principal) : "10000");
  const [rate, setRate] = useState(prefill ? String(prefill.rate) : "2");
  const [period, setPeriod] = useState<RatePeriod>(prefill?.period ?? "monthly");
  const [type, setType] = useState<InterestType>(prefill?.type ?? "simple");
  const [policy, setPolicy] = useState<Policy>(prefill?.policy ?? defaultPolicy);
  const [start, setStart] = useState(prefill?.start ?? todayYmd());
  const [end, setEnd] = useState(todayYmd());
  const [out, setOut] = useState<CalcResult | null>(null);
  const [error, setError] = useState("");

  const [dStart, setDStart] = useState(prefill?.start ?? todayYmd());
  const [dEnd, setDEnd] = useState(todayYmd());
  const [months, setMonths] = useState("1");
  const [dOut, setDOut] = useState<{ days: number; completedMonths: number; remainingDays: number; dueDate: string } | null>(null);

  useEffect(() => {
    const p = num(principal);
    const r = num(rate);
    if (!Number.isFinite(p) || !Number.isFinite(r) || !start || !end) {
      setOut(null);
      setError("Enter amount, rate and both dates.");
      return;
    }
    if (end < start) {
      setOut(null);
      setError("End date must be on or after the start date.");
      return;
    }
    const t = window.setTimeout(() => {
      api
        .calcInterest({ principal: p, ratePercent: r, ratePeriod: period, interestType: type, startDate: start, endDate: end, partialMonthPolicy: policy })
        .then((res) => {
          setOut(res);
          setError("");
        })
        .catch((e) => {
          setOut(null);
          setError(errMsg(e));
        });
    }, 250);
    return () => window.clearTimeout(t);
  }, [principal, rate, period, type, start, end, policy]);

  useEffect(() => {
    if (!dStart || !dEnd) return;
    const t = window.setTimeout(() => {
      api
        .calcDates({ startDate: dStart, endDate: dEnd, addMonths: Number(months) || 1 })
        .then(setDOut)
        .catch(() => setDOut(null));
    }, 200);
    return () => window.clearTimeout(t);
  }, [dStart, dEnd, months]);

  return (
    <Modal title={prefill?.label ? `Interest calculator · ${prefill.label}` : "Interest calculator"} onClose={onClose} wide>
      <div className="tabs small">
        <button type="button" className={tab === "interest" ? "active" : ""} onClick={() => setTab("interest")}>
          Interest
        </button>
        <button type="button" className={tab === "dates" ? "active" : ""} onClick={() => setTab("dates")}>
          Days between dates
        </button>
      </div>

      {tab === "interest" && (
        <>
          <div className="grid-3">
            <div className="field">
              <label>Loan amount (₹)</label>
              <input inputMode="decimal" value={principal} onChange={(e) => setPrincipal(e.target.value)} />
            </div>
            <div className="field">
              <label>Interest rate (%)</label>
              <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
            </div>
            <div className="field">
              <label>Rate is per</label>
              <select value={period} onChange={(e) => setPeriod(e.target.value as RatePeriod)}>
                <option value="monthly">Month</option>
                <option value="annual">Year</option>
              </select>
            </div>
            <div className="field">
              <label>From date</label>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="field">
              <label>To date</label>
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <div className="field">
              <label>Interest type</label>
              <select value={type} onChange={(e) => setType(e.target.value as InterestType)}>
                <option value="simple">Simple</option>
                <option value="compound">Compound (monthly)</option>
              </select>
            </div>
            <div className="field span-3">
              <label>Part-month rule</label>
              <select value={policy} onChange={(e) => setPolicy(e.target.value as Policy)}>
                {Object.entries(POLICY_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && <div className="notice warn">{error}</div>}
          {out && (
            <>
              <div className="big-result">
                <div>
                  <span>Time</span>
                  <strong>{out.days} days</strong>
                  <small>
                    {out.completedMonths} month{out.completedMonths === 1 ? "" : "s"} {out.remainingDays} day
                    {out.remainingDays === 1 ? "" : "s"}
                  </small>
                </div>
                <div>
                  <span>Interest</span>
                  <strong>{inr.format(out.interest)}</strong>
                </div>
                <div className="hl">
                  <span>Total to pay</span>
                  <strong>{inr.format(out.totalPayable)}</strong>
                </div>
              </div>
              <details className="chart">
                <summary>Show month-by-month table (1–12 months)</summary>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Date</th>
                      <th>Interest</th>
                      <th>Total to pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {out.chart.map((row) => (
                      <tr key={row.month}>
                        <td>{row.month}</td>
                        <td>{formatDate(row.dueDate)}</td>
                        <td>{inr.format(row.interest)}</td>
                        <td>{inr.format(row.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          )}
        </>
      )}

      {tab === "dates" && (
        <>
          <div className="grid-3">
            <div className="field">
              <label>From date</label>
              <input type="date" value={dStart} onChange={(e) => setDStart(e.target.value)} />
            </div>
            <div className="field">
              <label>To date</label>
              <input type="date" value={dEnd} onChange={(e) => setDEnd(e.target.value)} />
            </div>
            <div className="field">
              <label>Due date after</label>
              <select value={months} onChange={(e) => setMonths(e.target.value)}>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1} month{i ? "s" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {dOut && (
            <div className="big-result">
              <div>
                <span>Days</span>
                <strong>{dOut.days}</strong>
              </div>
              <div>
                <span>Months + days</span>
                <strong>
                  {dOut.completedMonths} mo · {dOut.remainingDays} d
                </strong>
              </div>
              <div className="hl">
                <span>Due date</span>
                <strong>{formatDate(dOut.dueDate)}</strong>
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
