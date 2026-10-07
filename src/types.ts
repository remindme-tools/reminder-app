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
