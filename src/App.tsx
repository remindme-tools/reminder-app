import { useCallback, useEffect, useMemo, useState } from "react";
import { demoMode, store, type Session } from "./lib/store";
import { daysUntil, describeDue, isRepeating, sortItems, todayLocal } from "./lib/dates";
import { CATEGORIES, type Item } from "./types";
import Auth from "./components/Auth";
import ItemForm from "./components/ItemForm";
import Settings from "./components/Settings";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    store.getSession().then(setSession);
  }, []);
  if (session === undefined) return <div className="center muted">Loading…</div>;
  if (!session) return <Auth onDone={() => store.getSession().then(setSession)} />;
  return <Main email={session.email} onSignOut={() => store.signOut().then(() => setSession(null))} />;
}

function Main({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState("All");
  const [view, setView] = useState<"upcoming" | "done">("upcoming");
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [settings, setSettings] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);

  const reload = useCallback(async () => {
    try {
      setItems(await store.list());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load items");
    }
  }, []);
  useEffect(() => {
    store.getProfile().catch(() => {}); // also records this phone's time zone on first launch
    reload();
    const onVis = () => document.visibilityState === "visible" && reload();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [reload]);

  const today = todayLocal();
  const categories = useMemo(
    () => ["All", ...Array.from(new Set([...CATEGORIES, ...items.map((i) => i.category)])).filter((c) => items.some((i) => i.category === c))],
    [items]
  );

  const shown = useMemo(() => {
    const base = items.filter((i) => (view === "done" ? !!i.done_at : !i.done_at) && (filter === "All" || i.category === filter));
    return view === "done" ? sortItems(base).reverse() : sortItems(base);
  }, [items, filter, view]);
  const overdue = view === "upcoming" ? shown.filter((i) => daysUntil(i, today) < 0) : [];
  const upcoming = view === "upcoming" ? shown.filter((i) => daysUntil(i, today) >= 0) : shown;

  async function done(item: Item) {
    await store.markDone(item);
    await reload();
    setToast({
      text: isRepeating(item) ? "Done. Next one is scheduled." : "Marked done.",
      undo: async () => {
        // Undo puts the item back exactly as it was before.
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
        });
        await store.undoDone(item);
        await reload();
        setToast(null);
      },
    });
    setTimeout(() => setToast(null), 6000);
  }

  function row(i: Item) {
    const d = daysUntil(i, today);
    const cls = d < 0 ? "bad" : d <= 7 ? "warn" : "ok";
    return (
      <li key={i.id} className={`row ${cls}`}>
        <button className="rowmain" onClick={() => setEditing(i)}>
          <span className="name">{i.name}</span>
          <span className="meta">
            {i.category} · {i.type}
            {isRepeating(i) ? ` · every ${i.repeat_every === 1 ? i.repeat_unit!.replace(/s$/, "") : `${i.repeat_every} ${i.repeat_unit}`}` : ""}
            {i.cost != null ? ` · $${i.cost}` : ""}
          </span>
          <span className={`when ${cls}`}>{view === "done" ? `Done ${i.done_at?.slice(0, 10)}` : `${describeDue(d)} · ${i.due_date}`}</span>
        </button>
        {view === "upcoming" ? (
          <button className="check" aria-label={`Mark ${i.name} done`} onClick={() => done(i)}>
            ✓
          </button>
        ) : (
          <button className="check" aria-label="Move back to upcoming" onClick={() => store.undoDone(i).then(reload)}>
            ↺
          </button>
        )}
      </li>
    );
  }

  return (
    <div className="app">
      <header>
        <h1>{view === "upcoming" ? "Upcoming" : "Done"}</h1>
        <div className="hdr">
          <button className="ghost" onClick={() => setView(view === "upcoming" ? "done" : "upcoming")}>
            {view === "upcoming" ? "Done list" : "Back"}
          </button>
          <button className="ghost" aria-label="Settings" onClick={() => setSettings(true)}>
            ⚙
          </button>
        </div>
      </header>
      {demoMode && <div className="banner">Demo mode: data stays on this device only.</div>}
      {error && <div className="banner err">{error}</div>}

      <div className="chips scroll">
        {categories.map((c) => (
          <button key={c} className={`chip ${filter === c ? "on" : ""}`} onClick={() => setFilter(c)}>
            {c}
          </button>
        ))}
      </div>

      <main>
        {overdue.length > 0 && (
          <>
            <h2 className="sec bad">Overdue</h2>
            <ul>{overdue.map(row)}</ul>
          </>
        )}
        {upcoming.length > 0 && (
          <>
            {overdue.length > 0 && <h2 className="sec">Coming up</h2>}
            <ul>{upcoming.map(row)}</ul>
          </>
        )}
        {shown.length === 0 && (
          <p className="empty muted">{view === "upcoming" ? "Nothing coming up. Tap + to add something you don't want to forget." : "Nothing done yet."}</p>
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

      {editing && (
        <ItemForm
          item={editing === "new" ? null : editing}
          defaultCategory={filter !== "All" ? filter : undefined}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {settings && <Settings email={email} onClose={() => setSettings(false)} onSignOut={onSignOut} />}
    </div>
  );
}
