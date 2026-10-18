import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, api, type HistoryRow, type Pledge, type Receipt, type Summary } from "./api";
import { formatDate, inr, num, todayYmd } from "./format";

type GoldDraft = { name: string; weight_grams: string; quantity: string; notes: string };

const emptyGold = (): GoldDraft => ({ name: "", weight_grams: "", quantity: "1", notes: "" });

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}

export function App() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<string | null>(null);
  const [policy, setPolicy] = useState("actual_days");
  const [flash, setFlash] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);

  const [tokenPreview, setTokenPreview] = useState("");
  const [name, setName] = useState("");
  const [additional, setAdditional] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [pledgeDate, setPledgeDate] = useState(todayYmd());
  const [principal, setPrincipal] = useState("");
  const [rate, setRate] = useState("2");
  const [ratePeriod, setRatePeriod] = useState<"monthly" | "annual">("monthly");
  const [interestType, setInterestType] = useState<"simple" | "compound">("simple");
  const [notes, setNotes] = useState("");
  const [gold, setGold] = useState<GoldDraft[]>([emptyGold()]);
  const [savedToken, setSavedToken] = useState("");

  const [search, setSearch] = useState("");
  const [current, setCurrent] = useState<Pledge | null>(null);
  const [payAmt, setPayAmt] = useState("");
  const [payResult, setPayResult] = useState<{
    applied: number;
    interest_portion: number;
    principal_portion: number;
    remaining_balance: number;
  } | null>(null);
  const [otpInfo, setOtpInfo] = useState<{ demo: boolean; demoOtp?: string; message: string; sent: boolean } | null>(
    null,
  );
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);

  const [cPrincipal, setCPrincipal] = useState("10000");
  const [cRate, setCRate] = useState("2");
  const [cPeriod, setCPeriod] = useState<"monthly" | "annual">("monthly");
  const [cType, setCType] = useState<"simple" | "compound">("simple");
  const [cStart, setCStart] = useState(todayYmd());
  const [cEnd, setCEnd] = useState(todayYmd());
  const [cOut, setCOut] = useState<{
    days: number;
    completedMonths: number;
    remainingDays: number;
    interest: number;
    totalPayable: number;
  } | null>(null);

  const [dStart, setDStart] = useState(todayYmd());
  const [dEnd, setDEnd] = useState(todayYmd());
  const [dMonths, setDMonths] = useState("1");
  const [dOut, setDOut] = useState<{
    days: number;
    completedMonths: number;
    remainingDays: number;
    dueDate: string;
    dueDates: { months: number; date: string }[];
  } | null>(null);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [histQ, setHistQ] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [login, setLogin] = useState({ username: "owner", password: "" });

  const refreshSide = useCallback(async () => {
    const [s, h, t] = await Promise.all([api.summary(), api.history(histQ), api.previewToken()]);
    setSummary(s);
    setHistory(h);
    setTokenPreview(t.token);
  }, [histQ]);

  useEffect(() => {
    api
      .me()
      .then(async (m) => {
        setUser(m.user.username);
        setPolicy(m.settings.partial_month_policy);
        await refreshSide();
      })
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, [refreshSide]);

  useEffect(() => {
    if (!user) return;
    const t = window.setTimeout(() => {
      api.history(histQ).then(setHistory).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(t);
  }, [histQ, user]);

  useEffect(() => {
    if (!user) return;
    const body = {
      principal: num(cPrincipal),
      ratePercent: num(cRate),
      ratePeriod: cPeriod,
      interestType: cType,
      startDate: cStart,
      endDate: cEnd,
    };
    api
      .calcInterest(body)
      .then((r) => setCOut(r as typeof cOut))
      .catch(() => setCOut(null));
  }, [user, cPrincipal, cRate, cPeriod, cType, cStart, cEnd]);

  useEffect(() => {
    if (!user) return;
    api
      .calcDates({ startDate: dStart, endDate: dEnd, addMonths: Number(dMonths) || 1 })
      .then((r) => setDOut(r as typeof dOut))
      .catch(() => setDOut(null));
  }, [user, dStart, dEnd, dMonths]);

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.login(login.username, login.password);
      setUser(r.user.username);
      const m = await api.me();
      setPolicy(m.settings.partial_month_policy);
      await refreshSide();
    } catch (err) {
      setFlash({ kind: "err", text: errMsg(err) });
    } finally {
      setBusy(false);
    }
  }

  async function savePledge(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFlash(null);
    try {
      const created = await api.createPledge({
        customer_name: name,
        additional_name: additional,
        mobile,
        email,
        pledge_date: pledgeDate,
        principal: num(principal),
        interest_rate: num(rate),
        rate_period: ratePeriod,
        interest_type: interestType,
        notes,
        gold: gold.map((g) => ({
          name: g.name,
          weight_grams: num(g.weight_grams),
          quantity: Number(g.quantity) || 1,
          notes: g.notes,
        })),
      });
      setSavedToken(created.token);
      setSearch(created.token);
      setCurrent(created);
      setName("");
      setAdditional("");
      setMobile("");
      setEmail("");
      setPrincipal("");
      setNotes("");
      setGold([emptyGold()]);
      setFlash({ kind: "ok", text: `Pledge saved. Token ${created.token}` });
      await refreshSide();
    } catch (err) {
      setFlash({ kind: "err", text: errMsg(err) });
    } finally {
      setBusy(false);
    }
  }

  async function doSearch(token = search) {
    if (!token.trim()) return;
    setBusy(true);
    setPayResult(null);
    setOtpInfo(null);
    setOtp("");
    try {
      const p = await api.getPledge(token.trim().toUpperCase());
      setCurrent(p);
      setSearch(p.token);
    } catch (err) {
      setCurrent(null);
      setFlash({ kind: "err", text: errMsg(err) });
    } finally {
      setBusy(false);
    }
  }

  async function doPay() {
    if (!current) return;
    setBusy(true);
    try {
      const r = await api.pay(current.token, num(payAmt));
      setPayResult(r);
      setCurrent(r.pledge);
      setPayAmt("");
      setFlash({ kind: "ok", text: `Payment of ${inr.format(r.applied)} recorded.` });
      await refreshSide();
    } catch (err) {
      setFlash({ kind: "err", text: errMsg(err) });
    } finally {
      setBusy(false);
    }
  }

  async function calcOnRecord() {
    if (!current) return;
    const p = await api.getPledge(current.token);
    setCurrent(p);
  }

  async function requestOtp() {
    if (!current) return;
    setBusy(true);
    try {
      const r = await api.requestOtp(current.token);
      setOtpInfo(r);
      if (!r.sent) {
        setFlash({ kind: "warn", text: r.message });
      } else {
        setFlash({ kind: "ok", text: r.message });
      }
    } catch (err) {
      setFlash({ kind: "err", text: errMsg(err) });
    } finally {
      setBusy(false);
    }
  }

  async function doRelease() {
    if (!current) return;
    setBusy(true);
    try {
      const p = await api.release(current.token, otp);
      setCurrent(p);
      setOtp("");
      setOtpInfo(null);
      setFlash({ kind: "ok", text: `Gold released for ${p.token}.` });
      await refreshSide();
    } catch (err) {
      setFlash({ kind: "err", text: errMsg(err) });
    } finally {
      setBusy(false);
    }
  }

  async function printReceipt(kind: "pledge" | "payment" | "release") {
    const token = current?.token || savedToken;
    if (!token) {
      setFlash({ kind: "err", text: "Save or search a token first." });
      return;
    }
    const snap = await api.receipt(token, kind);
    setReceipt(snap);
    window.setTimeout(() => window.print(), 50);
  }

  const goldWeight = useMemo(
    () => current?.gold.reduce((s, g) => s + g.weight_grams * g.quantity, 0) ?? 0,
    [current],
  );

  if (!ready) return <div className="login"><div className="login-card">Loading…</div></div>;

  if (!user) {
    return (
      <div className="login">
        <form className="login-card" onSubmit={onLogin}>
          <h1>KRISHNA GOLD SHOP</h1>
          <p>Single window pledge desk</p>
          {flash && <div className={`notice ${flash.kind}`}>{flash.text}</div>}
          <div className="field">
            <label>Username</label>
            <input value={login.username} onChange={(e) => setLogin({ ...login, username: e.target.value })} />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              value={login.password}
              onChange={(e) => setLogin({ ...login, password: e.target.value })}
            />
          </div>
          <button className="btn btn-gold large" disabled={busy}>
            Sign in
          </button>
          <p style={{ fontSize: 12 }}>Default login: owner / KrishnaGold@123 — change it after first sign-in.</p>
        </form>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>KRISHNA GOLD SHOP</h1>
          <small>Single window · Asia/Kolkata · Indian Rupees</small>
        </div>
        <div className="topbar-actions">
          <span>Signed in as {user}</span>
          <input
            placeholder="Current password"
            type="password"
            value={pw.current}
            onChange={(e) => setPw({ ...pw, current: e.target.value })}
            style={{ width: 140 }}
          />
          <input
            placeholder="New password"
            type="password"
            value={pw.next}
            onChange={(e) => setPw({ ...pw, next: e.target.value })}
            style={{ width: 140 }}
          />
          <button
            className="btn btn-ghost"
            onClick={async () => {
              try {
                await api.changePassword(pw.current, pw.next);
                setFlash({ kind: "ok", text: "Password updated." });
                setPw({ current: "", next: "" });
              } catch (e) {
                setFlash({ kind: "err", text: errMsg(e) });
              }
            }}
          >
            Change password
          </button>
          <button
            className="btn btn-ghost"
            onClick={async () => {
              const r = await api.backup();
              setFlash({ kind: "ok", text: `Backup saved: ${r.file}` });
            }}
          >
            Backup DB
          </button>
          <button
            className="btn btn-ink"
            onClick={async () => {
              await api.logout();
              setUser(null);
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      {flash && <div className={`notice ${flash.kind}`} style={{ margin: "8px 12px 0" }}>{flash.text}</div>}

      <section className="workspace">
        <aside className="col">
          <h2>Customer & gold pledge</h2>
          <div className="token-box">Next token: {tokenPreview}</div>
          <form onSubmit={savePledge}>
            <div className="grid-2">
              <div className="field">
                <label>Customer name</label>
                <input required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field">
                <label>Father / husband name</label>
                <input value={additional} onChange={(e) => setAdditional(e.target.value)} />
              </div>
              <div className="field">
                <label>Mobile</label>
                <input required inputMode="numeric" maxLength={10} value={mobile} onChange={(e) => setMobile(e.target.value)} />
              </div>
              <div className="field">
                <label>Email (optional)</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="field">
                <label>Pledge date</label>
                <input type="date" required value={pledgeDate} onChange={(e) => setPledgeDate(e.target.value)} />
              </div>
              <div className="field">
                <label>Principal (₹)</label>
                <input required value={principal} onChange={(e) => setPrincipal(e.target.value)} />
              </div>
              <div className="field">
                <label>Interest rate</label>
                <input required value={rate} onChange={(e) => setRate(e.target.value)} />
              </div>
              <div className="field">
                <label>Rate type</label>
                <select value={ratePeriod} onChange={(e) => setRatePeriod(e.target.value as "monthly" | "annual")}>
                  <option value="monthly">Monthly</option>
                  <option value="annual">Annual</option>
                </select>
              </div>
              <div className="field">
                <label>Interest calculation</label>
                <select value={interestType} onChange={(e) => setInterestType(e.target.value as "simple" | "compound")}>
                  <option value="simple">Simple</option>
                  <option value="compound">Compound (monthly)</option>
                </select>
              </div>
            </div>
            {gold.map((g, i) => (
              <div className="gold-card" key={i}>
                <header>
                  <strong>Gold item {i + 1}</strong>
                  {gold.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setGold(gold.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  )}
                </header>
                <div className="grid-3">
                  <div className="field">
                    <label>Item name</label>
                    <input required value={g.name} onChange={(e) => {
                      const next = [...gold];
                      next[i] = { ...g, name: e.target.value };
                      setGold(next);
                    }} />
                  </div>
                  <div className="field">
                    <label>Weight (g)</label>
                    <input required value={g.weight_grams} onChange={(e) => {
                      const next = [...gold];
                      next[i] = { ...g, weight_grams: e.target.value };
                      setGold(next);
                    }} />
                  </div>
                  <div className="field">
                    <label>Quantity</label>
                    <input required value={g.quantity} onChange={(e) => {
                      const next = [...gold];
                      next[i] = { ...g, quantity: e.target.value };
                      setGold(next);
                    }} />
                  </div>
                </div>
              </div>
            ))}
            <button type="button" className="btn btn-ghost" onClick={() => setGold([...gold, emptyGold()])}>
              Add another gold item
            </button>
            <div className="field">
              <label>Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <button className="btn btn-gold large" disabled={busy}>
              SAVE PLEDGE
            </button>
          </form>
          {savedToken && (
            <div className="notice ok">
              Saved token <strong>{savedToken}</strong>{" "}
              <button className="btn btn-ink" type="button" onClick={() => printReceipt("pledge")}>
                Print receipt
              </button>
            </div>
          )}
        </aside>

        <main className="col">
          <h2>Token search · payment · gold release</h2>
          <form
            className="search-row"
            onSubmit={(e) => {
              e.preventDefault();
              void doSearch();
            }}
          >
            <input
              placeholder="Enter token number"
              value={search}
              onChange={(e) => setSearch(e.target.value.toUpperCase())}
            />
            <button className="btn btn-gold" disabled={busy}>
              SEARCH
            </button>
          </form>

          {current && (
            <>
              <div className="kv" style={{ marginTop: 12 }}>
                <div><b>Customer</b><div>{current.customer_name} {current.additional_name && `(${current.additional_name})`}</div></div>
                <div><b>Mobile</b><div>{current.mobile}</div></div>
                <div><b>Token</b><div>{current.token}</div></div>
                <div><b>Pledge date</b><div>{formatDate(current.pledge_date)}</div></div>
                <div><b>Principal</b><div>{inr.format(current.principal)}</div></div>
                <div><b>Interest</b><div>{current.interest_rate}% {current.rate_period} / {current.interest_type}</div></div>
                <div><b>Elapsed</b><div>{current.finance.elapsed.days} days · {current.finance.elapsed.completedMonths} mo {current.finance.elapsed.remainingDays} d</div></div>
                <div><b>Interest accrued</b><div>{inr.format(current.finance.calc.interest)}</div></div>
                <div><b>Total payable</b><div>{inr.format(current.finance.calc.totalPayable)}</div></div>
                <div><b>Payments received</b><div>{inr.format(current.finance.totalPaid)}</div></div>
                <div><b>Outstanding</b><div>{inr.format(current.finance.outstanding)}</div></div>
                <div><b>Status</b><div><span className={`status status-${current.status}`}>{current.status}</span></div></div>
              </div>

              <h3 style={{ fontSize: 13, margin: "12px 0 6px" }}>Gold items · {goldWeight.toFixed(2)} g</h3>
              <table style={{ width: "100%", fontSize: 13 }}>
                <thead>
                  <tr><th>Item</th><th>Qty</th><th>Weight (g)</th></tr>
                </thead>
                <tbody>
                  {current.gold.map((g, i) => (
                    <tr key={i}>
                      <td>{g.name}</td>
                      <td>{g.quantity}</td>
                      <td>{g.weight_grams}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {current.payments.length > 0 && (
                <>
                  <h3 style={{ fontSize: 13, margin: "12px 0 6px" }}>Previous payments</h3>
                  <table style={{ width: "100%", fontSize: 12 }}>
                    <thead>
                      <tr><th>When</th><th>Amount</th><th>Interest</th><th>Principal</th><th>Balance</th></tr>
                    </thead>
                    <tbody>
                      {current.payments.map((p) => (
                        <tr key={p.id}>
                          <td>{new Date(p.received_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
                          <td>{inr.format(p.amount)}</td>
                          <td>{inr.format(p.interest_portion)}</td>
                          <td>{inr.format(p.principal_portion)}</td>
                          <td>{inr.format(p.balance_after)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              <div className="btn-row four">
                <button className="btn btn-ink" type="button" onClick={() => void calcOnRecord()}>
                  CALCULATE INTEREST
                </button>
                <button className="btn btn-gold" type="button" onClick={() => void printReceipt(current.status === "RELEASED" ? "release" : "pledge")}>
                  PRINT RECEIPT
                </button>
              </div>

              {current.status === "ACTIVE" && (
                <>
                  <div className="grid-2" style={{ marginTop: 10 }}>
                    <div className="field">
                      <label>Amount received (₹)</label>
                      <input value={payAmt} onChange={(e) => setPayAmt(e.target.value)} />
                    </div>
                    <div className="field">
                      <label>&nbsp;</label>
                      <button className="btn btn-ok" type="button" onClick={() => void doPay()} disabled={busy}>
                        RECORD PAYMENT
                      </button>
                    </div>
                  </div>
                  {payResult && (
                    <div className="pay-split">
                      <div>Interest<br /><strong>{inr.format(payResult.interest_portion)}</strong></div>
                      <div>Principal<br /><strong>{inr.format(payResult.principal_portion)}</strong></div>
                      <div>Balance<br /><strong>{inr.format(payResult.remaining_balance)}</strong></div>
                    </div>
                  )}

                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
                    <strong>Gold release</strong>
                    <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 8px" }}>
                      Full settlement is required. Partial payment never releases gold.
                    </p>
                    {!current.finance.settled && (
                      <div className="notice warn">
                        Outstanding {inr.format(current.finance.outstanding)}. Collect the balance before OTP.
                      </div>
                    )}
                    <div className="btn-row">
                      <button
                        className="btn btn-ink"
                        type="button"
                        disabled={busy || !current.finance.settled}
                        onClick={() => void requestOtp()}
                      >
                        Generate OTP
                      </button>
                      <button className="btn btn-danger" type="button" disabled={busy || !otp} onClick={() => void doRelease()}>
                        RELEASE GOLD
                      </button>
                    </div>
                    {otpInfo && (
                      <div className={`notice ${otpInfo.demo ? "demo" : "ok"}`}>
                        {otpInfo.sent
                          ? otpInfo.message
                          : otpInfo.message}
                        {otpInfo.demo && otpInfo.demoOtp && (
                          <>
                            <br />
                            DEMO OTP (not sent by SMS or email): <code>{otpInfo.demoOtp}</code>
                          </>
                        )}
                      </div>
                    )}
                    <div className="field">
                      <label>Enter OTP</label>
                      <input value={otp} onChange={(e) => setOtp(e.target.value)} maxLength={8} />
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </main>

        <aside className="col">
          <h2>Interest calculator</h2>
          <div className="field">
            <label>Partial month policy (shop-wide)</label>
            <select
              value={policy}
              onChange={async (e) => {
                const v = e.target.value;
                setPolicy(v);
                await api.saveSettings(v);
              }}
            >
              <option value="actual_days">Actual days (days ÷ 30)</option>
              <option value="thirty_day_month">Calendar months + leftover days ÷ 30</option>
              <option value="round_up_month">Round leftover days up to a month</option>
            </select>
          </div>
          <div className="grid-2">
            <div className="field"><label>Principal</label><input value={cPrincipal} onChange={(e) => setCPrincipal(e.target.value)} /></div>
            <div className="field"><label>Rate</label><input value={cRate} onChange={(e) => setCRate(e.target.value)} /></div>
            <div className="field">
              <label>Monthly / annual</label>
              <select value={cPeriod} onChange={(e) => setCPeriod(e.target.value as "monthly" | "annual")}>
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
              </select>
            </div>
            <div className="field">
              <label>Simple / compound</label>
              <select value={cType} onChange={(e) => setCType(e.target.value as "simple" | "compound")}>
                <option value="simple">Simple</option>
                <option value="compound">Compound</option>
              </select>
            </div>
            <div className="field"><label>Start</label><input type="date" value={cStart} onChange={(e) => setCStart(e.target.value)} /></div>
            <div className="field"><label>End</label><input type="date" value={cEnd} onChange={(e) => setCEnd(e.target.value)} /></div>
          </div>
          {cOut && (
            <div className="calc-result">
              <div>Days / months<strong>{cOut.days} d · {cOut.completedMonths} mo {cOut.remainingDays} d</strong></div>
              <div>Interest<strong>{inr.format(cOut.interest)}</strong></div>
              <div>Total payable<strong>{inr.format(cOut.totalPayable)}</strong></div>
            </div>
          )}

          <h2 style={{ marginTop: 16 }}>Date calculator</h2>
          <div className="grid-2">
            <div className="field"><label>Start date</label><input type="date" value={dStart} onChange={(e) => setDStart(e.target.value)} /></div>
            <div className="field"><label>End date</label><input type="date" value={dEnd} onChange={(e) => setDEnd(e.target.value)} /></div>
            <div className="field">
              <label>Due after months</label>
              <select value={dMonths} onChange={(e) => setDMonths(e.target.value)}>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>{i + 1} month{i ? "s" : ""}</option>
                ))}
              </select>
            </div>
          </div>
          {dOut && (
            <div className="calc-result">
              <div>Days<strong>{dOut.days}</strong></div>
              <div>Months + leftover<strong>{dOut.completedMonths} mo · {dOut.remainingDays} d</strong></div>
              <div>Due date<strong>{formatDate(dOut.dueDate)}</strong></div>
            </div>
          )}
        </aside>
      </section>

      <section className="summary-strip">
        <div className="card"><div className="lbl">Active pledges</div><div className="val">{summary?.active ?? 0}</div></div>
        <div className="card"><div className="lbl">Gold items / weight</div><div className="val">{summary?.items ?? 0} · {(summary?.weight ?? 0).toFixed(2)} g</div></div>
        <div className="card"><div className="lbl">Principal outstanding</div><div className="val">{inr.format(summary?.principalOutstanding ?? 0)}</div></div>
        <div className="card"><div className="lbl">Accrued interest</div><div className="val">{inr.format(summary?.accruedInterest ?? 0)}</div></div>
        <div className="card"><div className="lbl">Expected collection</div><div className="val">{inr.format(summary?.expectedCollection ?? 0)}</div></div>
        <div className="card"><div className="lbl">Payments received</div><div className="val">{inr.format(summary?.paymentsReceived ?? 0)}</div></div>
        <div className="card"><div className="lbl">Amount pending</div><div className="val">{inr.format(summary?.amountPending ?? 0)}</div></div>
        <div className="card"><div className="lbl">Released records</div><div className="val">{summary?.released ?? 0}</div></div>
      </section>

      <section className="history">
        <header>
          <h2 style={{ margin: 0 }}>Transaction history</h2>
          <div className="history-search">
            <input placeholder="Search token or name" value={histQ} onChange={(e) => setHistQ(e.target.value)} />
          </div>
        </header>
        <table>
          <thead>
            <tr>
              <th>Token</th><th>Customer</th><th>Date</th><th>Principal</th><th>Payments</th><th>Interest</th><th>Balance</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {history.map((r) => (
              <tr key={r.token} className="clickable" onClick={() => { setSearch(r.token); void doSearch(r.token); }}>
                <td>{r.token}</td>
                <td>{r.customer_name}</td>
                <td>{formatDate(r.pledge_date)}</td>
                <td>{inr.format(r.principal)}</td>
                <td>{inr.format(r.payments)}</td>
                <td>{inr.format(r.interest)}</td>
                <td>{inr.format(r.balance)}</td>
                <td><span className={`status status-${r.status}`}>{r.status}</span></td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr><td colSpan={8}>No records yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {receipt && (
        <article className="receipt-sheet">
          <h1>KRISHNA GOLD SHOP</h1>
          <p style={{ textAlign: "center" }}>Gold Pledge Receipt</p>
          <p>
            Receipt {receipt.receipt_no} · Token {receipt.pledge.token} · {formatDate(receipt.pledge.pledge_date)}
          </p>
          <p>
            Customer: {receipt.pledge.customer_name}
            {receipt.pledge.additional_name ? ` s/o / w/o ${receipt.pledge.additional_name}` : ""} · Mobile {receipt.pledge.mobile}
          </p>
          <table>
            <thead><tr><th>Gold item</th><th>Qty</th><th>Weight (g)</th></tr></thead>
            <tbody>
              {receipt.pledge.gold.map((g, i) => (
                <tr key={i}><td>{g.name}</td><td>{g.quantity}</td><td>{g.weight_grams}</td></tr>
              ))}
            </tbody>
          </table>
          <p>
            Principal {inr.format(receipt.pledge.principal)} · Rate {receipt.pledge.interest_rate}% {receipt.pledge.rate_period} · {receipt.pledge.interest_type} · Policy {receipt.policy}
          </p>
          <p>
            Paid {inr.format(receipt.pledge.finance.totalPaid)} · Balance {inr.format(receipt.pledge.finance.outstanding)} · Status {receipt.pledge.status}
          </p>
          <h3>1–12 month repayment chart</h3>
          <table>
            <thead><tr><th>Month</th><th>Due date</th><th>Interest</th><th>Total payable</th></tr></thead>
            <tbody>
              {receipt.chart.map((row) => (
                <tr key={row.month}>
                  <td>{row.month}</td>
                  <td>{formatDate(row.dueDate)}</td>
                  <td>{inr.format(row.interest)}</td>
                  <td>{inr.format(row.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>Use the browser Print dialog and choose Save as PDF for a PDF copy.</p>
          <div className="signs">
            <div>Customer signature</div>
            <div>Shop owner signature</div>
          </div>
        </article>
      )}
    </div>
  );
}
