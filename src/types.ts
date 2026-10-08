export type ItemType = "repeating" | "expiry" | "renewal";

export type RepeatUnit =
  | "minutes" | "hours" | "days" | "weeks" | "months" | "years"
  | "last_day_of_month" | "first_day_of_month";

export type NotifyVia = "email" | "push" | "both";

export interface Item {
  id: string;
  name: string;
  category: string;
  type: ItemType;
  due_date: string;             // YYYY-MM-DD — kept for index and backward compat
  due_at: string | null;        // ISO 8601 timestamptz — null means 09:00 in user's profile timezone
  snoozed_until: string | null; // ISO 8601 timestamptz — skip firing until this time
  repeat_every: number | null;  // null for last_day_of_month / first_day_of_month
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
