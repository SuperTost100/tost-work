import { describe, expect, it } from "vitest";
import type { Activity } from "../../../shared/model";
import { activityByMessage, duration, madeHeading, turnAnswer, turnsOf, wheelSideways, workedMs } from "./Task";

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

describe("turns", () => {
  const at = (s: number) => new Date(Date.UTC(2026, 10, 6, 9, 0, s)).toISOString();
  it("starts a turn at the brief and at each instruction sent after one ended", () => {
    const messages = [{}, {}, { followUp: true }, {}, {}];
    expect(turnsOf(messages)).toEqual([
      { start: 0, to: 2, latest: false },
      { start: 2, to: 5, latest: true },
    ]);
  });

  it("ends a turn on the agent's last answer, or on nothing when the user had the last word", () => {
    const messages = [{ from: "user" }, { from: "agent" }, { from: "user", answers: [] }, { from: "agent" }];
    expect(turnAnswer(messages, 0, 4)).toBe(3);
    expect(turnAnswer(messages, 0, 3)).toBe(-1);
    expect(turnAnswer(messages, 0, 1)).toBe(-1);
  });

  it("counts the agent's work, not the time it waited for answers", () => {
    const messages = [
      { from: "user", at: at(0) },
      { from: "agent", at: at(20) },
      // Answered 100 s after the question: the wait from 30 s to 130 s isn't work.
      { from: "user", at: at(130), answers: [] },
      { from: "agent", at: at(175) },
    ];
    const activity = [[], [], [{ at: at(30) }], [{ at: at(150) }]];
    expect(workedMs(messages, activity, 0, 3)).toBe(75_000);
  });

  it("says how long in seconds, minutes and hours", () => {
    expect(duration(45_400)).toBe("45 s");
    expect(duration(155_000)).toBe("2 min 35 s");
    expect(duration(120_000)).toBe("2 min");
    expect(duration(3_900_000)).toBe("1 h 5 min");
  });
});

describe("madeHeading", () => {
  it("says made, changed, or both", () => {
    expect(madeHeading([{ kind: "add" }])).toBe("task.made");
    expect(madeHeading([{ kind: "update" }])).toBe("task.changed");
    expect(madeHeading([{ kind: "add" }, { kind: "update" }])).toBe("task.madeChanged");
    expect(madeHeading([])).toBe("task.made");
  });
});

describe("wheelSideways", () => {
  const strip = (scrollWidth: number) => {
    const el = document.createElement("div");
    Object.defineProperty(el, "scrollWidth", { value: scrollWidth });
    Object.defineProperty(el, "clientWidth", { value: 100 });
    const glides: number[] = [];
    el.scrollTo = ((options: ScrollToOptions) => glides.push(options.left ?? 0)) as typeof el.scrollTo;
    document.body.append(el);
    const stop = wheelSideways(el);
    return { el, glides, stop };
  };
  let now = 0;
  const wheel = (on: Element, deltaY: number, gap = 20) => {
    now += gap;
    const e = new WheelEvent("wheel", { deltaY, cancelable: true, bubbles: true });
    Object.defineProperty(e, "timeStamp", { value: now });
    on.dispatchEvent(e);
    return e.defaultPrevented;
  };

  it("scrolls the row sideways in a gesture that starts on it, to its end, without moving the page", () => {
    const { el, stop } = strip(300);
    expect(wheel(el, 40, 1000)).toBe(true);
    expect(el.scrollLeft).toBe(40);
    el.scrollLeft = 200;
    // Still the same gesture at the end: the page doesn't take over halfway.
    expect(wheel(el, 40)).toBe(true);
    // A new gesture with nowhere to go that way scrolls the page.
    expect(wheel(el, 40, 1000)).toBe(false);
    stop?.();
  });

  it("lets a page scroll that passes over the row keep scrolling the page", () => {
    const { el, stop } = strip(300);
    expect(wheel(document.body, 40, 1000)).toBe(false);
    expect(wheel(el, 40)).toBe(false);
    expect(el.scrollLeft).toBe(0);
    // Once the pointer rests on the row, the next gesture is the row's.
    expect(wheel(el, 40, 1000)).toBe(true);
    stop?.();
  });

  it("glides a mouse wheel's notches, adding each to where the last one is heading", async () => {
    const { el, glides, stop } = strip(300);
    wheel(el, 100, 1000);
    wheel(el, 100);
    wheel(el, 100);
    await new Promise((r) => requestAnimationFrame(r));
    expect(glides).toEqual([100, 200, 200]);
    stop?.();
  });

  it("leaves a strip that fits alone", () => {
    const { el, stop } = strip(100);
    expect(wheel(el, 40, 1000)).toBe(false);
    stop?.();
  });
});
