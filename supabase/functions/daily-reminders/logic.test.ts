import { describe, expect, it } from "vitest";
import { buildDigest, localNow, shouldSendNow } from "./logic";

const item = (name: string, due_date: string, warn_days = [7, 1]) => ({ name, category: "Home", due_date, warn_days, cost: null });

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
