import { describe, expect, it } from "vitest";
import type { Task } from "./model";
import { applyEvent } from "./reduce";

const waiting = {
  status: "needs-you",
  question: { id: "q2", text: "Which template?", options: ["A", "B"] },
  approval: null,
} as unknown as Task;

describe("applyEvent withdrawn", () => {
  it("takes the named question off the task and puts it back to running", () => {
    const next = applyEvent(waiting, { type: "withdrawn", id: "q2" }, "t");
    expect(next.question).toBeNull();
    expect(next.status).toBe("running");
  });

  it("leaves a newer question alone", () => {
    expect(applyEvent(waiting, { type: "withdrawn", id: "q1" }, "t")).toBe(waiting);
  });
});
