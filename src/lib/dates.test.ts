import { describe, expect, it } from "vitest";
import { addInterval, addIntervalTs, daysBetween, describeDue, dueGroup, isRepeating, isSpecialUnit, reminderReason, rollForward, rollForwardAt, todayLocal } from "./dates";

describe("addInterval", () => {
  it("adds days and weeks", () => {
    expect(addInterval("2026-10-06", 10, "days")).toBe("2026-10-16");
    expect(addInterval("2026-12-30", 1, "weeks")).toBe("2027-01-06");
  });
  it("clamps month ends", () => {
    expect(addInterval("2026-01-31", 1, "months")).toBe("2026-02-28");
    expect(addInterval("2028-01-31", 1, "months")).toBe("2028-02-29");
  });
  it("handles years and leap day", () => {
    expect(addInterval("2028-02-29", 1, "years")).toBe("2029-02-28");
    expect(addInterval("2026-10-06", 3, "months")).toBe("2027-01-06");
  });
});

describe("rollForward", () => {
  it("moves one interval when done on time", () => {
    expect(rollForward("2026-10-06", 3, "months", "2026-10-06")).toBe("2027-01-06");
  });
  it("moves one interval when done early", () => {
    expect(rollForward("2026-12-01", 1, "years", "2026-10-06")).toBe("2027-12-01");
  });
  it("skips missed cycles when long overdue", () => {
    expect(rollForward("2026-01-10", 1, "months", "2026-10-06")).toBe("2026-10-10");
  });
  it("does not drift from the 31st", () => {
    expect(rollForward("2026-01-31", 1, "months", "2026-01-31")).toBe("2026-02-28");
    expect(rollForward("2026-01-31", 1, "months", "2026-03-01")).toBe("2026-03-31");
  });
  it("never returns today or earlier", () => {
    expect(rollForward("2026-10-01", 1, "days", "2026-10-06")).toBe("2026-10-07");
  });
});

describe("reminderReason", () => {
  const item = { due_date: "2026-10-20", warn_days: [14, 7, 1] };
  it("fires on warning days", () => {
    expect(reminderReason(item, "2026-10-06")).toBe("warning");
    expect(reminderReason(item, "2026-10-13")).toBe("warning");
    expect(reminderReason(item, "2026-10-19")).toBe("warning");
  });
  it("is quiet on other days", () => {
    expect(reminderReason(item, "2026-10-07")).toBeNull();
  });
  it("fires on due and overdue", () => {
    expect(reminderReason(item, "2026-10-20")).toBe("due");
    expect(reminderReason(item, "2026-10-25")).toBe("overdue");
  });
});

