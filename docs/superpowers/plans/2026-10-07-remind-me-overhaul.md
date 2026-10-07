# Remind Me Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver category colors, persistent sessions, forgot-password, a friendlier reminder list, and clearer notification settings to the Remind Me PWA.

**Architecture:** Twelve self-contained tasks in dependency order. Database migration first, then shared utilities, then store, then components, then CSS, then Edge Function, then final verification. Each task commits on completion.

**Tech Stack:** React 19, TypeScript 7, Vite 8, Supabase JS v2, vite-plugin-pwa, Vitest 5, GitHub Pages deployment.

**Safety:** Never open MY-SECRETS.local.txt or any .env file. Do not push to GitHub.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `supabase/migration-001.sql` | CREATE | Two new columns: category_colors on profiles, notify_via on items |
| `src/types.ts` | MODIFY | Add `NotifyVia` type and `notify_via` field to Item |
| `src/lib/categoryColors.ts` | CREATE | Default palette, color lookup, 12-color picker palette |
| `src/lib/dates.ts` | MODIFY | Update `describeDue` day-0 text from "Due today" → "Today" |
| `src/lib/dates.test.ts` | MODIFY | Add tests for updated describeDue output |
| `src/lib/store.ts` | MODIFY | persistSession, autoRefreshToken, subscribeToAuth, resetPasswordForEmail, updatePassword, category_colors in Profile |
| `src/components/Auth.tsx` | REWRITE | forgot/reset modes, show/hide password, PASSWORD_RECOVERY event |
| `src/App.tsx` | REWRITE | subscribeToAuth, Safari banner, skeleton, 3-group layout, snooze sheet, empty state w/ examples, category color border |
| `src/components/ItemForm.tsx` | MODIFY | notify_via toggle, category color dot |
| `src/components/Settings.tsx` | MODIFY | Push toggle switch, test notification, category color editor, iPhone note |
| `src/styles.css` | MODIFY | Toggle switch, skeleton animation, color dot, snooze sheet, polish |
| `supabase/functions/daily-reminders/logic.ts` | MODIFY | Respect notify_via per item |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migration-001.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- migration-001.sql
-- Remind Me: schema additions. Safe to run more than once.

-- Category color preferences per user (JSON: {"Home":"#f87171", ...})
alter table public.profiles
  add column if not exists category_colors jsonb not null default '{}';

-- Per-reminder notification channel: 'email', 'push', or 'both'
alter table public.items
  add column if not exists notify_via text not null default 'both'
  constraint items_notify_via_check check (notify_via in ('email','push','both'));
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migration-001.sql
git commit -m "feat: add migration-001 (category_colors, notify_via)"
```

---

## Task 2: TypeScript Types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add NotifyVia and update Item**

Replace the entire file:

```typescript
export type ItemType = "repeating" | "expiry" | "renewal";
export type RepeatUnit = "days" | "weeks" | "months" | "years";
export type NotifyVia = "email" | "push" | "both";

export interface Item {
  id: string;
  name: string;
  category: string;
  type: ItemType;
  due_date: string; // YYYY-MM-DD
  repeat_every: number | null;
  repeat_unit: RepeatUnit | null;
  warn_days: number[];
  notes: string;
  cost: number | null;
  photo_path: string | null;
  done_at: string | null;
  notify_via: NotifyVia;
}

export type ItemInput = Omit<Item, "id" | "done_at">;

export const CATEGORIES = ["Home", "Car", "Health", "Money", "Documents", "Pets", "Other"];
```

- [ ] **Step 2: Verify TypeScript accepts the change**

Run: `npx tsc --noEmit`
Expected: no errors (the new field will surface missing properties in store.ts — fix those in Task 4).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add NotifyVia type and notify_via field to Item"
```

---

## Task 3: Category Colors Utility

**Files:**
- Create: `src/lib/categoryColors.ts`

- [ ] **Step 1: Create the utility**

```typescript
export const DEFAULT_CATEGORY_COLORS: Record<string, string> = {
  Home: "#f87171",
  Car: "#60a5fa",
  Health: "#4ade80",
  Money: "#fbbf24",
  Documents: "#a78bfa",
  Pets: "#fb923c",
  Other: "#94a3b8",
};

/** 12-color picker palette shown in the Settings color editor. */
export const COLOR_PALETTE = [
  "#f87171", "#fb923c", "#fbbf24", "#a3e635",
  "#4ade80", "#34d399", "#60a5fa", "#818cf8",
  "#a78bfa", "#e879f9", "#fb7185", "#94a3b8",
];

/** Return the color for a category, falling back to the built-in default. */
export function getCategoryColor(
  category: string,
  overrides: Record<string, string> = {}
): string {
  return overrides[category] ?? DEFAULT_CATEGORY_COLORS[category] ?? "#94a3b8";
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/categoryColors.ts
git commit -m "feat: add category colors utility"
```

---

## Task 4: Update Store

**Files:**
- Modify: `src/lib/store.ts`

Replace the entire file with the following. Key changes:
- `createClient` gets `auth: { persistSession: true, autoRefreshToken: true }`
- `Profile` gains `category_colors`
- New `Store` methods: `subscribeToAuth`, `resetPasswordForEmail`, `updatePassword`
- Module-level `_explicitSignOut` flag so we never sign the user out on a failed token refresh

- [ ] **Step 1: Replace store.ts**

