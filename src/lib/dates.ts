import type { Item, RepeatUnit } from "../types";

// YYYY-MM-DD strings are always handled in UTC to prevent DST shifts.
// due_at timestamps are ISO 8601 with timezone offset (as returned by Supabase).
// When due_at is null, the effective time is 09:00 in the user's profile timezone
// (resolved by effectiveDueAt in the app, and by the edge function using localNow).

export function parse(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function format(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

export function todayLocal(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86400000);
}

/** Add an interval to a YYYY-MM-DD string, clamping month-ends. Does not handle minutes/hours/special units. */
export function addInterval(date: string, n: number, unit: RepeatUnit): string {
  const dt = parse(date);
  if (unit === "days") dt.setUTCDate(dt.getUTCDate() + n);
  else if (unit === "weeks") dt.setUTCDate(dt.getUTCDate() + 7 * n);
  else {
    const months = unit === "months" ? n : 12 * n;
    const day = dt.getUTCDate();
    dt.setUTCDate(1);
    dt.setUTCMonth(dt.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
    dt.setUTCDate(Math.min(day, lastDay));
  }
  return format(dt);
}

/**
 * Add an interval to an ISO timestamptz string, preserving time-of-day.
 * Handles all RepeatUnit values including minutes, hours, last/first day of month.
 */
export function addIntervalTs(isoTs: string, n: number, unit: RepeatUnit): string {
  const dt = new Date(isoTs);
  if (unit === "minutes") return new Date(dt.getTime() + n * 60_000).toISOString();
  if (unit === "hours")   return new Date(dt.getTime() + n * 3_600_000).toISOString();
  if (unit === "days")    return new Date(dt.getTime() + n * 86_400_000).toISOString();
  if (unit === "weeks")   return new Date(dt.getTime() + n * 7 * 86_400_000).toISOString();
  if (unit === "months" || unit === "years") {
    const months = unit === "years" ? n * 12 : n;
    const day = dt.getUTCDate();
    const result = new Date(dt);
    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
    result.setUTCDate(Math.min(day, lastDay));
    return result.toISOString();
  }
  if (unit === "last_day_of_month") {
    // Last day of the month AFTER dt's month, same time-of-day (UTC)
    const lastDay = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 2, 0));
    lastDay.setUTCHours(dt.getUTCHours(), dt.getUTCMinutes(), dt.getUTCSeconds(), 0);
    return lastDay.toISOString();
  }
  if (unit === "first_day_of_month") {
    // First day of next month, same time-of-day (UTC)
    const firstDay = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1));
    firstDay.setUTCHours(dt.getUTCHours(), dt.getUTCMinutes(), dt.getUTCSeconds(), 0);
    return firstDay.toISOString();
  }
  throw new Error(`Unknown RepeatUnit: ${unit}`);
}

/**
 * Roll a timestamptz forward past `now`, skipping missed occurrences.
 * For last/first day of month, n is ignored (always advance by one period).
 */
export function rollForwardAt(dueAt: string, n: number, unit: RepeatUnit, now: string): string {
  const isSpecial = unit === "last_day_of_month" || unit === "first_day_of_month";
  if (isSpecial) {
    let next = addIntervalTs(dueAt, 1, unit);
    while (next <= now) next = addIntervalTs(next, 1, unit);
    return next;
  }
  let k = 1;
  let next = addIntervalTs(dueAt, n * k, unit);
  while (next <= now) { k++; next = addIntervalTs(dueAt, n * k, unit); }
  return next;
}

/**
 * Roll a YYYY-MM-DD date forward past today, skipping missed occurrences.
 * Kept for backward compat and date-only (no due_at) items.
 */
export function rollForward(due: string, n: number, unit: RepeatUnit, today: string): string {
  let k = 1;
  let next = addInterval(due, n * k, unit);
  while (next <= today) { k++; next = addInterval(due, n * k, unit); }
  return next;
}

/** True for units that don't use repeat_every (they always advance by one period). */
export function isSpecialUnit(unit: RepeatUnit | null): boolean {
  return unit === "last_day_of_month" || unit === "first_day_of_month";
}

export function isRepeating(item: Pick<Item, "repeat_every" | "repeat_unit">): boolean {
  if (!item.repeat_unit) return false;
  if (isSpecialUnit(item.repeat_unit)) return true;
  return !!item.repeat_every;
}

