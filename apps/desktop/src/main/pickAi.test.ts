/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import type { AgentProvider } from "../shared/model";
import { pickAi, usableAis } from "./pickAi";

const signedIn =
  (...providers: AgentProvider[]) =>
  async (p: AgentProvider) =>
    providers.includes(p);

describe("pickAi", () => {
  it("runs on the chosen account while it's signed in", async () => {
    expect(await pickAi("claude", signedIn("codex", "claude"))).toBe("claude");
  });

  it("falls back to an account still signed in when the chosen one was signed out elsewhere", async () => {
    expect(await pickAi("claude", signedIn("codex"))).toBe("chatgpt");
    expect(await pickAi("chatgpt", signedIn("claude"))).toBe("claude");
  });

  it("stays on the chosen account when its check fails, rather than moving to another one", async () => {
    const failing = async (p: AgentProvider) => (p === "claude" ? null : true);
    expect(await pickAi("claude", failing)).toBe("claude");
    // Without a choice, a failed check doesn't count as signed in either.
    expect(await pickAi(null, async (p) => (p === "codex" ? null : true))).toBe("claude");
  });

  it("uses the course key while it's there, and falls back when a key kept until closing is gone", async () => {
    expect(await pickAi("key", signedIn("codex"), true)).toBe("key");
    expect(await pickAi("key", signedIn("claude"), false)).toBe("claude");
    expect(await pickAi(null, signedIn(), true)).toBe("key");
    // Nothing else to run on: the task says to paste the key again.
    expect(await pickAi("key", signedIn(), false)).toBe("key");
  });

  it("keeps the choice when nothing is signed in, so the error names that agent", async () => {
    expect(await pickAi("claude", signedIn())).toBe("claude");
    expect(await pickAi(null, signedIn())).toBe("chatgpt");
  });
});

describe("usableAis", () => {
  it("lists the signed-in AIs in order, then the course key", async () => {
    expect(await usableAis(signedIn("codex", "claude"), true)).toEqual(["chatgpt", "claude", "key"]);
    expect(await usableAis(signedIn("claude"), false)).toEqual(["claude"]);
    expect(await usableAis(async () => null, false)).toEqual([]);
  });

  it("checks both accounts at the same time", async () => {
    let started = 0;
    let release!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Each check answers only once both have started, so a check that waits for the one before it never answers.
    const check = async () => {
      if (++started === 2) release();
      await bothStarted;
      return true;
    };
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("the checks did not overlap")), 500),
    );
    expect(await Promise.race([usableAis(check, false), timeout])).toEqual(["chatgpt", "claude"]);
  });
});
