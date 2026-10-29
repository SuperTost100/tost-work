import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings, sectionOn } from "./model";

describe("sectionOn", () => {
  it("follows the level when the user hasn't chosen", () => {
    expect(sectionOn({ level: "beginner", sections: {} }, "skills")).toBe(true);
    expect(sectionOn({ level: "beginner", sections: {} }, "jobs")).toBe(false);
    expect(sectionOn({ level: "intermediate", sections: {} }, "board")).toBe(true);
    expect(sectionOn({ level: "expert", sections: {} }, "board")).toBe(true);
  });

  it("keeps the user's own choice over the level's", () => {
    expect(sectionOn({ level: "beginner", sections: { jobs: true } }, "jobs")).toBe(true);
    expect(sectionOn({ level: "expert", sections: { skills: false } }, "skills")).toBe(false);
  });
});

describe("mergeSettings", () => {
  const base = { ...DEFAULT_SETTINGS, level: "beginner" as const };

  it("keeps a switch the user turned against their level", () => {
    const next = mergeSettings(base, { sections: { jobs: true } });
    expect(next.sections).toEqual({ jobs: true });
    expect(sectionOn(next, "jobs")).toBe(true);
  });

  it("forgets a switch turned back to what the level shows", () => {
    const off = mergeSettings(base, { sections: { skills: false } });
    expect(mergeSettings(off, { sections: { skills: true } }).sections).toEqual({});
  });

  it("puts every switch back to the new level's when the level changes", () => {
    const own = mergeSettings(base, { sections: { jobs: true, skills: false } });
    const next = mergeSettings(own, { level: "intermediate" });
    expect(next.sections).toEqual({});
    expect(sectionOn(next, "skills")).toBe(true);
    expect(sectionOn(next, "board")).toBe(true);
    // Picking the same level again changes nothing.
    expect(mergeSettings(own, { level: "beginner" }).sections).toEqual({ jobs: true, skills: false });
  });

  it("takes the notifications it's given", () => {
    const next = mergeSettings(base, { notify: { ...base.notify, done: "normal" } });
    expect(next.notify).toEqual({ ...base.notify, done: "normal" });
  });
});
