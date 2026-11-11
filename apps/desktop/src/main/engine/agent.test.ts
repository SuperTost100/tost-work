/** @vitest-environment node */
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FunnelEvent, RunRequest } from "cli-funnel";
import { describe, expect, it } from "vitest";
import type { Decision, EngineEvent, Level, Task } from "../../shared/model";
import type { SandboxReadiness } from "../../shared/sandbox";
import { SandboxNotReady, UserError } from "../userError";
import { AgentEngine, type AgentFunnel, asCodexRequest, deletesFiles, isNetworkError, outside } from "./agent";

/** A hook check that passes, for engines whose Codex runs aren't about the hook. */
const PASSES = { codexHook: async () => {} };

let calls = 0;
/** Codex's PreToolUse hook input for one step, as Codex sends it before the step runs. */
const step = (tool: string, toolInput: unknown, cwd = "/w", id = `call_${++calls}`) => ({
  session_id: "s1",
  turn_id: "u1",
  cwd,
  hook_event_name: "PreToolUse",
  model: "gpt-6-sol",
  permission_mode: "bypassPermissions",
  tool_name: tool,
  tool_input: toolInput,
  tool_use_id: id,
});
/** An apply_patch patch with these lines. */
const patch = (...lines: string[]) => ["*** Begin Patch", ...lines, "*** End Patch"].join("\n");

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
  const engine = new AgentEngine(funnel, () => "it", PASSES);
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
        if (e.type === "approval") engine.decide(t.id, e.approval.id, decisions.shift() ?? "refuse");
      }
    })();
  const decisions: Decision[] = [];
  return { engine, inputs, seen, run, closed, controller, decisions };
}

/** An engine whose runs nobody answers: the test decides by hand, after the run has ended. */
function bare(script: Script) {
  const { funnel } = fakeFunnel(script);
  const engine = new AgentEngine(funnel, () => "it", PASSES);
  engine.attachTools({ open: () => ({ url: "http://127.0.0.1:1/mcp", token: "tok" }), close: () => {} });
  const drain = async (followUp: string | null, onEvent?: (e: EngineEvent) => void) => {
    const seen: EngineEvent[] = [];
    const signal = new AbortController().signal;
    for await (const e of engine.run({ task: task(), project: null, workdir: "/w", followUp, signal })) {
      seen.push(e);
      onEvent?.(e);
    }
    return seen;
  };
  return { engine, drain };
}

/** Codex's hook before a patch that changes `path`. */
const update = (path: string) => step("apply_patch", { command: patch(`*** Update File: ${path}`, "@@", "-a", "+b") });

