import { useState, type FormEvent } from "react";
import { api, type InterestType, type Pledge, type RatePeriod, type RateUnit } from "../api";
import { errMsg, grams, inr, num, rupeesInput, todayYmd } from "../format";
import { PhotoCapture } from "../components/PhotoCapture";

type GoldDraft = { name: string; weight: string; quantity: string };
const emptyGold = (): GoldDraft => ({ name: "", weight: "", quantity: "1" });

const ITEM_NAMES = ["Chain", "Necklace", "Ring", "Bangle", "Bracelet", "Earrings", "Stud", "Anklet", "Coin", "Pendant", "Mangalsutra"];

export function NewPledge({
  tokenPreview,
  onSaved,
}: {
  tokenPreview: string;
  onSaved: (p: Pledge) => void;
}) {
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [customerPhoto, setCustomerPhoto] = useState("");
  const [gold, setGold] = useState<GoldDraft[]>([emptyGold()]);
  const [jewelPhoto, setJewelPhoto] = useState("");
  const [principal, setPrincipal] = useState("");
  const [rate, setRate] = useState("2");
  const [unit, setUnit] = useState<RateUnit>("percent");
  const [period, setPeriod] = useState<RatePeriod>("monthly");
  const [type, setType] = useState<InterestType>("simple");
  const [date, setDate] = useState(todayYmd());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const amount = num(principal);
  const rateN = num(rate);
  const perPeriod = unit === "rupees" ? rateN : (amount * rateN) / 100;
  const monthly = Number.isFinite(amount) && Number.isFinite(rateN) ? (period === "monthly" ? perPeriod : perPeriod / 12) : NaN;
  const totalWeight = gold.reduce((s, g) => {
    const w = num(g.weight);
    const q = Number(g.quantity) || 0;
    return s + (Number.isFinite(w) ? w * q : 0);
  }, 0);

  const setItem = (i: number, patch: Partial<GoldDraft>) => setGold(gold.map((g, j) => (j === i ? { ...g, ...patch } : g)));

  function validate(): string {
    if (name.trim().length < 2) return "Enter the customer's name.";
    if (!/^[6-9]\d{9}$/.test(mobile.trim())) return "Enter a valid 10-digit mobile number.";
    if (!customerPhoto) return "Take the customer's photo.";
    for (const [i, g] of gold.entries()) {
      if (!g.name.trim()) return `Gold item ${i + 1}: enter the item name.`;
      if (!(num(g.weight) > 0)) return `Gold item ${i + 1}: enter weight in grams.`;
      if (!(Number(g.quantity) >= 1) || !Number.isInteger(Number(g.quantity))) return `Gold item ${i + 1}: quantity must be 1 or more.`;
    }
    if (!jewelPhoto) return "Take a photo of the jewellery.";
    if (!(amount > 0)) return "Enter the loan amount.";
    if (!Number.isInteger(amount)) return "Loan amount must be in whole rupees (no paise).";
    if (unit === "rupees" && !Number.isInteger(rateN)) return "Interest amount must be in whole rupees (no paise).";
    if (!(rateN > 0)) return "Enter the interest rate.";
    if (unit === "percent" && rateN > 100) return "Interest rate looks too high.";
    if (unit === "rupees" && rateN > amount) return "Interest amount is more than the loan amount.";
    if (!date || date > todayYmd()) return "Pledge date cannot be in the future.";
    return "";
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = validate();
    setError(problem);
    if (problem) return;
    setBusy(true);
    try {
      const created = await api.createPledge({
        customer_name: name.trim(),
        additional_name: relation.trim(),
        mobile: mobile.trim(),
        email: email.trim(),
        pledge_date: date,
        principal: amount,
        interest_rate: rateN,
        rate_unit: unit,
        rate_period: period,
        interest_type: type,
        notes,
        gold: gold.map((g) => ({ name: g.name.trim(), weight_grams: num(g.weight), quantity: Number(g.quantity) })),
        photos: { customer: customerPhoto, jewel: jewelPhoto },
      });
      setName("");
      setRelation("");
      setMobile("");
      setEmail("");
      setCustomerPhoto("");
      setGold([emptyGold()]);
      setJewelPhoto("");
      setPrincipal("");
      setNotes("");
      setDate(todayYmd());
      onSaved(created);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="page new-pledge" onSubmit={submit} noValidate>
      <div className="page-head">
        <h2>New Registration</h2>
        <span className="token-chip">Next token: {tokenPreview || "…"}</span>
      </div>

      <section className="panel">
        <h3>
          <span className="step">1</span> Customer
        </h3>
        <div className="with-photo">
          <div className="grid-2">
            <div className="field">
              <label>Customer name *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            </div>
            <div className="field">
              <label>Father / husband name</label>
              <input value={relation} onChange={(e) => setRelation(e.target.value)} autoComplete="off" />
            </div>
            <div className="field">
              <label>Mobile number *</label>
              <input
                inputMode="numeric"
                maxLength={10}
                value={mobile}
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))}
                placeholder="10 digits"
              />
            </div>
            <div className="field">
              <label>Email (optional)</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <PhotoCapture label="Customer photo" hint="Face clearly visible" value={customerPhoto} onChange={setCustomerPhoto} facing="user" />
        </div>
      </section>

      <section className="panel">
        <h3>
          <span className="step">2</span> Gold items
          <span className="muted right">Total {grams(totalWeight)}</span>
        </h3>
        <div className="with-photo">
          <div>
            <datalist id="item-names">
              {ITEM_NAMES.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            {gold.map((g, i) => (
              <div className="gold-row" key={i}>
                <div className="field grow">
                  <label>Item {i + 1}</label>
                  <input list="item-names" placeholder="e.g. Chain" value={g.name} onChange={(e) => setItem(i, { name: e.target.value })} />
                </div>
                <div className="field">
                  <label>Weight each (g)</label>
                  <input inputMode="decimal" value={g.weight} onChange={(e) => setItem(i, { weight: e.target.value })} />
                </div>
                <div className="field qty">
                  <label>Qty</label>
                  <input inputMode="numeric" value={g.quantity} onChange={(e) => setItem(i, { quantity: e.target.value.replace(/\D/g, "") })} />
                </div>
                {gold.length > 1 && (
                  <button type="button" className="icon-btn danger" aria-label="Remove item" onClick={() => setGold(gold.filter((_, j) => j !== i))}>
                    ×
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="btn btn-ghost" onClick={() => setGold([...gold, emptyGold()])}>
              + Add another item
            </button>
          </div>
          <PhotoCapture label="Jewellery photo" hint="All items together" value={jewelPhoto} onChange={setJewelPhoto} />
        </div>
      </section>

      <section className="panel">
        <h3>
          <span className="step">3</span> Loan
        </h3>
        <div className="grid-4">
          <div className="field">
            <label>Loan amount (₹) *</label>
            <input className="big-input" inputMode="numeric" value={principal} onChange={(e) => setPrincipal(rupeesInput(e.target.value))} />
          </div>
          <div className="field">
            <label>Interest {unit === "percent" ? "rate (%)" : "amount (₹)"} *</label>
            <div className="input-unit">
              <input
                className="big-input"
                inputMode={unit === "rupees" ? "numeric" : "decimal"}
                value={rate}
                onChange={(e) => setRate(unit === "rupees" ? rupeesInput(e.target.value) : e.target.value)}
              />
              <div className="seg" role="group" aria-label="Interest unit">
                <button type="button" className={unit === "percent" ? "active" : ""} onClick={() => setUnit("percent")}>
                  %
                </button>
                <button
                  type="button"
                  className={unit === "rupees" ? "active" : ""}
                  onClick={() => {
                    setUnit("rupees");
                    setRate(rupeesInput(rate));
                  }}
                >
                  ₹
                </button>
              </div>
            </div>
          </div>
          <div className="field">
            <label>Rate is per</label>
            <select value={period} onChange={(e) => setPeriod(e.target.value as RatePeriod)}>
              <option value="monthly">Month</option>
              <option value="annual">Year</option>
            </select>
          </div>
          <div className="field">
            <label>Pledge date</label>
            <input type="date" max={todayYmd()} value={date} onChange={(e) => setDate(e.target.value)} />
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
              <label>Notes</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        </details>
        {Number.isFinite(monthly) && monthly > 0 && amount > 0 && (
          <div className="hint-strip">
            Interest <b>{inr.format(monthly)}</b> per month on {inr.format(amount)}
            {unit === "rupees" && <> (= {Number(((perPeriod / amount) * 100).toFixed(3))}% per {period === "monthly" ? "month" : "year"})</>}
          </div>
        )}
      </section>

      {error && <div className="notice err">{error}</div>}
      <button className="btn btn-gold xl" disabled={busy}>
        {busy ? "Saving…" : "Register & print bill"}
      </button>
    </form>
  );
}
