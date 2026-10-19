import { Suspense, lazy, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  api,
  photoUrl,
  type Finance,
  type HistoryRow,
  type InterestType,
  type Photo,
  type Pledge,
  type Policy,
  type RatePeriod,
  type RateUnit,
  type RupeeBasis,
} from "../api";
import { POLICY_LABEL, STATUS_LABEL, TOKEN_PATTERN, errMsg, formatDate, formatDateTime, grams, inr, num, ratePercent, rateLabel, rupeesInput, todayYmd } from "../format";
import { Modal } from "../components/Modal";
import { PhotoCapture } from "../components/PhotoCapture";
import { RateField } from "../components/RateField";

const QrScanner = lazy(() => import("../components/QrScanner").then((m) => ({ default: m.QrScanner })));

const PHOTO_LABEL: Record<Photo["kind"], string> = {
  customer: "Customer (pledge)",
  jewel: "Jewellery (pledge)",
  release_customer: "Collected by",
  release_jewel: "Jewellery returned",
};

export function FindPledge({
  pledge,
  setPledge,
  active,
  onPrint,
  onCalc,
  notify,
  onChanged,
  rupeeBasis,
}: {
  pledge: Pledge | null;
  setPledge: (p: Pledge | null) => void;
  active: boolean;
  onPrint: (token: string) => void;
  onCalc: (p: Pledge) => void;
  notify: (kind: "ok" | "err" | "warn", text: string) => void;
  onChanged: () => void;
  rupeeBasis: RupeeBasis;
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<HistoryRow[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"none" | "pay" | "release" | "renew">("none");
  const [zoom, setZoom] = useState<Photo | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (active && !pledge) inputRef.current?.focus();
  }, [active, pledge]);

  useEffect(() => {
    setMode("none");
  }, [pledge?.token]);

  async function open(token: string) {
    setBusy(true);
    try {
      const p = await api.getPledge(token);
      setPledge(p);
      setMatches(null);
      setQuery("");
    } catch (err) {
      notify("err", errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  const openRef = useRef(open);
  openRef.current = open;
  const onScan = useCallback((text: string) => {
    setScanning(false);
    void openRef.current(text);
  }, []);
  const closeScanner = useCallback(() => setScanning(false), []);

  async function search(e?: FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    if (TOKEN_PATTERN.test(q)) return open(q);
    setBusy(true);
    try {
      const rows = await api.history(q);
      if (rows.length === 1) await open(rows[0].token);
      else setMatches(rows);
    } catch (err) {
      notify("err", errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  const f = pledge?.finance;

  return (
    <div className="page">
      <form className="search-bar" onSubmit={search}>
        <input
          ref={inputRef}
          placeholder="Scan QR, or type token / name / mobile"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
        <button className="btn btn-gold" disabled={busy}>
          Search
        </button>
        <button type="button" className="btn btn-ink" onClick={() => setScanning(true)}>
          Scan QR
        </button>
      </form>

      {matches && (
        <div className="panel">
          <h3>{matches.length ? `${matches.length} match${matches.length > 1 ? "es" : ""}` : "No pledge found"}</h3>
          {matches.map((r) => (
            <button type="button" key={r.token} className="match-row" onClick={() => void open(r.token)}>
              <span>
                <b>{r.customer_name}</b> · {r.mobile}
              </span>
              <span className="muted">{r.token}</span>
              <span>{inr.format(r.balance)}</span>
              <span className={`status status-${r.status}`}>{STATUS_LABEL[r.status]}</span>
            </button>
          ))}
        </div>
      )}

      {!pledge && !matches && (
        <div className="empty-state">
          <p>Scan the QR code on the customer's bill to open the pledge.</p>
          <p className="muted">A USB QR / barcode scanner works directly: click the box above and scan.</p>
        </div>
      )}

      {pledge && f && (
        <>
          <section className="panel pledge-head">
            <div className="pledge-photos">
              {pledge.photos.map((ph) => (
                <button type="button" key={ph.id} className="thumb" onClick={() => setZoom(ph)} title={PHOTO_LABEL[ph.kind]}>
                  <img src={photoUrl(ph.id)} alt={PHOTO_LABEL[ph.kind]} />
                  <span>{PHOTO_LABEL[ph.kind]}</span>
                </button>
              ))}
              {pledge.photos.length === 0 && <div className="muted">No photos (old record)</div>}
            </div>
            <div className="pledge-who">
              <div className="token-line">
                {pledge.token}
                <span className={`status status-${pledge.status}`}>{STATUS_LABEL[pledge.status]}</span>
              </div>
              <h2>{pledge.customer_name}</h2>
              <div className="muted">
                {pledge.additional_name && <>c/o {pledge.additional_name} · </>}
                {pledge.mobile}
                {pledge.email && <> · {pledge.email}</>}
              </div>
              <div className="muted">
                Pledged on {formatDate(pledge.pledge_date)} · {rateLabel(pledge)}
              </div>
              {pledge.renewed_from_token && (
                <div className="muted">
                  Includes {inr.format(pledge.carried_amount)} carried from{" "}
                  <button type="button" className="link" onClick={() => void open(pledge.renewed_from_token!)}>
                    {pledge.renewed_from_token}
                  </button>
                </div>
              )}
            </div>
            <button type="button" className="icon-btn" aria-label="Close pledge" onClick={() => setPledge(null)}>
              ×
            </button>
          </section>

          {pledge.status === "ACTIVE" ? (
            <section className="money-card">
              <div className="due">
                <span>To close today</span>
                <strong>{inr.format(f.outstanding)}</strong>
              </div>
              <div className="split">
                <div>
                  <span>Loan left</span>
                  <b>{inr.format(f.outstandingPrincipal)}</b>
                </div>
                <div>
                  <span>Interest due</span>
                  <b>{inr.format(f.unpaidInterest)}</b>
                </div>
                <div>
                  <span>Time</span>
                  <b>
                    {f.elapsed.days} days ({f.elapsed.completedMonths} m {f.elapsed.remainingDays} d)
                  </b>
                </div>
                <div>
                  <span>Paid so far</span>
                  <b>{inr.format(f.totalPaid)}</b>
                </div>
              </div>
            </section>
          ) : (
            <section className="money-card closed">
              <div className="due">
                <span>
                  {pledge.status === "RENEWED" ? "Renewed" : "Closed"} on {pledge.released_at ? formatDateTime(pledge.released_at) : "—"}
                </span>
                <strong>{inr.format(f.totalPaid)} {pledge.status === "RENEWED" ? "settled" : "paid"}</strong>
              </div>
              <div className="split">
                {pledge.returned_to && (
                  <div>
                    <span>Returned to</span>
                    <b>{pledge.returned_to}</b>
                  </div>
                )}
                <div>
                  <span>Loan</span>
                  <b>{inr.format(pledge.principal)}</b>
                </div>
                <div>
                  <span>Interest paid</span>
                  <b>{inr.format(f.interestPaid)}</b>
                </div>
              </div>
            </section>
          )}

          {pledge.status === "RENEWED" && pledge.renewed_to_token && (
            <div className="notice warn">
              This loan was renewed. The items are now on{" "}
              <button type="button" className="link" onClick={() => void open(pledge.renewed_to_token!)}>
                {pledge.renewed_to_token}
              </button>
              . Use that bill for payments and return.
            </div>
          )}

          <div className="action-bar">
            {pledge.status === "ACTIVE" && (
              <>
                <button type="button" className={`btn btn-ok big ${mode === "pay" ? "pressed" : ""}`} onClick={() => setMode(mode === "pay" ? "none" : "pay")}>
                  Receive payment
                </button>
                <button
                  type="button"
                  className={`btn btn-danger big ${mode === "release" ? "pressed" : ""}`}
                  onClick={() => setMode(mode === "release" ? "none" : "release")}
                >
                  Return gold
                </button>
                <button
                  type="button"
                  className={`btn btn-ink big ${mode === "renew" ? "pressed" : ""}`}
                  onClick={() => setMode(mode === "renew" ? "none" : "renew")}
                >
                  Give more money
                </button>
              </>
            )}
            <button type="button" className="btn btn-gold big" onClick={() => onPrint(pledge.token)}>
              Print bill
            </button>
            <button type="button" className="btn btn-ghost big" onClick={() => onCalc(pledge)}>
              Calculator
            </button>
          </div>

          {mode === "pay" && pledge.status === "ACTIVE" && (
            <PaymentPanel
              pledge={pledge}
              onDone={(p) => {
                setPledge(p);
                onChanged();
              }}
              notify={notify}
            />
          )}
          {mode === "release" && pledge.status === "ACTIVE" && (
            <ReleasePanel
              pledge={pledge}
              onPay={() => setMode("pay")}
              onDone={(p) => {
                setPledge(p);
                onChanged();
                notify("ok", `Gold returned to ${p.returned_to}. ${p.token} is closed.`);
              }}
              notify={notify}
            />
          )}

          {mode === "renew" && pledge.status === "ACTIVE" && (
            <RenewPanel
              pledge={pledge}
              basis={rupeeBasis}
              onDone={(p) => {
                setPledge(p);
                onChanged();
                notify("ok", `New loan ${p.token} created for ${inr.format(p.principal)}. Give the customer the new bill.`);
                onPrint(p.token);
              }}
              notify={notify}
            />
          )}

          <div className="grid-2 top">
            <section className="panel">
              <h3>
                Gold items <span className="muted right">{grams(pledge.total_weight)}</span>
              </h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Weight each</th>
                  </tr>
                </thead>
                <tbody>
                  {pledge.gold.map((g, i) => (
                    <tr key={i}>
                      <td>{g.name}</td>
                      <td>{g.quantity}</td>
                      <td>{grams(g.weight_grams)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pledge.notes && <p className="muted">Note: {pledge.notes}</p>}
            </section>
            <section className="panel">
              <h3>Payments</h3>
              {pledge.payments.length === 0 ? (
                <p className="muted">No payments yet.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Paid</th>
                      <th>Interest</th>
                      <th>Loan</th>
                      <th>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pledge.payments.map((p) => (
                      <tr key={p.id}>
                        <td>
                          {formatDateTime(p.received_at)}
                          {p.method === "renewal" && <div className="muted small">{p.notes}</div>}
                        </td>
                        <td>{inr.format(p.amount)}</td>
                        <td>
                          {inr.format(p.interest_portion)}
                          {p.interest_adjustment !== 0 && (
                            <div className="muted small">
                              {p.interest_adjustment < 0 ? "waived " : "added "}
                              {inr.format(Math.abs(p.interest_adjustment))}
                            </div>
                          )}
                        </td>
                        <td>{inr.format(p.principal_portion)}</td>
                        <td>{inr.format(p.balance_after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        </>
      )}

      {scanning && (
        <Suspense fallback={null}>
          <QrScanner onClose={closeScanner} onResult={onScan} />
        </Suspense>
      )}
      {zoom && (
        <Modal title={PHOTO_LABEL[zoom.kind]} onClose={() => setZoom(null)} wide>
          <img src={photoUrl(zoom.id)} alt={PHOTO_LABEL[zoom.kind]} className="photo-full" />
          <p className="muted center">Taken {formatDateTime(zoom.created_at)}</p>
        </Modal>
      )}
    </div>
  );
}

/**
 * Lets the owner round the extra days of interest (e.g. 16 → 15, or 30 for a full month).
 * Empty or unchanged means the real days are used.
 */
function ExtraDaysField({
  finance,
  value,
  onChange,
}: {
  finance: Finance;
  value: string;
  onChange: (v: string) => void;
}) {
  const actual = finance.elapsed.remainingDays;
  const changed = value !== "" && Number(value) !== actual;
  return (
    <div className="days-adjust">
      <span>Interest for</span>
      <b>{finance.elapsed.completedMonths} months +</b>
      <input
        inputMode="numeric"
        aria-label="Extra days"
        placeholder={String(actual)}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 2))}
      />
      <span>days</span>
      {changed ? (
        <button type="button" className="link" onClick={() => onChange(String(actual))}>
          Use real {actual} days
        </button>
      ) : (
        <span className="muted small">Optional: change the days to round off</span>
      )}
    </div>
  );
}

/**
 * Live amounts due with the chosen extra days (and date), from the server.
 * The server ignores extra days equal to the real days.
 */
function useDue(pledge: Pledge, daysText: string, date: string | undefined, notify: (kind: "ok" | "err" | "warn", text: string) => void) {
  const days = daysText === "" ? undefined : Number(daysText);
  const today = !date || date === todayYmd();
  const needsFetch = !today || (days !== undefined && days !== pledge.finance.elapsed.remainingDays);
  const [due, setDue] = useState<Finance>(pledge.finance);
  const [loading, setLoading] = useState(false);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  useEffect(() => {
    if (!needsFetch) {
      setDue(pledge.finance);
      setLoading(false);
      return;
    }
    if (days !== undefined && days > 31) {
      notifyRef.current("warn", "Extra days can be at most 31.");
      return;
    }
    let live = true;
    setLoading(true);
    const id = window.setTimeout(() => {
      api
        .due(pledge.token, { extraDays: days, date })
        .then((d) => live && setDue(d))
        .catch((err) => live && notifyRef.current("err", errMsg(err)))
        .finally(() => live && setLoading(false));
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(id);
    };
  }, [pledge.token, pledge.finance, needsFetch, days, date]);
  return { due, extraDays: days, loading };
}

function PaymentPanel({
  pledge,
  onDone,
  notify,
}: {
  pledge: Pledge;
  onDone: (p: Pledge) => void;
  notify: (kind: "ok" | "err" | "warn", text: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [daysText, setDaysText] = useState(String(pledge.finance.elapsed.remainingDays));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ applied: number; interest_portion: number; principal_portion: number; remaining_balance: number } | null>(null);
  const { due: f, extraDays, loading } = useDue(pledge, daysText, undefined, notify);
  const value = num(amount);
  const maxToday = Math.ceil(f.outstanding - 0.009);
  const tooMuch = value > maxToday;

  useEffect(() => {
    setDaysText(String(pledge.finance.elapsed.remainingDays));
  }, [pledge.finance]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!(value > 0)) {
      notify("err", "Enter the amount received.");
      return;
    }
    setBusy(true);
    try {
      const r = await api.pay(pledge.token, value, extraDays);
      setResult(r);
      setAmount("");
      onDone(r.pledge);
      notify(
        "ok",
        r.remaining_balance <= 0
          ? `${inr.format(r.applied)} received. Loan fully paid. You can now return the gold.`
          : `${inr.format(r.applied)} received. Balance ${inr.format(r.remaining_balance)}.`,
      );
    } catch (err) {
      notify("err", errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel action-panel">
      <h3>Receive payment</h3>
      <ExtraDaysField finance={pledge.finance} value={daysText} onChange={setDaysText} />
      {f.adjustment !== 0 && (
        <p className="muted">
          Interest due {inr.format(pledge.finance.unpaidInterest)} → <b>{inr.format(f.unpaidInterest)}</b> ({f.adjustment < 0 ? "waived" : "added"}{" "}
          {inr.format(Math.abs(f.adjustment))})
        </p>
      )}
      <form className="pay-form" onSubmit={submit}>
        <div className="field grow">
          <label>Amount received (₹, whole rupees)</label>
          <input className="big-input" inputMode="numeric" autoFocus value={amount} onChange={(e) => setAmount(rupeesInput(e.target.value))} />
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => setAmount(String(Math.ceil(f.unpaidInterest)))} disabled={f.unpaidInterest <= 0 || loading}>
          Interest only {inr.format(Math.ceil(f.unpaidInterest))}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setAmount(String(maxToday))} disabled={loading}>
          Full {inr.format(maxToday)}
        </button>
        <button className="btn btn-ok" disabled={busy || tooMuch || loading}>
          Save payment
        </button>
      </form>
      {tooMuch && <div className="notice warn">Amount is more than the total due ({inr.format(maxToday)}).</div>}
      {value > 0 && !tooMuch && (
        <p className="muted">
          This goes {inr.format(Math.min(value, f.unpaidInterest))} to interest and {inr.format(Math.max(0, value - f.unpaidInterest))} to the loan.
        </p>
      )}
      {result && (
        <div className="pay-split">
          <div>
            Interest<br />
            <strong>{inr.format(result.interest_portion)}</strong>
          </div>
          <div>
            Loan<br />
            <strong>{inr.format(result.principal_portion)}</strong>
          </div>
          <div>
            Balance<br />
            <strong>{inr.format(result.remaining_balance)}</strong>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Top-up on the same items: today's balance is carried into a new loan plus the
 * extra cash given now. The owner can change the date, rate and rules.
 */
/** Starting rate for the new loan: the old rate, shown the way the shop counts ₹ interest now. */
function renewRate(pledge: Pledge, basis: RupeeBasis): { unit: RateUnit; rate: string } {
  if (pledge.rate_unit === "rupees" && basis > 0) return { unit: "rupees", rate: String(Number(((pledge.interest_rate * basis) / 100).toFixed(2))) };
  if (pledge.rate_unit === "rupees" && pledge.rate_basis === 0 && pledge.rate_amount !== null) return { unit: "rupees", rate: String(pledge.rate_amount) };
  return { unit: "percent", rate: String(Number(pledge.interest_rate.toFixed(4))) };
}

function RenewPanel({
  pledge,
  basis,
  onDone,
  notify,
}: {
  pledge: Pledge;
  basis: RupeeBasis;
  onDone: (p: Pledge) => void;
  notify: (kind: "ok" | "err" | "warn", text: string) => void;
}) {
  const lastPay = pledge.payments.length ? pledge.payments[pledge.payments.length - 1].received_at : "";
  const minDate = [pledge.pledge_date, lastPay ? new Date(lastPay).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : ""].sort().pop()!;
  const [extra, setExtra] = useState("");
  const [date, setDate] = useState(todayYmd());
  const [unit, setUnit] = useState<RateUnit>(() => renewRate(pledge, basis).unit);
  const [rate, setRate] = useState(() => renewRate(pledge, basis).rate);
  const [period, setPeriod] = useState<RatePeriod>(pledge.rate_period);
  const [type, setType] = useState<InterestType>(pledge.interest_type);
  const [rule, setRule] = useState<Policy>(pledge.partial_month_policy);
  const [daysText, setDaysText] = useState(String(pledge.finance.elapsed.remainingDays));
  const [busy, setBusy] = useState(false);
  const { due, extraDays, loading } = useDue(pledge, daysText, date, notify);

  const extraN = extra === "" ? 0 : Number(extra);
  const carried = due.outstanding;
  const newLoan = Math.round(carried + extraN);
  const rateN = num(rate);
  const perPeriod = (newLoan * ratePercent(unit, rateN, basis, newLoan)) / 100;
  const monthly = period === "monthly" ? perPeriod : perPeriod / 12;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!(newLoan > 0)) return notify("err", "Enter the extra amount to give.");
    if (!(rateN > 0)) return notify("err", "Enter the interest rate.");
    if (unit === "rupees" && basis === 0 && !Number.isInteger(rateN)) return notify("err", "Interest amount must be in whole rupees.");
    if (!window.confirm(`Close ${pledge.token} and create a new loan of ${inr.format(newLoan)}?\nGive the customer ${inr.format(extraN)} now.`)) return;
    setBusy(true);
    try {
      onDone(
        await api.renew(pledge.token, {
          extra_amount: extraN,
          pledge_date: date,
          interest_rate: rateN,
          rate_unit: unit,
          rate_basis: basis,
          rate_period: period,
          interest_type: type,
          partial_month_policy: rule,
          extra_days: extraDays,
        }),
      );
    } catch (err) {
      notify("err", errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel action-panel">
      <h3>Give more money (new loan on the same items)</h3>
      <p className="muted">
        The balance on this loan is moved into a new loan with a new bill. The old bill will no longer be valid.
      </p>
      <form onSubmit={submit}>
        <div className="grid-4">
          <div className="field">
            <label>Extra amount to give now (₹)</label>
            <input className="big-input" inputMode="numeric" autoFocus value={extra} onChange={(e) => setExtra(rupeesInput(e.target.value))} />
          </div>
          <div className="field">
            <label>New loan date</label>
            <input
              type="date"
              min={minDate}
              max={todayYmd()}
              value={date}
              onChange={(e) => {
                setDate(e.target.value || todayYmd());
                setDaysText("");
              }}
            />
          </div>
          <RateField unit={unit} rate={rate} basis={basis} onUnit={setUnit} onRate={setRate} big />
          <div className="field">
            <label>Rate is per</label>
            <select value={period} onChange={(e) => setPeriod(e.target.value as RatePeriod)}>
              <option value="monthly">Month</option>
              <option value="annual">Year</option>
            </select>
          </div>
        </div>
        <details className="more">
          <summary>More options</summary>
          <div className="grid-2">
            <div className="field">
              <label>Interest type</label>
              <select value={type} onChange={(e) => setType(e.target.value as InterestType)}>
                <option value="simple">Simple (normal)</option>
                <option value="compound">Compound (monthly)</option>
              </select>
            </div>
            <div className="field">
              <label>Part-month rule</label>
              <select value={rule} onChange={(e) => setRule(e.target.value as Policy)}>
                {(Object.keys(POLICY_LABEL) as Policy[]).map((k) => (
                  <option key={k} value={k}>
                    {POLICY_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </details>

        <h4>Old loan on {formatDate(date)}</h4>
        <ExtraDaysField finance={due} value={daysText} onChange={setDaysText} />
        <div className="renew-sum">
          <div>
            <span>Loan left</span>
            <b>{inr.format(due.outstandingPrincipal)}</b>
          </div>
          <div>
            <span>+ Interest due{due.adjustment !== 0 && ` (${due.adjustment < 0 ? "waived" : "added"} ${inr.format(Math.abs(due.adjustment))})`}</span>
            <b>{inr.format(due.unpaidInterest)}</b>
          </div>
          <div>
            <span>+ Extra cash now</span>
            <b>{inr.format(extraN)}</b>
          </div>
          <div className="total">
            <span>= New loan amount</span>
            <b>{inr.format(newLoan)}</b>
          </div>
        </div>
        {Number.isFinite(monthly) && monthly > 0 && newLoan > 0 && (
          <div className="hint-strip">
            New interest <b>{inr.format(Math.round(monthly))}</b> per month on {inr.format(newLoan)}
          </div>
        )}
        <button className="btn btn-gold xl" disabled={busy || loading || !(newLoan > 0)}>
          {busy ? "Saving…" : "Create new loan & print bill"}
        </button>
      </form>
    </section>
  );
}

function ReleasePanel({
  pledge,
  onPay,
  onDone,
  notify,
}: {
  pledge: Pledge;
  onPay: () => void;
  onDone: (p: Pledge) => void;
  notify: (kind: "ok" | "err" | "warn", text: string) => void;
}) {
  const [personPhoto, setPersonPhoto] = useState("");
  const [jewelPhoto, setJewelPhoto] = useState("");
  const [checked, setChecked] = useState(false);
  const [returnedTo, setReturnedTo] = useState(pledge.customer_name);
  const [busy, setBusy] = useState(false);
  const f = pledge.finance;

  if (!f.settled) {
    return (
      <section className="panel action-panel">
        <h3>Return gold</h3>
        <div className="notice warn">
          {inr.format(f.outstanding)} is still due. Collect the full amount before returning the gold.
        </div>
        <button type="button" className="btn btn-ok" onClick={onPay}>
          Receive payment
        </button>
      </section>
    );
  }

  const photosReady = !!personPhoto && !!jewelPhoto;
  const nameReady = returnedTo.trim().length >= 2;

  async function release(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      onDone(await api.release(pledge.token, returnedTo.trim(), { customer: personPhoto, jewel: jewelPhoto }));
    } catch (err) {
      notify("err", errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel action-panel">
      <h3>Return gold</h3>
      <ol className="steps">
        <li className={nameReady ? "done" : "current"}>
          <b>Who is collecting the gold?</b>
          <div className="field">
            <label>Returned to (name) *</label>
            <input className="big-input" value={returnedTo} onChange={(e) => setReturnedTo(e.target.value)} maxLength={120} autoComplete="off" />
          </div>
          <p className="muted small">
            {returnedTo.trim() === pledge.customer_name
              ? "Change it if someone else (e.g. a family member) is collecting."
              : `Customer on the bill: ${pledge.customer_name}`}
          </p>
        </li>
        <li className={photosReady ? "done" : nameReady ? "current" : ""}>
          <b>Take photos</b>
          <div className="grid-2">
            <PhotoCapture label="Person collecting" hint="Face clearly visible" value={personPhoto} onChange={setPersonPhoto} facing="user" />
            <PhotoCapture label="Jewellery being returned" hint="All items together" value={jewelPhoto} onChange={setJewelPhoto} />
          </div>
        </li>
        <li className={photosReady && nameReady ? "current" : ""}>
          <b>Confirm and return gold</b>
          <form className="pay-form" onSubmit={release}>
            <label className="check">
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              I checked the customer&apos;s bill and the items match. Gold is handed to <b>{returnedTo.trim() || "—"}</b>.
            </label>
            <button className="btn btn-danger" disabled={busy || !checked || !photosReady || !nameReady}>
              {busy ? "Returning…" : "Confirm & return gold"}
            </button>
          </form>
        </li>
      </ol>
    </section>
  );
}