describe("misc", () => {
  it("daysBetween across DST", () => {
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
  });
  it("todayLocal formats", () => {
    expect(todayLocal(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("addIntervalTs", () => {
  it("adds minutes", () => {
    expect(addIntervalTs("2026-10-07T09:00:00.000Z", 10, "minutes")).toBe("2026-10-07T09:10:00.000Z");
  });
  it("adds hours", () => {
    expect(addIntervalTs("2026-10-07T09:00:00.000Z", 2, "hours")).toBe("2026-10-07T11:00:00.000Z");
  });
  it("adds days preserving time", () => {
    expect(addIntervalTs("2026-10-07T15:30:00.000Z", 3, "days")).toBe("2026-10-10T15:30:00.000Z");
  });
  it("clamps February (non-leap)", () => {
    expect(addIntervalTs("2026-01-31T09:00:00.000Z", 1, "months")).toBe("2026-02-28T09:00:00.000Z");
  });
  it("clamps February (leap year)", () => {
    expect(addIntervalTs("2028-01-31T09:00:00.000Z", 1, "months")).toBe("2028-02-29T09:00:00.000Z");
  });
  it("handles 30-day month", () => {
    expect(addIntervalTs("2026-10-31T09:00:00.000Z", 1, "months")).toBe("2026-11-30T09:00:00.000Z");
  });
  it("last_day_of_month → last day of next month, preserving time", () => {
    expect(addIntervalTs("2026-10-31T09:00:00.000Z", 1, "last_day_of_month")).toBe("2026-11-30T09:00:00.000Z");
    expect(addIntervalTs("2028-01-31T09:00:00.000Z", 1, "last_day_of_month")).toBe("2028-02-29T09:00:00.000Z");
    expect(addIntervalTs("2026-11-30T09:00:00.000Z", 1, "last_day_of_month")).toBe("2026-12-31T09:00:00.000Z");
  });
  it("first_day_of_month → first day of next month, preserving time", () => {
    expect(addIntervalTs("2026-10-01T09:00:00.000Z", 1, "first_day_of_month")).toBe("2026-11-01T09:00:00.000Z");
    expect(addIntervalTs("2026-12-01T09:00:00.000Z", 1, "first_day_of_month")).toBe("2027-01-01T09:00:00.000Z");
  });
});

describe("rollForwardAt", () => {
  it("skips missed monthly cycles", () => {
    const result = rollForwardAt(
      "2026-01-07T09:00:00.000Z", 1, "months",
      "2026-10-07T09:00:00.000Z"
    );
    expect(result).toBe("2026-11-07T09:00:00.000Z");
  });
  it("rolls last_day_of_month correctly through February", () => {
    const result = rollForwardAt(
      "2026-01-31T09:00:00.000Z", 1, "last_day_of_month",
      "2026-03-01T09:00:00.000Z"
    );
    expect(result).toBe("2026-03-31T09:00:00.000Z");
  });
  it("rolls first_day_of_month past now", () => {
    const result = rollForwardAt(
      "2026-01-01T09:00:00.000Z", 1, "first_day_of_month",
      "2026-10-07T09:00:00.000Z"
    );
    expect(result).toBe("2026-11-01T09:00:00.000Z");
  });
});

describe("isRepeating with new units", () => {
  it("last_day_of_month is repeating with null repeat_every", () => {
    expect(isRepeating({ repeat_every: null, repeat_unit: "last_day_of_month" })).toBe(true);
  });
  it("first_day_of_month is repeating with null repeat_every", () => {
    expect(isRepeating({ repeat_every: null, repeat_unit: "first_day_of_month" })).toBe(true);
  });
  it("null unit is not repeating", () => {
    expect(isRepeating({ repeat_every: null, repeat_unit: null })).toBe(false);
  });
  it("isSpecialUnit returns true for boundary units only", () => {
    expect(isSpecialUnit("last_day_of_month")).toBe(true);
    expect(isSpecialUnit("first_day_of_month")).toBe(true);
    expect(isSpecialUnit("months")).toBe(false);
    expect(isSpecialUnit(null)).toBe(false);
  });
});

describe("dueGroup", () => {
  const now = new Date("2026-10-07T14:00:00Z");
  it("overdue → now", () => {
    expect(dueGroup({ due_date: "2026-10-07", due_at: "2026-10-07T09:00:00.000Z" }, now)).toBe("now");
  });
  it("later today → today", () => {
    expect(dueGroup({ due_date: "2026-10-07", due_at: "2026-10-07T18:00:00.000Z" }, now)).toBe("today");
  });
  it("3 days away → week", () => {
    expect(dueGroup({ due_date: "2026-10-10", due_at: "2026-10-10T09:00:00.000Z" }, now)).toBe("week");
  });
  it("8 days away → later", () => {
    expect(dueGroup({ due_date: "2026-10-15", due_at: "2026-10-15T09:00:00.000Z" }, now)).toBe("later");
  });
  it("null due_at falls back to 09:00 local — treated as group based on local time", () => {
    // due_date tomorrow with no due_at: falls back to tomorrow at 09:00 local → "week"
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const d = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth()+1).padStart(2,"0")}-${String(tomorrow.getDate()).padStart(2,"0")}`;
    const grp = dueGroup({ due_date: d, due_at: null }, now);
    expect(["today", "week"]).toContain(grp); // depends on local tz offset
  });
});

describe("describeDue", () => {
  it("returns Today for 0 days", () => {
    expect(describeDue(0)).toBe("Today");
  });
  it("returns Tomorrow for 1 day", () => {
    expect(describeDue(1)).toBe("Tomorrow");
  });
  it("returns overdue text for negative days", () => {
    expect(describeDue(-1)).toBe("1 day overdue");
    expect(describeDue(-5)).toBe("5 days overdue");
  });
  it("returns In X days for 2-13", () => {
    expect(describeDue(7)).toBe("In 7 days");
    expect(describeDue(13)).toBe("In 13 days");
  });
  it("returns In X weeks for 14-59", () => {
    expect(describeDue(14)).toBe("In 2 weeks");
    expect(describeDue(28)).toBe("In 4 weeks");
  });
  it("returns In X months for 60+", () => {
    expect(describeDue(90)).toBe("In 3 months");
  });
});
