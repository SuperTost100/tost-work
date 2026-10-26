/** @vitest-environment node */
import type { FunnelEvent, RunRequest } from "cli-funnel";
import { describe, expect, it } from "vitest";
import type { EngineEvent, Task } from "../../shared/model";
import { CodexEngine, type CodexFunnel, deletesFiles } from "./codex";

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

/** An engine whose runs nobody answers: the test decides by hand, after the run has ended. */
function bare(script: Script) {
  const { funnel } = fakeFunnel(script);
  const engine = new CodexEngine(funnel, () => "it");
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
    expect(input?.mcpServers?.tost_work).toMatchObject({ type: "http", autoApprove: true });
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

  it("continues the same conversation on a follow-up", async () => {
    const { inputs, run } = setup(async () => ({ text: "ok" }));
    await run(task({ sessionId: "s1" }), "Make it shorter");
    expect(inputs[0]).toMatchObject({ prompt: "Make it shorter", sessionId: "s1" });
  });

  it("puts ask_user's question on the task and tells the agent to end its turn", async () => {
    const holder: { engine?: CodexEngine } = {};
    let reply = "";
    const { engine, seen, run } = setup(async () => {
      reply = (await holder.engine?.ask("t1", { text: "Who pays?", options: ["Us", "Them"] })) ?? "";
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
    const holder: { engine?: CodexEngine } = {};
    const { engine, seen, controller, run } = setup(async () => {
      controller.abort();
      const reply = await holder.engine
        ?.ask("t1", { text: "Late?", options: ["a", "b"] })
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
    const holder: { engine?: CodexEngine } = {};
    const { engine, seen, run } = setup(async () => {
      await holder.engine?.ask("t1", { text: "Which template?", options: ["A", "B"] });
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
    expect(await engine.defaults()).toEqual({ model: "gpt-6-sol", effort: "medium" });
  });
});

describe("deletesFiles", () => {
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