```typescript
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Item, ItemInput } from "../types";
import { isRepeating, rollForward, todayLocal } from "./dates";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const demoMode = !url || !key;
const supabase: SupabaseClient | null = demoMode
  ? null
  : createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "remindme-auth" },
    });

export interface Profile {
  email_reminders: boolean;
  timezone: string;
  category_colors: Record<string, string>;
}

export interface Session {
  email: string;
  needsPasswordReset?: boolean;
}

export interface Store {
  subscribeToAuth(cb: (session: Session | null) => void): () => void;
  getSession(): Promise<Session | null>;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<{ needsConfirm: boolean }>;
  signOut(): Promise<void>;
  resetPasswordForEmail(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  list(): Promise<Item[]>;
  create(input: ItemInput): Promise<void>;
  update(id: string, input: ItemInput): Promise<void>;
  remove(id: string): Promise<void>;
  markDone(item: Item): Promise<void>;
  undoDone(item: Item): Promise<void>;
  uploadPhoto(file: Blob): Promise<string>;
  photoUrl(path: string): Promise<string>;
  getProfile(): Promise<Profile>;
  saveProfile(p: Profile): Promise<void>;
  savePushSubscription(sub: PushSubscriptionJSON | null): Promise<void>;
}

function nextDue(item: Item): string | null {
  return isRepeating(item)
    ? rollForward(item.due_date, item.repeat_every!, item.repeat_unit!, todayLocal())
    : null;
}

// ---------- Supabase ----------
let _explicitSignOut = false;

const remote: Store = {
  subscribeToAuth(cb) {
    const {
      data: { subscription },
    } = supabase!.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY" && s) {
        cb({ email: s.user.email ?? "", needsPasswordReset: true });
      } else if (s) {
        cb({ email: s.user.email ?? "" });
      } else if (event === "INITIAL_SESSION") {
        cb(null);
      } else if (event === "SIGNED_OUT" && _explicitSignOut) {
        _explicitSignOut = false;
        cb(null);
      }
      // TOKEN_REFRESH_FAILED and unexpected SIGNED_OUT: ignore — keep user logged in
    });
    return () => subscription.unsubscribe();
  },
  async getSession() {
    const { data } = await supabase!.auth.getSession();
    return data.session ? { email: data.session.user.email ?? "" } : null;
  },
  async signIn(email, password) {
    const { error } = await supabase!.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },
  async signUp(email, password) {
    const { data, error } = await supabase!.auth.signUp({ email, password });
    if (error) throw error;
    return { needsConfirm: !data.session };
  },
  async signOut() {
    _explicitSignOut = true;
    await supabase!.auth.signOut();
  },
  async resetPasswordForEmail(email) {
    const { error } = await supabase!.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname,
    });
    if (error) throw error;
  },
  async updatePassword(password) {
    const { error } = await supabase!.auth.updateUser({ password });
    if (error) throw error;
  },
  async list() {
    const { data, error } = await supabase!.from("items").select("*").order("due_date");
    if (error) throw error;
    return (data as Item[]).map((i) => ({ ...i, notify_via: i.notify_via ?? "both" }));
  },
  async create(input) {
    const { data: u } = await supabase!.auth.getUser();
    const { error } = await supabase!.from("items").insert({ ...input, user_id: u.user!.id });
    if (error) throw error;
  },
  async update(id, input) {
    const { error } = await supabase!.from("items").update(input).eq("id", id);
    if (error) throw error;
  },
  async remove(id) {
    const { error } = await supabase!.from("items").delete().eq("id", id);
    if (error) throw error;
  },
  async markDone(item) {
    const next = nextDue(item);
    const patch = next
      ? { due_date: next, done_at: null, last_done_at: new Date().toISOString() }
      : { done_at: new Date().toISOString() };
    const { error } = await supabase!.from("items").update(patch).eq("id", item.id);
    if (error) throw error;
  },
  async undoDone(item) {
    const { error } = await supabase!.from("items").update({ done_at: null }).eq("id", item.id);
    if (error) throw error;
  },
  async uploadPhoto(file) {
    const { data: u } = await supabase!.auth.getUser();
    const path = `${u.user!.id}/${crypto.randomUUID()}.jpg`;
    const { error } = await supabase!.storage
      .from("photos")
      .upload(path, file, { contentType: "image/jpeg" });
    if (error) throw error;
    return path;
  },
  async photoUrl(path) {
    const { data, error } = await supabase!.storage
      .from("photos")
      .createSignedUrl(path, 3600);
    if (error) throw error;
    return data.signedUrl;
  },
  async getProfile() {
    const { data: u } = await supabase!.auth.getUser();
    const { data } = await supabase!
      .from("profiles")
      .select("*")
      .eq("user_id", u.user!.id)
      .maybeSingle();
    const profile: Profile = {
      email_reminders: data?.email_reminders ?? true,
      timezone:
        data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      category_colors: (data?.category_colors as Record<string, string>) ?? {},
    };
    if (!data?.timezone)
      await supabase!
        .from("profiles")
        .upsert({ user_id: u.user!.id, ...profile });
    return profile;
  },
  async saveProfile(p) {
    const { data: u } = await supabase!.auth.getUser();
    const { error } = await supabase!
      .from("profiles")
      .upsert({ user_id: u.user!.id, ...p });
    if (error) throw error;
  },
  async savePushSubscription(sub) {
    const { data: u } = await supabase!.auth.getUser();
    const uid = u.user!.id;
    if (!sub) {
      await supabase!.from("push_subscriptions").delete().eq("user_id", uid);
      return;
    }
    const { error } = await supabase!
      .from("push_subscriptions")
      .upsert(
        { user_id: uid, endpoint: sub.endpoint, subscription: sub },
        { onConflict: "endpoint" }
      );
    if (error) throw error;
  },
};

// ---------- Demo (this device only) ----------
const LS = "remindme-demo-items";
const LS_SESSION = "remindme-demo-session";
const read = (): Item[] => JSON.parse(localStorage.getItem(LS) ?? "[]");
const write = (items: Item[]) => localStorage.setItem(LS, JSON.stringify(items));

const demo: Store = {
  subscribeToAuth(cb) {
    const s = localStorage.getItem(LS_SESSION);
    // Fire on next microtask (mirrors async Supabase behavior)
    Promise.resolve().then(() => cb(s ? { email: "demo@this-device" } : null));
    return () => {};
  },
  async getSession() {
    return localStorage.getItem(LS_SESSION) ? { email: "demo@this-device" } : null;
  },
  async signIn() {
    localStorage.setItem(LS_SESSION, "1");
  },
  async signUp() {
    localStorage.setItem(LS_SESSION, "1");
    return { needsConfirm: false };
  },
  async signOut() {
    localStorage.removeItem(LS_SESSION);
  },
  async resetPasswordForEmail() {
    // Demo mode: no email; just succeed silently
  },
  async updatePassword() {},
  async list() {
    return read().map((i) => ({ ...i, notify_via: i.notify_via ?? "both" }));
  },
  async create(input) {
    write([...read(), { ...input, id: crypto.randomUUID(), done_at: null }]);
  },
  async update(id, input) {
    write(read().map((i) => (i.id === id ? { ...i, ...input } : i)));
  },
  async remove(id) {
    write(read().filter((i) => i.id !== id));
  },
  async markDone(item) {
    const next = nextDue(item);
    write(
      read().map((i) =>
        i.id !== item.id
          ? i
          : next
          ? { ...i, due_date: next }
          : { ...i, done_at: new Date().toISOString() }
      )
    );
  },
  async undoDone(item) {
    write(read().map((i) => (i.id === item.id ? { ...i, done_at: null } : i)));
  },
  async uploadPhoto(file) {
    return await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.readAsDataURL(file);
    });
  },
  async photoUrl(path) {
    return path;
  },
  async getProfile() {
    const raw = localStorage.getItem("remindme-demo-colors");
    return {
      email_reminders: true,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      category_colors: raw ? (JSON.parse(raw) as Record<string, string>) : {},
    };
  },
  async saveProfile(p) {
    localStorage.setItem("remindme-demo-colors", JSON.stringify(p.category_colors));
  },
  async savePushSubscription() {},
};

export const store: Store = demoMode ? demo : remote;
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: 0 errors. If errors appear in App.tsx or components about missing `notify_via`, fix those in later tasks — the store is correct now.

- [ ] **Step 3: Commit**

```bash
git add src/lib/store.ts
git commit -m "feat: persistent session, subscribeToAuth, password reset, category_colors in store"
```

---

## Task 5: Update describeDue + Tests

**Files:**
- Modify: `src/lib/dates.ts` (one-line change)
- Modify: `src/lib/dates.test.ts` (add describe block)

- [ ] **Step 1: Write failing tests first**

Add this describe block to the end of `src/lib/dates.test.ts`:

```typescript
import { describeDue } from "./dates"; // add to existing import line

