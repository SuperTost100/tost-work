import { describe, expect, it } from "vitest";
import { childCalls, debugView, inputText, type LogLine } from "./debug";

const at = "2026-11-02T10:00:00.000Z";
const line = (fields: Record<string, unknown>) => ({ at, ...fields }) as LogLine;

describe("debugView", () => {
  it("joins each call to its end and the thinking before it, and adds up the tokens", () => {
    const view = debugView([
      line({
        type: "run",
        provider: "claude",
        model: "m",
        effort: "e",
        access: "supervised",
        cwd: "/w",
        followUp: false,
      }),
      line({ type: "session", sessionId: "s1" }),
      line({ type: "reasoning.delta", text: "I should read " }),
      line({ type: "reasoning.delta", text: "the notes." }),
      line({ type: "tool.start", id: "c1", name: "Read", input: { file_path: "/w/note.txt" } }),
      line({ type: "tool.end", id: "c1", output: "the notes", cut: 50_000 }),
      line({ type: "usage", usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } }),
      line({ type: "tool.start", id: "c2", name: "Bash", input: { command: "ls" } }),
      line({ type: "tool.end", id: "c2", error: "denied" }),
      line({ type: "reasoning.delta", text: "Now the answer." }),
      line({ type: "usage", usage: { inputTokens: 50, outputTokens: 5, totalTokens: 55 } }),
    ]);
    expect(view.calls.get("c1")).toMatchObject({ name: "Read", output: "the notes", cut: 50_000 });
    expect(view.calls.get("c1")?.reasoning).toBe("I should read the notes.");
    expect(view.calls.get("c2")).toMatchObject({ error: "denied", reasoning: "" });
    expect(view.finalReasoning).toBe("Now the answer.");
    expect(view.sessionId).toBe("s1");
    expect(view.tokens).toEqual({ input: 150, output: 25 });
    expect(view.capped).toBe(false);
  });

  it("drops the last run's closing thoughts when the next run starts, and has no tokens before a usage event", () => {
    const view = debugView([
      line({ type: "reasoning.delta", text: "About the answer." }),
      line({ type: "run", provider: "codex", model: "m", effort: "e", access: "a", cwd: "/w", followUp: true }),
      line({ type: "tool.start", id: "c1", name: "command", input: { command: "ls" } }),
      line({ type: "log.capped", bytes: 1 }),
    ]);
    expect(view.calls.get("c1")?.reasoning).toBe("");
    expect(view.tokens).toBeNull();
    expect(view.capped).toBe(true);
  });

  it("puts a subagent's calls and words under the call that started it", () => {
    const view = debugView([
      line({ type: "tool.start", id: "a1", name: "Agent", input: { description: "Find sources" } }),
      line({ type: "subagent.text", parentId: "a1", text: "Found 12." }),
      line({ type: "tool.start", id: "c1", name: "WebSearch", input: { query: "x" }, parentId: "a1" }),
      line({ type: "tool.start", id: "c2", name: "Read", input: {} }),
    ]);
    expect(childCalls(view, "a1").map((c) => c.id)).toEqual(["c1"]);
    expect(view.calls.get("a1")?.notes).toEqual(["Found 12."]);
  });
});

describe("inputText", () => {
  it("shows a command, a path or a search alone, and anything else as JSON", () => {
    expect(inputText({ command: "ls -la" })).toBe("ls -la");
    expect(inputText({ file_path: "/w/a.txt" })).toBe("/w/a.txt");
    expect(inputText({ query: "bandi Piemonte" })).toBe("bandi Piemonte");
    expect(inputText({ file_path: "/w/a.txt", old_string: "a", new_string: "b" })).toBe(
      '{\n  "file_path": "/w/a.txt",\n  "old_string": "a",\n  "new_string": "b"\n}',
    );
    expect(inputText(undefined)).toBe("");
  });
});