describe("AgentEngine", () => {
  it("runs Codex at full in its sandbox, with the instructions, the tool server and the hook's address, and maps its events", async () => {
    const { inputs, seen, run, closed } = setup(async (_input, emit) => {
      emit({ type: "session", sessionId: "s1" });
      emit({ type: "plan", steps: [{ text: "Draft", status: "in_progress" }] });
      emit({ type: "file.change", id: "c1", path: "/w/Proposta.docx", kind: "add", status: "done" });
      emit({ type: "file.change", id: "c2", path: "/w/no.docx", kind: "add", status: "declined" });
      return { text: "Done." };
    });
    await run();
    const input = inputs[0];
    expect(input?.selection).toMatchObject({ provider: "codex", access: "full", cwd: "/w", model: "gpt-6-sol" });
    // Shell commands run in the CLI's sandbox, so they can't write outside the folder. At full Codex asks no
    // approvals, and every command stays in the sandbox.
    expect(input?.sandbox).toBe(true);
    // Its steps reach the policy through its hook instead, which finds Tost Work at the run's address with its token.
    expect(input?.onApproval).toBeUndefined();
    expect(input?.env).toEqual({ TOST_WORK_HOOK_URL: "http://127.0.0.1:1/hook", TOST_WORK_HOOK_TOKEN: "tok" });
    expect(input?.system).toContain("use Italian.");
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

  it("sends the line breaks and blank lines of a brief and of a follow-up as the user wrote them", async () => {
    const lines = "Dear Anna,\n\nPlease sum up:\n- the offer\n- the price";
    const { inputs, run } = setup(async () => ({ text: "ok" }));
    await run(task({ brief: lines }));
    await run(task({ sessionId: "s1" }), "Shorter,\n\nand in Italian");
    expect(inputs.map((i) => i.prompt)).toEqual([lines, "Shorter,\n\nand in Italian"]);
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
      else decisions.push(await engine.gate("t1", update("/w/theirs.xlsx")));
      return { text: "" };
    });
    const seen = await drain(null);
    const approval = seen.find((e) => e.type === "approval");
    expect(approval).toMatchObject({ approval: { action: "overwrite", paths: ["/w/theirs.xlsx"] } });
    // The run is over, so the decision goes to the next one, which may make the change without asking again.
    expect(engine.decide("t1", approval?.type === "approval" ? approval.approval.id : "", "allow")).toBe(false);
    const next = await drain("go ahead");
    expect(decisions).toEqual([{ decision: "allow" }]);
    expect(next.some((e) => e.type === "approval")).toBe(false);
  });

  it("keeps the card when a held file change ends with the turn, and asks again after a refusal", async () => {
    const decisions: unknown[] = [];
    // Each turn ends once its card is out, however long the engine takes to ask.
    let asked = () => {};
    const whenAsked = (e: EngineEvent) => {
      if (e.type === "approval") asked();
    };
    const { engine, drain } = bare(async () => {
      const shown = new Promise<void>((resolve) => {
        asked = resolve;
      });
      // A relative path is taken from the folder the step runs in.
      const held = engine.gate("t1", update("theirs.xlsx"));
      void held.then((d) => decisions.push(d));
      await shown;
      return { text: "" };
    });
    const seen = await drain(null, whenAsked);
    const ids = seen.flatMap((e) => (e.type === "approval" ? [e.approval.id] : []));
    expect(ids).toHaveLength(1);
    // The turn ended: Codex hears no, and the task keeps the card until the user decides.
    expect(seen.at(-1)).toEqual({ type: "done" });
    expect(decisions).toEqual([expect.objectContaining({ decision: "deny" })]);
    expect(engine.decide("t1", ids[0] ?? "", "refuse")).toBe(false);
    const again = await drain("try again", whenAsked);
    expect(again.filter((e) => e.type === "approval")).toHaveLength(1);
  });

  it("asks before changing a file that was already there, and not for one the task made", async () => {
    const decisions: unknown[] = [];
    const {
      engine,
      seen,
      run,
      decisions: replies,
    } = setup(async () => {
      const change = (path: string, kind: "Update" | "Add") =>
        engine.gate("t1", step("apply_patch", { command: patch(`*** ${kind} File: ${path}`, "+x") }));
      decisions.push(await change("/w/made.docx", "Update"));
      decisions.push(await change("/w/theirs.xlsx", "Update"));
      // Allowed once, with its copy kept, the same file doesn't ask again in this run.
      decisions.push(await change("/w/theirs.xlsx", "Update"));
      decisions.push(await change("/w/other.xlsx", "Update"));
      decisions.push(await change("/w/new.docx", "Add"));
      decisions.push(await change("/w/other.xlsx", "Update"));
      return { text: "" };
    });
    replies.push("allow", "refuse", "discard");
    await run(task({ own: ["/w/made.docx"] }));
    expect(decisions[0]).toEqual({ decision: "allow" });
    expect(decisions[1]).toEqual({ decision: "allow" });
    expect(decisions[2]).toEqual({ decision: "allow" });
    expect(decisions[3]).toMatchObject({ decision: "deny", reason: expect.stringMatching(/new name/) });
    expect(decisions[4]).toEqual({ decision: "allow" });
    // Turned down altogether, the agent hears not to save its version at all.
    expect(decisions[5]).toMatchObject({ decision: "deny", reason: expect.stringMatching(/Don't save it/) });
    const asked = seen.flatMap((e) => (e.type === "approval" ? [e.approval] : []));
    expect(asked.map((a) => [a.action, a.paths])).toEqual([
      ["overwrite", ["/w/theirs.xlsx"]],
      ["overwrite", ["/w/other.xlsx"]],
      ["overwrite", ["/w/other.xlsx"]],
    ]);
  });

  it("asks again before changing a file the task overwrote or restored earlier", async () => {
    const decisions: unknown[] = [];
    const {
      engine,
      seen,
      run,
      decisions: replies,
    } = setup(async () => {
      decisions.push(await engine.gate("t1", update("/w/theirs.xlsx")));
      return { text: "" };
    });
    replies.push("allow");
    await run(
      task({
        files: [{ path: "/w/theirs.xlsx", kind: "update", role: "made" }],
        kept: [{ path: "/w/theirs.xlsx", copy: "/k/1", at: "", reason: "overwrite" }],
      }),
      "Change the totals",
    );
    expect(seen.filter((e) => e.type === "approval")).toHaveLength(1);
    expect(decisions[0]).toEqual({ decision: "allow" });
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
      engine,
      seen,
      run,
      decisions: replies,
    } = setup(async () => {
      const del = () => engine.gate("t1", step("apply_patch", { command: patch("*** Delete File: /w/old.txt") }));
      const command = (command: string) => engine.gate("t1", step("Bash", { command }));
      decisions.push(await del());
      decisions.push(await del());
      decisions.push(await command("rm -rf drafts"));
      decisions.push(await command("python3 -c 'import os; os.remove(\"a\")'"));
      decisions.push(await command("python3 make_docx.py"));
      return { text: "" };
    });
    replies.push("allow", "refuse");
    await run();
    expect(seen.filter((e) => e.type === "approval")[0]).toMatchObject({
      approval: { action: "delete", paths: ["/w/old.txt"] },
    });
    expect(decisions[0]).toMatchObject({ decision: "deny", reason: expect.stringMatching(/Trash/) });
    expect(decisions[1]).toMatchObject({ decision: "deny", reason: expect.stringMatching(/keep/) });
    expect(decisions[2]).toMatchObject({ decision: "deny", reason: expect.stringMatching(/Don't delete files/) });
    expect(decisions[3]).toMatchObject({ decision: "deny", reason: expect.stringMatching(/Don't delete files/) });
    expect(decisions[4]).toEqual({ decision: "allow" });
  });

  it("carries the Tost Work tools' questions, files and review into the task", async () => {
    const holder: { engine?: AgentEngine } = {};
    // A reported file has to be there to be listed.
    const made = join(await mkdtemp(join(tmpdir(), "tw-report-")), "a.docx");
    await writeFile(made, "x");
    const { engine, seen, run } = setup(async () => {
      await holder.engine?.ask("t1", [{ text: "Which template?", options: ["A", "B"] }]);
      await holder.engine?.reportFile("t1", { path: made, kind: "add" });
      await holder.engine?.review("t1", { asked: [{ text: "A proposal" }], decided: [], checkYourself: [] });
      return { text: "" };
    });
    holder.engine = engine;
    await run();
    expect(seen.slice(0, 3)).toMatchObject([
      { type: "question", question: { text: "Which template?" } },
      { type: "file", change: { path: made, role: "made" } },
      { type: "review", review: { asked: [{ text: "A proposal" }] } },
    ]);
  });

  it("doesn't list a reported file that isn't there, and says where a file of that name is", async () => {
    const work = await realpath(await mkdtemp(join(tmpdir(), "tw-report-")));
    await writeFile(join(work, "a.txt"), "x");
    const errors: string[] = [];
    const { funnel } = fakeFunnel(async () => {
      const report = (path: string, kind: "add" | "update" | "delete") =>
        engine.reportFile("t1", { path, kind }).catch((e: Error) => errors.push(e.message));
      // Claude made a.txt at the top after a cd in an earlier command, and reports it under sub.
      await report(join(work, "sub", "a.txt"), "add");
      await report(join(work, "gone.docx"), "update");
      // A deleted file isn't there, as expected.
      await report(join(work, "old.txt"), "delete");
      await report(join(work, "a.txt"), "add");
      return { text: "" };
    });
    const engine = new AgentEngine(funnel, () => "en", PASSES);
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
    expect(seen.flatMap((e) => (e.type === "file" ? [[e.change.path, e.change.kind]] : []))).toEqual([
      [join(work, "old.txt"), "delete"],
      [join(work, "a.txt"), "add"],
    ]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain(`no file at ${join(work, "sub", "a.txt")}`);
    expect(errors[0]).toContain(`There is one at ${join(work, "a.txt")}.`);
    expect(errors[1]).toContain(`no file at ${join(work, "gone.docx")}`);
    expect(errors[1]).not.toContain("There is one");
  });

  it("ends a stopped run as stopped, and a held file change hears that nobody allowed it", async () => {
    let decision: unknown;
    const { engine, seen, controller, run } = setup(async () => {
      decision = await engine.gate("t1", update("/w/theirs.xlsx"));
      return { text: "", finishReason: "cancelled" };
    });
    // Stop as soon as the card shows, without deciding.
    engine.decide = () => {
      controller.abort();
      return true;
    };
    await run();
    expect(decision).toEqual({ decision: "deny", reason: "This task was stopped." });
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
      level?: () => Level;
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
      ...(over.level ? { level: over.level } : {}),
    });
  }

  it.each(["beginner", "intermediate", "advanced"] as const)(
    "never offers or starts the Maximum level at %s: a pick of it runs on the nearest level left",
    async (level) => {
      const engine = engineWithModels({ level: () => level });
      const offered = (await engine.choices()).lists.flatMap((l) => l.models.map((m) => m.efforts));
      expect(offered.length).toBeGreaterThan(0);
      for (const efforts of offered) expect(efforts).toEqual(["low", "medium", "high", "xhigh"]);
      for (const ai of ["claude", "chatgpt"] as const)
        expect(
          await engine.defaults({ ai, model: ai === "claude" ? "claude-opus-5-5" : "gpt-6.1-sol", effort: "max" }),
        ).toMatchObject({ effort: "xhigh" });
      // The three choices don't use it either way.
      expect(await engine.defaults({ preset: "thorough" })).toMatchObject({ model: "gpt-6.1-sol", effort: "high" });
    },
  );

  it("runs a task started at Maximum on the nearest level its model offers once the level is below Expert", async () => {
    let level: Level = "advanced";
    const { funnel, inputs } = fakeFunnel(async () => ({ text: "ok" }));
    // A model with no "xhigh": the nearest level left is "high".
    (funnel as { models: unknown }).models = async () => [
      { id: "m1", efforts: ["low", "medium", "high", "max"].map((id) => ({ id })) },
    ];
    const engine = new AgentEngine(funnel, () => "it", { ...PASSES, level: () => level });
    engine.attachTools({ open: () => ({ url: "http://127.0.0.1:1/mcp", token: "tok" }), close: () => {} });
    const followUp = async (text: string) => {
      const seen: EngineEvent[] = [];
      const run = { task: task({ model: "m1", effort: "max", sessionId: "s1" }), project: null, workdir: "/w" };
      for await (const e of engine.run({ ...run, followUp: text, signal: new AbortController().signal })) seen.push(e);
      return seen;
    };
    await followUp("go on");
    level = "expert";
    await followUp("and again");
    expect(inputs.map((i) => i.selection.effort)).toEqual(["high", "max"]);
  });

  it("takes Maximum away when the level is lowered, and offers and starts it again at Expert", async () => {
    let level: Level = "expert";
    const engine = engineWithModels({ level: () => level });
    const pick = { ai: "claude", model: "claude-opus-5-5", effort: "max" } as const;
    expect((await engine.choices()).lists[0]?.models[0]?.efforts).toContain("max");
    expect(await engine.defaults(pick)).toMatchObject({ effort: "max" });
    level = "advanced";
    expect((await engine.choices()).lists[0]?.models[0]?.efforts).not.toContain("max");
    expect(await engine.defaults(pick)).toMatchObject({ effort: "xhigh" });
    level = "expert";
    expect(await engine.defaults(pick)).toMatchObject({ effort: "max" });
  });

  it("starts the middle choice when nothing is picked, and each choice on the default AI", async () => {
    const codex = engineWithModels();
    expect(await codex.defaults()).toMatchObject({ model: "gpt-6.1-terra", effort: "medium" });
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

  it("reads the AIs' model lists at the same time, keeping the default AI first and leaving out one that fails", async () => {
    const efforts = [{ id: "medium" }];
    /** A models() whose reads each answer only once both AIs' reads have started, so one that waits for the other hangs. */
    const overlapping = (answer: (provider: string) => string) => {
      let started = 0;
      let release!: () => void;
      const bothStarted = new Promise<void>((resolve) => {
        release = resolve;
      });
      return async (provider: string) => {
        if (++started === 2) release();
        await bothStarted;
        return [{ id: answer(provider), name: answer(provider), efforts }];
      };
    };
    const within = <T>(work: Promise<T>) =>
      Promise.race([
        work,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("the reads did not overlap")), 500)),
      ]);
    const engineWith = (ai: "chatgpt" | "claude", models: (provider: string) => Promise<unknown>) => {
      const { funnel } = fakeFunnel(async () => ({ text: "" }));
      (funnel as { models: unknown }).models = models;
      return new AgentEngine(funnel, () => "it", { ai: async () => ai, usable: async () => ["claude", "chatgpt"] });
    };

    const ok = overlapping((p) => (p === "claude" ? "claude-sonnet-5-5" : "gpt-6.1-terra"));
    expect((await within(engineWith("chatgpt", ok).choices())).lists.map((l) => l.ai)).toEqual(["chatgpt", "claude"]);
    const okAgain = overlapping((p) => (p === "claude" ? "claude-sonnet-5-5" : "gpt-6.1-terra"));
    expect((await within(engineWith("claude", okAgain).choices())).lists.map((l) => l.ai)).toEqual([
      "claude",
      "chatgpt",
    ]);

    // Claude can't be read: the other AI's list stands alone, as when the reads ran one after the other.
    const read = overlapping(() => "gpt-6.1-terra");
    const failing = engineWith("claude", async (p) => {
      const models = await read(p);
      if (p === "claude") throw new Error("claude isn't answering");
      return models;
    });
    expect((await within(failing.choices())).lists.map((l) => l.ai)).toEqual(["chatgpt"]);
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

  it("writes a CLI's warnings and a narrower start to the task's log only, and the run goes on", async () => {
    const { funnel } = fakeFunnel(async (_input, emit) => {
      emit({ type: "session", sessionId: "s1" });
      emit({ type: "access.reduced", access: "full", expected: "workspace-write", started: "read-only" });
      emit({ type: "warning", message: "Under-development features enabled: hooks." });
      return { text: "Fatto." };
    });
    const written: Record<string, unknown>[] = [];
    const engine = new AgentEngine(funnel, () => "it", {
      ...PASSES,
      taskLog: () => ({ write: (l) => written.push(l) }),
    });
    engine.attachTools({ open: () => ({ url: "http://127.0.0.1:1/mcp", token: "tok" }), close: () => {} });
    const seen: EngineEvent[] = [];
    const signal = new AbortController().signal;
    for await (const e of engine.run({ task: task(), project: null, workdir: "/w", followUp: null, signal }))
      seen.push(e);
    expect(seen).toEqual([{ type: "session", sessionId: "s1" }, { type: "message", text: "Fatto." }, { type: "done" }]);
    expect(written).toEqual(
      expect.arrayContaining([
        { type: "access.reduced", access: "full", expected: "workspace-write", started: "read-only" },
        { type: "warning", message: "Under-development features enabled: hooks." },
      ]),
    );
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
      // The folder isn't there, so the listing that tells the task's own files from the rest can't be made.
      "listing.failed",
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
      sandbox: true,
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
      decisions.push(await ask("Bash", { command: "ls", dangerouslyDisableSandbox: true }));
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
      if (e.type === "approval") engine.decide(t.id, e.approval.id, "refuse");
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
    // Each of its commands starts in the task's folder, which is where the policy resolves a relative path.
    expect(inputs[0]?.env).toMatchObject({ CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: "1" });
    expect(decisions).toEqual([
      "allow",
      { decision: "deny", message: "Work only inside the task's folder." },
      { decision: "deny", message: "Work only inside the task's folder." },
      expect.objectContaining({
        decision: "deny",
        message: expect.stringMatching(/keep .*theirs\.docx as it is\. Save your version under a new name/),
      }),
      expect.objectContaining({ decision: "deny", message: expect.stringMatching(/Don't delete files/) }),
      "allow",
      expect.objectContaining({ decision: "deny", message: expect.stringMatching(/ask_user/) }),
      // Its commands stay in its sandbox, even when it asks to leave it.
      expect.objectContaining({ decision: "deny", message: expect.stringMatching(/only inside the sandbox/) }),
    ]);
    expect(seen.filter((e) => e.type === "approval")).toEqual([
      {
        type: "approval",
        approval: expect.objectContaining({ action: "overwrite", paths: [join(workdir, "theirs.docx")] }),
      },
    ]);
  });

  it("doesn't start Claude Code in a folder whose own Claude Code settings would change the checks", async () => {
    const workdir = await realpath(await mkdtemp(join(tmpdir(), "tw-claude-")));
    await mkdir(join(workdir, ".claude"));
    await writeFile(join(workdir, ".claude", "settings.local.json"), "{}");
    const { funnel, inputs } = fakeFunnel(async () => ({ text: "" }));
    const engine = new AgentEngine(funnel, () => "it");
    engine.attachTools({ open: () => ({ url: "http://127.0.0.1:1/mcp", token: "tok" }), close: () => {} });
    const run = async (t: Task) => {
      for await (const _ of engine.run({
        task: t,
        project: null,
        workdir,
        followUp: null,
        signal: AbortSignal.abort(),
      }));
    };
    await expect(run(task({ provider: "claude", model: "claude-sonnet-5-5", workdir }))).rejects.toMatchObject({
      key: "error.claudeFolderSettings",
      vars: { path: join(workdir, ".claude", "settings.local.json") },
    });
    expect(inputs).toHaveLength(0);
    // Codex doesn't read them, and its own .codex settings have their check (codexHook.ts).
    const codex = new AgentEngine(fakeFunnel(async () => ({ text: "" })).funnel, () => "it", PASSES);
    codex.attachTools({ open: () => ({ url: "http://127.0.0.1:1/mcp", token: "tok" }), close: () => {} });
    for await (const _ of codex.run({
      task: task({ workdir }),
      project: null,
      workdir,
      followUp: null,
      signal: AbortSignal.abort(),
    }));
  });

  it("keeps the AI's own settings in the task's folder as they are, however a tool names them", async () => {
    const workdir = await realpath(await mkdtemp(join(tmpdir(), "tw-claude-")));
    await mkdir(join(workdir, ".claude"));
    await symlink(join(workdir, ".claude"), join(workdir, "config"));
    const decisions: unknown[] = [];
    const { funnel } = fakeFunnel(async (input) => {
      const ask = (tool: string, toolInput: unknown) => input.onApproval?.({ id: tool, tool, input: toolInput });
      decisions.push(await ask("Write", { file_path: ".claude/settings.json", content: "{}" }));
      decisions.push(await ask("Edit", { file_path: join(workdir, ".mcp.json"), old_string: "a", new_string: "b" }));
      decisions.push(await ask("Write", { file_path: "notes/.Claude/agents/helper.md", content: "x" }));
      decisions.push(await ask("Write", { file_path: ".codex/config.toml", content: "x" }));
      decisions.push(await ask("Write", { file_path: "config/settings.local.json", content: "{}" }));
      decisions.push(await ask("Write", { file_path: "claude-notes.md", content: "x" }));
      return { text: "" };
    });
    const engine = new AgentEngine(funnel, () => "it");
    engine.attachTools({ open: () => ({ url: "http://127.0.0.1:1/mcp", token: "tok" }), close: () => {} });
    const t = task({ provider: "claude", model: "claude-sonnet-5-5", workdir });
    for await (const _ of engine.run({
      task: t,
      project: null,
      workdir,
      followUp: null,
      signal: new AbortController().signal,
    }));
    const refused = expect.objectContaining({ decision: "deny", message: expect.stringMatching(/AI's own settings/) });
    expect(decisions).toEqual([refused, refused, refused, refused, refused, "allow"]);
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
      ...PASSES,
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
    expect(inputs[0]?.env).toEqual({
      ...documents.env,
      TOST_WORK_HOOK_URL: "http://127.0.0.1:1/hook",
      TOST_WORK_HOOK_TOKEN: "tok",
    });
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
    const engine = new AgentEngine(funnel, () => "it", { ...PASSES, documents });
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
    const offline = new AgentEngine(funnel, () => "it", { ...PASSES, online: () => false });
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
    const engine = new AgentEngine(dropping, () => "it", { ...PASSES, online: () => online });
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

  it("finds Windows commands that delete, from Claude Code's PowerShell tool and from Codex", () => {
    // Codex on Windows wraps each command like this.
    const codex = (inner: string) =>
      String.raw`"C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command '${inner}'`;
    const encoded = (text: string) => Buffer.from(text, "utf16le").toString("base64");
    for (const command of [
      "Remove-Item C:\\Users\\me\\proj\\old.docx",
      "remove-item -Recurse -Force drafts",
      "Get-ChildItem *.tmp | Remove-Item",
      "ri old.docx",
      "Get-ChildItem *.tmp | ri",
      "rm old.docx",
      "del old.docx",
      "Del .\\old.docx",
      "erase old.docx",
      "rd /s /q drafts",
      "rmdir drafts",
      "cd out; RI old.docx",
      "[System.IO.File]::Delete('C:\\Users\\me\\proj\\old.docx')",
      "[IO.Directory]::Delete('drafts', $true)",
      "(Get-Item old.docx).Delete()",
      'cmd /c "del old.docx"',
      '"C:\\Windows\\system32\\cmd.exe" /c "rd /s /q drafts"',
      codex("del old.docx"),
      codex("rm old.docx"),
      codex("ri old.docx"),
      codex("Remove-Item old.docx"),
      'powershell -ExecutionPolicy Bypass -Command "del old.docx"',
      `powershell -NoProfile -EncodedCommand ${encoded("ri old.docx")}`,
      `pwsh.exe -enc ${encoded("del old.docx")}`,
    ])
      expect(deletesFiles(command), command).toBe(true);
  });

  it("leaves alone Windows commands that only read or write text", () => {
    const codex = (inner: string) =>
      String.raw`"C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command '${inner}'`;
    const encoded = (text: string) => Buffer.from(text, "utf16le").toString("base64");
    for (const command of [
      codex("Get-ChildItem ."),
      codex('Set-Content -Path note.txt -Value "Scaletta del corso"'),
      "Get-Content programma.md",
      "Write-Output 'Obiettivi del corso'",
      'Set-Content note.txt "rd round"',
      "Get-ChildItem -Recurse | Select-Object Name",
      `powershell -NoProfile -EncodedCommand ${encoded("Get-ChildItem .")}`,
    ])
      expect(deletesFiles(command), command).toBe(false);
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

  it("reads a command's words the way the shell does: quotes, paths, joined pieces and call operators", () => {
    const encoded = (text: string) => Buffer.from(text, "utf16le").toString("base64");
    for (const command of [
      // Found in review: each of these passed the check.
      "/bin/rm victim.txt",
      '"rm" victim.txt',
      'r"m" victim.txt',
      '& "ri" victim.txt',
      'Get-ChildItem victim.txt | & "ri"',
      "cmd /c del/q victim.txt",
      'cmd /d /s /c "del victim.txt"',
      String.raw`powershell -WorkingDirectory "C:\Work" -Command "ri victim.txt"`,
      "powershell -en cgBpACAAdgBpAGMAdABpAG0ALgB0AHgAdAA=",
      "Get-ChildItem | ForEach-Object {$_.Delete($true)}",
      // Their neighbours.
      "/usr/bin/rm victim.txt",
      String.raw`\rm victim.txt`,
      "'/bin/rm' victim.txt",
      "command rm victim.txt",
      "env rm victim.txt",
      "sudo rm victim.txt",
      "sudo /bin/rm victim.txt",
      "busybox rm victim.txt",
      "xargs /bin/rm < list.txt",
      "unlink victim.txt",
      "rmdir drafts",
      "find . -name '*.tmp' -delete",
      "find . -exec /bin/rm {} +",
      "git clean -fdx",
      "git -C drafts clean -f",
      "rd /s /q drafts",
      "erase victim.txt",
      "Remove-Item victim.txt",
      "&('Remove-Item') victim.txt",
      "rm.exe victim.txt",
      String.raw`C:\Windows\System32\cmd.exe /c del victim.txt`,
      "cmd /c d^el victim.txt",
      'cmd /c "cd drafts && del victim.txt"',
      'bash -lc "rm victim.txt"',
      "bash <<< 'rm victim.txt'",
      "sudo sh <<<'rm victim.txt'",
      "sudo -u bob sh -c 'rm victim.txt'",
      'pwsh -NoProfile -c "ri victim.txt"',
      'powershell "ri victim.txt"',
      'powershell -Command "& { ri victim.txt }"',
      'iex "ri victim.txt"',
      "[IO.File]::Delete('victim.txt')",
      "(Get-Item victim.txt).Delete($true)",
      "$f.Delete('victim.txt')",
      `powershell -e ${encoded("ri victim.txt")}`,
      `powershell -ec ${encoded("ri victim.txt")}`,
      `powershell -encod ${encoded("ri victim.txt")}`,
      `powershell -EncodedCommand ${encoded("ri victim.txt")}`,
      `cmd /c powershell -enc ${encoded('cmd /c "del victim.txt"')}`,
    ])
      expect(deletesFiles(command), command).toBe(true);
  });

  it("leaves alone code that a command only writes as text", () => {
    for (const command of [
      'Set-Content note.txt "Use [IO.File]::Delete() to delete a file"',
      'echo "run rm -rf to clean"',
      "Add-Content readme.md 'del /q *.tmp removes temp files'",
      "python3 -c \"print('unlink')\"",
      "Write-Output 'Call os.remove(path) or shutil.rmtree(folder)'",
      'Set-Content -Value "(Get-Item x).Delete()" -Path note.txt',
      "echo 'rm'",
      "node -e \"const m = new Map(); m.delete('a')\"",
      'git commit -m "clean up the drafts"',
      "cat <<< 'rm is a command'",
      // The same inside a shell's payload, as Codex on Windows and bash -c send it.
      String.raw`"C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command 'Set-Content note.txt "Use [IO.File]::Delete() to delete a file"'`,
      `bash -c "echo 'Call os.remove(path) to delete' > note.txt"`,
    ])
      expect(deletesFiles(command), command).toBe(false);
    // Code a command runs is still checked.
    for (const command of [
      "powershell -Command \"[IO.File]::Delete('x')\"",
      "python3 -c 'import os; os.unlink(\"a\")'",
      "powershell -Command \"Set-Content note.txt '[IO.File]::Delete() deletes'; ri x\"",
    ])
      expect(deletesFiles(command), command).toBe(true);
  });
});

describe("the folder check", () => {
  /** A task's folder `work` next to a folder `out` that the task may not write to. */
  async function folders() {
    const root = await mkdtemp(join(tmpdir(), "tw-links-"));
    const work = join(root, "work");
    const out = join(root, "out");
    await mkdir(work);
    await mkdir(out);
    return { root, work, out, done: () => rm(root, { recursive: true, force: true }) };
  }

  it("refuses a write through a link whose target isn't there yet", async () => {
    const { work, out, done } = await folders();
    try {
      // Writing to work/link.txt would create out/new.txt.
      await symlink(join(out, "new.txt"), join(work, "link.txt"));
      expect(await outside(work, "link.txt")).toBe(true);
      const write = { id: "1", tool: "Write", input: { file_path: "link.txt", content: "x" } };
      expect(await asCodexRequest(write, work)).toMatchObject({ tool: "file_change" });
      // A link to a missing file inside the folder is refused too: what it points to isn't checked.
      await symlink(join(work, "later.txt"), join(work, "inner.txt"));
      expect(await outside(work, "inner.txt")).toBe(true);
      // A chain of links that ends at a missing file outside.
      await symlink(join(work, "link.txt"), join(work, "chain.txt"));
      expect(await outside(work, "chain.txt")).toBe(true);
      // A folder link that leads nowhere, with a new file under it.
      await symlink(join(out, "gone"), join(work, "gone"));
      expect(await outside(work, join("gone", "new.txt"))).toBe(true);
    } finally {
      await done();
    }
  });

  it("allows a new file in a new subfolder, and a link that resolves inside", async () => {
    const { work, out, done } = await folders();
    try {
      expect(await outside(work, join("sub", "deeper", "new.txt"))).toBe(false);
      expect(await outside(work, "new.txt")).toBe(false);
      await writeFile(join(work, "there.txt"), "x");
      await symlink(join(work, "there.txt"), join(work, "alias.txt"));
      expect(await outside(work, "alias.txt")).toBe(false);
      // A link to a folder outside that exists is resolved and refused, as before.
      await symlink(out, join(work, "away"));
      expect(await outside(work, join("away", "new.txt"))).toBe(true);
      expect(await outside(work, join("..", "out", "new.txt"))).toBe(true);
    } finally {
      await done();
    }
  });

  it("doesn't take an error other than a missing file as allowed", async () => {
    const { work, done } = await folders();
    try {
      // A file used as a folder can't be resolved: that's ENOTDIR, not a missing file.
      await writeFile(join(work, "plain.txt"), "x");
      await expect(outside(work, join("plain.txt", "new.txt"))).rejects.toThrow(/ENOTDIR/);
    } finally {
      await done();
    }
  });
});

const READY: SandboxReadiness = { ready: true, missing: [], distro: null, appArmorRestrictsUserns: null };

describe("the sandbox", () => {
  /** A run on `platform`, with the sandbox check given, returning what reached cli-funnel and the error, if any. */
  async function runOn(
    platform: string,
    provider: "codex" | "claude",
    ready: (provider: "codex" | "claude") => Promise<SandboxReadiness> = async () => READY,
  ) {
    const { funnel, inputs } = fakeFunnel(async () => ({ text: "ok" }));
    const checked: string[] = [];
    const engine = new AgentEngine(funnel, () => "it", {
      ...PASSES,
      platform,
      sandboxReady: (p) => {
        checked.push(p);
        return ready(p);
      },
    });
    engine.attachTools({ open: () => ({ url: "http://127.0.0.1:1/mcp", token: "tok" }), close: () => {} });
    const signal = new AbortController().signal;
    let error: unknown = null;
    try {
      for await (const _ of engine.run({
        task: task({ provider }),
        project: null,
        workdir: "/w",
        followUp: null,
        signal,
      }));
    } catch (err) {
      error = err;
    }
    return { input: inputs[0], checked, error };
  }

  it("asks every CLI for a sandbox, except Claude Code on Windows, which has none", async () => {
    for (const [platform, provider, sandbox] of [
      ["darwin", "codex", true],
      ["darwin", "claude", true],
      ["linux", "codex", true],
      ["linux", "claude", true],
      ["win32", "codex", true],
      ["win32", "claude", false],
    ] as const) {
      const { input, error } = await runOn(platform, provider);
      expect(error, `${platform} ${provider}`).toBeNull();
      expect(input?.sandbox, `${platform} ${provider}`).toBe(sandbox);
      // Codex runs with no approvals everywhere, in its sandbox; Claude Code asks through its approvals.
      expect(input?.selection.access, `${platform} ${provider}`).toBe(provider === "codex" ? "full" : "supervised");
    }
  });

  it("fails a task at once, saying what's missing, when its sandbox can't start", async () => {
    const missing: SandboxReadiness = {
      ready: false,
      missing: ["socat"],
      distro: { id: "ubuntu", like: ["debian"], name: "Ubuntu", version: "24.04" },
      appArmorRestrictsUserns: true,
    };
    const { input, checked, error } = await runOn("linux", "claude", async () => missing);
    expect(input).toBeUndefined();
    expect(checked).toEqual(["claude"]);
    expect(error).toBeInstanceOf(SandboxNotReady);
    expect((error as SandboxNotReady).readiness).toEqual(missing);
    expect((error as SandboxNotReady).provider).toBe("claude");
    expect((error as SandboxNotReady).say("it")).toMatch(/Claude non può ancora lavorare.*socat non è installato/);

    // Claude Code on Windows runs without a sandbox, so there's nothing to check.
    const windows = await runOn("win32", "claude", async () => missing);
    expect(windows.checked).toEqual([]);
    expect(windows.error).toBeNull();
  });

  it("puts Claude Code's PowerShell commands through the same policy as Bash", async () => {
    expect(await asCodexRequest({ id: "1", tool: "PowerShell", input: { command: "ri old.docx" } }, "/w")).toEqual({
      id: "1",
      tool: "command",
      input: { command: "ri old.docx" },
    });
    const decisions: unknown[] = [];
    const { funnel } = fakeFunnel(async (input) => {
      for (const command of ["Remove-Item old.docx", "del old.docx", "Get-ChildItem ."])
        decisions.push(await input.onApproval?.({ id: command, tool: "PowerShell", input: { command } }));
      return { text: "" };
    });
    const engine = new AgentEngine(funnel, () => "it", { platform: "win32" });
    engine.attachTools({ open: () => ({ url: "http://127.0.0.1:1/mcp", token: "tok" }), close: () => {} });
    const signal = new AbortController().signal;
    for await (const _ of engine.run({
      task: task({ provider: "claude" }),
      project: null,
      workdir: "/w",
      followUp: null,
      signal,
    }));
    expect(decisions).toEqual([
      expect.objectContaining({ decision: "deny", message: expect.stringMatching(/Don't delete files/) }),
      expect.objectContaining({ decision: "deny", message: expect.stringMatching(/Don't delete files/) }),
      "allow",
    ]);
  });
});

describe("Codex's hook", () => {
  /** An engine for a Codex task in a real folder, whose cards get `decisions` in turn. */
  async function inFolder(script: (engine: AgentEngine, work: string) => Promise<unknown>) {
    const work = await realpath(await mkdtemp(join(tmpdir(), "tw-hook-")));
    const holder: { engine?: AgentEngine } = {};
    const { funnel } = fakeFunnel(async () => {
      await script(holder.engine as AgentEngine, work);
      return { text: "" };
    });
    const engine = new AgentEngine(funnel, () => "en", PASSES);
    holder.engine = engine;
    engine.attachTools({ open: () => ({ url: "http://127.0.0.1:1/mcp", token: "tok" }), close: () => {} });
    const decisions: Decision[] = [];
    const seen: EngineEvent[] = [];
    const go = async () => {
      const signal = new AbortController().signal;
      for await (const e of engine.run({
        task: task({ workdir: work }),
        project: null,
        workdir: work,
        followUp: null,
        signal,
      })) {
        seen.push(e);
        if (e.type === "approval") engine.decide("t1", e.approval.id, decisions.shift() ?? "refuse");
      }
    };
    return { work, decisions, seen, go };
  }

  it("doesn't start a Codex task unless its hook will check each step", async () => {
    const { funnel, inputs } = fakeFunnel(async () => ({ text: "" }));
    const signal = new AbortController().signal;
    const runWith = async (engine: AgentEngine) => {
      engine.attachTools({ open: () => ({ url: "http://127.0.0.1:1/mcp", token: "tok" }), close: () => {} });
      for await (const _ of engine.run({ task: task(), project: null, workdir: "/w", followUp: null, signal }));
    };
    // Without a check, and with one that fails, Codex never starts.
    await expect(runWith(new AgentEngine(funnel, () => "en"))).rejects.toThrow(/ChatGPT tasks can't start/);
    const failing = new AgentEngine(funnel, () => "it", {
      codexHook: async () => {
        throw new UserError("error.codexHookOff", { detail: "Codex says the hook is untrusted" });
      },
    });
    await expect(runWith(failing)).rejects.toMatchObject({ key: "error.codexHookOff" });
    expect(inputs).toHaveLength(0);
    // The check is given the task's folder, and a Claude task doesn't need it.
    const folders: string[] = [];
    const checked = new AgentEngine(funnel, () => "it", { codexHook: async (w) => void folders.push(w) });
    await runWith(checked);
    checked.attachTools({ open: () => ({ url: "http://127.0.0.1:1/mcp", token: "tok" }), close: () => {} });
    for await (const _ of checked.run({
      task: task({ provider: "claude" }),
      project: null,
      workdir: "/w",
      followUp: null,
      signal,
    }));
    expect(folders).toEqual(["/w"]);
    expect(inputs).toHaveLength(2);
  });

  it("puts a patch inside a command, a move onto a file and a file's Delete and Add through the same cards", async () => {
    const answers: unknown[] = [];
    const { work, decisions, seen, go } = await inFolder(async (engine, work) => {
      const gate = (tool: string, input: unknown) => engine.gate("t1", step(tool, input, work));
      // A whole file rewritten as Delete File and Add File is an overwrite, not a deletion.
      answers.push(
        await gate("apply_patch", { command: patch("*** Delete File: notes.txt", "*** Add File: notes.txt", "+new") }),
      );
      // A patch typed as a heredoc, which Codex applies itself, and one that deletes.
      answers.push(
        await gate("Bash", {
          command: `apply_patch <<'EOF'\n${patch("*** Update File: plan.md", "@@", "-a", "+b")}\nEOF`,
        }),
      );
      answers.push(
        await gate("Bash", { command: `cd sub && apply_patch <<'EOF'\n${patch("*** Delete File: old.md")}\nEOF` }),
      );
      // A patch's Add File replaces a file that's already there, and a move replaces the file it lands on.
      answers.push(await gate("apply_patch", { command: patch("*** Add File: budget.xlsx", "+x") }));
      answers.push(
        await gate("apply_patch", { command: patch("*** Update File: draft.md", "*** Move to: final.md", "@@", "+x") }),
      );
    });
    for (const name of ["notes.txt", "plan.md", "budget.xlsx", "draft.md", "final.md"])
      await writeFile(join(work, name), "x");
    await mkdir(join(work, "sub"));
    await writeFile(join(work, "sub", "old.md"), "x");
    decisions.push("allow", "refuse", "allow", "discard", "allow");
    await go();
    const asked = seen.flatMap((e) => (e.type === "approval" ? [e.approval] : []));
    expect(asked.map((a) => [a.action, a.paths])).toEqual([
      ["overwrite", [join(work, "notes.txt")]],
      ["overwrite", [join(work, "plan.md")]],
      ["delete", [join(work, "sub", "old.md")]],
      ["overwrite", [join(work, "budget.xlsx")]],
      ["overwrite", [join(work, "draft.md"), join(work, "final.md")]],
    ]);
    expect(answers).toEqual([
      { decision: "allow" },
      { decision: "deny", reason: expect.stringMatching(/Save your version under a new name/) },
      { decision: "deny", reason: expect.stringMatching(/moved the files to the Trash/) },
      { decision: "deny", reason: expect.stringMatching(/Don't save it/) },
      { decision: "allow" },
    ]);
  });

  it("refuses a file change outside the task's folder, however the patch names it", async () => {
    const answers: unknown[] = [];
    const elsewhere = await realpath(await mkdtemp(join(tmpdir(), "tw-hook-out-")));
    const { seen, go } = await inFolder(async (engine, work) => {
      const gate = (tool: string, input: unknown) => engine.gate("t1", step(tool, input, work));
      answers.push(await gate("apply_patch", { command: patch(`*** Add File: ${join(elsewhere, "x.txt")}`, "+x") }));
      answers.push(await gate("apply_patch", { command: patch("*** Add File: ../x.txt", "+x") }));
      answers.push(
        await gate("apply_patch", {
          command: patch("*** Update File: a.md", `*** Move to: ${elsewhere}/a.md`, "@@", "+x"),
        }),
      );
      answers.push(
        await gate("Bash", { command: `cd .. && apply_patch <<'EOF'\n${patch("*** Add File: x.txt", "+x")}\nEOF` }),
      );
      // Through a link inside the folder that points out of it.
      const { symlink } = await import("node:fs/promises");
      await symlink(elsewhere, join(work, "link"));
      answers.push(await gate("apply_patch", { command: patch("*** Add File: link/x.txt", "+x") }));
      answers.push(await gate("apply_patch", { command: patch("*** Add File: inside.txt", "+x") }));
    });
    await go();
    const outsideAnswer = { decision: "deny", reason: "Work only inside the task's folder." };
    expect(answers).toEqual([
      outsideAnswer,
      outsideAnswer,
      outsideAnswer,
      outsideAnswer,
      outsideAnswer,
      { decision: "allow" },
    ]);
    expect(seen.some((e) => e.type === "approval")).toBe(false);
  });

  it("refuses a patch to the AI's own settings in the task's folder", async () => {
    const answers: unknown[] = [];
    const { go } = await inFolder(async (engine, work) => {
      const gate = (tool: string, input: unknown) => engine.gate("t1", step(tool, input, work));
      answers.push(await gate("apply_patch", { command: patch("*** Add File: .claude/settings.local.json", "+{}") }));
      answers.push(await gate("apply_patch", { command: patch("*** Add File: .codex/config.toml", "+x") }));
      answers.push(
        await gate("apply_patch", {
          command: patch("*** Update File: servers.json", "*** Move to: .mcp.json", "@@", "+x"),
        }),
      );
      answers.push(await gate("apply_patch", { command: patch("*** Add File: notes.md", "+x") }));
    });
    await go();
    const refused = { decision: "deny", reason: expect.stringMatching(/AI's own settings/) };
    expect(answers).toEqual([refused, refused, refused, { decision: "allow" }]);
  });

  it("refuses shells to type into and steps it can't read, and lets through the ones that change nothing", async () => {
    const answers: unknown[] = [];
    const { go } = await inFolder(async (engine, work) => {
      const gate = (tool: string, input: unknown) => engine.gate("t1", step(tool, input, work));
      answers.push(await gate("Bash", { command: "bash" }));
      answers.push(await gate("Bash", { command: "python3" }));
      answers.push(await gate("Bash", { command: "python3 make_docx.py" }));
      answers.push(await gate("Bash", { command: "cat fix.patch | apply_patch" }));
      answers.push(await gate("mcp__tost_work__report_file", { path: join(work, "a.md"), kind: "add" }));
      answers.push(await gate("update_plan", { plan: [] }));
      answers.push(await engine.gate("t1", { tool_name: "Bash", tool_input: { command: "ls" } }));
    });
    await go();
    expect(answers).toEqual([
      { decision: "deny", reason: expect.stringMatching(/waiting for typed input.*by its path/) },
      { decision: "deny", reason: expect.stringMatching(/waiting for typed input.*by its path/) },
      { decision: "allow" },
      { decision: "deny", reason: expect.stringMatching(/couldn't read this patch/) },
      { decision: "allow" },
      { decision: "allow" },
      { decision: "deny", reason: "Tost Work couldn't read this step." },
    ]);
  });

  it("refuses a step once the run is over", async () => {
    const { engine, run } = setup(async () => ({ text: "" }));
    await run();
    expect(await engine.gate("t1", step("Bash", { command: "ls" }))).toEqual({
      decision: "deny",
      reason: "This task isn't running any more.",
    });
  });

  it("stops a Codex task when a command or a file change starts that its hook never allowed", async () => {
    for (const name of ["command", "file_change"]) {
      let aborted = false;
      const { engine, seen, run } = setup(async (input, emit) => {
        const allowed = step("Bash", { command: "ls" });
        await engine.gate("t1", allowed);
        const denied = step("Bash", { command: "rm x" });
        await engine.gate("t1", denied);
        // Steps the hook allowed, a subagent's among them, and steps no hook gates: web search, MCP calls, subagents.
        emit({ type: "tool.start", id: allowed.tool_use_id, name: "command", input: { command: "ls" } });
        const sub = step("apply_patch", { command: patch("*** Add File: a.md", "+a") });
        await engine.gate("t1", sub);
        emit({ type: "tool.start", id: sub.tool_use_id, parentId: "a1", name: "file_change", input: {} });
        emit({ type: "tool.start", id: "ws_1", name: "web_search", input: { query: "x" } });
        emit({ type: "tool.start", id: "m_1", name: "mcp:tost_work/ask_user", input: {} });
        emit({ type: "tool.start", id: "a1", name: "agent:spawnAgent", input: {} });
        emit({ type: "text.delta", text: "ok" });
        // A step the hook refused, or never saw, starts all the same: the hook isn't running.
        emit({ type: "tool.start", id: name === "command" ? denied.tool_use_id : "call_unseen", name, input: {} });
        await new Promise<void>((resolve) => input.signal?.addEventListener("abort", () => resolve()));
        aborted = true;
        return { text: "", finishReason: "cancelled" };
      });
      await run();
      expect(aborted, name).toBe(true);
      expect(seen.at(-1), name).toEqual({
        type: "failed",
        error: expect.stringMatching(/ChatGPT ha fatto un passaggio senza il controllo di Tost Work/),
      });
      // The steps before it went through as usual.
      expect(
        seen.some((e) => e.type === "text"),
        name,
      ).toBe(true);
    }
  });

  it("doesn't check Claude Code's steps against a hook it doesn't have", async () => {
    const { funnel } = fakeFunnel(async (_input, emit) => {
      emit({ type: "tool.start", id: "b1", name: "Bash", input: { command: "ls" } });
      emit({ type: "tool.start", id: "c1", name: "command", input: { command: "ls" } });
      return { text: "Done." };
    });
    const engine = new AgentEngine(funnel, () => "it");
    engine.attachTools({ open: () => ({ url: "http://127.0.0.1:1/mcp", token: "tok" }), close: () => {} });
    const seen: EngineEvent[] = [];
    const signal = new AbortController().signal;
    for await (const e of engine.run({
      task: task({ provider: "claude" }),
      project: null,
      workdir: "/w",
      followUp: null,
      signal,
    }))
      seen.push(e);
    expect(seen.at(-1)).toEqual({ type: "done" });
  });
});

describe("Commands that replace a file", () => {
  type Run = (command: string, cwd?: string) => Promise<unknown>;

  /**
   * A task in a real folder that holds note.txt, on Codex through its hook or on Claude Code through its approvals.
   * Each run plays `steps`, and the user answers each card with the next of `decisions`.
   */
  async function folder(provider: "codex" | "claude" = "codex") {
    const work = await realpath(await mkdtemp(join(tmpdir(), "tw-cmd-")));
    await writeFile(join(work, "note.txt"), "v1");
    const holder: { engine?: AgentEngine; steps: (run: Run) => Promise<unknown> } = { steps: async () => {} };
    const answers: unknown[] = [];
    const { funnel } = fakeFunnel(async (input) => {
      const run: Run = async (command, cwd = work) => {
        const answer =
          provider === "codex"
            ? await holder.engine?.gate("t1", step("Bash", { command }, cwd))
            : await input.onApproval?.({ id: command, tool: "Bash", input: { command } });
        answers.push(answer);
        return answer;
      };
      await holder.steps(run);
      return { text: "" };
    });
    const engine = new AgentEngine(funnel, () => "en", PASSES);
    holder.engine = engine;
    engine.attachTools({ open: () => ({ url: "http://127.0.0.1:1/mcp", token: "tok" }), close: () => {} });
    const decisions: Decision[] = [];
    const asked: string[][] = [];
    const go = async (
      steps: (run: Run) => Promise<unknown>,
      over: Partial<Task> = {},
      followUp: string | null = null,
    ) => {
      holder.steps = steps;
      answers.length = 0;
      const signal = new AbortController().signal;
      for await (const e of engine.run({
        task: task({ workdir: work, provider, ...over }),
        project: null,
        workdir: work,
        followUp,
        signal,
      }))
        if (e.type === "approval") {
          asked.push(e.approval.paths);
          engine.decide("t1", e.approval.id, decisions.shift() ?? "refuse");
        }
      return [...answers];
    };
    return { work, engine, decisions, asked, go, at: (name: string) => join(work, name) };
  }

  const allowed = { decision: "allow" };

  it("asks before a command replaces a file, and lets it run only when the user allows it", async () => {
    const { decisions, asked, go, at, work } = await folder();
    for (const name of ["a.txt", "b.txt"]) await writeFile(join(work, name), "x");
    decisions.push("allow", "refuse", "discard");
    const answers = await go(async (run) => {
      // The tester's command, as Codex's hook hands it over on Linux.
      await run(`/bin/bash -lc "printf 'v9' > note.txt"`);
      await run("printf x > a.txt");
      await run("echo x >> b.txt");
      // Allowed once, with its copy kept, the file doesn't ask again in this run.
      await run("printf v10 > note.txt");
    });
    expect(asked).toEqual([[at("note.txt")], [at("a.txt")], [at("b.txt")]]);
    expect(answers).toEqual([
      allowed,
      { decision: "deny", reason: expect.stringMatching(/Save your version under a new name/) },
      { decision: "deny", reason: expect.stringMatching(/Don't save it/) },
      allowed,
    ]);
  });

  it("doesn't ask for a new file, a file the task made, a file outside the folder or one a command only reads", async () => {
    const { asked, go, at, work } = await folder();
    await writeFile(join(work, "made.txt"), "a");
    const elsewhere = await realpath(await mkdtemp(join(tmpdir(), "tw-cmd-out-")));
    await writeFile(join(elsewhere, "out.txt"), "x");
    const answers = await go(
      async (run) => {
        await run("printf x > new.txt");
        // Made by this run's last command, so changing it again doesn't ask.
        await run("printf y >> new.txt");
        await run("sed -i 's/a/b/' made.txt");
        await run(`printf x > '${join(elsewhere, "out.txt")}'`);
        await run("cat note.txt > /dev/null 2>&1");
        await run("touch note.txt");
        await run("sort -o sorted.txt note.txt");
      },
      { own: [at("made.txt")] },
    );
    expect(asked).toEqual([]);
    expect(answers).toEqual(Array(7).fill(allowed));
  });

  it("asks once for all the files one command replaces", async () => {
    const { decisions, asked, go, at, work } = await folder();
    await mkdir(join(work, "docs"));
    for (const name of ["one.txt", "two.txt", "docs/one.txt"]) await writeFile(join(work, name), "x");
    decisions.push("allow", "allow");
    const answers = await go(async (run) => {
      await run("tee one.txt two.txt three.txt < note.txt");
      // A copy into a folder replaces the file of the same name there.
      await run("cp one.txt docs/");
    });
    expect(asked).toEqual([[at("one.txt"), at("two.txt")], [at("docs/one.txt")]]);
    expect(answers).toEqual([allowed, allowed]);
  });

  it("asks before OfficeCLI changes a document once per run, and never for reading one", async () => {
    const { decisions, asked, go, at, work } = await folder();
    await writeFile(join(work, "Contratto.docx"), "x");
    decisions.push("allow");
    const answers = await go(async (run) => {
      await run('officecli view "Contratto.docx" outline');
      await run('officecli set "Contratto.docx" / --find "Alberto Pedrini" --replace "Alberto Pedroni"');
      await run('officecli add "Contratto.docx" /body --type paragraph --prop text="Ciao"');
      await run("officecli validate Contratto.docx");
    });
    expect(asked).toEqual([[at("Contratto.docx")]]);
    expect(answers).toEqual(Array(4).fill(allowed));
  });

  it("doesn't ask a second time after the user allowed the AI's own request, and asks again in a later run", async () => {
    const { engine, decisions, asked, go, at } = await folder();
    // The AI asks first, as its instructions say, and ends its turn. The user allows it.
    decisions.push("allow");
    await go(() => engine.approve("t1", "overwrite", [at("note.txt")]));
    const card = asked.length;
    expect(card).toBe(1);
    // The next run makes the change without another card.
    expect(await go(async (run) => run("printf v2 > note.txt"), {}, "Go ahead")).toEqual([allowed]);
    expect(asked).toHaveLength(card);
    // A later message is a new run: the file now has a kept copy, so a command that changes it asks again, and the
    // copy kept then holds v2.
    decisions.push("allow");
    const kept = [{ path: at("note.txt"), copy: "/k/1", at: "", reason: "overwrite" as const }];
    const files = [{ path: at("note.txt"), kind: "update" as const, role: "made" as const }];
    expect(await go(async (run) => run("printf v3 > note.txt"), { kept, files }, "Change it to v3")).toEqual([allowed]);
    expect(asked.slice(card)).toEqual([[at("note.txt")]]);
  });

  it("asks again in a follow-up after the card allowed a command's overwrite", async () => {
    const { decisions, asked, go, at } = await folder();
    decisions.push("allow", "allow");
    await go(async (run) => run("printf v2 > note.txt"));
    const kept = [{ path: at("note.txt"), copy: "/k/1", at: "", reason: "overwrite" as const }];
    const files = [{ path: at("note.txt"), kind: "update" as const, role: "made" as const }];
    await go(async (run) => run("printf v3 > note.txt"), { kept, files }, "Change it to v3");
    expect(asked).toEqual([[at("note.txt")], [at("note.txt")]]);
  });

  it("takes relative paths from the folder Codex's hook names, and from a cd in the command", async () => {
    const { decisions, asked, go, at, work } = await folder();
    await mkdir(join(work, "sub"));
    await writeFile(join(work, "sub", "a.txt"), "x");
    await writeFile(join(work, "sub", "b.txt"), "x");
    decisions.push("allow", "allow");
    await go(async (run) => {
      await run("printf x > a.txt", join(work, "sub"));
      await run(`/bin/bash -lc "cd sub && printf x > b.txt"`);
    });
    expect(asked).toEqual([[at("sub/a.txt")], [at("sub/b.txt")]]);
  });

  it("resolves Claude Code's relative paths against the task's folder, plus the cd inside the same command", async () => {
    const { decisions, asked, go, at, work } = await folder("claude");
    await mkdir(join(work, "sub"));
    await writeFile(join(work, "sub", "a.txt"), "x");
    decisions.push("allow", "allow");
    const answers = await go(async (run) => {
      await run("printf 'v9' > note.txt");
      // Each of its commands starts in the task's folder (CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR), so an earlier cd
      // doesn't move where the next one writes: this makes a.txt at the top, and sub/a.txt stays as it is.
      await run("cd sub");
      await run("printf x > a.txt");
      // A cd inside the command does move it.
      await run("cd sub && printf x > a.txt");
    });
    expect(asked).toEqual([[at("note.txt")], [at("sub/a.txt")]]);
    expect(answers).toEqual(Array(4).fill("allow"));
  });
});
