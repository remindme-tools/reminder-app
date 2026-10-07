import { describe, expect, it } from "vitest";
import { addInterval, daysBetween, reminderReason, rollForward, todayLocal } from "./dates";

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