describe("describeDue", () => {
  it("returns Today for 0 days", () => {
    expect(describeDue(0)).toBe("Today");
  });
  it("returns Tomorrow for 1 day", () => {
    expect(describeDue(1)).toBe("Tomorrow");
  });
  it("returns plain overdue for negative", () => {
    expect(describeDue(-1)).toBe("1 day overdue");
    expect(describeDue(-5)).toBe("5 days overdue");
  });
  it("returns In X days for 2-13", () => {
    expect(describeDue(7)).toBe("In 7 days");
    expect(describeDue(13)).toBe("In 13 days");
  });
  it("returns In X weeks for 14-59", () => {
    expect(describeDue(14)).toBe("In 2 weeks");
    expect(describeDue(28)).toBe("In 4 weeks");
  });
  it("returns In X months for 60+", () => {
    expect(describeDue(90)).toBe("In 3 months");
  });
});
```

- [ ] **Step 2: Run tests — expect failure on the "Today" test**

Run: `npm test`
Expected: FAIL — `describeDue(0)` returns "Due today" not "Today"

- [ ] **Step 3: Fix describeDue in dates.ts**

Change only this one line in `src/lib/dates.ts`:

Old:
```typescript
  if (days === 0) return "Due today";
```
New:
```typescript
  if (days === 0) return "Today";
```

Also update the import line in `dates.test.ts` to include `describeDue`:

```typescript
import { addInterval, daysBetween, describeDue, reminderReason, rollForward, todayLocal } from "./dates";
```

- [ ] **Step 4: Run tests — expect all pass**

Run: `npm test`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/dates.ts src/lib/dates.test.ts
git commit -m "fix: describeDue returns 'Today' for day 0, add tests"
```

---

## Task 6: Auth Component — Forgot Password + Show/Hide

**Files:**
- Modify: `src/components/Auth.tsx` (full rewrite)

- [ ] **Step 1: Replace Auth.tsx**

```typescript
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

  // Switch to reset mode when Supabase fires PASSWORD_RECOVERY via subscribeToAuth
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
        {mode === "reset" && "Choose a new password (8+ characters)."}
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
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: 0 errors from Auth.tsx

- [ ] **Step 3: Commit**

```bash
git add src/components/Auth.tsx
git commit -m "feat: forgot password, reset password flow, show/hide password"
```

---

## Task 7: App.tsx — Session, Layout, Snooze, Empty State, Safari Banner

**Files:**
- Modify: `src/App.tsx` (full rewrite)

- [ ] **Step 1: Replace App.tsx**

```typescript
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { demoMode, store, type Session } from "./lib/store";
import { addInterval, daysUntil, describeDue, isRepeating, sortItems, todayLocal } from "./lib/dates";
import { getCategoryColor } from "./lib/categoryColors";
import { CATEGORIES, type Item } from "./types";
import Auth from "./components/Auth";
import ItemForm from "./components/ItemForm";
import Settings from "./components/Settings";

// Detect Safari-on-iOS (not installed to Home Screen)
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !("MSStream" in window);
const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches ||
  !!(navigator as { standalone?: boolean }).standalone;

function SkeletonCard() {
  return <li className="row skeleton" aria-hidden="true"><div className="skel-body" /></li>;
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    return store.subscribeToAuth(setSession);
  }, []);

  if (session === undefined) return <div className="center muted">Loading…</div>;
  if (!session) return <Auth onDone={() => {}} />;
  if (session.needsPasswordReset) return <Auth initialMode="reset" onDone={() => {}} />;
  return (
    <Main
      email={session.email}
      onSignOut={() => store.signOut()}
    />
  );
}

