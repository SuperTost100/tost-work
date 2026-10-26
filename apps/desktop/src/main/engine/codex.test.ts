/** @vitest-environment node */
import type { FunnelEvent, RunRequest } from "cli-funnel";
import { describe, expect, it } from "vitest";
import type { EngineEvent, Task } from "../../shared/model";
import { CodexEngine, type CodexFunnel } from "./codex";

type Emit = (event: FunnelEvent) => void;
type Script = (input: RunRequest, emit: Emit) => Promise<{ text: string; finishReason?: string }>;

/** A stand-in for cli-funnel: the script emits events and calls the run's callbacks, like Codex would. */
function fakeFunnel(script: Script) {
  const inputs: RunRequest[] = [];
  const funnel = {
    models: async () => [{ id: "gpt-6-sol", efforts: [{ id: "low" }, { id: "medium" }], defaultEffort: "medium" }],
    stream: (input: RunRequest) => {
      inputs.push(input);
      const events: FunnelEvent[] = [];
      let wake: (() => void) | null = null;
      let ended = false;
      const result = script(input, (e) => {
        events.push(e);
        wake?.();
      }).then((r) => ({ toolCalls: [], deniedActions: [], finishReason: "stop", ...r }));
      void result.finally(() => {
        ended = true;
        wake?.();
      });
      return {
        result,
        async *[Symbol.asyncIterator]() {
          while (true) {
            const e = events.shift();
            if (e) yield e;
            else if (ended) return;
            else await new Promise<void>((r) => (wake = r));
          }
        },
      };
    },
  } as unknown as CodexFunnel;
  return { funnel, inputs };
}

const task = (over: Partial<Task> = {}): Task =>
  ({
    id: "t1",
    projectId: "p1",
    title: "Proposal",
    brief: "Write the proposal",
    attachments: [],
    workdir: "/w",
    model: "gpt-6-sol",
    effort: "medium",
    status: "running",
    steps: [],
    files: [],
    messages: [],
    question: null,
    approval: null,
    review: null,
    error: null,
    createdAt: "",
    updatedAt: "",
    ...over,
  }) as Task;

function setup(script: Script) {
  const { funnel, inputs } = fakeFunnel(script);
  const engine = new CodexEngine(funnel, () => "it");
  const closed: string[] = [];
  engine.attachTools({ open: () => ({ url: "http://127.0.0.1:1/mcp", token: "tok" }), close: (t) => closed.push(t) });
  const controller = new AbortController();
  const seen: EngineEvent[] = [];
  const run = (t = task(), followUp: string | null = null) =>
    (async () => {
      for await (const e of engine.run({
        task: t,
        project: null,
        workdir: "/w",
        followUp,
        signal: controller.signal,
      })) {
        seen.push(e);
        // Answer what the engine asks, as the user would.
        if (e.type === "question") engine.answer(t.id, e.question.id, e.question.options[0] ?? "my own words");
        if (e.type === "approval") engine.decide(t.id, e.approval.id, decisions.shift() ?? false);
      }
    })();
  const decisions: boolean[] = [];
  return { engine, inputs, seen, run, closed, controller, decisions };
}

