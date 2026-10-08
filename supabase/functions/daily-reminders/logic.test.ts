import { describe, expect, it } from "vitest";
import { buildDigest, buildItemEmail, firedAtKey, isDueNow, localNow, shouldSendNow } from "./logic";

const item = (name: string, due_date: string, warn_days = [7, 1]) => ({
  id: "test-id", name, category: "Home", due_date,
  due_at: null as string | null, snoozed_until: null as string | null,
  warn_days, cost: null, repeat_every: null, repeat_unit: null,
});

describe("buildDigest", () => {
  it("returns null when nothing is due", () => {
    expect(buildDigest([item("A", "2026-12-01")], "2026-10-06")).toBeNull();
  });
  it("includes warnings, due and overdue, most urgent first", () => {
    const d = buildDigest([item("Warn", "2026-10-13"), item("Late", "2026-10-01"), item("Today", "2026-10-06"), item("Quiet", "2026-10-20")], "2026-10-06")!;
    expect(d.count).toBe(3);
    expect(d.text.split("\n")[0]).toContain("Late");
    expect(d.subject).toBe("3 reminders today (1 overdue)");
    expect(d.text).not.toContain("Quiet");
  });
  it("escapes html in names", () => {
    const d = buildDigest([item("<b>x</b>", "2026-10-06")], "2026-10-06")!;
    expect(d.html).not.toContain("<b>x</b>");
  });
});

describe("time zones", () => {
  const t = new Date("2026-10-06T22:30:00Z");
  it("computes local date and hour", () => {
    expect(localNow("Pacific/Auckland", t)).toEqual({ date: "2026-10-07", hour: 11 });
    expect(localNow("America/New_York", t)).toEqual({ date: "2026-10-06", hour: 18 });
  });
  it("falls back to UTC for a bad zone", () => {
    expect(localNow("Nope/Zone", t).hour).toBe(22);
  });
  it("sends once per local day, from 7am", () => {
    expect(shouldSendNow("UTC", null, new Date("2026-10-06T06:59:00Z")).send).toBe(false);
    expect(shouldSendNow("UTC", null, new Date("2026-10-06T07:00:00Z")).send).toBe(true);
    expect(shouldSendNow("UTC", "2026-10-06", new Date("2026-10-06T09:00:00Z")).send).toBe(false);
  });
});

describe("isDueNow", () => {
  const base = {
    id: "abc", name: "Test", category: "Home",
    due_date: "2026-10-07", due_at: "2026-10-07T14:00:00.000Z", snoozed_until: null,
    warn_days: [], cost: null, repeat_every: null, repeat_unit: null,
  };
  it("true when due_at is in the past", () => {
    expect(isDueNow(base, new Date("2026-10-07T14:01:00Z"))).toBe(true);
  });
  it("false when due_at is in the future", () => {
    expect(isDueNow(base, new Date("2026-10-07T13:59:00Z"))).toBe(false);
  });
  it("false when snoozed", () => {
    expect(isDueNow({ ...base, snoozed_until: "2026-10-07T15:00:00.000Z" }, new Date("2026-10-07T14:30:00Z"))).toBe(false);
  });
  it("true after snooze expires", () => {
    expect(isDueNow({ ...base, snoozed_until: "2026-10-07T14:30:00.000Z" }, new Date("2026-10-07T14:31:00Z"))).toBe(true);
  });
  it("null due_at fires at 09:00 UTC when tz is UTC", () => {
    const noTime = { ...base, due_at: null };
    expect(isDueNow(noTime, new Date("2026-10-07T09:01:00Z"), "UTC")).toBe(true);
    expect(isDueNow(noTime, new Date("2026-10-07T08:59:00Z"), "UTC")).toBe(false);
  });
});

describe("firedAtKey", () => {
  it("returns due_at when set", () => {
    const ts = "2026-10-07T14:00:00.000Z";
    expect(firedAtKey({ due_date: "2026-10-07", due_at: ts })).toBe(ts);
  });
  it("returns 09:00 UTC when due_at is null and tz is UTC", () => {
    expect(firedAtKey({ due_date: "2026-10-07", due_at: null }, "UTC")).toBe("2026-10-07T09:00:00.000Z");
  });
});

describe("buildItemEmail", () => {
  const baseItem = {
    id: "abc", name: "Car Insurance", category: "Car",
    due_date: "2026-10-07", due_at: "2026-10-07T14:00:00.000Z", snoozed_until: null,
    warn_days: [], cost: 250, repeat_every: null, repeat_unit: null,
  };
  it("returns an email when item is due", () => {
    const msg = buildItemEmail(baseItem, new Date("2026-10-07T14:01:00Z"));
    expect(msg).not.toBeNull();
    expect(msg!.subject).toContain("Car Insurance");
    expect(msg!.html).toContain("Car Insurance");
    expect(msg!.html).toContain("$250");
  });
  it("returns null when item is not yet due", () => {
    expect(buildItemEmail(baseItem, new Date("2026-10-07T13:59:00Z"))).toBeNull();
  });
});

describe("buildDigest respects notify_via pre-filtering", () => {
  const today = "2026-10-07";
  const allItems = [
    { id: "1", name: "A", category: "Home",  due_date: "2026-10-07", due_at: null, snoozed_until: null, warn_days: [], cost: null, notify_via: "email", repeat_every: null, repeat_unit: null },
    { id: "2", name: "B", category: "Car",   due_date: "2026-10-07", due_at: null, snoozed_until: null, warn_days: [], cost: null, notify_via: "push",  repeat_every: null, repeat_unit: null },
    { id: "3", name: "C", category: "Other", due_date: "2026-10-07", due_at: null, snoozed_until: null, warn_days: [], cost: null, notify_via: "both",  repeat_every: null, repeat_unit: null },
  ];
  it("emailItems digest contains email and both items only", () => {
    const emailItems = allItems.filter((i) => !i.notify_via || i.notify_via === "email" || i.notify_via === "both");
    const d = buildDigest(emailItems, today);
    expect(d?.count).toBe(2);
    expect(d?.text).toContain("A");
    expect(d?.text).toContain("C");
    expect(d?.text).not.toContain("B");
  });
  it("pushItems digest contains push and both items only", () => {
    const pushItems = allItems.filter((i) => !i.notify_via || i.notify_via === "push" || i.notify_via === "both");
    const d = buildDigest(pushItems, today);
    expect(d?.count).toBe(2);
    expect(d?.text).toContain("B");
    expect(d?.text).toContain("C");
    expect(d?.text).not.toContain("A");
  });
});
