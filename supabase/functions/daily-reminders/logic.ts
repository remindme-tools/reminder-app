// Pure helpers for the reminder job. No imports, so it runs in Deno (the server)
// and in Vitest (our tests). Keep date rules in step with src/lib/dates.ts.

export interface DueItem {
  name: string;
  category: string;
  due_date: string; // YYYY-MM-DD
  warn_days: number[];
  cost: number | null;
  notify_via?: string; // 'email' | 'push' | 'both' — undefined treated as 'both'
}

export type Reason = "overdue" | "due" | "warning";

export function daysBetween(from: string, to: string): number {
  const p = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((p(to) - p(from)) / 86400000);
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
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
  } catch {
    tz = "UTC";
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

const SEND_FROM_HOUR = 7; // send the morning summary at/after 7am local time

export function shouldSendNow(timeZone: string, alreadySentOn: string | null, now: Date = new Date()): { send: boolean; today: string } {
  const { date, hour } = localNow(timeZone, now);
  return { send: hour >= SEND_FROM_HOUR && alreadySentOn !== date, today: date };
}

export interface Digest {
  count: number;
  subject: string;
  text: string;
  html: string;
  pushTitle: string;
  pushBody: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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
    hits
      .map((h) => `<li style="margin-bottom:8px${h.reason === "overdue" ? ";color:#b91c1c" : ""}"><b>${esc(h.i.name)}</b> (${esc(h.i.category)}) &mdash; ${when(h.d)}, ${h.i.due_date}${h.i.cost != null ? `, $${h.i.cost}` : ""}</li>`)
      .join("") +
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
