/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { removalText } from "./projects";

describe("removalText", () => {
  it("names the tasks and jobs that go, in the user's language", () => {
    expect(removalText("it", "Corsi AI", { tasks: 3, jobs: 1 })).toEqual({
      message: "Rimuovere «Corsi AI» da Tost Work?",
      detail: "Spariscono dall'app: 3 attività e 1 lavoro pianificato. La cartella e i suoi file restano dove sono.",
    });
    expect(removalText("en", "AI courses", { tasks: 1, jobs: 2 }).detail).toBe(
      "Gone from the app: 1 task and 2 scheduled jobs. The folder and its files stay where they are.",
    );
  });

  it("only says the folder stays when nothing else goes", () => {
    expect(removalText("en", "Empty", { tasks: 0, jobs: 0 }).detail).toBe(
      "The folder and its files stay where they are.",
    );
  });
});