/**
 * The effective due moment for an item in the browser.
 * If due_at is set, use it directly.
 * If null, fall back to due_date at 09:00 in the browser's local timezone
 * (proxy for the user's timezone when the profile hasn't been loaded yet).
 */
export function effectiveDueAt(item: Pick<Item, "due_date" | "due_at">): Date {
  if (item.due_at) return new Date(item.due_at);
  const [y, m, d] = item.due_date.split("-").map(Number);
  return new Date(y, m - 1, d, 9, 0, 0);
}

/**
 * Which list group this item belongs to, relative to now.
 * "now"   — overdue (effective due time is in the past)
 * "today" — due later today
 * "week"  — due within the next 7 calendar days (not today)
 * "later" — more than 7 days away
 */
export function dueGroup(
  item: Pick<Item, "due_date" | "due_at">,
  now: Date = new Date()
): "now" | "today" | "week" | "later" {
  const due = effectiveDueAt(item);
  if (due <= now) return "now";
  if (
    due.getFullYear() === now.getFullYear() &&
    due.getMonth()    === now.getMonth() &&
    due.getDate()     === now.getDate()
  ) return "today";
  const daysAway = Math.ceil((due.getTime() - now.getTime()) / 86_400_000);
  return daysAway <= 7 ? "week" : "later";
}

/**
 * Plain-language label for a due time, computed relative to now.
 * Updates every minute via setInterval in App.tsx.
 * Examples: "Overdue by 25 minutes", "In 3 hours", "Tomorrow at 7:15 PM", "In 5 days".
 */
export function formatDueLabel(
  item: Pick<Item, "due_date" | "due_at">,
  now: Date = new Date()
): string {
  const due = effectiveDueAt(item);
  const diffMs = due.getTime() - now.getTime();
  const absMs  = Math.abs(diffMs);
  const overdue = diffMs < 0;

  const mins = Math.round(absMs / 60_000);
  const hrs  = Math.round(absMs / 3_600_000);
  const days = Math.round(absMs / 86_400_000);

  const fmtTime = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  if (overdue) {
    if (mins < 60)  return `Overdue by ${mins < 2 ? "1 minute" : `${mins} minutes`}`;
    if (hrs  < 24)  return `Overdue by ${hrs < 2 ? "1 hour" : `${hrs} hours`}`;
    return `Overdue by ${days < 2 ? "1 day" : `${days} days`}`;
  }
  if (mins < 60)  return `In ${mins < 2 ? "1 minute" : `${mins} minutes`}`;
  if (hrs  < 24)  return `In ${hrs < 2 ? "1 hour" : `${hrs} hours`}`;

  // Check tomorrow
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (
    due.getFullYear() === tomorrow.getFullYear() &&
    due.getMonth()    === tomorrow.getMonth() &&
    due.getDate()     === tomorrow.getDate()
  ) return `Tomorrow at ${fmtTime(due)}`;

  if (days < 7) {
    const dayName = due.toLocaleDateString(undefined, { weekday: "long" });
    return `${dayName} at ${fmtTime(due)}`;
  }
  if (days < 14) return `In ${days} days`;
  if (days < 60) return `In ${Math.round(days / 7)} weeks`;
  return `In ${Math.round(days / 30)} months`;
}

/** Days-based label kept for the Done list. */
export function describeDue(days: number): string {
  if (days < -1) return `${-days} days overdue`;
  if (days === -1) return "1 day overdue";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 14) return `In ${days} days`;
  if (days < 60) return `In ${Math.round(days / 7)} weeks`;
  return `In ${Math.round(days / 30)} months`;
}

export function daysUntil(item: Pick<Item, "due_date">, today: string): number {
  return daysBetween(today, item.due_date);
}

export function reminderReason(
  item: Pick<Item, "due_date" | "warn_days">,
  today: string
): "warning" | "due" | "overdue" | null {
  const d = daysBetween(today, item.due_date);
  if (d < 0) return "overdue";
  if (d === 0) return "due";
  return item.warn_days.includes(d) ? "warning" : null;
}

export function sortItems<T extends Pick<Item, "due_date" | "due_at">>(items: T[]): T[] {
  return [...items].sort((a, b) => effectiveDueAt(a).getTime() - effectiveDueAt(b).getTime());
}