function Main({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("All");
  const [view, setView] = useState<"upcoming" | "done">("upcoming");
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [settings, setSettings] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [snoozeTarget, setSnoozeTarget] = useState<Item | null>(null);
  const [categoryColors, setCategoryColors] = useState<Record<string, string>>({});
  const [safariBanner, setSafariBanner] = useState(
    isIOS && !isStandalone && !localStorage.getItem("remindme-safari-banner-dismissed")
  );
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const reload = useCallback(async () => {
    try {
      setItems(await store.list());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your reminders. Pull down to try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    store
      .getProfile()
      .then((p) => setCategoryColors(p.category_colors))
      .catch(() => {});
    reload();
    const onVis = () => document.visibilityState === "visible" && reload();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [reload]);

  const today = todayLocal();

  const categories = useMemo(
    () => [
      "All",
      ...Array.from(new Set([...CATEGORIES, ...items.map((i) => i.category)])).filter((c) =>
        items.some((i) => i.category === c)
      ),
    ],
    [items]
  );

  const shown = useMemo(() => {
    const base = items.filter(
      (i) => (view === "done" ? !!i.done_at : !i.done_at) && (filter === "All" || i.category === filter)
    );
    return view === "done" ? sortItems(base).reverse() : sortItems(base);
  }, [items, filter, view]);

  const overdue = view === "upcoming" ? shown.filter((i) => daysUntil(i, today) < 0) : [];
  const dueSoon = view === "upcoming" ? shown.filter((i) => { const d = daysUntil(i, today); return d >= 0 && d <= 7; }) : [];
  const later = view === "upcoming" ? shown.filter((i) => daysUntil(i, today) > 7) : shown;

  function showToast(text: string, undo?: () => void) {
    clearTimeout(toastTimer.current);
    setToast({ text, undo });
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }

  async function done(item: Item) {
    await store.markDone(item);
    await reload();
    showToast(isRepeating(item) ? "Done! Next one is scheduled." : "Marked done.", async () => {
      await store.update(item.id, {
        name: item.name,
        category: item.category,
        type: item.type,
        due_date: item.due_date,
        repeat_every: item.repeat_every,
        repeat_unit: item.repeat_unit,
        warn_days: item.warn_days,
        notes: item.notes,
        cost: item.cost,
        photo_path: item.photo_path,
        notify_via: item.notify_via,
      });
      await store.undoDone(item);
      await reload();
      setToast(null);
    });
  }

  async function snooze(item: Item, days: number) {
    const newDate = addInterval(item.due_date, days, "days");
    await store.update(item.id, {
      name: item.name,
      category: item.category,
      type: item.type,
      due_date: newDate,
      repeat_every: item.repeat_every,
      repeat_unit: item.repeat_unit,
      warn_days: item.warn_days,
      notes: item.notes,
      cost: item.cost,
      photo_path: item.photo_path,
      notify_via: item.notify_via,
    });
    setSnoozeTarget(null);
    await reload();
    showToast(`Snoozed ${days === 1 ? "1 day" : `${days} days`}.`);
  }

  function dismissSafariBanner() {
    localStorage.setItem("remindme-safari-banner-dismissed", "1");
    setSafariBanner(false);
  }

  function row(i: Item) {
    const d = daysUntil(i, today);
    const cls = d < 0 ? "bad" : d <= 7 ? "warn" : "ok";
    const borderColor = getCategoryColor(i.category, categoryColors);
    return (
      <li key={i.id} className="row" style={{ borderLeftColor: borderColor }}>
        <button className="rowmain" onClick={() => setEditing(i)}>
          <span className="name">{i.name}</span>
          <span className="meta">
            <span className="cat-dot" style={{ background: borderColor }} />
            {i.category} · {i.type}
            {isRepeating(i)
              ? ` · every ${i.repeat_every === 1 ? i.repeat_unit!.replace(/s$/, "") : `${i.repeat_every} ${i.repeat_unit}`}`
              : ""}
            {i.cost != null ? ` · $${i.cost}` : ""}
          </span>
          <span className={`when ${cls}`}>
            {view === "done" ? `Done ${i.done_at?.slice(0, 10)}` : describeDue(d)}
          </span>
        </button>
        {view === "upcoming" ? (
          <div className="row-actions">
            <button className="check" aria-label={`Mark ${i.name} done`} onClick={() => done(i)}>
              ✓
            </button>
            <button className="snooze" aria-label={`Snooze ${i.name}`} onClick={() => setSnoozeTarget(i)}>
              💤
            </button>
          </div>
        ) : (
          <button className="check" aria-label="Move back to upcoming" onClick={() => store.undoDone(i).then(reload)}>
            ↺
          </button>
        )}
      </li>
    );
  }

  const isEmpty = shown.length === 0 && !loading;

  return (
    <div className="app">
      <header>
        <h1>{view === "upcoming" ? "Remind Me" : "Done"}</h1>
        <div className="hdr">
          <button className="ghost" onClick={() => setView(view === "upcoming" ? "done" : "upcoming")}>
            {view === "upcoming" ? "Done list" : "Back"}
          </button>
          <button className="ghost" aria-label="Settings" onClick={() => setSettings(true)}>
            ⚙
          </button>
        </div>
      </header>

      {safariBanner && (
        <div className="banner safari-banner">
          For the best experience and to stay logged in, add Remind Me to your Home Screen: tap Share → Add to Home Screen.
          <button className="banner-close" aria-label="Dismiss" onClick={dismissSafariBanner}>✕</button>
        </div>
      )}
      {demoMode && <div className="banner">Demo mode: data stays on this device only.</div>}
      {error && <div className="banner err">{error}</div>}

      <div className="chips scroll">
        {categories.map((c) => (
          <button key={c} className={`chip ${filter === c ? "on" : ""}`} onClick={() => setFilter(c)}>
            {c !== "All" && (
              <span className="chip-dot" style={{ background: getCategoryColor(c, categoryColors) }} />
            )}
            {c}
          </button>
        ))}
      </div>

      <main>
        {loading && items.length === 0 && (
          <ul>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </ul>
        )}

        {!loading && isEmpty && view === "upcoming" && (
          <div className="empty-state">
            <p className="empty-title">All clear!</p>
            <p className="muted">Nothing coming up yet.</p>
            <button className="primary wide" onClick={() => setEditing("new")}>
              Add your first reminder
            </button>
            <p className="empty-ideas muted">Ideas:</p>
            <div className="chips wrap">
              {["Furnace filter", "Car registration", "Passport renewal"].map((name) => (
                <button
                  key={name}
                  className="chip"
                  onClick={() => setEditing({ id: "", name, category: "Home", type: "renewal", due_date: "", repeat_every: null, repeat_unit: null, warn_days: [30, 7], notes: "", cost: null, photo_path: null, done_at: null, notify_via: "both" } as Item)}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        )}

        {!loading && isEmpty && view === "done" && (
          <p className="empty muted">Nothing done yet.</p>
        )}

        {overdue.length > 0 && (
          <>
            <h2 className="sec bad">Overdue</h2>
            <ul>{overdue.map(row)}</ul>
          </>
        )}
        {dueSoon.length > 0 && (
          <>
            <h2 className="sec warn">Due soon</h2>
            <ul>{dueSoon.map(row)}</ul>
          </>
        )}
        {later.length > 0 && (
          <>
            {(overdue.length > 0 || dueSoon.length > 0) && view === "upcoming" && (
              <h2 className="sec">Later</h2>
            )}
            <ul>{later.map(row)}</ul>
          </>
        )}
      </main>

      {toast && (
        <div className="toast" role="status">
          {toast.text}
          {toast.undo && <button onClick={toast.undo}>Undo</button>}
        </div>
      )}

      <button className="fab" aria-label="Add item" onClick={() => setEditing("new")}>
        +
      </button>

      {snoozeTarget && (
        <div className="sheet-bg" onClick={() => setSnoozeTarget(null)}>
          <div className="sheet snooze-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="grab" />
            <h2>Snooze "{snoozeTarget.name}"</h2>
            <p className="muted">Move the due date forward by:</p>
            <div className="snooze-options">
              <button className="primary" onClick={() => snooze(snoozeTarget, 1)}>1 day</button>
              <button className="primary" onClick={() => snooze(snoozeTarget, 3)}>3 days</button>
              <button className="primary" onClick={() => snooze(snoozeTarget, 7)}>1 week</button>
            </div>
            <button className="ghost wide" onClick={() => setSnoozeTarget(null)}>Cancel</button>
          </div>
        </div>
      )}

      {editing !== null && (
        <ItemForm
          item={editing === "new" || (editing as Item).id === "" ? null : editing as Item}
          defaultName={(editing as Item)?.id === "" ? (editing as Item).name : undefined}
          defaultCategory={filter !== "All" ? filter : undefined}
          categoryColors={categoryColors}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
      {settings && (
        <Settings
          email={email}
          categoryColors={categoryColors}
          onCategoryColorsChange={(colors) => {
            setCategoryColors(colors);
            store.getProfile().then((p) => store.saveProfile({ ...p, category_colors: colors })).catch(() => {});
          }}
          onClose={() => setSettings(false)}
          onSignOut={onSignOut}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: Errors about `defaultName` and `categoryColors` props on ItemForm, and `categoryColors`/`onCategoryColorsChange` on Settings — these are fixed in Tasks 8 and 9.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: persistent session, 3-group layout, snooze, friendly empty state, Safari banner"
```

---

## Task 8: ItemForm — notify_via + Category Color Dot

**Files:**
- Modify: `src/components/ItemForm.tsx` (full rewrite)

- [ ] **Step 1: Replace ItemForm.tsx**

```typescript
import { useEffect, useState, type FormEvent } from "react";
import { store } from "../lib/store";
import { addInterval, todayLocal } from "../lib/dates";
import { shrinkPhoto } from "../lib/image";
import { getCategoryColor } from "../lib/categoryColors";
import { CATEGORIES, type Item, type ItemInput, type ItemType, type NotifyVia, type RepeatUnit } from "../types";

const TYPES: { id: ItemType; label: string; hint: string }[] = [
  { id: "renewal", label: "Renewal", hint: "Insurance, subscriptions, registration" },
  { id: "expiry", label: "Expiry", hint: "Passport, food, licence, deadline" },
  { id: "repeating", label: "Repeating", hint: "Filter change, check-up, chores" },
];
const DEFAULT_WARN: Record<ItemType, number[]> = { renewal: [30, 7, 1], expiry: [30, 7, 1], repeating: [3, 1] };
const WARN_CHOICES = [60, 30, 14, 7, 3, 1, 0];
const NOTIFY_OPTIONS: { id: NotifyVia; label: string }[] = [
  { id: "email", label: "Email" },
  { id: "push", label: "Push" },
  { id: "both", label: "Both" },
];

export default function ItemForm({
  item,
  defaultName,
  defaultCategory,
  categoryColors = {},
  onClose,
  onSaved,
}: {
  item: Item | null;
  defaultName?: string;
  defaultCategory?: string;
  categoryColors?: Record<string, string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = todayLocal();
  const [name, setName] = useState(item?.name ?? defaultName ?? "");
  const [type, setType] = useState<ItemType>(item?.type ?? "renewal");
  const [category, setCategory] = useState(item?.category ?? defaultCategory ?? "Home");
  const [due, setDue] = useState(item?.due_date ?? addInterval(today, 1, "months"));
  const [more, setMore] = useState(!!item);
  const [every, setEvery] = useState<string>(String(item?.repeat_every ?? 1));
  const [unit, setUnit] = useState<RepeatUnit>(item?.repeat_unit ?? "years");
  const [repeatOn, setRepeatOn] = useState(item ? !!item.repeat_every : true);
  const [warn, setWarn] = useState<number[]>(item?.warn_days ?? DEFAULT_WARN[item?.type ?? "renewal"]);
  const [customWarn, setCustomWarn] = useState("");
  const [notifyVia, setNotifyVia] = useState<NotifyVia>(item?.notify_via ?? "both");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [cost, setCost] = useState(item?.cost != null ? String(item.cost) : "");
  const [photo, setPhoto] = useState<string | null>(item?.photo_path ?? null);
  const [photoView, setPhotoView] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (photo) store.photoUrl(photo).then(setPhotoView).catch(() => setPhotoView(""));
    else setPhotoView("");
  }, [photo]);

  function pickType(t: ItemType) {
    setType(t);
    if (item) return;
    setWarn(DEFAULT_WARN[t]);
    if (t === "repeating") { setRepeatOn(true); setEvery("3"); setUnit("months"); }
    else if (t === "renewal") { setRepeatOn(true); setEvery("1"); setUnit("years"); }
    else setRepeatOn(false);
  }

  const toggleWarn = (d: number) =>
    setWarn((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d].sort((a, b) => b - a)));
  const choices = Array.from(new Set([...WARN_CHOICES, ...warn])).sort((a, b) => b - a);

  async function onPhoto(file?: File) {
    if (!file) return;
    try {
      setPhoto(await store.uploadPhoto(await shrinkPhoto(file)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Photo upload failed. Please try again.");
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const n = parseInt(every, 10);
    if (repeatOn && !(n > 0)) return setErr("Repeat interval must be 1 or more.");
    setBusy(true);
    setErr("");
    const input: ItemInput = {
      name: name.trim(),
      category,
      type,
      due_date: due,
      repeat_every: repeatOn ? n : null,
      repeat_unit: repeatOn ? unit : null,
      warn_days: warn,
      notes,
      cost: cost.trim() === "" ? null : Number(cost),
      photo_path: photo,
      notify_via: notifyVia,
    };
    try {
      if (item) await store.update(item.id, input);
      else await store.create(input);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save. Please try again.");
      setBusy(false);
    }
  }

  async function del() {
    if (!item || !confirm(`Delete "${item.name}"?`)) return;
    await store.remove(item.id);
    onSaved();
  }

  const quick: [string, string][] = [
    ["Today", today],
    ["1 week", addInterval(today, 1, "weeks")],
    ["1 month", addInterval(today, 1, "months")],
    ["3 months", addInterval(today, 3, "months")],
    ["1 year", addInterval(today, 1, "years")],
  ];

  return (
    <div className="sheet-bg" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="grab" />
        <h2>{item ? "Edit reminder" : "New reminder"}</h2>

        <input
          className="big"
          placeholder="What do you need to remember?"
          autoFocus={!item}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <div className="lbl">Type</div>
        <div className="seg">
          {TYPES.map((t) => (
            <button type="button" key={t.id} className={type === t.id ? "on" : ""} onClick={() => pickType(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="hint">{TYPES.find((t) => t.id === type)!.hint}</div>

        <div className="lbl">Due date</div>
        <div className="chips scroll">
          {quick.map(([l, d]) => (
            <button type="button" key={l} className={`chip ${due === d ? "on" : ""}`} onClick={() => setDue(d)}>
              {l}
            </button>
          ))}
        </div>
        <input type="date" required value={due} onChange={(e) => setDue(e.target.value)} />

        <div className="lbl">Category</div>
        <div className="chips scroll">
          {Array.from(new Set([...CATEGORIES, category])).map((c) => (
            <button
              type="button"
              key={c}
              className={`chip ${category === c ? "on" : ""}`}
              onClick={() => setCategory(c)}
            >
              <span className="chip-dot" style={{ background: getCategoryColor(c, categoryColors) }} />
              {c}
            </button>
          ))}
        </div>

        {!more && (
          <button type="button" className="ghost wide" onClick={() => setMore(true)}>
            More: repeat, notes, cost, photo
          </button>
        )}

        {more && (
          <>
            <label className="check-row">
              <input type="checkbox" checked={repeatOn} onChange={(e) => setRepeatOn(e.target.checked)} />
              Repeats
            </label>
            {repeatOn && (
              <div className="inline">
                <span>Every</span>
                <input type="number" min={1} inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value)} />
                <select value={unit} onChange={(e) => setUnit(e.target.value as RepeatUnit)}>
                  <option value="days">days</option>
                  <option value="weeks">weeks</option>
                  <option value="months">months</option>
                  <option value="years">years</option>
                </select>
              </div>
            )}

            <div className="lbl">Warn me this many days before</div>
            <div className="chips wrap">
              {choices.map((d) => (
                <button type="button" key={d} className={`chip ${warn.includes(d) ? "on" : ""}`} onClick={() => toggleWarn(d)}>
                  {d === 0 ? "On the day" : `${d}d`}
                </button>
              ))}
            </div>
            <div className="inline">
              <input
                type="number"
                min={1}
                inputMode="numeric"
                placeholder="Other number of days"
                value={customWarn}
                onChange={(e) => setCustomWarn(e.target.value)}
              />
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  const n = parseInt(customWarn, 10);
                  if (n >= 0) setWarn((w) => Array.from(new Set([...w, n])).sort((a, b) => b - a));
                  setCustomWarn("");
                }}
              >
                Add
              </button>
            </div>

            <div className="lbl">Notify me by</div>
            <div className="seg">
              {NOTIFY_OPTIONS.map((o) => (
                <button
                  type="button"
                  key={o.id}
                  className={notifyVia === o.id ? "on" : ""}
                  onClick={() => setNotifyVia(o.id)}
                >
                  {o.label}
                </button>
              ))}
            </div>

            <div className="lbl">Cost</div>
            <input
              type="number"
              step="0.01"
              min={0}
              inputMode="decimal"
              placeholder="Optional"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />

            <div className="lbl">Notes</div>
            <textarea
              rows={3}
              placeholder="Policy number, where to renew…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />

            <div className="lbl">Photo</div>
            {photoView && <img className="photo" src={photoView} alt="Attached" />}
            <label className="ghost wide filebtn">
              {photo ? "Replace photo" : "Add photo"}
              <input type="file" accept="image/*" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
            </label>
            {photo && (
              <button type="button" className="ghost wide" onClick={() => setPhoto(null)}>
                Remove photo
              </button>
            )}
          </>
        )}

        {err && <div className="banner err">{err}</div>}
        <div className="actions">
          {item && (
            <button type="button" className="danger" onClick={del}>
              Delete
            </button>
          )}
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy || !name.trim()}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: 0 errors from ItemForm.tsx. Settings.tsx errors still pending (Task 9).

- [ ] **Step 3: Commit**

```bash
git add src/components/ItemForm.tsx
git commit -m "feat: notify_via per reminder, category color dots in form"
```

---

## Task 9: Settings — Push Toggle, Test Button, Category Colors Editor

**Files:**
- Modify: `src/components/Settings.tsx` (full rewrite)

- [ ] **Step 1: Replace Settings.tsx**

```typescript
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
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification("Test from Remind Me", {
      body: "Notifications are working!",
      icon: "/reminder-app/icons/icon-192.png",
    });
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
          <div>
            <div className="setting-label">Push notifications on this phone</div>
            {push && (
              <div className="hint ok-text">Active on this device</div>
            )}
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
            {push && standalone && (
              <div className="hint">
                If notifications stopped working: Settings → Remind Me → Notifications → Allow.
              </div>
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
              <div key={cat} className="color-row">
                <span className="color-swatch" style={{ background: color }} />
                <span className="color-cat-name">{cat}</span>
                <button
                  className="ghost color-change-btn"
                  onClick={() => setColorPicker(colorPicker === cat ? null : cat)}
                >
                  Change
                </button>
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
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/components/Settings.tsx
git commit -m "feat: push toggle switch, test notification, category color editor, iPhone note"
```

---

## Task 10: CSS Updates

**Files:**
- Modify: `src/styles.css` (append and update)

- [ ] **Step 1: Replace styles.css entirely**

```css
:root {
  --bg: #0f172a;
  --card: #1e293b;
  --line: #334155;
  --text: #f1f5f9;
  --muted: #94a3b8;
  --accent: #38bdf8;
  --ok: #4ade80;
  --warn: #fbbf24;
  --bad: #f87171;
  --on-accent: #082f49;
  color-scheme: dark;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: #f1f5f9;
    --card: #ffffff;
    --line: #cbd5e1;
    --text: #0f172a;
    --muted: #475569;
    --accent: #0369a1;
    --ok: #15803d;
    --warn: #b45309;
    --bad: #b91c1c;
    --on-accent: #ffffff;
    color-scheme: light;
  }
}

* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html, body { margin: 0; background: var(--bg); color: var(--text); font: 17px/1.35 -apple-system, system-ui, "Segoe UI", sans-serif; }
button, input, select, textarea { font: inherit; color: inherit; }
button { cursor: pointer; border: 0; background: none; }
.app { max-width: 640px; margin: 0 auto; padding: env(safe-area-inset-top) 16px calc(110px + env(safe-area-inset-bottom)); }
.center { display: grid; place-items: center; min-height: 100vh; }
.muted { color: var(--muted); }
.ok-text { color: var(--ok); }
header { display: flex; align-items: center; justify-content: space-between; padding: 14px 0 6px; }
h1 { font-size: 28px; margin: 0; }
h2 { margin: 0 0 8px; font-size: 20px; }
h2.sec { font-size: 12px; letter-spacing: .09em; text-transform: uppercase; color: var(--muted); margin: 22px 0 8px; }
h2.sec.bad { color: var(--bad); }
h2.sec.warn { color: var(--warn); }
.hdr { display: flex; gap: 4px; }
.ghost { padding: 12px 14px; border-radius: 12px; color: var(--accent); min-height: 44px; }
.ghost.wide { width: 100%; text-align: center; border: 1px dashed var(--line); margin-top: 12px; display: block; }
.banner { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; margin: 8px 0; font-size: 15px; }
.banner.err { border-color: var(--bad); color: var(--bad); }
.safari-banner { display: flex; align-items: flex-start; gap: 8px; }
.banner-close { color: var(--muted); padding: 4px 8px; min-height: 0; flex-shrink: 0; }
.chips { display: flex; gap: 8px; padding: 8px 0; }
.chips.scroll { overflow-x: auto; scrollbar-width: none; }
.chips.wrap { flex-wrap: wrap; }
.chip { padding: 10px 14px; min-height: 44px; border-radius: 22px; background: var(--card); border: 1px solid var(--line); white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; }
.chip.on { background: var(--accent); color: var(--on-accent); border-color: var(--accent); font-weight: 600; }
.chip-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }

/* Reminder card */
.row { display: flex; background: var(--card); border-radius: 16px; border-left: 6px solid var(--ok); overflow: hidden; }
.rowmain { flex: 1; display: grid; gap: 3px; text-align: left; padding: 14px; min-width: 0; }
.name { font-weight: 600; font-size: 18px; overflow-wrap: anywhere; }
.meta { color: var(--muted); font-size: 14px; display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.cat-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; display: inline-block; }
.when { font-size: 15px; font-weight: 600; color: var(--ok); }
.when.warn { color: var(--warn); }
.when.bad { color: var(--bad); }
.row-actions { display: flex; flex-direction: column; border-left: 1px solid var(--line); }
.check { width: 64px; font-size: 26px; color: var(--accent); flex: 1; }
.check:active, .snooze:active { background: var(--line); }
.snooze { width: 64px; font-size: 22px; border-top: 1px solid var(--line); flex: 1; }

/* Skeleton loading */
.skeleton { border-left-color: var(--line) !important; pointer-events: none; }
.skel-body { height: 72px; background: linear-gradient(90deg, var(--line) 25%, var(--card) 50%, var(--line) 75%); background-size: 200% 100%; border-radius: 8px; animation: shimmer 1.4s infinite; }
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

/* Empty state */
.empty { text-align: center; padding: 48px 16px; }
.empty-state { text-align: center; padding: 40px 16px; display: grid; gap: 10px; }
.empty-title { font-size: 22px; font-weight: 700; margin: 0; }
.empty-ideas { margin: 4px 0 0; font-size: 14px; }
.primary.wide { width: 100%; display: block; }

/* FAB */
.fab { position: fixed; right: 20px; bottom: calc(24px + env(safe-area-inset-bottom)); width: 68px; height: 68px; border-radius: 34px; background: var(--accent); color: var(--on-accent); font-size: 40px; line-height: 1; box-shadow: 0 6px 20px rgba(0,0,0,.4); }

/* Toast */
.toast { position: fixed; left: 16px; right: 100px; bottom: calc(32px + env(safe-area-inset-bottom)); background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 8px 8px 8px 14px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.toast button { color: var(--accent); font-weight: 700; padding: 10px; }

/* Sheets */
.sheet-bg { position: fixed; inset: 0; background: rgba(0,0,0,.55); display: flex; align-items: flex-end; justify-content: center; z-index: 10; }
.sheet { background: var(--bg); width: 100%; max-width: 640px; max-height: 94vh; overflow-y: auto; border-radius: 24px 24px 0 0; padding: 8px 16px calc(20px + env(safe-area-inset-bottom)); }
.snooze-sheet { max-height: 60vh; }
.snooze-options { display: grid; gap: 10px; margin: 12px 0; }
.grab { width: 44px; height: 5px; border-radius: 3px; background: var(--line); margin: 6px auto 12px; }
.lbl { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 14px 0 4px; }
.hint { color: var(--muted); font-size: 14px; margin-top: 4px; }
input, select, textarea { width: 100%; padding: 14px; border-radius: 12px; background: var(--card); border: 1px solid var(--line); min-height: 48px; }
input.big { font-size: 20px; }
input[type="checkbox"] { width: 24px; height: 24px; min-height: 0; flex: none; }
.check-row { display: flex; align-items: center; gap: 12px; margin-top: 14px; min-height: 44px; }
.inline { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.inline input { width: 110px; flex: 1; }
.inline select { flex: 1; }
.seg { display: grid; grid-template-columns: repeat(3, 1fr); background: var(--card); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.seg button { padding: 14px 4px; min-height: 48px; }
.seg button.on { background: var(--accent); color: var(--on-accent); font-weight: 700; }
.photo { width: 100%; border-radius: 12px; margin-bottom: 8px; }
.actions { display: flex; gap: 8px; margin-top: 18px; justify-content: flex-end; position: sticky; bottom: 0; background: var(--bg); padding-top: 8px; }
.primary { background: var(--accent); color: var(--on-accent); font-weight: 700; padding: 14px 28px; border-radius: 14px; min-height: 52px; flex: 1; }
.primary:disabled { opacity: .5; }
.danger { color: var(--bad); padding: 14px; border-radius: 14px; }

/* Auth */
.auth { max-width: 420px; margin: 0 auto; padding: 12vh 20px 20px; display: grid; gap: 14px; }
.auth label { display: grid; gap: 6px; font-size: 14px; color: var(--muted); }
.pw-wrap { position: relative; }
.pw-wrap input { padding-right: 52px; }
.pw-eye { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); color: var(--muted); padding: 8px; min-height: 0; display: flex; align-items: center; }

/* Toggle switch */
.toggle { display: flex; align-items: center; cursor: pointer; }
.toggle input { position: absolute; opacity: 0; width: 0; height: 0; }
.toggle-track { width: 52px; height: 30px; border-radius: 15px; background: var(--line); position: relative; transition: background .2s; flex-shrink: 0; }
.toggle input:checked + .toggle-track { background: var(--accent); }
.toggle-thumb { position: absolute; top: 3px; left: 3px; width: 24px; height: 24px; border-radius: 50%; background: #fff; transition: left .2s; box-shadow: 0 1px 4px rgba(0,0,0,.3); }
.toggle input:checked + .toggle-track .toggle-thumb { left: 25px; }
.toggle input:disabled + .toggle-track { opacity: .4; cursor: not-allowed; }

/* Settings rows */
.setting-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-top: 14px; }
.setting-label { font-weight: 600; }

/* Category color editor */
.color-list { display: grid; gap: 2px; margin-top: 4px; }
.color-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; flex-wrap: wrap; }
.color-swatch { width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0; border: 2px solid rgba(255,255,255,.2); }
.color-cat-name { flex: 1; font-size: 15px; }
.color-change-btn { padding: 6px 12px; font-size: 13px; min-height: 0; }
.color-picker { display: flex; flex-wrap: wrap; gap: 8px; padding: 10px 0 4px; width: 100%; }
.color-option { width: 32px; height: 32px; border-radius: 50%; border: 3px solid transparent; min-height: 0; padding: 0; }
.color-option.selected { border-color: var(--text); }
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "feat: CSS for toggle switch, skeleton, color picker, snooze sheet, polish"
```

---

## Task 11: Edge Function — Respect notify_via

**Files:**
- Modify: `supabase/functions/daily-reminders/logic.ts`

- [ ] **Step 1: Write failing test first**

Add to `supabase/functions/daily-reminders/logic.test.ts`:

```typescript
// Add to imports at top of the test file:
// import { buildDigest, shouldSendNow, ... } — already imported; no change needed for the test below

describe("buildDigest respects notify_via", () => {
  const today = "2026-10-07";
  const items = [
    { name: "A", category: "Home", due_date: "2026-10-07", warn_days: [], cost: null, notify_via: "email" },
    { name: "B", category: "Car",  due_date: "2026-10-07", warn_days: [], cost: null, notify_via: "push" },
    { name: "C", category: "Other",due_date: "2026-10-07", warn_days: [], cost: null, notify_via: "both" },
  ];
  it("emailItems contains only email and both", () => {
    const email = items.filter((i) => i.notify_via === "email" || i.notify_via === "both");
    const d = buildDigest(email, today);
    expect(d?.count).toBe(2);
    expect(d?.text).toContain("A");
    expect(d?.text).toContain("C");
    expect(d?.text).not.toContain("B");
  });
  it("pushItems contains only push and both", () => {
    const push = items.filter((i) => i.notify_via === "push" || i.notify_via === "both");
    const d = buildDigest(push, today);
    expect(d?.count).toBe(2);
    expect(d?.text).toContain("B");
    expect(d?.text).toContain("C");
    expect(d?.text).not.toContain("A");
  });
});
```

- [ ] **Step 2: Run tests — should PASS** (filtering happens in the caller, not buildDigest)

Run: `npm test`
Expected: PASS — the test verifies the filtering contract before we wire it into the Edge Function

- [ ] **Step 3: Add notify_via to DueItem and update index.ts**

In `supabase/functions/daily-reminders/logic.ts`, update the `DueItem` interface:

```typescript
export interface DueItem {
  name: string;
  category: string;
  due_date: string; // YYYY-MM-DD
  warn_days: number[];
  cost: number | null;
  notify_via?: string; // 'email' | 'push' | 'both' — undefined treated as 'both'
}
```

- [ ] **Step 4: Update index.ts to filter items by notify_via before calling buildDigest**

In `supabase/functions/daily-reminders/index.ts`, make these two targeted changes:

**Change 1** — add `notify_via` to the select query (line 44):
```typescript
// OLD:
const { data: items } = await db.from("items").select("name,category,due_date,warn_days,cost").eq("user_id", u.id).is("done_at", null);
const digest = buildDigest((items ?? []) as DueItem[], today);

// NEW:
const { data: items } = await db.from("items").select("name,category,due_date,warn_days,cost,notify_via").eq("user_id", u.id).is("done_at", null);
const allItems = (items ?? []) as DueItem[];
const emailItems = allItems.filter((i) => !i.notify_via || i.notify_via === "email" || i.notify_via === "both");
const pushItems  = allItems.filter((i) => !i.notify_via || i.notify_via === "push"  || i.notify_via === "both");
const digest = buildDigest(emailItems, today);
const pushDigest = buildDigest(pushItems, today);
```

**Change 2** — use `pushDigest` for push notifications (around line 61):
```typescript
// OLD:
if (pushOn && !pushSent) {
  const { data: subs } = ...
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(s.subscription, JSON.stringify({ title: digest.pushTitle, body: digest.pushBody }));

// NEW:
if (pushOn && !pushSent && pushDigest) {
  const { data: subs } = ...
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(s.subscription, JSON.stringify({ title: pushDigest.pushTitle, body: pushDigest.pushBody }));
```

Also update the guard at the top that checks `if (!digest) continue;` to:
```typescript
if (!digest && !pushDigest) continue;
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/daily-reminders/logic.ts supabase/functions/daily-reminders/logic.test.ts supabase/functions/daily-reminders/index.ts
git commit -m "feat: edge function respects notify_via per reminder"
```

---

## Task 12: Final Verification

- [ ] **Step 1: Full type check**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: Full test run**

Run: `npm test`
Expected: all tests PASS

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: build succeeds with no errors

- [ ] **Step 4: Final commit if any loose ends**

```bash
git add -A
git status  # confirm only expected files changed
git commit -m "chore: final type and build fixes" --allow-empty
```

---

## Summary for the User

**SQL to run in Supabase SQL Editor:** Paste `supabase/migration-001.sql`

**Supabase settings to change (Authentication → URL Configuration):**
- Site URL: `https://remindme-tools.github.io/reminder-app/`
- Redirect URLs (add): `https://remindme-tools.github.io/reminder-app/**`

**Nothing to push yet** — user will review and push manually.
