import type { Item, RepeatUnit } from "../types";

// All dates are plain "YYYY-MM-DD" strings, handled in UTC so time zones and
// daylight-saving changes can never shift a date by a day.

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

/** Add an interval, clamping month-ends (Jan 31 + 1 month = Feb 28/29). */
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
 * Next due date after marking done: the following occurrence after the current
 * due date, skipping any that are already in the past. Always computed from the
 * original date so a monthly item on the 31st does not drift to the 28th.
 */
export function rollForward(due: string, n: number, unit: RepeatUnit, today: string): string {
  let k = 1;
  let next = addInterval(due, n * k, unit);
  while (next <= today) {
    k++;
    next = addInterval(due, n * k, unit);
  }
  return next;
}

export function isRepeating(item: Pick<Item, "repeat_every" | "repeat_unit">): boolean {
  return !!item.repeat_every && !!item.repeat_unit;
}

/** Days until due (negative = overdue). */
export function daysUntil(item: Pick<Item, "due_date">, today: string): number {
  return daysBetween(today, item.due_date);
}

/** True if a reminder is due today: a warning day matches, due today, or overdue. */
export function reminderReason(
  item: Pick<Item, "due_date" | "warn_days">,
  today: string
): "warning" | "due" | "overdue" | null {
  const d = daysBetween(today, item.due_date);
  if (d < 0) return "overdue";
  if (d === 0) return "due";
  return item.warn_days.includes(d) ? "warning" : null;
}

export function describeDue(days: number): string {
  if (days < -1) return `${-days} days overdue`;
  if (days === -1) return "1 day overdue";
  if (days === 0) return "Due today";
  if (days === 1) return "Tomorrow";
  if (days < 14) return `In ${days} days`;
  if (days < 60) return `In ${Math.round(days / 7)} weeks`;
  return `In ${Math.round(days / 30)} months`;
}

/** Sort: overdue first (most overdue first), then by date ascending. */
export function sortItems<T extends Pick<Item, "due_date">>(items: T[]): T[] {
  return [...items].sort((a, b) => a.due_date.localeCompare(b.due_date));
}
