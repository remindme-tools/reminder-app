import { useState, type FormEvent } from "react";
import { demoMode, store } from "../lib/store";

export default function Auth({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      if (mode === "in") {
        await store.signIn(email, password);
        onDone();
      } else {
        const { needsConfirm } = await store.signUp(email, password);
        if (needsConfirm) setMsg("Check your email and tap the confirmation link, then come back and sign in.");
        else onDone();
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth" onSubmit={submit}>
      <h1>Remind Me</h1>
      <p className="muted">{mode === "in" ? "Sign in to see your reminders." : "Create your private account."}</p>
      {demoMode && <div className="banner">Demo mode: any email and password works. Data stays on this device.</div>}
      <label>
        Email
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Password
        <input
          type="password"
          autoComplete={mode === "in" ? "current-password" : "new-password"}
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {msg && <div className="banner err">{msg}</div>}
      <button className="primary" disabled={busy}>
        {busy ? "…" : mode === "in" ? "Sign in" : "Create account"}
      </button>
      <button type="button" className="ghost" onClick={() => setMode(mode === "in" ? "up" : "in")}>
        {mode === "in" ? "New here? Create an account" : "I already have an account"}
      </button>
    </form>
  );
}
