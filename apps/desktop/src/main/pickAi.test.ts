/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import type { AgentProvider } from "../shared/model";
import { pickAi } from "./pickAi";

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

  it("keeps the choice when nothing is signed in, so the error names that agent", async () => {
    expect(await pickAi("claude", signedIn())).toBe("claude");
    expect(await pickAi(null, signedIn())).toBe("chatgpt");
  });
});
