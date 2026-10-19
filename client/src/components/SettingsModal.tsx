import { useState, type FormEvent } from "react";
import { api, type Policy } from "../api";
import { POLICY_LABEL, errMsg } from "../format";
import { Modal } from "./Modal";

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

export function SettingsModal({
  policy,
  onPolicy,
  onClose,
  notify,
}: {
  policy: Policy;
  onPolicy: (p: Policy) => void;
  onClose: () => void;
  notify: (kind: "ok" | "err", text: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <Modal title="Settings" onClose={onClose}>
      <section className="settings-section">
        <h3>Part-month interest rule</h3>
        <p className="muted">Applies to new registrations only. Existing ones keep the rule they were created with.</p>
        <select
          value={policy}
          onChange={async (e) => {
            const v = e.target.value as Policy;
            try {
              await api.saveSettings(v);
              onPolicy(v);
              notify("ok", "Interest rule saved for new registrations.");
            } catch (err) {
              notify("err", errMsg(err));
            }
          }}
        >
          {Object.entries(POLICY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </section>

      <section className="settings-section">
        <h3>Backup</h3>
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

      <section className="settings-section">
        <h3>Change password</h3>
        <ChangePasswordForm onDone={() => notify("ok", "Password changed.")} />
      </section>
    </Modal>
  );
}
