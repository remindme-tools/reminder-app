import { useEffect, useState, type FormEvent } from "react";
import { demoMode, store } from "../lib/store";

type Mode = "in" | "up" | "forgot" | "reset";

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

export default function Auth({
  initialMode = "in",
  onDone,
}: {
  initialMode?: Mode;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgOk, setMsgOk] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialMode === "reset") setMode("reset");
  }, [initialMode]);

  function info(text: string) {
    setMsgOk(true);
    setMsg(text);
  }
  function err(text: string) {
    setMsgOk(false);
    setMsg(text);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      if (mode === "in") {
        await store.signIn(email, password);
        onDone();
      } else if (mode === "up") {
        const { needsConfirm } = await store.signUp(email, password);
        if (needsConfirm)
          info("Check your email and tap the confirmation link, then come back and sign in.");
        else onDone();
      } else if (mode === "forgot") {
        await store.resetPasswordForEmail(email);
        info("Check your email! We sent you a password reset link.");
      } else if (mode === "reset") {
        if (password.length < 8) return err("Password must be at least 8 characters.");
        await store.updatePassword(password);
        info("Password updated! Please sign in with your new password.");
        setMode("in");
      }
    } catch (e) {
      err(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const showPasswordField = mode === "in" || mode === "up" || mode === "reset";
  const submitLabel =
    mode === "in" ? "Sign in" :
    mode === "up" ? "Create account" :
    mode === "forgot" ? "Send reset email" :
    "Set new password";

  return (
    <form className="auth" onSubmit={submit}>
      <h1>Remind Me</h1>
      <p className="muted">
        {mode === "in" && "Sign in to see your reminders."}
        {mode === "up" && "Create your private account."}
        {mode === "forgot" && "Enter your email and we'll send a reset link."}
        {mode === "reset" && "Choose a new password (8 or more characters)."}
      </p>
      {demoMode && (
        <div className="banner">
          Demo mode: any email and password works. Data stays on this device.
        </div>
      )}

      {(mode === "in" || mode === "up" || mode === "forgot") && (
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
      )}

      {showPasswordField && (
        <label>
          {mode === "reset" ? "New password" : "Password"}
          <div className="pw-wrap">
            <input
              type={showPw ? "text" : "password"}
              autoComplete={mode === "in" ? "current-password" : "new-password"}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="pw-eye"
              aria-label={showPw ? "Hide password" : "Show password"}
              onClick={() => setShowPw((v) => !v)}
            >
              <EyeIcon open={showPw} />
            </button>
          </div>
        </label>
      )}

      {msg && <div className={`banner${msgOk ? "" : " err"}`}>{msg}</div>}

      <button className="primary" disabled={busy}>
        {busy ? "…" : submitLabel}
      </button>

      {mode === "in" && (
        <>
          <button type="button" className="ghost" onClick={() => { setMode("up"); setMsg(""); }}>
            New here? Create an account
          </button>
          <button type="button" className="ghost" onClick={() => { setMode("forgot"); setMsg(""); }}>
            Forgot password?
          </button>
        </>
      )}
      {mode === "up" && (
        <button type="button" className="ghost" onClick={() => { setMode("in"); setMsg(""); }}>
          I already have an account
        </button>
      )}
      {(mode === "forgot" || mode === "reset") && (
        <button type="button" className="ghost" onClick={() => { setMode("in"); setMsg(""); }}>
          Back to sign in
        </button>
      )}
    </form>
  );
}
