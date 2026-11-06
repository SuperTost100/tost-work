/** @vitest-environment node */
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FunnelEvent, RunRequest } from "cli-funnel";
import { describe, expect, it } from "vitest";
import type { EngineEvent, Task } from "../../shared/model";
import { AgentEngine, type AgentFunnel, deletesFiles, isNetworkError } from "./agent";

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
      // Settles either way: a script that throws fails the run through `result`, not as a stray rejection here.
      const end = () => {
        ended = true;
        wake?.();
      };
      result.then(end, end);
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
  } as unknown as AgentFunnel;
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
  const engine = new AgentEngine(funnel, () => "it");
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

/** An engine whose runs nobody answers: the test decides by hand, after the run has ended. */
function bare(script: Script) {
  const { funnel } = fakeFunnel(script);
  const engine = new AgentEngine(funnel, () => "it");
  engine.attachTools({ open: () => ({ url: "http://127.0.0.1:1/mcp", token: "tok" }), close: () => {} });
  const drain = async (followUp: string | null) => {
    const seen: EngineEvent[] = [];
    const signal = new AbortController().signal;
    for await (const e of engine.run({ task: task(), project: null, workdir: "/w", followUp, signal })) seen.push(e);
    return seen;
  };
  return { engine, drain };
}

const update = (path: string) => ({
  id: path,
  tool: "file_change",
  input: { changes: { changes: [{ path, kind: { type: "update" } }] } },
});

