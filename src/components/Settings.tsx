import { useEffect, useState } from "react";
import { demoMode, store } from "../lib/store";
import { disablePush, enablePush, pushEnabled, pushSupported } from "../lib/push";

export default function Settings({ email, onClose, onSignOut }: { email: string; onClose: () => void; onSignOut: () => void }) {
  const [emailOn, setEmailOn] = useState(true);
  const [tz, setTz] = useState("");
  const [push, setPush] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    store.getProfile().then((p) => {
      setEmailOn(p.email_reminders);
      setTz(p.timezone);
    });
    pushEnabled().then(setPush).catch(() => {});
  }, []);

  async function saveProfile(next: { email_reminders: boolean; timezone: string }) {
    try {
      await store.saveProfile(next);
      setMsg("Saved");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not save");
    }
  }

  async function togglePush(on: boolean) {
    setMsg("");
    try {
      if (on) await enablePush();
      else await disablePush();
      setPush(on);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not change notifications");
    }
  }

  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone;

  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <h2>Settings</h2>
        <p className="muted">Signed in as {email}</p>

        <label className="check-row">
          <input
            type="checkbox"
            checked={emailOn}
            disabled={demoMode}
            onChange={(e) => {
              setEmailOn(e.target.checked);
              saveProfile({ email_reminders: e.target.checked, timezone: tz });
            }}
          />
          Email me reminders (one summary each morning)
        </label>

        <label className="check-row">
          <input type="checkbox" checked={push} disabled={!pushSupported() || !standalone} onChange={(e) => togglePush(e.target.checked)} />
          Push notifications on this phone
        </label>
        {!standalone && (
          <div className="hint">To turn on push notifications, first add this app to your Home Screen (Share, then Add to Home Screen) and open it from there.</div>
        )}
        {standalone && !pushSupported() && <div className="hint">Push notifications are not set up for this copy of the app yet.</div>}

        <div className="lbl">Time zone (decides when morning is)</div>
        <input value={tz} disabled={demoMode} onChange={(e) => setTz(e.target.value)} onBlur={() => tz && saveProfile({ email_reminders: emailOn, timezone: tz })} />

        {msg && <div className="banner">{msg}</div>}
        <div className="actions">
          <button className="danger" onClick={onSignOut}>
            Sign out
          </button>
          <button className="primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