describe("CodexEngine", () => {
  it("runs Codex at supervised with the instructions and the tool server, and maps its events", async () => {
    const { inputs, seen, run, closed } = setup(async (_input, emit) => {
      emit({ type: "session", sessionId: "s1" });
      emit({ type: "plan", steps: [{ text: "Draft", status: "in_progress" }] });
      emit({ type: "file.change", id: "c1", path: "/w/Proposta.docx", kind: "add", status: "done" });
      emit({ type: "file.change", id: "c2", path: "/w/no.docx", kind: "add", status: "declined" });
      return { text: "Done." };
    });
    await run();
    const input = inputs[0];
    expect(input?.selection).toMatchObject({ provider: "codex", access: "supervised", cwd: "/w", model: "gpt-6-sol" });
    expect(input?.system).toContain("plain Italian");
    expect(input?.mcpServers?.tost_work).toMatchObject({ type: "http", autoApprove: true, toolTimeoutSec: 3600 });
    expect(seen).toEqual([
      { type: "session", sessionId: "s1" },
      { type: "plan", steps: [{ text: "Draft", status: "in_progress" }] },
      { type: "file", change: { path: "/w/Proposta.docx", kind: "add", role: "made" } },
      { type: "message", text: "Done." },
      { type: "done" },
    ]);
    expect(closed).toEqual(["tok"]);
  });

  it("continues the same conversation on a follow-up", async () => {
    const { inputs, run } = setup(async () => ({ text: "ok" }));
    await run(task({ sessionId: "s1" }), "Make it shorter");
    expect(inputs[0]).toMatchObject({ prompt: "Make it shorter", sessionId: "s1" });
  });

  it("asks Codex's own questions on the task and returns the answer", async () => {
    let answers: unknown;
    const { seen, run } = setup(async (input) => {
      answers = await input.onQuestion?.({
        id: "r1",
        questions: [{ id: "q", question: "Who pays?", options: [{ label: "Us" }, { label: "Them" }] }],
      });
      return { text: "" };
    });
    await run();
    expect(seen[0]).toMatchObject({ type: "question", question: { text: "Who pays?", options: ["Us", "Them"] } });
    expect(answers).toEqual({ q: ["Us"] });
  });

  it("asks before changing a file that was already there, and not for one the task made", async () => {
    const decisions: unknown[] = [];
    const {
      seen,
      run,
      decisions: replies,
    } = setup(async (input) => {
      const change = (path: string, kind: string) => ({
        id: path,
        tool: "file_change",
        input: { changes: { changes: [{ path, kind: { type: kind } }] } },
      });
      decisions.push(await input.onApproval?.(change("/w/made.docx", "update")));
      decisions.push(await input.onApproval?.(change("/w/theirs.xlsx", "update")));
      decisions.push(await input.onApproval?.(change("/w/theirs.xlsx", "update")));
      decisions.push(await input.onApproval?.(change("/w/new.docx", "add")));
      return { text: "" };
    });
    replies.push(true, false);
    await run(task({ files: [{ path: "/w/made.docx", kind: "add", role: "made" }] }));
    expect(decisions[0]).toBe("allow");
    expect(decisions[1]).toBe("allow");
    expect(decisions[2]).toMatchObject({ decision: "deny", message: expect.stringMatching(/new name/) });
    expect(decisions[3]).toBe("allow");
    const asked = seen.filter((e) => e.type === "approval");
    expect(asked).toHaveLength(2);
    expect(asked[0]).toMatchObject({ approval: { action: "overwrite", paths: ["/w/theirs.xlsx"] } });
  });

  it("turns a deletion into the approval card and never lets Codex delete itself", async () => {
    const decisions: unknown[] = [];
    const {
      seen,
      run,
      decisions: replies,
    } = setup(async (input) => {
      const del = {
        id: "d",
        tool: "file_change",
        input: { changes: { changes: [{ path: "/w/old.txt", kind: "delete" }] } },
      };
      decisions.push(await input.onApproval?.(del));
      decisions.push(await input.onApproval?.(del));
      decisions.push(await input.onApproval?.({ id: "c1", tool: "command", input: { command: "rm -rf drafts" } }));
      decisions.push(
        await input.onApproval?.({
          id: "c2",
          tool: "command",
          input: { command: "python3 -c 'import os; os.remove(\"a\")'" },
        }),
      );
      decisions.push(
        await input.onApproval?.({ id: "c3", tool: "command", input: { command: "python3 make_docx.py" } }),
      );
      return { text: "" };
    });
    replies.push(true, false);
    await run();
    expect(seen.filter((e) => e.type === "approval")[0]).toMatchObject({
      approval: { action: "delete", paths: ["/w/old.txt"] },
    });
    expect(decisions[0]).toMatchObject({ decision: "deny", message: expect.stringMatching(/Trash/) });
    expect(decisions[1]).toMatchObject({ decision: "deny", message: expect.stringMatching(/keep/) });
    expect(decisions[2]).toMatchObject({ decision: "deny" });
    expect(decisions[3]).toMatchObject({ decision: "deny" });
    expect(decisions[4]).toBe("allow");
  });

  it("carries the Tost Work tools' questions, files and review into the task", async () => {
    const holder: { engine?: CodexEngine } = {};
    const { engine, seen, run } = setup(async () => {
      const reply = await holder.engine?.ask("t1", { text: "Which template?", options: ["A", "B"] });
      await holder.engine?.reportFile("t1", { path: "/w/a.docx", kind: "add" });
      await holder.engine?.review("t1", { asked: [{ text: reply ?? "" }], decided: [], checkYourself: [] });
      return { text: "" };
    });
    holder.engine = engine;
    await run();
    expect(seen.slice(0, 3)).toMatchObject([
      { type: "question", question: { text: "Which template?" } },
      { type: "file", change: { path: "/w/a.docx", role: "made" } },
      { type: "review", review: { asked: [{ text: "A" }] } },
    ]);
  });

  it("takes a question off the task when the agent stops waiting for it", async () => {
    const holder: { engine?: CodexEngine } = {};
    const gaveUp = new AbortController();
    let toolError = "";
    const { engine, seen, run } = setup(async () => {
      await holder.engine?.ask("t1", { text: "Which one?", options: ["a", "b"] }, gaveUp.signal).catch((e: Error) => {
        toolError = e.message;
      });
      return { text: "" };
    });
    holder.engine = engine;
    // Nobody answers; the agent gives up instead.
    engine.answer = () => gaveUp.abort();
    await run();
    const question = seen.find((e) => e.type === "question");
    expect(question).toBeTruthy();
    expect(seen).toContainEqual({ type: "withdrawn", id: question?.type === "question" ? question.question.id : "" });
    expect(toolError).toMatch(/stopped/);
  });

  it("ends a stopped run as stopped, and a waiting tool hears that nobody answered", async () => {
    const holder: { engine?: CodexEngine } = {};
    let toolError = "";
    const { engine, seen, controller, run } = setup(async () => {
      await holder.engine?.ask("t1", { text: "?", options: ["a", "b"] }).catch((e: Error) => {
        toolError = e.message;
      });
      return { text: "", finishReason: "cancelled" };
    });
    holder.engine = engine;
    // Stop as soon as the question shows, without answering it.
    engine.answer = () => controller.abort();
    await run();
    expect(toolError).toMatch(/stopped/);
    expect(seen.at(-1)).toEqual({ type: "stopped" });
  });

  it("starts tasks on the model Codex lists first", async () => {
    const { engine } = setup(async () => ({ text: "" }));
    expect(await engine.defaults()).toEqual({ model: "gpt-6-sol", effort: "medium" });
  });
});
