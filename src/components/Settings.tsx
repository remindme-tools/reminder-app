import { useEffect, useState } from "react";
import { demoMode, store } from "../lib/store";
import { disablePush, enablePush, pushEnabled, pushSupported } from "../lib/push";
import { getCategoryColor, COLOR_PALETTE } from "../lib/categoryColors";
import { CATEGORIES } from "../types";

export default function Settings({
  email,
  categoryColors,
  onCategoryColorsChange,
  onClose,
  onSignOut,
}: {
  email: string;
  categoryColors: Record<string, string>;
  onCategoryColorsChange: (colors: Record<string, string>) => void;
  onClose: () => void;
  onSignOut: () => void;
}) {
  const [emailOn, setEmailOn] = useState(true);
  const [tz, setTz] = useState("");
  const [push, setPush] = useState(false);
  const [msg, setMsg] = useState("");
  const [colorPicker, setColorPicker] = useState<string | null>(null);

  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    !!(navigator as { standalone?: boolean }).standalone;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !("MSStream" in window);

  useEffect(() => {
    store.getProfile().then((p) => {
      setEmailOn(p.email_reminders);
      setTz(p.timezone);
    });
    pushEnabled().then(setPush).catch(() => {});
  }, []);

  async function saveProfile(next: { email_reminders: boolean; timezone: string }) {
    try {
      const p = await store.getProfile();
      await store.saveProfile({ ...p, ...next });
      setMsg("Saved");
      setTimeout(() => setMsg(""), 2000);
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

  async function sendTestNotification() {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification("Test from Remind Me", {
        body: "Notifications are working!",
        icon: "/reminder-app/icons/icon-192.png",
      });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not send test notification");
    }
  }

  function setColor(category: string, color: string) {
    const updated = { ...categoryColors, [category]: color };
    onCategoryColorsChange(updated);
    setColorPicker(null);
  }

  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <h2>Settings</h2>
        <p className="muted">Signed in as {email}</p>

        {/* ── Email reminders ── */}
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

        {/* ── Push notifications ── */}
        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Push notifications on this phone</div>
            {push && <div className="hint ok-text">Active on this device</div>}
            {!push && standalone && pushSupported() && (
              <div className="hint">Tap the switch to turn on</div>
            )}
            {!standalone && isIOS && (
              <div className="hint">
                Push only works from the Home Screen icon. In Safari: tap Share → Add to Home Screen.
              </div>
            )}
            {!standalone && !isIOS && (
              <div className="hint">Add this app to your Home Screen first to enable push.</div>
            )}
            {standalone && !pushSupported() && (
              <div className="hint">Push notifications are not set up for this copy of the app yet.</div>
            )}
          </div>
          <label className="toggle" aria-label="Push notifications">
            <input
              type="checkbox"
              checked={push}
              disabled={!pushSupported() || !standalone}
              onChange={(e) => togglePush(e.target.checked)}
            />
            <span className="toggle-track">
              <span className="toggle-thumb" />
            </span>
          </label>
        </div>

        {push && standalone && (
          <button className="ghost wide" onClick={sendTestNotification}>
            Send me a test notification
          </button>
        )}

        {/* ── Time zone ── */}
        <div className="lbl">Time zone (decides when morning is)</div>
        <input
          value={tz}
          disabled={demoMode}
          onChange={(e) => setTz(e.target.value)}
          onBlur={() => tz && saveProfile({ email_reminders: emailOn, timezone: tz })}
        />

        {/* ── Category colors ── */}
        <div className="lbl">Category colors</div>
        <div className="color-list">
          {CATEGORIES.map((cat) => {
            const color = getCategoryColor(cat, categoryColors);
            return (
              <div key={cat}>
                <div className="color-row">
                  <span className="color-swatch" style={{ background: color }} />
                  <span className="color-cat-name">{cat}</span>
                  <button
                    className="ghost color-change-btn"
                    onClick={() => setColorPicker(colorPicker === cat ? null : cat)}
                  >
                    Change
                  </button>
                </div>
                {colorPicker === cat && (
                  <div className="color-picker">
                    {COLOR_PALETTE.map((c) => (
                      <button
                        key={c}
                        className={`color-option${c === color ? " selected" : ""}`}
                        style={{ background: c }}
                        aria-label={c}
                        onClick={() => setColor(cat, c)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

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
