import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { demoMode, store, type Session } from "./lib/store";
import { addInterval, daysUntil, describeDue, isRepeating, sortItems, todayLocal } from "./lib/dates";
import { getCategoryColor } from "./lib/categoryColors";
import { CATEGORIES, type Item } from "./types";
import Auth from "./components/Auth";
import ItemForm from "./components/ItemForm";
import Settings from "./components/Settings";

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !("MSStream" in window);
const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches ||
  !!(navigator as { standalone?: boolean }).standalone;

function SkeletonCard() {
  return (
    <li className="row skeleton" aria-hidden="true">
      <div className="skel-body" />
    </li>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    return store.subscribeToAuth(setSession);
  }, []);

  if (session === undefined) return <div className="center muted">Loading…</div>;
  if (!session) return <Auth onDone={() => {}} />;
  if (session.needsPasswordReset) return <Auth initialMode="reset" onDone={() => {}} />;
  return <Main email={session.email} onSignOut={() => store.signOut()} />;
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
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const reload = useCallback(async () => {
    try {
      setItems(await store.list());
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load your reminders. Please try again."
      );
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
      (i) =>
        (view === "done" ? !!i.done_at : !i.done_at) &&
        (filter === "All" || i.category === filter)
    );
    return view === "done" ? sortItems(base).reverse() : sortItems(base);
  }, [items, filter, view]);

  const overdue = view === "upcoming" ? shown.filter((i) => daysUntil(i, today) < 0) : [];
  const dueSoon =
    view === "upcoming"
      ? shown.filter((i) => { const d = daysUntil(i, today); return d >= 0 && d <= 7; })
      : [];
  const later =
    view === "upcoming" ? shown.filter((i) => daysUntil(i, today) > 7) : shown;

  function showToast(text: string, undo?: () => void) {
    clearTimeout(toastTimer.current);
    setToast({ text, undo });
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }

  async function done(item: Item) {
    await store.markDone(item);
    await reload();
    showToast(
      isRepeating(item) ? "Done! Next one is scheduled." : "Marked done.",
      async () => {
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
      }
    );
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
              ? ` · every ${
                  i.repeat_every === 1
                    ? i.repeat_unit!.replace(/s$/, "")
                    : `${i.repeat_every} ${i.repeat_unit}`
                }`
              : ""}
            {i.cost != null ? ` · $${i.cost}` : ""}
          </span>
          <span className={`when ${cls}`}>
            {view === "done" ? `Done ${i.done_at?.slice(0, 10)}` : describeDue(d)}
          </span>
        </button>
        {view === "upcoming" ? (
          <div className="row-actions">
            <button
              className="check"
              aria-label={`Mark ${i.name} done`}
              onClick={() => done(i)}
            >
              ✓
            </button>
            <button
              className="snooze"
              aria-label={`Snooze ${i.name}`}
              onClick={() => setSnoozeTarget(i)}
            >
              💤
            </button>
          </div>
        ) : (
          <button
            className="check"
            aria-label="Move back to upcoming"
            onClick={() => store.undoDone(i).then(reload)}
          >
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
          <button
            className="ghost"
            onClick={() => setView(view === "upcoming" ? "done" : "upcoming")}
          >
            {view === "upcoming" ? "Done list" : "Back"}
          </button>
          <button className="ghost" aria-label="Settings" onClick={() => setSettings(true)}>
            ⚙
          </button>
        </div>
      </header>

      {safariBanner && (
        <div className="banner safari-banner">
          For the best experience and to stay logged in, add Remind Me to your Home Screen: tap
          Share → Add to Home Screen.
          <button className="banner-close" aria-label="Dismiss" onClick={dismissSafariBanner}>
            ✕
          </button>
        </div>
      )}
      {demoMode && (
        <div className="banner">Demo mode: data stays on this device only.</div>
      )}
      {error && <div className="banner err">{error}</div>}

      <div className="chips scroll">
        {categories.map((c) => (
          <button
            key={c}
            className={`chip ${filter === c ? "on" : ""}`}
            onClick={() => setFilter(c)}
          >
            {c !== "All" && (
              <span
                className="chip-dot"
                style={{ background: getCategoryColor(c, categoryColors) }}
              />
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
                  onClick={() =>
                    setEditing({
                      id: "__example__",
                      name,
                      category: "Home",
                      type: "renewal",
                      due_date: "",
                      repeat_every: null,
                      repeat_unit: null,
                      warn_days: [30, 7],
                      notes: "",
                      cost: null,
                      photo_path: null,
                      done_at: null,
                      notify_via: "both",
                    })
                  }
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
              <button className="primary" onClick={() => snooze(snoozeTarget, 1)}>
                1 day
              </button>
              <button className="primary" onClick={() => snooze(snoozeTarget, 3)}>
                3 days
              </button>
              <button className="primary" onClick={() => snooze(snoozeTarget, 7)}>
                1 week
              </button>
            </div>
            <button className="ghost wide" onClick={() => setSnoozeTarget(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {editing !== null && (
        <ItemForm
          item={
            editing === "new" || (editing as Item).id === "__example__"
              ? null
              : (editing as Item)
          }
          defaultName={
            (editing as Item)?.id === "__example__" ? (editing as Item).name : undefined
          }
          defaultCategory={filter !== "All" ? filter : undefined}
          categoryColors={categoryColors}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}

      {settings && (
        <Settings
          email={email}
          categoryColors={categoryColors}
          onCategoryColorsChange={(colors: Record<string, string>) => {
            setCategoryColors(colors);
            store
              .getProfile()
              .then((p) => store.saveProfile({ ...p, category_colors: colors }))
              .catch(() => {});
          }}
          onClose={() => setSettings(false)}
          onSignOut={onSignOut}
        />
      )}
    </div>
  );
}
