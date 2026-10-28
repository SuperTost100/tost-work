import { describe, expect, it } from "vitest";
import { lastRun, nextRun, validTime } from "./schedule";

// Local times, as the schedule works in the computer's time zone. 28 Oct 2026 is a Wednesday.
const at = (d: number, h = 0, m = 0, month = 9) => new Date(2026, month, d, h, m);

describe("nextRun", () => {
  it("finds today's run if it's still ahead, otherwise the next day's", () => {
    const daily = { repeat: "daily" as const, time: "09:00" };
    expect(nextRun(daily, at(28, 8))).toEqual(at(28, 9));
    expect(nextRun(daily, at(28, 9))).toEqual(at(29, 9));
  });

  it("skips the weekend for weekdays, and runs on the days picked for weekly", () => {
    expect(nextRun({ repeat: "weekdays", time: "09:00" }, at(30, 10))).toEqual(at(2, 9, 0, 10));
    expect(nextRun({ repeat: "weekly", time: "08:00", days: [1, 4] }, at(28, 12))).toEqual(at(29, 8));
    expect(nextRun({ repeat: "weekly", time: "08:00", days: [] }, at(28))).toBeNull();
  });

  it("runs a monthly job on the month's last day when the month is shorter", () => {
    const end = { repeat: "monthly" as const, time: "07:30", day: 31 };
    expect(nextRun(end, at(1, 0, 0, 10))).toEqual(at(30, 7, 30, 10));
    expect(nextRun({ repeat: "monthly", time: "09:00", day: 1 }, at(28))).toEqual(at(1, 9, 0, 10));
  });
});

describe("lastRun", () => {
  it("finds the latest run at or before the time, however many were missed", () => {
    const daily = { repeat: "daily" as const, time: "09:00" };
    expect(lastRun(daily, at(28, 9))).toEqual(at(28, 9));
    expect(lastRun(daily, at(28, 8, 59))).toEqual(at(27, 9));
    expect(lastRun({ repeat: "weekdays", time: "09:00" }, at(2, 8, 0, 10))).toEqual(at(30, 9));
  });
});

describe("validTime", () => {
  it("takes 24-hour times only", () => {
    expect(validTime("09:05")).toBe(true);
    expect(validTime("23:59")).toBe(true);
    expect(validTime("24:00")).toBe(false);
    expect(validTime("9:05")).toBe(false);
  });
});