describe("AgentEngine", () => {
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
    // Shell commands run in the CLI's sandbox, so they can't write outside the folder.
    expect(input?.sandbox).toBe(true);
    expect(input?.system).toContain("plain informal Italian");
    expect(input?.mcpServers?.tost_work).toMatchObject({ type: "http", autoApprove: true });
    // Codex searches the web without asking before each site.
    // It also passes on what its subagents write and do.
    expect(input?.providerOptions).toEqual({
      codex: { webSearch: "cached", forwardSubagentText: true, forwardSubagentTools: true },
    });
    // What the CLI prints goes to the log only while debug is on.
    expect(input?.verbose).toBe(false);
    // Codex's own question tool would hold the turn open, which Codex gives up on after about 30 seconds.
    expect(input?.onQuestion).toBeUndefined();
    expect(seen).toEqual([
      { type: "session", sessionId: "s1" },
      { type: "plan", steps: [{ text: "Draft", status: "in_progress" }] },
      { type: "file", change: { path: "/w/Proposta.docx", kind: "add", role: "made" } },
      { type: "message", text: "Done." },
      { type: "done" },
    ]);
    expect(closed).toEqual(["tok"]);
  });

  it("keeps the words the agent wrote between steps as notes in the activity, and only its last words as the answer", async () => {
    const { seen, run } = setup(async (_input, emit) => {
      emit({ type: "text.delta", text: "Leggo le note " });
      emit({ type: "text.delta", text: "della chiamata." });
      emit({ type: "tool.start", id: "t1", name: "Read", input: { file_path: "/w/note.txt" } });
      // A tool call with nothing written before it adds no note.
      emit({ type: "tool.start", id: "t2", name: "Read", input: { file_path: "/w/prezzi.xlsx" } });
      emit({ type: "text.delta", text: "Il preventivo è pronto." });
      return { text: "Il preventivo è pronto." };
    });
    await run();
    expect(seen).toEqual([
      { type: "text", text: "Leggo le note " },
      { type: "text", text: "della chiamata." },
      { type: "activity", kind: "note", target: "Leggo le note della chiamata." },
      { type: "activity", kind: "read", target: "note.txt", id: "t1" },
      { type: "activity", kind: "read", target: "prezzi.xlsx", id: "t2" },
      { type: "text", text: "Il preventivo è pronto." },
      { type: "message", text: "Il preventivo è pronto." },
      { type: "done" },
    ]);
  });

  it("continues the same conversation on a follow-up", async () => {
    const { inputs, run } = setup(async () => ({ text: "ok" }));
    await run(task({ sessionId: "s1" }), "Make it shorter");
    expect(inputs[0]).toMatchObject({ prompt: "Make it shorter", sessionId: "s1" });
  });

  it("puts ask_user's question on the task and tells the agent to end its turn", async () => {
    const holder: { engine?: AgentEngine } = {};
    let reply = "";
    const { engine, seen, run } = setup(async () => {
      reply = (await holder.engine?.ask("t1", [{ text: "Who pays?", options: ["Us", "Them"] }])) ?? "";
      return { text: "" };
    });
    holder.engine = engine;
    await run();
    expect(seen[0]).toMatchObject({ type: "question", question: { text: "Who pays?", options: ["Us", "Them"] } });
    expect(reply).toMatch(/End your turn/);
    // No run waits for the answer: the runner sends it as the next message.
    expect(engine.answer("t1", "any", "Us")).toBe(false);
  });

  it("lets the next run replace a file the user allowed after the turn that asked had ended", async () => {
    const decisions: unknown[] = [];
    const { engine, drain } = bare(async (input) => {
      if (input.prompt === "Write the proposal") await engine.approve("t1", "overwrite", ["/w/theirs.xlsx"]);
      else decisions.push(await input.onApproval?.(update("/w/theirs.xlsx")));
      return { text: "" };
    });
    const seen = await drain(null);
    const approval = seen.find((e) => e.type === "approval");
    expect(approval).toMatchObject({ approval: { action: "overwrite", paths: ["/w/theirs.xlsx"] } });
    // The run is over, so the decision goes to the next one, which may make the change without asking again.
    expect(engine.decide("t1", approval?.type === "approval" ? approval.approval.id : "", true)).toBe(false);
    const next = await drain("go ahead");
    expect(decisions).toEqual(["allow"]);
    expect(next.some((e) => e.type === "approval")).toBe(false);
  });

  it("keeps the card when a held file change ends with the turn, and asks again after a refusal", async () => {
    const decisions: unknown[] = [];
    const { engine, drain } = bare(async (input) => {
      const held = input.onApproval?.(update("/w/theirs.xlsx"));
      void Promise.resolve(held).then((d) => decisions.push(d));
      await new Promise((r) => setTimeout(r, 5));
      return { text: "" };
    });
    const seen = await drain(null);
    const ids = seen.flatMap((e) => (e.type === "approval" ? [e.approval.id] : []));
    expect(ids).toHaveLength(1);
    // The turn ended: Codex hears no, and the task keeps the card until the user decides.
    expect(seen.at(-1)).toEqual({ type: "done" });
    expect(decisions).toEqual([expect.objectContaining({ decision: "deny" })]);
    expect(engine.decide("t1", ids[0] ?? "", false)).toBe(false);
    const again = await drain("try again");
    expect(again.filter((e) => e.type === "approval")).toHaveLength(1);
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

  it("asks again before changing a file the task overwrote or restored earlier", async () => {
    const decisions: unknown[] = [];
    const {
      seen,
      run,
      decisions: replies,
    } = setup(async (input) => {
      decisions.push(
        await input.onApproval?.({
          id: "c",
          tool: "file_change",
          input: { changes: { changes: [{ path: "/w/theirs.xlsx", kind: { type: "update" } }] } },
        }),
      );
      return { text: "" };
    });
    replies.push(true);
    await run(
      task({
        files: [{ path: "/w/theirs.xlsx", kind: "update", role: "made" }],
        kept: [{ path: "/w/theirs.xlsx", copy: "/k/1", at: "", reason: "overwrite" }],
      }),
      "Change the totals",
    );
    expect(seen.filter((e) => e.type === "approval")).toHaveLength(1);
    expect(decisions[0]).toBe("allow");
  });

  it("puts nothing new on a task once it's stopped", async () => {
    const holder: { engine?: AgentEngine } = {};
    const { engine, seen, controller, run } = setup(async () => {
      controller.abort();
      const reply = await holder.engine
        ?.ask("t1", [{ text: "Late?", options: ["a", "b"] }])
        .catch((e: Error) => e.message);
      expect(reply).toMatch(/isn't running/);
      return { text: "", finishReason: "cancelled" };
    });
    holder.engine = engine;
    await run();
    expect(seen.some((e) => e.type === "question")).toBe(false);
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
    const holder: { engine?: AgentEngine } = {};
    const { engine, seen, run } = setup(async () => {
      await holder.engine?.ask("t1", [{ text: "Which template?", options: ["A", "B"] }]);
      await holder.engine?.reportFile("t1", { path: "/w/a.docx", kind: "add" });
      await holder.engine?.review("t1", { asked: [{ text: "A proposal" }], decided: [], checkYourself: [] });
      return { text: "" };
    });
    holder.engine = engine;
    await run();
    expect(seen.slice(0, 3)).toMatchObject([
      { type: "question", question: { text: "Which template?" } },
      { type: "file", change: { path: "/w/a.docx", role: "made" } },
      { type: "review", review: { asked: [{ text: "A proposal" }] } },
    ]);
  });

  it("ends a stopped run as stopped, and a held file change hears that nobody allowed it", async () => {
    let decision: unknown;
    const { engine, seen, controller, run } = setup(async (input) => {
      decision = await input.onApproval?.({
        id: "c",
        tool: "file_change",
        input: { changes: { changes: [{ path: "/w/theirs.xlsx", kind: { type: "update" } }] } },
      });
      return { text: "", finishReason: "cancelled" };
    });
    // Stop as soon as the card shows, without deciding.
    engine.decide = () => {
      controller.abort();
      return true;
    };
    await run();
    expect(decision).toMatchObject({ decision: "deny" });
    expect(seen.at(-1)).toEqual({ type: "stopped" });
  });

  it("starts tasks on the model Codex lists first", async () => {
    const { engine } = setup(async () => ({ text: "" }));
    expect(await engine.defaults()).toEqual({
      provider: "codex",
      auth: "account",
      model: "gpt-6-sol",
      effort: "medium",
    });
  });

  it("starts tasks on Claude Sonnet at high when Claude is the default", async () => {
    const { funnel } = fakeFunnel(async () => ({ text: "" }));
    const efforts = [{ id: "low" }, { id: "medium" }, { id: "high" }];
    (funnel as { models: unknown }).models = async (provider: string) =>
      provider === "claude"
        ? [
            { id: "claude-fable-5-1", efforts },
            { id: "claude-sonnet-5-5", efforts },
          ]
        : [];
    const engine = new AgentEngine(funnel, () => "it", { ai: async () => "claude" });
    expect(await engine.defaults()).toEqual({
      provider: "claude",
      auth: "account",
      model: "claude-sonnet-5-5",
      effort: "high",
    });
  });

  /** An engine whose AIs offer the models Tost's table names, so each choice can be checked on both agents. */
  function engineWithModels(
    over: {
      ai?: "chatgpt" | "claude" | "key";
      claudeModels?: string[];
      usable?: ("chatgpt" | "claude")[];
      codexFails?: boolean;
      claudeFails?: boolean;
    } = {},
  ) {
    const { funnel } = fakeFunnel(async () => ({ text: "" }));
    const efforts = ["low", "medium", "high", "xhigh", "max"].map((id) => ({ id }));
    const list = (ids: string[]) => ids.map((id) => ({ id, name: id, efforts }));
    (funnel as { models: unknown }).models = async (provider: string) => {
      if (provider === "claude" && over.claudeFails) throw new Error("claude isn't answering");
      if (provider === "claude")
        return list(over.claudeModels ?? ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
      if (over.codexFails) throw new Error("codex isn't answering");
      return list(["gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna"]);
    };
    return new AgentEngine(funnel, () => "it", {
      ai: async () => over.ai ?? "chatgpt",
      usable: async () => over.usable ?? ["chatgpt", "claude"],
      courseKey: () => null,
    });
  }

  it("starts the middle choice when nothing is picked, and each choice on the default AI", async () => {
    const codex = engineWithModels();
    expect(await codex.defaults()).toMatchObject({ model: "gpt-6.1-terra", effort: "high" });
    expect(await codex.defaults({ preset: "fast" })).toMatchObject({ model: "gpt-6-luna", effort: "medium" });
    expect(await codex.defaults({ preset: "thorough" })).toMatchObject({ model: "gpt-6.1-sol", effort: "high" });
    const claude = engineWithModels({ ai: "claude" });
    expect(await claude.defaults({ preset: "fast" })).toEqual({
      provider: "claude",
      auth: "account",
      model: "claude-haiku-5-5",
      effort: "medium",
    });
    expect(await claude.defaults({ preset: "thorough" })).toMatchObject({ model: "claude-opus-5-5", effort: "high" });
  });

  it("starts Claude's thorough choice on Sonnet at xhigh when Opus isn't offered", async () => {
    const claude = engineWithModels({ ai: "claude", claudeModels: ["claude-sonnet-5-5", "claude-haiku-5-5"] });
    expect(await claude.defaults({ preset: "thorough" })).toMatchObject({
      model: "claude-sonnet-5-5",
      effort: "xhigh",
    });
  });

  it("starts a model picked from the full list on the AI it belongs to, even when it isn't the default", async () => {
    const engine = engineWithModels();
    expect(await engine.defaults({ ai: "claude", model: "claude-opus-5-5", effort: "max" })).toEqual({
      provider: "claude",
      auth: "account",
      model: "claude-opus-5-5",
      effort: "max",
    });
    // A model that's no longer listed falls back to the middle choice.
    expect(await engine.defaults({ ai: "claude", model: "claude-opus-4-1", effort: "max" })).toMatchObject({
      provider: "codex",
      model: "gpt-6.1-terra",
    });
    // So does a pick on a course key that was removed.
    expect(await engine.defaults({ ai: "key", model: "gpt-6.1-sol", effort: "high" })).toMatchObject({
      provider: "codex",
      model: "gpt-6.1-terra",
    });
  });

  it("leaves out a remembered pick on an AI that's signed out, and the middle choice stands in", async () => {
    const engine = engineWithModels({ usable: ["chatgpt"] });
    expect(await engine.defaults({ ai: "claude", model: "claude-opus-5-5", effort: "max" })).toMatchObject({
      provider: "codex",
      model: "gpt-6.1-terra",
    });
  });

  it("falls back to the middle choice when the picked AI's list can't be read", async () => {
    const engine = engineWithModels({ claudeFails: true });
    expect(await engine.defaults({ ai: "claude", model: "claude-opus-5-5", effort: "high" })).toMatchObject({
      provider: "codex",
      model: "gpt-6.1-terra",
    });
  });

  it("starts a pick on another AI even when the default AI's list can't be read", async () => {
    const engine = engineWithModels({ codexFails: true });
    expect(await engine.defaults({ ai: "claude", model: "claude-opus-5-5", effort: "high" })).toMatchObject({
      provider: "claude",
      model: "claude-opus-5-5",
    });
    // A choice of the three still needs that list, and says why it can't start.
    await expect(engine.defaults({ preset: "balanced" })).rejects.toThrow("codex isn't answering");
  });

  it("lists the default AI first, then the others that can run a task, with their models", async () => {
    const engine = engineWithModels({ ai: "claude" });
    const choices = await engine.choices();
    expect(choices).toMatchObject({ ai: "claude", provider: "claude" });
    expect(choices.lists.map((l) => l.ai)).toEqual(["claude", "chatgpt"]);
    expect(choices.lists[1]?.models.map((m) => m.id)).toEqual(["gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna"]);
    expect(choices.lists[0]?.models[0]).toMatchObject({ efforts: ["low", "medium", "high", "xhigh", "max"] });
  });

  it("runs on the course key through the agent its vendor needs, and stops when the key is gone", async () => {
    const { funnel, inputs } = fakeFunnel(async () => ({ text: "Done." }));
    const efforts = [{ id: "medium" }];
    (funnel as { models: unknown }).models = async (provider: string) =>
      provider === "claude" ? [{ id: "claude-sonnet-5-5", efforts }] : [{ id: "gpt-6-sol", efforts }];
    let key: { key: string; vendor: "openai" | "anthropic" } | null = {
      key: "sk-ant-api03-secret",
      vendor: "anthropic",
    };
    const engine = new AgentEngine(funnel, () => "it", { ai: async () => "key", courseKey: () => key });
    engine.attachTools({ open: () => ({ url: "http://127.0.0.1:1/mcp", token: "tok" }), close: () => {} });
    const defaults = await engine.defaults();
    expect(defaults).toEqual({ provider: "claude", auth: "key", model: "claude-sonnet-5-5", effort: "medium" });

    const drain = async (t: Task) => {
      const seen: EngineEvent[] = [];
      const signal = new AbortController().signal;
      for await (const e of engine.run({ task: t, project: null, workdir: "/w", followUp: null, signal })) seen.push(e);
      return seen;
    };
    const keyTask = task({ provider: "claude", auth: "key", model: "claude-sonnet-5-5" });
    await drain(keyTask);
    expect(inputs[0]?.apiKey).toBe("sk-ant-api03-secret");
    // A task on the subscription never gets the key.
    await drain(task({ provider: "claude", model: "claude-sonnet-5-5" }));
    expect(inputs[1]?.apiKey).toBeUndefined();

    // Replaced with an OpenAI key, Claude can't use it; removed, nothing can.
    key = { key: "sk-proj-other", vendor: "openai" };
    await expect(drain(keyTask)).rejects.toThrow(/course key/);
    key = null;
    await expect(drain(keyTask)).rejects.toThrow(/course key/);
    await expect(engine.defaults()).rejects.toThrow(/course key/);
    expect(inputs).toHaveLength(2);
  });

  it("shows a Claude subagent's work in the activity, under the line that hands it off", async () => {
    const { funnel } = fakeFunnel(async (_input, emit) => {
      emit({ type: "tool.start", id: "a1", name: "Agent", input: { description: "Trova le fonti", prompt: "…" } });
      // The subagent's own calls are for the debug view, under the line that hands it off, not lines of their own.
      emit({ type: "tool.start", id: "s1", parentId: "a1", agent: "general-purpose", name: "WebSearch", input: {} });
      emit({ type: "tool.end", id: "s1", parentId: "a1", output: "…" });
      emit({ type: "subagent.text", parentId: "a1", text: "Ho trovato 12   fonti\nutili." });
      return { text: "Fatto." };
    });
    const engine = new AgentEngine(funnel, () => "it");
    engine.attachTools({ open: () => ({ url: "http://127.0.0.1:1/mcp", token: "tok" }), close: () => {} });
    const seen: EngineEvent[] = [];
    const t = task({ provider: "claude", model: "claude-sonnet-5-5" });
    const signal = new AbortController().signal;
    for await (const e of engine.run({ task: t, project: null, workdir: "/w", followUp: null, signal })) seen.push(e);
    expect(seen.filter((e) => e.type === "activity")).toEqual([
      { type: "activity", kind: "helper", target: "Trova le fonti", id: "a1" },
      { type: "activity", kind: "note", target: "Ho trovato 12 fonti utili." },
    ]);
    expect(seen.at(-1)).toEqual({ type: "done" });
  });

  it("writes the run and every event to the task's log, with the run's token and the course key among its secrets", async () => {
    const key = { key: "sk-ant-api03-thecoursekeyfortoday0123456789", vendor: "anthropic" as const };
    const { funnel, inputs } = fakeFunnel(async (_input, emit) => {
      emit({ type: "reasoning.delta", text: "Leggo prima le note." });
      emit({ type: "tool.start", id: "c1", name: "Read", input: { file_path: "/w/note.txt" } });
      emit({ type: "tool.end", id: "c1", output: "le note" });
      emit({ type: "raw", provider: "claude", source: "stderr", data: "warning" });
      return { text: "Fatto." };
    });
    const written: { taskId: string; secrets: (string | undefined)[]; line: Record<string, unknown> }[] = [];
    const engine = new AgentEngine(funnel, () => "it", {
      courseKey: () => key,
      verbose: () => true,
      taskLog: (taskId, secrets) => ({ write: (line) => written.push({ taskId, secrets, line }) }),
    });
    engine.attachTools({ open: () => ({ url: "http://127.0.0.1:1/mcp", token: "tok-123" }), close: () => {} });
    const t = task({ provider: "claude", auth: "key", model: "claude-sonnet-5-5", sessionId: "s0" });
    const signal = new AbortController().signal;
    for await (const _ of engine.run({ task: t, project: null, workdir: "/w", followUp: "Ancora", signal })) {
      // Drained for the log it writes.
    }
    expect(written.map((w) => w.line.type)).toEqual([
      "run",
      "reasoning.delta",
      "tool.start",
      "tool.end",
      "raw",
      "run.end",
    ]);
    // Debug is on, so the CLI's own output comes too.
    expect(inputs[0]?.verbose).toBe(true);
    expect(written[0]?.line).toEqual({
      type: "run",
      provider: "claude",
      model: "claude-sonnet-5-5",
      effort: "medium",
      access: "supervised",
      cwd: "/w",
      sessionId: "s0",
      followUp: true,
    });
    expect(
      written.every((w) => w.taskId === "t1" && w.secrets.includes("tok-123") && w.secrets.includes(key.key)),
    ).toBe(true);
  });

  it("runs a Claude task on Claude Code, with its tools held to the same rules", async () => {
    const workdir = await realpath(await mkdtemp(join(tmpdir(), "tw-claude-")));
    await writeFile(join(workdir, "theirs.docx"), "x");
    const decisions: unknown[] = [];
    const { funnel, inputs } = fakeFunnel(async (input) => {
      const ask = (tool: string, toolInput: unknown) => input.onApproval?.({ id: tool, tool, input: toolInput });
      decisions.push(await ask("Write", { file_path: "new.docx", content: "x" }));
      decisions.push(await ask("Write", { file_path: "/etc/elsewhere.docx", content: "x" }));
      decisions.push(await ask("Write", { file_path: "../outside.docx", content: "x" }));
      decisions.push(await ask("Edit", { file_path: join(workdir, "theirs.docx"), old_string: "x", new_string: "y" }));
      decisions.push(await ask("Bash", { command: "rm theirs.docx" }));
      decisions.push(await ask("Bash", { command: "ls" }));
      decisions.push(await ask("AskUserQuestion", { questions: [] }));
      return { text: "" };
    });
    const engine = new AgentEngine(funnel, () => "it");
    engine.attachTools({ open: () => ({ url: "http://127.0.0.1:1/mcp", token: "tok" }), close: () => {} });
    const t = task({ provider: "claude", model: "claude-sonnet-5-5", workdir });
    const seen: EngineEvent[] = [];
    for await (const e of engine.run({
      task: t,
      project: null,
      workdir,
      followUp: null,
      signal: new AbortController().signal,
    })) {
      seen.push(e);
      // The user refuses the overwrite.
      if (e.type === "approval") engine.decide(t.id, e.approval.id, false);
    }
    expect(inputs[0]?.selection).toMatchObject({ provider: "claude", model: "claude-sonnet-5-5", cwd: workdir });
    // Its shell commands run in Claude Code's sandbox: the policy can't tell where a command writes.
    expect(inputs[0]?.sandbox).toBe(true);
    // Claude Code has its own search tool, so it gets no Codex options; it passes on what its subagents write and do.
    expect(inputs[0]?.providerOptions).toMatchObject({
      claude: { forwardSubagentText: true, forwardSubagentTools: true },
    });
    // Its built-in tools a task never uses stay off: their descriptions were most of every request (#194). The ones
    // the task needs stay on, the plan's TaskCreate and TaskUpdate included.
    const off = (inputs[0]?.providerOptions as { claude?: { disallowedTools?: string[] } })?.claude?.disallowedTools;
    expect(off).toEqual(expect.arrayContaining(["Artifact", "CronCreate", "EnterWorktree", "NotebookEdit", "Skill"]));
    for (const needed of [
      "Read",
      "Write",
      "Edit",
      "Bash",
      "WebSearch",
      "WebFetch",
      "Task",
      "Agent",
      "TaskCreate",
      "TaskUpdate",
    ])
      expect(off).not.toContain(needed);
    expect(off?.some((t) => t.startsWith("mcp__"))).toBe(false);
    // It waits for each command and subagent instead of leaving one in the background and finishing the task.
    expect(inputs[0]?.env).toMatchObject({ CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1" });
    expect(decisions).toEqual([
      "allow",
      { decision: "deny", message: "Work only inside the task's folder." },
      { decision: "deny", message: "Work only inside the task's folder." },
      expect.objectContaining({ decision: "deny", message: expect.stringMatching(/keep the file/) }),
      expect.objectContaining({ decision: "deny", message: expect.stringMatching(/Don't delete files/) }),
      "allow",
      expect.objectContaining({ decision: "deny", message: expect.stringMatching(/ask_user/) }),
    ]);
    expect(seen.filter((e) => e.type === "approval")).toEqual([
      {
        type: "approval",
        approval: expect.objectContaining({ action: "overwrite", paths: [join(workdir, "theirs.docx")] }),
      },
    ]);
  });
});

describe("AgentEngine with the document tools", () => {
  const made: [string, string][] = [];
  const documents = {
    skills: "/app/skills",
    env: { PATH: "/app/bin:/usr/bin", OFFICECLI_SKIP_UPDATE: "1" },
    makePdf: async (source: string, target: string) => {
      made.push([source, target]);
    },
  };

  it("gives Codex the tools' environment and the guides, and makes a PDF next to the file", async () => {
    const work = await mkdtemp(join(tmpdir(), "tw-pdf-"));
    await writeFile(join(work, "Proposta.docx"), "x");
    await writeFile(join(work, "Proposta.pdf"), "an older one");
    const { funnel, inputs } = fakeFunnel(async () => {
      reply = await engine.makePdf("t1", join(work, "Proposta.docx"));
      return { text: "" };
    });
    let reply = "";
    const engine = new AgentEngine(funnel, () => "it", {
      documents,
      user: () => ({ name: "Giulia", work: "", notes: "" }),
    });
    engine.attachTools({ open: () => ({ url: "http://127.0.0.1:1/mcp", token: "tok" }), close: () => {} });
    const seen: EngineEvent[] = [];
    const signal = new AbortController().signal;
    for await (const e of engine.run({
      task: task({ workdir: work }),
      project: null,
      workdir: work,
      followUp: null,
      signal,
    }))
      seen.push(e);
    expect(inputs[0]?.env).toEqual(documents.env);
    expect(inputs[0]?.system).toContain("/app/skills/word/SKILL.md");
    // An existing PDF stays: the new one gets a free name.
    const target = join(await realpath(work), "Proposta (2).pdf");
    expect(made).toEqual([[join(await realpath(work), "Proposta.docx"), target]]);
    expect(reply).toContain(target);
    expect(seen).toContainEqual({ type: "file", change: { path: target, kind: "add", role: "made" } });
  });

  it("refuses a file outside the task's folder", async () => {
    const work = await mkdtemp(join(tmpdir(), "tw-pdf-"));
    const elsewhere = await mkdtemp(join(tmpdir(), "tw-pdf-out-"));
    await writeFile(join(elsewhere, "Other.docx"), "x");
    let error = "";
    const { funnel } = fakeFunnel(async () => {
      error = await engine.makePdf("t1", join(elsewhere, "Other.docx")).then(
        () => "",
        (e: Error) => e.message,
      );
      return { text: "" };
    });
    const engine = new AgentEngine(funnel, () => "it", { documents });
    engine.attachTools({ open: () => ({ url: "http://127.0.0.1:1/mcp", token: "tok" }), close: () => {} });
    const signal = new AbortController().signal;
    for await (const _ of engine.run({
      task: task({ workdir: work }),
      project: null,
      workdir: work,
      followUp: null,
      signal,
    }));
    expect(error).toMatch(/outside the task's folder/);
  });
});

describe("deletesFiles", () => {
  it("says in plain words that the network is down, at once when the computer is offline", async () => {
    const { funnel, inputs } = fakeFunnel(async () => ({ text: "" }));
    const offline = new AgentEngine(funnel, () => "it", { online: () => false });
    offline.attachTools({ open: () => ({ url: "http://127.0.0.1:1/mcp", token: "tok" }), close: () => {} });
    const runs = offline.run({
      task: task(),
      project: null,
      workdir: "/w",
      followUp: null,
      signal: new AbortController().signal,
    });
    await expect(runs[Symbol.asyncIterator]().next()).rejects.toThrow(/non riesce a raggiungere ChatGPT/);
    expect(inputs).toHaveLength(0);

    // Online, a CLI's own network error is put the same way, and any other error keeps the CLI's words.
    const { run, seen } = setup(async () => {
      throw new Error("API Error: Connection refused (ECONNREFUSED)");
    });
    await run();
    expect(seen.at(-1)).toMatchObject({ type: "failed", error: expect.stringMatching(/Controlla la connessione/) });
    const other = setup(async () => {
      throw new Error("model not found");
    });
    await other.run();
    expect(other.seen.at(-1)).toEqual({ type: "failed", error: "model not found" });

    // A connection that drops during the run doesn't hide another reason.
    let online = true;
    const { funnel: dropping } = fakeFunnel(async () => {
      online = false;
      throw new Error("model not found");
    });
    const engine = new AgentEngine(dropping, () => "it", { online: () => online });
    engine.attachTools({ open: () => ({ url: "http://127.0.0.1:1/mcp", token: "tok" }), close: () => {} });
    const events: EngineEvent[] = [];
    const signal = new AbortController().signal;
    for await (const e of engine.run({ task: task(), project: null, workdir: "/w", followUp: null, signal }))
      events.push(e);
    expect(events.at(-1)).toEqual({ type: "failed", error: "model not found" });
  });

  it("tells network errors from the rest", () => {
    expect(isNetworkError("workspace routing discovery failed")).toBe(true);
    expect(isNetworkError("stream disconnected before completion: error sending request")).toBe(true);
    expect(isNetworkError("getaddrinfo ENOTFOUND api.anthropic.com")).toBe(true);
    expect(isNetworkError("You've hit your usage limit")).toBe(false);
    expect(isNetworkError("The network folder is read-only")).toBe(false);
  });

  it("finds commands that delete, whatever comes before them", () => {
    for (const command of [
      "rm -rf drafts",
      "cd out && rm old.docx",
      "ls; rmdir empty",
      "find . -name '*.tmp' -delete",
      "find . -name '*.tmp' | xargs rm",
      "find . -exec rm {} +",
      "sudo rm x",
      "del report.docx",
      "Remove-Item old.xlsx",
      "python3 -c 'import os; os.remove(\"a\")'",
      "python3 - <<'PY'\nimport shutil\nshutil.rmtree('drafts')\nPY",
      "node -e \"require('fs').rmSync('x')\"",
      // A quoted command given to a shell runs, and so does a substitution inside double quotes.
      'powershell -Command "Remove-Item x"',
      'echo "$(rm x)"',
      'bash -c "$(rm x)"',
      "bash -c 'rm -rf drafts'",
      'sh -c "cd out && rm old.docx"',
      'cmd /c "del report.docx"',
      "echo `rm x`",
      "bash <<EOF\nrm -rf drafts\nEOF",
      "/bin/sh <<EOF\nrm -rf drafts\nEOF",
      "if test -f old.docx; then rm old.docx; fi",
      'for f in *.tmp; do rm "$f"; done',
      "cat <<EOF > plan.md\n$(rm old.docx)\nEOF",
      "env -i rm x",
      "FOO=1 rm old.docx",
      "env FOO=1 rm x",
      "sudo -u bob rm x",
      "sudo -u www-data rm old.docx",
      "env -C /tmp rm old.docx",
    ])
      expect(deletesFiles(command), command).toBe(true);
  });

  it("leaves alone words inside the text a command writes", () => {
    for (const command of [
      "python3 - <<'PY'\nparas = ['Scaletta del corso', 'rd round']\ndel paras[0]\nPY",
      "echo 'Obiettivi del corso' > note.txt",
      'printf "Programma del primo incontro\\n" >> scaletta.txt',
      "python3 make_docx.py --title 'Corso del 27 ottobre'",
      "cat <<EOF > plan.md\nrm is not run here\nEOF",
      // A script written to a file isn't run by writing it, and a quoted heredoc delimiter keeps $(…) literal.
      "cat > cleanup.sh <<EOF\nrm old.docx\nEOF",
      "cat <<'EOF' > plan.md\n$(rm old.docx)\nEOF",
    ])
      expect(deletesFiles(command), command).toBe(false);
  });
});
