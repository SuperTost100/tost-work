/** @vitest-environment node */
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApprovalRequest } from "cli-funnel";
import { describe, expect, it } from "vitest";
import type { Decision, Task } from "../../shared/model";
import { fileGuard } from "../guard";
import { Store } from "../store/store";
import { AgentEngine, type AgentFunnel } from "./agent";
import { TaskRunner } from "./runner";

const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 500 && !check(); i++) await new Promise((r) => setTimeout(r, 2));
  if (!check()) throw new Error("timed out");
};

/** What a run does in place of the CLI: Codex steps go through the engine's hook, Claude Code's through `approve`. */
type Steps = (ctx: { engine: AgentEngine; approve: (r: ApprovalRequest) => Promise<unknown> }) => Promise<unknown>;

/** A task on the real engine, runner and guard, in a folder that holds note.txt ("v1"). */
async function setup(provider: "codex" | "claude") {
  const work = await realpath(await mkdtemp(join(tmpdir(), "tw-listed-")));
  const keptDir = await mkdtemp(join(tmpdir(), "tw-listed-kept-"));
  const note = join(work, "note.txt");
  await writeFile(note, "v1");
  const holder: { engine?: AgentEngine; steps: Steps } = { steps: async () => {} };
  const funnel = {
    models: async () => [{ id: "m", efforts: [{ id: "medium" }], defaultEffort: "medium" }],
    stream: (input: { onApproval?: (r: ApprovalRequest) => Promise<unknown> }) => {
      const approve = async (r: ApprovalRequest) => {
        if (!input.onApproval) throw new Error("This run takes no approvals");
        return input.onApproval(r);
      };
      const result = holder.steps({ engine: holder.engine as AgentEngine, approve }).then(() => ({
        text: "",
        toolCalls: [],
        deniedActions: [],
        finishReason: "stop",
      }));
      // The CLI's own events don't matter here: the stream only ends with the run.
      return {
        result,
        [Symbol.asyncIterator]: () => ({
          next: async () => {
            await result;
            return { done: true as const, value: undefined };
          },
        }),
      };
    },
  } as unknown as AgentFunnel;
  const engine = new AgentEngine(funnel, () => "en", { codexHook: async () => {}, claudeFolder: async () => {} });
  holder.engine = engine;
  engine.attachTools({ open: () => ({ url: "http://127.0.0.1:1/mcp", token: "tok" }), close: () => {} });
  const store = new Store(":memory:");
  const runner = new TaskRunner(
    store,
    engine,
    () => {},
    undefined,
    fileGuard(keptDir, (path) => rm(path)),
  );
  const { id } = runner.create({ projectId: "p1", brief: "Change the note", workdir: work, provider });
  const get = () => store.getTask(id) as Task;

  /** Runs `steps` and answers the cards they raise with `decisions`, in order, through the runner as the window does. */
  const go = async (steps: Steps, decisions: Decision[], followUp: string | null = null) => {
    holder.steps = steps;
    const done = runner.start(id, followUp);
    for (const decision of decisions) {
      await waitFor(() => get().approval != null);
      await runner.decide(id, decision);
    }
    return done;
  };

  /** A shell command that writes v9 into note.txt once the policy lets it run, as each CLI sends it. */
  const printf: Steps = async ({ engine, approve }) => {
    const cmd = "printf 'v9' > note.txt";
    const answer =
      provider === "codex"
        ? await engine.gate(id, hook("Bash", { command: cmd }, work))
        : await approve({ id: "c1", tool: "Bash", input: { command: cmd } });
    const allowed = answer === "allow" || (answer as { decision?: string }).decision === "allow";
    if (allowed) await writeFile(note, "v9");
    return answer;
  };
  return { id, work, note, runner, get, go, holder, printf };
}

/** Codex's PreToolUse hook input for one step. */
const hook = (tool: string, input: unknown, cwd: string) => ({
  session_id: "s1",
  turn_id: "u1",
  cwd,
  hook_event_name: "PreToolUse",
  model: "m",
  permission_mode: "bypassPermissions",
  tool_name: tool,
  tool_input: input,
  tool_use_id: `call_${Math.random()}`,
});

