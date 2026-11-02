import { describe, expect, it } from "vitest";
import { jobGroup, scheduleText, sentText, whenText } from "./jobText";

// 28 Oct 2026 is a Wednesday.
const at = (d: number, h = 9, month = 9) => new Date(2026, month, d, h, 0);

describe("scheduleText", () => {
  it("says when a job runs, in both languages", () => {
    expect(scheduleText("it", { repeat: "weekdays", time: "09:00" })).toBe("Nei giorni feriali alle 09:00");
    expect(scheduleText("en", { repeat: "weekly", time: "08:00", days: [4, 1] })).toBe(
      "Every Monday and Thursday at 08:00",
    );
    expect(scheduleText("it", { repeat: "weekly", time: "08:00", days: [0, 1] })).toBe(
      "Ogni lunedì e domenica alle 08:00",
    );
    expect(scheduleText("en", { repeat: "monthly", time: "09:00", day: 1 })).toBe("On the 1st of every month at 09:00");
    expect(scheduleText("it", { repeat: "monthly", time: "09:00", day: 31 })).toBe(
      "Il giorno 31 di ogni mese (o l'ultimo) alle 09:00",
    );
  });
});

describe("whenText and jobGroup", () => {
  const now = at(28, 10);
  it("words a run by how near it is", () => {
    expect(whenText("it", at(28, 18), now)).toBe("oggi 18:00");
    expect(whenText("en", at(29), now)).toBe("tomorrow 09:00");
    expect(whenText("en", at(30), now)).toBe("Fri 09:00");
    expect(whenText("it", at(2, 8, 10), now)).toBe("lun 08:00");
    expect(whenText("it", at(9, 8, 10), now)).toBe("lun 9 nov 08:00");
  });

  it("groups by today, tomorrow, the rest of this week, next week and later", () => {
    expect(jobGroup(at(28, 18), now)).toBe("today");
    expect(jobGroup(at(29), now)).toBe("tomorrow");
    expect(jobGroup(at(1, 9, 10), now)).toBe("week");
    expect(jobGroup(at(2, 9, 10), now)).toBe("nextWeek");
    expect(jobGroup(at(9, 9, 10), now)).toBe("later");
    expect(jobGroup(null, now)).toBe("off");
  });
});

describe("sentText", () => {
  const now = new Date(2026, 10, 2, 15, 0);
  it("gives the time today, yesterday by name, and the date before that", () => {
    expect(sentText("it", new Date(2026, 10, 2, 9, 5), now)).toBe("09:05");
    expect(sentText("it", new Date(2026, 10, 1, 23, 59), now)).toBe("ieri 23:59");
    expect(sentText("en", new Date(2026, 10, 1, 8, 0), now)).toBe("yesterday 08:00");
    expect(sentText("it", new Date(2026, 9, 28, 14, 32), now)).toBe("28 ott 14:32");
    expect(sentText("en", new Date(2026, 9, 28, 14, 32), now)).toBe("28 Oct 14:32");
  });
  it("names the year for a message from another year", () => {
    expect(sentText("it", new Date(2025, 11, 30, 10, 0), now)).toBe("30 dic 2025 10:00");
  });
});
