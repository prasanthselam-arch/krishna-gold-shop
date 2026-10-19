import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, setUnauthorizedHandler, type Pledge, type Receipt, type ShopSettings } from "./api";
import { errMsg } from "./format";
import { BillPreview } from "./components/BillCards";
import { CalculatorModal, type CalcPrefill } from "./components/CalculatorModal";
import { Modal } from "./components/Modal";
import { ChangePasswordForm, SettingsModal } from "./components/SettingsModal";
import { FindPledge } from "./pages/FindPledge";
import { NewPledge } from "./pages/NewPledge";
import { Records } from "./pages/Records";

type Tab = "new" | "find" | "records";
type Flash = { kind: "ok" | "err" | "warn"; text: string; id: number };

export function App() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<string | null>(null);
  const [shop, setShop] = useState("KRISHNA GOLD SHOP");
  const [mustChange, setMustChange] = useState(false);
  const [settings, setSettings] = useState<ShopSettings>({
    shop_name: "KRISHNA GOLD SHOP",
    partial_month_policy: "actual_days",
    rupee_basis: 100,
    default_rate: 2,
    default_rate_unit: "percent",
    default_rate_period: "monthly",
    default_interest_type: "simple",
    rate_slabs: [],
  });
  const [tab, setTab] = useState<Tab>("find");
  const [flash, setFlash] = useState<Flash | null>(null);
  const [tokenPreview, setTokenPreview] = useState("");
  const [pledge, setPledge] = useState<Pledge | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [calc, setCalc] = useState<CalcPrefill | null | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const flashTimer = useRef<number | undefined>(undefined);

  const notify = useCallback((kind: Flash["kind"], text: string) => {
    window.clearTimeout(flashTimer.current);
    setFlash({ kind, text, id: Date.now() });
    if (kind === "ok") flashTimer.current = window.setTimeout(() => setFlash(null), 5000);
  }, []);

  const loadSession = useCallback(async () => {
    const m = await api.me();
    setUser(m.user.username);
    setShop(m.shop);
    setMustChange(m.mustChangePassword);
    setSettings(m.settings);
  }, []);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    api.previewToken().then((t) => setTokenPreview(t.token)).catch(() => undefined);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      notify("warn", "Session expired. Please sign in again.");
    });
    fetch("/api/health")
      .then((r) => r.json())
      .then((h: { shop?: string }) => h.shop && setShop(h.shop))
      .catch(() => undefined);
    loadSession()
      .then(refresh)
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, [loadSession, refresh, notify]);

  const print = useCallback(
    async (token: string) => {
      try {
        setReceipt(await api.receipt(token, "pledge"));
      } catch (err) {
        notify("err", errMsg(err));
      }
    },
    [notify],
  );

  const openToken = useCallback(
    async (token: string) => {
      try {
        setPledge(await api.getPledge(token));
        setTab("find");
      } catch (err) {
        notify("err", errMsg(err));
      }
    },
    [notify],
  );

  if (!ready) return <div className="login"><div className="login-card">Loading…</div></div>;

  if (!user) {
    return (
      <Login
        shop={shop}
        flash={flash}
        onLogin={async (u, p) => {
          await api.login(u, p);
          await loadSession();
          setFlash(null);
          refresh();
        }}
      />
    );
  }

  return (
    <>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <h1>{shop}</h1>
            <small>Gold loan desk</small>
          </div>
          <nav className="tabs main">
            <button type="button" className={tab === "new" ? "active" : ""} onClick={() => setTab("new")}>
              New Registration
            </button>
            <button type="button" className={tab === "find" ? "active" : ""} onClick={() => setTab("find")}>
              Find / Pay / Return
            </button>
            <button type="button" className={tab === "records" ? "active" : ""} onClick={() => setTab("records")}>
              Records
            </button>
          </nav>
          <div className="topbar-actions">
            <button type="button" className="btn btn-gold" onClick={() => setCalc(null)}>
              <span className="hide-sm">Interest </span>Calculator
            </button>
            <button type="button" className="btn btn-ghost light" onClick={() => setSettingsOpen(true)}>
              Settings
            </button>
            <button type="button" className="btn btn-ghost light" onClick={() => setConfirmSignOut(true)}>
              Sign out
            </button>
          </div>
        </header>

        {flash && (
          <div key={flash.id} className={`flash notice ${flash.kind}`} role="status">
            <span>{flash.text}</span>
            <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setFlash(null)}>
              ×
            </button>
          </div>
        )}

        <main className="content">
          <div hidden={tab !== "new"}>
            <NewPledge
              tokenPreview={tokenPreview}
              settings={settings}
              onSaved={(p) => {
                notify("ok", `Registration saved. Token ${p.token}.`);
                setPledge(p);
                setTab("find");
                refresh();
                void print(p.token);
              }}
            />
          </div>
          <div hidden={tab !== "find"}>
            <FindPledge
              pledge={pledge}
              setPledge={setPledge}
              active={tab === "find"}
              onPrint={(t) => void print(t)}
              rupeeBasis={settings.rupee_basis}
              onCalc={(p) => {
                const principal = p.finance.outstandingPrincipal || p.principal;
                const perAmount = p.rate_unit === "rupees" && p.rate_amount != null && p.rate_basis > 0;
                const fixed = p.rate_unit === "rupees" && p.rate_amount != null && p.rate_basis === 0 && principal === p.principal;
                setCalc({
                  principal,
                  rate: perAmount || fixed ? p.rate_amount! : p.interest_rate,
                  unit: perAmount || fixed ? "rupees" : "percent",
                  basis: perAmount || fixed ? p.rate_basis : settings.rupee_basis,
                  period: p.rate_period,
                  type: p.interest_type,
                  start: p.pledge_date,
                  policy: p.partial_month_policy,
                  label: p.token,
                });
              }}
              notify={notify}
              onChanged={refresh}
            />
          </div>
          <div hidden={tab !== "records"}>
            <Records active={tab === "records"} refreshKey={refreshKey} onOpen={(t) => void openToken(t)} />
          </div>
        </main>
      </div>

      {calc !== undefined && <CalculatorModal prefill={calc} settings={settings} onClose={() => setCalc(undefined)} />}
      {confirmSignOut && (
        <Modal
          title="Sign out?"
          className="confirm"
          onClose={() => setConfirmSignOut(false)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" autoFocus onClick={() => setConfirmSignOut(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={async () => {
                  setConfirmSignOut(false);
                  await api.logout().catch(() => undefined);
                  setUser(null);
                  setPledge(null);
                }}
              >
                Sign out
              </button>
            </>
          }
        >
          <p>You will need the password to sign in again.</p>
        </Modal>
      )}
      {settingsOpen && (
        <SettingsModal
          settings={settings}
          onSaved={(s) => {
            setSettings(s);
            setShop(s.shop_name);
          }}
          onClose={() => setSettingsOpen(false)}
          notify={notify}
        />
      )}
      {receipt && <BillPreview receipt={receipt} onClose={() => setReceipt(null)} />}
      {mustChange && (
        <Modal title="Set a new password" onClose={() => undefined} closable={false}>
          <p>You are using the default password. Please set your own password to continue.</p>
          <ChangePasswordForm
            onDone={() => {
              setMustChange(false);
              notify("ok", "Password changed.");
            }}
          />
        </Modal>
      )}
    </>
  );
}

function Login({ shop, flash, onLogin }: { shop: string; flash: Flash | null; onLogin: (u: string, p: string) => Promise<void> }) {
  const [username, setUsername] = useState("owner");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onLogin(username, password);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <h1>{shop}</h1>
        <p>Gold loan desk</p>
        {flash && !error && <div className={`notice ${flash.kind}`}>{flash.text}</div>}
        {error && <div className="notice err">{error}</div>}
        <div className="field">
          <label>Username</label>
          <input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="btn btn-gold xl" disabled={busy}>
          Sign in
        </button>
      </form>
    </div>
  );
}