const CHANGED = { kind: "update", role: "made" } as const;
const listing = (t: Task, path: string) => t.files.find((f) => f.path === path);

describe("a file replaced with the user's permission", () => {
  for (const provider of ["codex", "claude"] as const) {
    it(`is listed as changed after a ${provider} command, though the AI never reports it`, async () => {
      const { id, note, runner, get, go, printf } = await setup(provider);
      await go(printf, ["allow"]);
      expect(await readFile(note, "utf8")).toBe("v9");
      expect(listing(get(), note)).toEqual({ path: note, ...CHANGED });
      expect(get().kept?.map((k) => k.reason)).toEqual(["overwrite"]);
      await runner.restore(id, note);
      expect(await readFile(note, "utf8")).toBe("v1");
    });
  }

  it("stays listed as changed when the AI then reports it as a new file", async () => {
    const { id, note, get, go, printf } = await setup("claude");
    await go(
      async (ctx) => {
        await printf(ctx);
        await ctx.engine.reportFile(id, { path: note, kind: "add" });
      },
      ["allow"],
    );
    expect(listing(get(), note)).toEqual({ path: note, ...CHANGED });
  });

  for (const decision of ["refuse", "discard"] as const) {
    it(`isn't listed when the user chose "${decision}", since nothing was replaced`, async () => {
      const { note, get, go, printf } = await setup("claude");
      await go(printf, [decision]);
      expect(await readFile(note, "utf8")).toBe("v1");
      expect(listing(get(), note)).toBeUndefined();
      expect(get().kept ?? []).toEqual([]);
    });
  }

  it("is listed as changed after a Codex patch, even one that says Add File", async () => {
    const { id, note, work, get, go } = await setup("codex");
    const answers: unknown[] = [];
    await go(
      async ({ engine }) => {
        const add = `*** Begin Patch\n*** Add File: ${note}\n+v9\n*** End Patch`;
        answers.push(await engine.gate(id, hook("apply_patch", { command: add }, work)));
      },
      ["allow"],
    );
    expect(answers).toEqual([{ decision: "allow" }]);
    expect(listing(get(), note)).toEqual({ path: note, ...CHANGED });
  });

  it("is listed as changed after Claude's Write and Edit", async () => {
    for (const tool of ["Write", "Edit"]) {
      const { note, get, go } = await setup("claude");
      const answers: unknown[] = [];
      await go(
        async ({ approve }) => {
          answers.push(await approve({ id: "w1", tool, input: { file_path: "note.txt", content: "v9" } }));
        },
        ["allow"],
      );
      expect(answers).toEqual(["allow"]);
      expect(listing(get(), note)).toEqual({ path: note, ...CHANGED });
    }
  });

  it("is listed as changed as soon as the user allows the AI's own request_approval", async () => {
    const { id, note, runner, get, go, holder } = await setup("codex");
    // The AI asks and ends its turn: the card stays on the task.
    await go(({ engine }) => engine.approve(id, "overwrite", [note]), []);
    expect(get().approval?.paths).toEqual([note]);
    // The decision starts the next run, which makes the change and reports the file as new.
    holder.steps = async ({ engine }) => {
      await writeFile(note, "v9");
      await engine.reportFile(id, { path: note, kind: "add" });
    };
    const decided = await runner.decide(id, "allow");
    expect(listing(decided, note)).toEqual({ path: note, ...CHANGED });
    await waitFor(() => get().status === "done");
    expect(listing(get(), note)).toEqual({ path: note, ...CHANGED });
    await runner.restore(id, note);
    expect(await readFile(note, "utf8")).toBe("v1");
  });

  it("stays listed with every copy after a restore and a later change", async () => {
    const { id, note, runner, get, go, printf } = await setup("claude");
    await go(printf, ["allow"]);
    await runner.restore(id, note);
    runner.followUp(id, "Change it again");
    await go(printf, ["allow"], "Change it again");
    expect(await readFile(note, "utf8")).toBe("v9");
    expect(listing(get(), note)).toEqual({ path: note, ...CHANGED });
    expect(get().kept?.map((k) => k.reason)).toEqual(["overwrite", "restore", "overwrite"]);
  });
});
