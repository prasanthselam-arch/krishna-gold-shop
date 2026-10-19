import { Suspense, lazy, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, photoUrl, type HistoryRow, type OtpResult, type Photo, type Pledge, type ReceiptKind } from "../api";
import { TOKEN_PATTERN, errMsg, formatDate, formatDateTime, grams, inr, num } from "../format";
import { Modal } from "../components/Modal";
import { PhotoCapture } from "../components/PhotoCapture";

const BarcodeScanner = lazy(() => import("../components/BarcodeScanner").then((m) => ({ default: m.BarcodeScanner })));

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
}: {
  pledge: Pledge | null;
  setPledge: (p: Pledge | null) => void;
  active: boolean;
  onPrint: (token: string, kind: ReceiptKind) => void;
  onCalc: (p: Pledge) => void;
  notify: (kind: "ok" | "err" | "warn", text: string) => void;
  onChanged: () => void;
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<HistoryRow[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"none" | "pay" | "release">("none");
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
          placeholder="Scan barcode, or type token / name / mobile"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
        <button className="btn btn-gold" disabled={busy}>
          Search
        </button>
        <button type="button" className="btn btn-ink" onClick={() => setScanning(true)}>
          Scan with camera
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
              <span className={`status status-${r.status}`}>{r.status === "ACTIVE" ? "Active" : "Closed"}</span>
            </button>
          ))}
        </div>
      )}

      {!pledge && !matches && (
        <div className="empty-state">
          <p>Scan the barcode on the customer's bill to open the pledge.</p>
          <p className="muted">A USB barcode scanner works directly: click the box above and scan.</p>
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
                <span className={`status status-${pledge.status}`}>{pledge.status === "ACTIVE" ? "Active" : "Closed"}</span>
              </div>
              <h2>{pledge.customer_name}</h2>
              <div className="muted">
                {pledge.additional_name && <>c/o {pledge.additional_name} · </>}
                {pledge.mobile}
                {pledge.email && <> · {pledge.email}</>}
              </div>
              <div className="muted">
                Pledged on {formatDate(pledge.pledge_date)} · {pledge.interest_rate}% per{" "}
                {pledge.rate_period === "monthly" ? "month" : "year"}
                {pledge.interest_type === "compound" && " (compound)"}
              </div>
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
                <span>Closed on {pledge.released_at ? formatDateTime(pledge.released_at) : "—"}</span>
                <strong>{inr.format(f.totalPaid)} paid</strong>
              </div>
              <div className="split">
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
              </>
            )}
            <button type="button" className="btn btn-gold big" onClick={() => onPrint(pledge.token, pledge.status === "RELEASED" ? "release" : "pledge")}>
              Print bill
            </button>
            {pledge.payments.length > 0 && (
              <button type="button" className="btn btn-ghost big" onClick={() => onPrint(pledge.token, "payment")}>
                Print last payment
              </button>
            )}
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
              onPrint={() => onPrint(pledge.token, "payment")}
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
                notify("ok", `Gold returned. Pledge ${p.token} is closed.`);
                onPrint(p.token, "release");
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
                        <td>{formatDateTime(p.received_at)}</td>
                        <td>{inr.format(p.amount)}</td>
                        <td>{inr.format(p.interest_portion)}</td>
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
          <BarcodeScanner onClose={closeScanner} onResult={onScan} />
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

function PaymentPanel({
  pledge,
  onDone,
  onPrint,
  notify,
}: {
  pledge: Pledge;
  onDone: (p: Pledge) => void;
  onPrint: () => void;
  notify: (kind: "ok" | "err" | "warn", text: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ applied: number; interest_portion: number; principal_portion: number; remaining_balance: number } | null>(null);
  const f = pledge.finance;
  const value = num(amount);
  const tooMuch = value > f.outstanding + 0.009;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!(value > 0)) {
      notify("err", "Enter the amount received.");
      return;
    }
    setBusy(true);
    try {
      const r = await api.pay(pledge.token, value);
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
      <form className="pay-form" onSubmit={submit}>
        <div className="field grow">
          <label>Amount received (₹)</label>
          <input className="big-input" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => setAmount(String(f.unpaidInterest))} disabled={f.unpaidInterest <= 0}>
          Interest only {inr.format(f.unpaidInterest)}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setAmount(String(f.outstanding))}>
          Full {inr.format(f.outstanding)}
        </button>
        <button className="btn btn-ok" disabled={busy || tooMuch}>
          Save payment
        </button>
      </form>
      {tooMuch && <div className="notice warn">Amount is more than the total due ({inr.format(f.outstanding)}).</div>}
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
          <button type="button" className="btn btn-gold" onClick={onPrint}>
            Print receipt
          </button>
        </div>
      )}
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
  const [otpInfo, setOtpInfo] = useState<OtpResult | null>(null);
  const [otp, setOtp] = useState("");
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

  async function sendOtp() {
    setBusy(true);
    try {
      const r = await api.requestOtp(pledge.token);
      setOtpInfo(r);
      notify(r.sent ? "ok" : "warn", r.message);
    } catch (err) {
      notify("err", errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function release(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      onDone(await api.release(pledge.token, otp.trim(), { customer: personPhoto, jewel: jewelPhoto }));
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
        <li className={photosReady ? "done" : "current"}>
          <b>Take photos</b>
          <div className="grid-2">
            <PhotoCapture label="Person collecting" hint="Face clearly visible" value={personPhoto} onChange={setPersonPhoto} facing="user" />
            <PhotoCapture label="Jewellery being returned" hint="All items together" value={jewelPhoto} onChange={setJewelPhoto} />
          </div>
        </li>
        <li className={!photosReady ? "" : otpInfo ? "done" : "current"}>
          <b>Send OTP to customer ({pledge.mobile})</b>
          <div>
            <button type="button" className="btn btn-ink" disabled={busy || !photosReady} onClick={() => void sendOtp()}>
              {otpInfo ? "Send OTP again" : "Send OTP"}
            </button>
          </div>
          {otpInfo?.demo && otpInfo.demoOtp && (
            <div className="notice demo">
              SMS/email is not set up, so the OTP was not sent. Demo OTP: <code>{otpInfo.demoOtp}</code>
            </div>
          )}
        </li>
        <li className={otpInfo ? "current" : ""}>
          <b>Enter OTP and return gold</b>
          <form className="pay-form" onSubmit={release}>
            <div className="field">
              <label>6-digit OTP</label>
              <input
                className="big-input otp"
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                disabled={!otpInfo}
              />
            </div>
            <button className="btn btn-danger" disabled={busy || otp.length !== 6 || !photosReady}>
              Confirm & return gold
            </button>
          </form>
        </li>
      </ol>
    </section>
  );
}
