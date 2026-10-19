import { useState, type FormEvent } from "react";
import { api, type InterestType, type Policy, type RatePeriod, type RateUnit, type ShopSettings } from "../api";
import { POLICY_LABEL, errMsg, inr, num, ratePercent, rateText, rupeesInput } from "../format";
import { Modal } from "./Modal";
import { RateField, cleanRate } from "./RateField";

export function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setError("New passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(current, next);
      onDone();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="notice err">{error}</div>}
      <div className="field">
        <label>Current password</label>
        <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </div>
      <div className="field">
        <label>New password (min 8 characters)</label>
        <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} minLength={8} required />
      </div>
      <div className="field">
        <label>Type new password again</label>
        <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </div>
      <button className="btn btn-gold" disabled={busy}>
        Change password
      </button>
    </form>
  );
}

type SlabDraft = { upto: string; rate: string; unit: RateUnit };

function Configuration({
  settings,
  onSaved,
  notify,
}: {
  settings: ShopSettings;
  onSaved: (s: ShopSettings) => void;
  notify: (kind: "ok" | "err", text: string) => void;
}) {
  const [shopName, setShopName] = useState(settings.shop_name);
  const [fixed, setFixed] = useState(settings.rupee_basis === 0);
  const [basisText, setBasisText] = useState(String(settings.rupee_basis || 100));
  const [slabs, setSlabs] = useState<SlabDraft[]>(
    settings.rate_slabs.map((s) => ({ upto: String(s.upto), rate: String(s.rate), unit: s.unit })),
  );
  const [unit, setUnit] = useState<RateUnit>(settings.default_rate_unit);
  const [rate, setRate] = useState(String(settings.default_rate));
  const [period, setPeriod] = useState<RatePeriod>(settings.default_rate_period);
  const [type, setType] = useState<InterestType>(settings.default_interest_type);
  const [policy, setPolicy] = useState<Policy>(settings.partial_month_policy);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const basis = fixed ? 0 : Number(basisText) || 0;
  const per = period === "monthly" ? "month" : "year";
  const setSlab = (i: number, patch: Partial<SlabDraft>) => setSlabs(slabs.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  /** Re-clean every ₹ value when the counting changes (e.g. paise are not allowed for a fixed amount). */
  const recount = (b: number) => {
    setRate(cleanRate(rate, unit, b));
    setSlabs(slabs.map((s) => ({ ...s, rate: cleanRate(s.rate, s.unit, b) })));
  };

  function validate(): string {
    if (shopName.trim().length < 2) return "Enter the shop name.";
    if (!fixed && !(basis > 0)) return "Enter the amount the ₹ interest is counted on (for example 100).";
    let last = 0;
    for (const [i, s] of slabs.entries()) {
      const upto = Number(s.upto);
      if (!(upto > 0)) return `Slab ${i + 1}: enter the loan amount.`;
      if (upto <= last) return `Slab ${i + 1}: the amount must be more than the slab above it.`;
      if (!(num(s.rate) > 0)) return `Slab ${i + 1}: enter the interest.`;
      last = upto;
    }
    if (!(num(rate) > 0)) return "Enter the default interest.";
    return "";
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const problem = validate();
    setError(problem);
    if (problem) return;
    setBusy(true);
    try {
      onSaved(
        await api.saveSettings({
          shop_name: shopName.trim(),
          rupee_basis: basis,
          rate_slabs: slabs.map((s) => ({ upto: Number(s.upto), rate: num(s.rate), unit: s.unit })),
          default_rate: num(rate),
          default_rate_unit: unit,
          default_rate_period: period,
          default_interest_type: type,
          partial_month_policy: policy,
        }),
      );
      notify("ok", "Configuration saved. New registrations will use it.");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  const exampleLoan = 50000;
  const example = (u: RateUnit, r: number) => {
    const pct = ratePercent(u, r, basis, exampleLoan);
    return Number.isFinite(pct) && pct > 0 ? inr.format(Math.round((exampleLoan * pct) / 100)) : "—";
  };

  return (
    <form onSubmit={save} className="config">
      <p className="muted">Changes apply to new registrations. Existing ones keep the interest they were created with.</p>

      <section className="config-block">
        <h4>Shop</h4>
        <div className="field">
          <label>Shop name (shown on bills and at the top)</label>
          <input value={shopName} onChange={(e) => setShopName(e.target.value)} maxLength={60} />
        </div>
      </section>

      <section className="config-block">
        <h4>How interest in ₹ is counted</h4>
        <div className="radio-list" role="radiogroup" aria-label="How interest in ₹ is counted">
          <label className="check">
            <input
              type="radio"
              name="rupee-basis"
              checked={!fixed}
              onChange={() => {
                setFixed(false);
                recount(Number(basisText) || 100);
              }}
            />
            <span className="basis-line">
              ₹ interest for every ₹
              <input
                className="basis-input"
                inputMode="numeric"
                aria-label="Counted on every (₹)"
                value={basisText}
                disabled={fixed}
                onChange={(e) => setBasisText(rupeesInput(e.target.value))}
              />
              of loan
            </span>
          </label>
          <label className="check">
            <input
              type="radio"
              name="rupee-basis"
              checked={fixed}
              onChange={() => {
                setFixed(true);
                recount(0);
              }}
            />
            <span>A fixed ₹ amount on the whole loan</span>
          </label>
        </div>
        {!fixed && basis > 0 && (
          <div className="chips">
            {[100, 1000].map((b) => (
              <button key={b} type="button" className={`chip ${basis === b ? "active" : ""}`} onClick={() => setBasisText(String(b))}>
                Per {inr.format(b)}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="config-block">
        <h4>Interest by loan amount</h4>
        <p className="muted small">
          New Registration fills in the interest from the first row the loan fits in. Loans above the last row, or when
          there are no rows, use the default interest below. The interest can still be changed for any customer.
        </p>
        {slabs.length > 0 && (
          <div className="slab-list">
            {slabs.map((s, i) => (
              <div className="slab-row" key={i}>
                <div className="field">
                  <label>{i === 0 ? "Loans up to (₹)" : `Above ${inr.format(Number(slabs[i - 1].upto) || 0)}, up to (₹)`}</label>
                  <input inputMode="numeric" value={s.upto} onChange={(e) => setSlab(i, { upto: rupeesInput(e.target.value) })} />
                </div>
                <RateField
                  unit={s.unit}
                  rate={s.rate}
                  basis={basis}
                  onUnit={(u) => setSlab(i, { unit: u })}
                  onRate={(v) => setSlab(i, { rate: v })}
                />
                <div className="slab-eg muted small">
                  {num(s.rate) > 0 && <>{example(s.unit, num(s.rate))} / {per} on {inr.format(exampleLoan)}</>}
                </div>
                <button type="button" className="icon-btn danger" aria-label={`Remove slab ${i + 1}`} onClick={() => setSlabs(slabs.filter((_, j) => j !== i))}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            const last = Number(slabs[slabs.length - 1]?.upto) || 0;
            setSlabs([...slabs, { upto: String(last ? last * 2 : 50000), rate, unit }]);
          }}
        >
          + Add slab
        </button>
      </section>

      <section className="config-block">
        <h4>Default interest</h4>
        <div className="grid-3">
          <RateField unit={unit} rate={rate} basis={basis} onUnit={setUnit} onRate={setRate} />
          <div className="field">
            <label>Rate is per</label>
            <select value={period} onChange={(e) => setPeriod(e.target.value as RatePeriod)}>
              <option value="monthly">Month</option>
              <option value="annual">Year</option>
            </select>
          </div>
          <div className="field">
            <label>Interest type</label>
            <select value={type} onChange={(e) => setType(e.target.value as InterestType)}>
              <option value="simple">Simple (normal)</option>
              <option value="compound">Compound (monthly)</option>
            </select>
          </div>
        </div>
        {num(rate) > 0 && (
          <p className="muted small">
            {rateText(unit, num(rate), basis)} per {per} = {example(unit, num(rate))} on a loan of {inr.format(exampleLoan)}.
          </p>
        )}
      </section>

      <section className="config-block">
        <h4>Part-month interest</h4>
        <div className="field">
          <label>When the time is not a whole number of months</label>
          <select value={policy} onChange={(e) => setPolicy(e.target.value as Policy)}>
            {(Object.keys(POLICY_LABEL) as Policy[]).map((k) => (
              <option key={k} value={k}>
                {POLICY_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
      </section>

      {error && <div className="notice err">{error}</div>}
      <button className="btn btn-gold xl" disabled={busy}>
        {busy ? "Saving…" : "Save configuration"}
      </button>
    </form>
  );
}

type SettingsTab = "config" | "backup" | "password";

export function SettingsModal({
  settings,
  onSaved,
  onClose,
  notify,
}: {
  settings: ShopSettings;
  onSaved: (s: ShopSettings) => void;
  onClose: () => void;
  notify: (kind: "ok" | "err", text: string) => void;
}) {
  const [tab, setTab] = useState<SettingsTab>("config");
  const [busy, setBusy] = useState(false);
  const tabs: [SettingsTab, string][] = [
    ["config", "Configuration"],
    ["backup", "Backup"],
    ["password", "Password"],
  ];

  return (
    <Modal title="Settings" onClose={onClose} wide>
      <div className="tabs small" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "config" && <Configuration settings={settings} onSaved={onSaved} notify={notify} />}

      {tab === "backup" && (
        <section className="settings-section">
          <p className="muted">
            Backups are also taken automatically. Files are saved in the <code>backups</code> folder. Photos are in{" "}
            <code>data/photos</code>. Copy both folders to a pen drive regularly.
          </p>
          <button
            type="button"
            className="btn btn-ink"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api.backup();
                notify("ok", `Backup saved: ${r.file}`);
              } catch (err) {
                notify("err", errMsg(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Back up now
          </button>
        </section>
      )}

      {tab === "password" && (
        <section className="settings-section">
          <ChangePasswordForm onDone={() => notify("ok", "Password changed.")} />
        </section>
      )}
    </Modal>
  );
}
