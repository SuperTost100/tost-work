import { describe, expect, it } from "vitest";
import type { Activity } from "../../../shared/model";
import { activityByMessage } from "./Task";

const line = (target: string, msg?: number): Activity => ({
  kind: "read",
  target,
  at: "t",
  ...(msg === undefined ? {} : { msg }),
});

describe("activityByMessage", () => {
  it("puts each line above the message that followed it, and the rest at the end", () => {
    const { before, tail } = activityByMessage([line("a", 1), line("b", 2), line("c", 3)], 3);
    expect(before.map((g) => g.map((a) => a.target))).toEqual([[], ["a"], ["b"]]);
    expect(tail.map((a) => a.target)).toEqual(["c"]);
  });

  it("keeps lines from before positions apart from the live ones", () => {
    const { tail, older } = activityByMessage([line("old"), line("older"), line("new", 4)], 4);
    expect(older.map((a) => a.target)).toEqual(["old", "older"]);
    expect(tail.map((a) => a.target)).toEqual(["new"]);
  });
});
