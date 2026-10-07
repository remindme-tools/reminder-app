import { useEffect, useState, type FormEvent } from "react";
import { store } from "../lib/store";
import { addInterval, todayLocal } from "../lib/dates";
import { shrinkPhoto } from "../lib/image";
import { CATEGORIES, type Item, type ItemType, type RepeatUnit } from "../types";

const TYPES: { id: ItemType; label: string; hint: string }[] = [
  { id: "renewal", label: "Renewal", hint: "Insurance, subscriptions, registration" },
  { id: "expiry", label: "Expiry", hint: "Passport, food, licence, deadline" },
  { id: "repeating", label: "Repeating", hint: "Filter change, check-up, chores" },
];
const DEFAULT_WARN: Record<ItemType, number[]> = { renewal: [30, 7, 1], expiry: [30, 7, 1], repeating: [3, 1] };
const WARN_CHOICES = [60, 30, 14, 7, 3, 1, 0];

export default function ItemForm({
  item,
  defaultCategory,
  onClose,
  onSaved,
}: {
  item: Item | null;
  defaultCategory?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = todayLocal();
  const [name, setName] = useState(item?.name ?? "");
  const [type, setType] = useState<ItemType>(item?.type ?? "renewal");
  const [category, setCategory] = useState(item?.category ?? defaultCategory ?? "Home");
  const [due, setDue] = useState(item?.due_date ?? addInterval(today, 1, "months"));
  const [more, setMore] = useState(!!item);
  const [every, setEvery] = useState<string>(String(item?.repeat_every ?? 1));
  const [unit, setUnit] = useState<RepeatUnit>(item?.repeat_unit ?? "years");
  const [repeatOn, setRepeatOn] = useState(item ? !!item.repeat_every : true);
  const [warn, setWarn] = useState<number[]>(item?.warn_days ?? DEFAULT_WARN[item?.type ?? "renewal"]);
  const [customWarn, setCustomWarn] = useState("");
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
    if (t === "repeating") {
      setRepeatOn(true);
      setEvery("3");
      setUnit("months");
    } else if (t === "renewal") {
      setRepeatOn(true);
      setEvery("1");
      setUnit("years");
    } else setRepeatOn(false);
  }

  const toggleWarn = (d: number) => setWarn((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d].sort((a, b) => b - a)));
  const choices = Array.from(new Set([...WARN_CHOICES, ...warn])).sort((a, b) => b - a);

  async function onPhoto(file?: File) {
    if (!file) return;
    try {
      setPhoto(await store.uploadPhoto(await shrinkPhoto(file)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Photo upload failed");
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const n = parseInt(every, 10);
    if (repeatOn && !(n > 0)) return setErr("Repeat interval must be 1 or more.");
    setBusy(true);
    setErr("");
    const input = {
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
    };
    try {
      if (item) await store.update(item.id, input);
      else await store.create(input);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
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
        <h2>{item ? "Edit item" : "New reminder"}</h2>

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
            <button type="button" key={c} className={`chip ${category === c ? "on" : ""}`} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>

        {!more && (
          <button type="button" className="ghost wide" onClick={() => setMore(true)}>
            More options: repeat, early warnings, notes, cost, photo
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

            <div className="lbl">Cost</div>
            <input type="number" step="0.01" min={0} inputMode="decimal" placeholder="Optional" value={cost} onChange={(e) => setCost(e.target.value)} />

            <div className="lbl">Notes</div>
            <textarea rows={3} placeholder="Policy number, where to renew…" value={notes} onChange={(e) => setNotes(e.target.value)} />

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
