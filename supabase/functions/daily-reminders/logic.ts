// Pure helpers for the reminder job. No imports — runs in Deno and Vitest.
// Keep date rules in step with src/lib/dates.ts.

export type RepeatUnit =
  | "minutes" | "hours" | "days" | "weeks" | "months" | "years"
  | "last_day_of_month" | "first_day_of_month";

export interface DueItem {
  id: string;
  name: string;
  category: string;
  due_date: string;          // YYYY-MM-DD
  due_at: string | null;     // ISO timestamptz — null means 09:00 in user's profile timezone
  snoozed_until: string | null;
  warn_days: number[];
  cost: number | null;
  notify_via?: string;       // 'email' | 'push' | 'both' — undefined = 'both'
  repeat_every: number | null;
  repeat_unit: RepeatUnit | null;
}

export type Reason = "overdue" | "due" | "warning";

export function daysBetween(from: string, to: string): number {
  const p = (s: string) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(to) - p(from)) / 86_400_000);
}

export function reminderReason(item: Pick<DueItem, "due_date" | "warn_days">, today: string): Reason | null {
  const d = daysBetween(today, item.due_date);
  if (d < 0) return "overdue";
  if (d === 0) return "due";
  return item.warn_days.includes(d) ? "warning" : null;
}

/** The date and hour it currently is for someone in the given time zone. */
export function localNow(timeZone: string, now: Date = new Date()): { date: string; hour: number } {
  let tz = timeZone || "UTC";
  try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }); } catch { tz = "UTC"; }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
    }).formatToParts(now).map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

const SEND_FROM_HOUR = 7;

export function shouldSendNow(timeZone: string, alreadySentOn: string | null, now: Date = new Date()): { send: boolean; today: string } {
  const { date, hour } = localNow(timeZone, now);
  return { send: hour >= SEND_FROM_HOUR && alreadySentOn !== date, today: date };
}

/**
 * The effective due moment for a server-side item.
 * If due_at is set, use it directly.
 * If null, use due_date at 09:00 in the user's profile timezone.
 */
export function effectiveDueAt(item: Pick<DueItem, "due_date" | "due_at">, timeZone = "UTC"): Date {
  if (item.due_at) return new Date(item.due_at);
  // Build 09:00 in the user's timezone by formatting the date in that tz and parsing it
  const local = localNow(timeZone, new Date(item.due_date + "T12:00:00Z")); // noon UTC → local date
  // Construct 09:00 local by offsetting: find UTC ms that gives 09:00 in timeZone
  const tz = timeZone || "UTC";
  // Use Intl to find the UTC time that equals 09:00 on due_date in timeZone
  const [y, m, d] = item.due_date.split("-").map(Number);
  // Binary-search the UTC offset isn't needed; instead use a simpler trick:
  // format a candidate UTC time in the tz and check if it reads 09:00
  let candidate = new Date(Date.UTC(y, m - 1, d, 9, 0, 0)); // start with 09:00 UTC
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).formatToParts(candidate).map((p) => [p.type, p.value])
    );
    const localHour = Number(parts.hour);
    const localMin  = Number(parts.minute);
    const diffMs = ((9 - localHour) * 60 + (0 - localMin)) * 60_000;
    if (Math.abs(diffMs) < 60_000) break;
    candidate = new Date(candidate.getTime() + diffMs);
  }
  return candidate;
}

/**
 * The key used in reminder_fires.fired_at for this item's current occurrence.
 * Uses due_at if set, otherwise due_date@09:00 UTC (timezone-unaware fallback for server).
 * Pass the user's timezone for accurate results when due_at is null.
 */
export function firedAtKey(item: Pick<DueItem, "due_date" | "due_at">, timeZone = "UTC"): string {
  return effectiveDueAt(item, timeZone).toISOString();
}

/**
 * True if this item should fire a reminder right now.
 * Checks: effective due time has passed, and not currently snoozed.
 */
export function isDueNow(
  item: Pick<DueItem, "due_date" | "due_at" | "snoozed_until">,
  now: Date,
  timeZone = "UTC"
): boolean {
  if (item.snoozed_until && new Date(item.snoozed_until) > now) return false;
  return effectiveDueAt(item, timeZone) <= now;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Short single-item email for per-minute firing. */
export function buildItemEmail(
  item: DueItem,
  now: Date,
  timeZone = "UTC"
): { subject: string; html: string; text: string } | null {
  if (!isDueNow(item, now, timeZone)) return null;
  const due = effectiveDueAt(item, timeZone);
  const diffMs = now.getTime() - due.getTime();
  const overdueMins = Math.round(diffMs / 60_000);
  const when = overdueMins <= 1 ? "now" : overdueMins < 60 ? `${overdueMins} min ago` : "overdue";
  const subject = `Reminder: ${item.name} is due ${when}`;
  const costLine = item.cost != null ? ` · $${item.cost}` : "";
  const text = `${item.name} (${item.category}) — due ${when}${costLine}`;
  const html =
    `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:16px">` +
    `<p><b>${esc(item.name)}</b> (${esc(item.category)}) is due <b>${when}</b>${costLine}.</p>` +
    `</div>`;
  return { subject, html, text };
}

/** Push payload for a single item. */
export function buildItemPush(item: DueItem): { title: string; body: string; tag: string } {
  return {
    title: item.name,
    body: `Due now · ${item.category}${item.cost != null ? ` · $${item.cost}` : ""}`,
    tag: `item-${item.id}`,
  };
}

// ---- Legacy digest (kept so existing tests continue to pass) ----

export interface Digest {
  count: number;
  subject: string;
  text: string;
  html: string;
  pushTitle: string;
  pushBody: string;
}

function when(d: number): string {
  if (d < 0) return d === -1 ? "1 day overdue" : `${-d} days overdue`;
  if (d === 0) return "due today";
  return d === 1 ? "due tomorrow" : `due in ${d} days`;
}

export function buildDigest(items: DueItem[], today: string): Digest | null {
  const hits = items
    .map((i) => ({ i, reason: reminderReason(i, today), d: daysBetween(today, i.due_date) }))
    .filter((x): x is { i: DueItem; reason: Reason; d: number } => x.reason !== null)
    .sort((a, b) => a.d - b.d);
  if (hits.length === 0) return null;

  const overdue = hits.filter((h) => h.reason === "overdue").length;
  const line = (h: (typeof hits)[number]) =>
    `${h.i.name} (${h.i.category}) - ${when(h.d)}, ${h.i.due_date}${h.i.cost != null ? `, $${h.i.cost}` : ""}`;
  const subject =
    hits.length === 1
      ? `Reminder: ${hits[0].i.name} is ${when(hits[0].d)}`
      : `${hits.length} reminders today${overdue ? ` (${overdue} overdue)` : ""}`;
  const text = hits.map((h) => `- ${line(h)}`).join("\n");
  const html =
    `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:16px"><p>Here is what needs your attention:</p><ul>` +
    hits.map((h) =>
      `<li style="margin-bottom:8px${h.reason === "overdue" ? ";color:#b91c1c" : ""}">` +
      `<b>${esc(h.i.name)}</b> (${esc(h.i.category)}) &mdash; ${when(h.d)}, ${h.i.due_date}` +
      `${h.i.cost != null ? `, $${h.i.cost}` : ""}</li>`
    ).join("") +
    `</ul></div>`;
  return {
    count: hits.length,
    subject,
    text,
    html,
    pushTitle: subject,
    pushBody: hits.slice(0, 3).map((h) => `${h.i.name}: ${when(h.d)}`).join("\n"),
  };
}
