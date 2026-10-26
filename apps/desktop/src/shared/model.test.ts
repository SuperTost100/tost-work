import { describe, expect, it } from "vitest";
import { sectionOn } from "./model";

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
