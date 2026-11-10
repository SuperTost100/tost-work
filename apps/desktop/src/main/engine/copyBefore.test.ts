/** @vitest-environment node */
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, realpath, rename, rm, stat, truncate, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApprovalRequest } from "cli-funnel";
import { describe, expect, it } from "vitest";
import type { Decision, Task } from "../../shared/model";
import { fileGuard } from "../guard";
import { Store } from "../store/store";
import { AgentEngine, type AgentFunnel, COPY_MAX } from "./agent";
import { TaskRunner } from "./runner";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One command as each CLI sends it, and what it does once allowed. Returns whether the policy let it run. */
type Run = (command: string, effect?: () => Promise<unknown>, tool?: "Bash" | "PowerShell") => Promise<boolean>;
type Steps = (ctx: { engine: AgentEngine; run: Run }) => Promise<unknown>;

/** Codex's PreToolUse hook input for one step. */
const hook = (id: string, tool: string, input: unknown, cwd: string) => ({
  session_id: "s1",
  turn_id: "u1",
  cwd,
  hook_event_name: "PreToolUse",
  model: "m",
  permission_mode: "bypassPermissions",
  tool_name: tool,
  tool_input: input,
  tool_use_id: id,
});

const allowed = (answer: unknown) =>
  answer === "allow" || (answer as { decision?: string } | undefined)?.decision === "allow";

/**
 * A task on the real engine, runner and guard, in a folder that holds the user's note.txt ("v1") and Listino.txt.
 * Each command goes through the policy as its CLI sends it, and its end comes as the CLI's tool.end event.
 */
async function setup(provider: "codex" | "claude") {
  const work = await realpath(await mkdtemp(join(tmpdir(), "tw-copy-")));
  const keptDir = await mkdtemp(join(tmpdir(), "tw-copy-kept-"));
  const note = join(work, "note.txt");
  await writeFile(note, "v1");
  await writeFile(join(work, "Listino.txt"), "prezzi");
  const holder: { engine?: AgentEngine; steps: Steps } = { steps: async () => {} };
  /** The instructions each run started with. */
  const systems: string[] = [];
  const funnel = {
    models: async () => [{ id: "m", efforts: [{ id: "medium" }], defaultEffort: "medium" }],
    stream: (input: { system: string; onApproval?: (r: ApprovalRequest) => Promise<unknown> }) => {
      systems.push(input.system);
      const engine = holder.engine as AgentEngine;
      const events: unknown[] = [];
      let wake: (() => void) | null = null;
      let ended = false;
      const emit = (event: unknown) => {
        events.push(event);
        wake?.();
      };
      const run: Run = async (command, effect, tool = "Bash") => {
        const id = `call_${randomUUID()}`;
        let answer: unknown;
        if (provider === "codex") answer = await engine.gate(taskId, hook(id, tool, { command }, work));
        else if (input.onApproval) answer = await input.onApproval({ id, tool, input: { command } });
        else throw new Error("This run takes no approvals");
        if (allowed(answer)) await effect?.();
        emit({ type: "tool.end", id, ...(allowed(answer) ? { output: "" } : { error: "denied" }) });
        return allowed(answer);
      };
      const result = holder.steps({ engine, run }).then(() => {
        ended = true;
        wake?.();
        return { text: "", toolCalls: [], deniedActions: [], finishReason: "stop" };
      });
      async function* iterate() {
        while (true) {
          const event = events.shift();
          if (event) {
            yield event;
            continue;
          }
          if (ended) return;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = null;
        }
      }
      return Object.assign(iterate(), { result });
    },
  } as unknown as AgentFunnel;
  const guard = fileGuard(keptDir, (path) => rm(path));
  const engine = new AgentEngine(funnel, () => "en", {
    codexHook: async () => {},
    claudeFolder: async () => {},
    copies: guard,
  });
  holder.engine = engine;
  engine.attachTools({ open: () => ({ url: "http://127.0.0.1:1/mcp", token: "tok" }), close: () => {} });
  const store = new Store(":memory:");
  const runner = new TaskRunner(store, engine, () => {}, undefined, guard);
  const { id: taskId } = runner.create({ projectId: "p1", brief: "Prepara il preventivo", workdir: work, provider });
  const get = () => store.getTask(taskId) as Task;

  /** Resolves once the run that answering a question started has ended. */
  const answered = async () => {
    while (runner.isRunning(taskId)) await sleep(2);
  };
  /**
   * Runs `steps` once, as the first run or a follow-up, and answers every card a step waits on with the next of
   * `decisions`, or "refuse". When the last run ended on a question, `followUp` is the answer to it. Returns the files
   * each card asked about.
   */
  const go = async (steps: Steps, decisions: Decision[] = [], followUp: string | null = null) => {
    holder.steps = steps;
    const answer = get().question ? followUp : null;
    if (answer !== null) runner.answer(taskId, [answer]);
    else if (followUp !== null) runner.followUp(taskId, followUp);
    const cards: string[][] = [];
    let finished = false;
    const done = (answer !== null ? answered() : runner.start(taskId, followUp)).finally(() => {
      finished = true;
    });
    let seen = "";
    while (!finished) {
      const card = get().approval;
      if (card && card.id !== seen && runner.isRunning(taskId)) {
        seen = card.id;
        cards.push(card.paths);
        await runner.decide(taskId, decisions.shift() ?? "refuse");
      }
      await sleep(2);
    }
    await done;
    return cards;
  };
  /** The copies in the kept folder for this task. */
  const keptFiles = async () => readdir(join(keptDir, taskId)).catch(() => []);
  return { taskId, work, note, keptDir, runner, get, go, keptFiles, systems };
}

const listed = (t: Task, path: string) => t.files.find((f) => f.path === path);
/** Ends a run on a question, so the files it made stay the task's own in the run that follows the answer. */
const askWhich = (engine: AgentEngine, id: string) =>
  engine.ask(id, [{ text: "Per chi è?", options: ["Rossi", "Bianchi"] }]);
const CHANGED = { kind: "update", role: "made" } as const;

/** The user opens a file, edits it and saves: new text, and a modification time that is only ever different. */
async function userSaves(path: string, text: string) {
  const before = await stat(path);
  await writeFile(path, text);
  await utimes(path, new Date(), new Date(before.mtimeMs + 60_000));
}

/** The tester's command on Linux: Python, given its code in a heredoc, rewrites the first line of the file. */
const PYTHON_FIRST_LINE = (path: string) =>
  `/bin/bash -lc "python3 - <<'PY'\nfrom pathlib import Path\np = Path('${path}')\nlines = p.read_text().splitlines()\nlines[0] = 'Preventivo per Rossi'\np.write_bytes(('\\n'.join(lines) + '\\n').encode())\nPY"`;

/** The tester's command on Windows, with a forward slash, which Linux reads as a folder too. */
const POWERSHELL_FIRST_LINE = [
  "$p = './Preventivo.txt'",
  "$lines = Get-Content -LiteralPath $p",
  "$lines[0] = 'Preventivo per Rossi'",
  "Set-Content -LiteralPath $p -Value $lines -Encoding UTF8",
].join("\n");

for (const provider of ["codex", "claude"] as const) {
  describe(`a user's file a command names, on ${provider}`, () => {
    /**
     * Tost's first run makes Preventivo.txt, and ends on a question when `asks`; the tester then rewrites the file
     * from outside the app, as an editor would.
     */
    const testerCase = async (ctx: Awaited<ReturnType<typeof setup>>, asks = false) => {
      const quote = join(ctx.work, "Preventivo.txt");
      await ctx.go(async ({ engine, run }) => {
        await run(`printf 'Preventivo\\nRiga due\\n' > Preventivo.txt`, () =>
          writeFile(quote, "Preventivo\nRiga due\n"),
        );
        await engine.reportFile(ctx.taskId, { path: quote, kind: "add" });
        if (asks) await askWhich(engine, ctx.taskId);
      });
      expect(ctx.get().own).toEqual([quote]);
      expect(listed(ctx.get(), quote)).toEqual({ path: quote, kind: "add", role: "made" });
      await userSaves(quote, "Testo del tester\nRiga due\n");
      return quote;
    };

    it("keeps a copy before the tester's Python command, lists the file as changed, and Restore brings it back", async () => {
      const ctx = await setup(provider);
      const quote = await testerCase(ctx);
      const cards = await ctx.go(
        async ({ run }) => {
          await run(PYTHON_FIRST_LINE(quote), () => writeFile(quote, "Preventivo per Rossi\nRiga due\n"));
        },
        [],
        "Change the first line of Preventivo.txt to: Preventivo per Rossi.",
      );
      expect(cards).toEqual([]);
      const task = ctx.get();
      expect(task.own).toEqual([]);
      expect(listed(task, quote)).toEqual({ path: quote, ...CHANGED });
      expect(task.kept?.map((k) => k.path)).toEqual([quote]);
      expect(await ctx.keptFiles()).toHaveLength(1);
      await ctx.runner.restore(ctx.taskId, quote);
      expect(await readFile(quote, "utf8")).toBe("Testo del tester\nRiga due\n");
    });

    it("asks with the card before the tester's PowerShell command, which holds the path in a variable", async () => {
      const ctx = await setup(provider);
      const quote = await testerCase(ctx);
      const cards = await ctx.go(
        async ({ run }) => {
          await run(
            POWERSHELL_FIRST_LINE,
            () => writeFile(quote, "Preventivo per Rossi\nRiga due\n"),
            provider === "claude" ? "PowerShell" : "Bash",
          );
        },
        ["allow"],
        "Change the first line of Preventivo.txt to: Preventivo per Rossi.",
      );
      expect(cards).toEqual([[quote]]);
      expect(listed(ctx.get(), quote)).toEqual({ path: quote, ...CHANGED });
      // The card's copy, and no second one kept silently.
      expect(await ctx.keptFiles()).toHaveLength(1);
      await ctx.runner.restore(ctx.taskId, quote);
      expect(await readFile(quote, "utf8")).toBe("Testo del tester\nRiga due\n");
    });

    it("tells the AI in the next run that the files the user saved since are theirs again", async () => {
      const ctx = await setup(provider);
      const quote = await testerCase(ctx, true);
      await ctx.go(async () => {}, [], "Rossi");
      expect(ctx.systems[0]).not.toContain("The user changed these files");
      expect(ctx.systems[1]).toContain(`The user changed these files after your last turn.`);
      expect(ctx.systems[1]).toContain(`- ${quote}`);
    });

    it("tells the AI in the next run that the files of a finished request are the user's now", async () => {
      const ctx = await setup(provider);
      const quote = join(ctx.work, "Preventivo.txt");
      await ctx.go(async ({ engine, run }) => {
        await run(`printf uno > Preventivo.txt`, () => writeFile(quote, "uno"));
        await engine.reportFile(ctx.taskId, { path: quote, kind: "add" });
      });
      await ctx.go(async () => {}, [], "Ancora una cosa");
      expect(ctx.systems[0]).not.toContain("You made these files for a request you finished");
      expect(ctx.systems[1]).toContain("You made these files for a request you finished in an earlier turn");
      expect(ctx.systems[1]).toContain(`- ${quote}`);
      expect(ctx.systems[1]).not.toContain("The user changed these files");
    });

    it("keeps a copy before a command it can't read changes a file a finished run made, and Restore brings it back", async () => {
      const ctx = await setup(provider);
      const quote = join(ctx.work, "Preventivo.txt");
      await ctx.go(async ({ engine, run }) => {
        await run(`printf 'Preventivo\\nRiga due\\n' > Preventivo.txt`, () =>
          writeFile(quote, "Preventivo\nRiga due\n"),
        );
        await engine.reportFile(ctx.taskId, { path: quote, kind: "add" });
      });
      expect(ctx.get().status).toBe("done");
      const cards = await ctx.go(
        async ({ run }) => {
          await run(PYTHON_FIRST_LINE(quote), () => writeFile(quote, "Preventivo per Rossi\nRiga due\n"));
        },
        [],
        "Change the first line of Preventivo.txt to: Preventivo per Rossi.",
      );
      expect(cards).toEqual([]);
      expect(listed(ctx.get(), quote)).toEqual({ path: quote, ...CHANGED });
      expect(ctx.get().kept?.map((k) => k.path)).toEqual([quote]);
      await ctx.runner.restore(ctx.taskId, quote);
      expect(await readFile(quote, "utf8")).toBe("Preventivo\nRiga due\n");
    });

    it("lists a file the task made, that the user saved since, as changed when an unseen change hits it", async () => {
      const ctx = await setup(provider);
      const quote = await testerCase(ctx);
      await ctx.go(
        async ({ run }) => {
          await run("python3 rewrite_all.py", () => writeFile(quote, "riscritto"));
        },
        [],
        "Riscrivi tutto",
      );
      expect(listed(ctx.get(), quote)).toEqual({ path: quote, ...CHANGED });
      expect(ctx.get().unkept).toEqual([quote]);
    });

    it("leaves no copy and lists nothing when the command only reads the file", async () => {
      const ctx = await setup(provider);
      const answers: boolean[] = [];
      const cards = await ctx.go(async ({ run }) => {
        answers.push(await run("cat note.txt"));
        answers.push(await run(`/bin/zsh -lc "grep -n v1 'note.txt' | head -5"`));
      });
      expect([cards, answers]).toEqual([[], [true, true]]);
      expect(await ctx.keptFiles()).toEqual([]);
      expect(ctx.get().files).toEqual([]);
    });

    it("keeps a copy before a script in the folder that names the file runs, and lists it as changed", async () => {
      const ctx = await setup(provider);
      const script = join(ctx.work, "fix.py");
      const cards = await ctx.go(async ({ run }) => {
        await run(`printf "open('note.txt', 'w').write('v2')" > fix.py`, () =>
          writeFile(script, "open('note.txt', 'w').write('v2')"),
        );
        await run("python3 fix.py", () => writeFile(ctx.note, "v2"));
      });
      expect(cards).toEqual([]);
      expect(listed(ctx.get(), ctx.note)).toEqual({ path: ctx.note, ...CHANGED });
      const copy = ctx.get().kept?.find((k) => k.path === ctx.note)?.copy as string;
      expect(await readFile(copy, "utf8")).toBe("v1");
      // The script is the task's own: no copy of it.
      expect(ctx.get().kept?.map((k) => k.path)).toEqual([ctx.note]);
    });

    it("keeps a copy before a command writes to a path the policy can't resolve, such as one in a variable", async () => {
      const ctx = await setup(provider);
      const answers: boolean[] = [];
      const cards = await ctx.go(async ({ run }) => {
        answers.push(await run(`out=$(printf note.txt); echo v2 > "$out"`, () => writeFile(ctx.note, "v2")));
      });
      expect([cards, answers]).toEqual([[], [true]]);
      expect(listed(ctx.get(), ctx.note)).toEqual({ path: ctx.note, ...CHANGED });
      expect(ctx.get().kept?.map((k) => k.path)).toEqual([ctx.note]);
      await ctx.runner.restore(ctx.taskId, ctx.note);
      expect(await readFile(ctx.note, "utf8")).toBe("v1");
    });

    it("asks with the card about a file too big to copy", async () => {
      const ctx = await setup(provider);
      const video = join(ctx.work, "Presentazione.mp4");
      await writeFile(video, "");
      await truncate(video, COPY_MAX + 1);
      const answers: boolean[] = [];
      const cards = await ctx.go(async ({ run }) => {
        answers.push(await run(`python3 -c "open('Presentazione.mp4', 'r+b').write(b'x')"`));
      });
      expect(cards).toEqual([[video]]);
      expect(answers).toEqual([false]);
      expect(await ctx.keptFiles()).toEqual([]);
    });

    it("lists a change no command named at the end of the run, without an earlier version", async () => {
      const ctx = await setup(provider);
      const cards = await ctx.go(async ({ run }) => {
        await run(`python3 -c "import os\nfor f in os.listdir('.'):\n    open(f, 'a').write('!')"`, async () => {
          await writeFile(ctx.note, "v1!");
          await writeFile(join(ctx.work, "Listino.txt"), "prezzi!");
        });
      });
      expect(cards).toEqual([]);
      expect(await ctx.keptFiles()).toEqual([]);
      expect(ctx.get().kept ?? []).toEqual([]);
      const listino = join(ctx.work, "Listino.txt");
      expect(listed(ctx.get(), ctx.note)).toEqual({ path: ctx.note, ...CHANGED });
      expect(listed(ctx.get(), listino)).toEqual({ path: listino, ...CHANGED });
      expect(ctx.get().unkept?.sort()).toEqual([listino, ctx.note].sort());
    });

    it("lists a user's file that went as deleted: with its copy when a command named it, without one when not", async () => {
      const ctx = await setup(provider);
      const listino = join(ctx.work, "Listino.txt");
      await ctx.go(async ({ run }) => {
        await run("mv note.txt archivio.txt", () => rename(ctx.note, join(ctx.work, "archivio.txt")));
        await run("python3 tidy.py", () => rm(listino));
      });
      expect(listed(ctx.get(), ctx.note)).toEqual({ path: ctx.note, kind: "delete", role: "made" });
      expect(listed(ctx.get(), listino)).toEqual({ path: listino, kind: "delete", role: "made" });
      expect(ctx.get().unkept).toEqual([listino]);
      await ctx.runner.restore(ctx.taskId, ctx.note);
      expect(await readFile(ctx.note, "utf8")).toBe("v1");
    });

    it("removes the copy when the file didn't change, and makes one copy for two commands that name the file", async () => {
      const ctx = await setup(provider);
      let during: string[] = [];
      await ctx.go(async ({ run }) => {
        await run(`python3 -c "print(open('note.txt').read())"`);
        await run(`python3 -c "print(len(open('note.txt').read()))"`);
        during = await ctx.keptFiles();
      });
      expect(during).toHaveLength(1);
      expect(await ctx.keptFiles()).toEqual([]);
      expect(ctx.get().files).toEqual([]);
      expect(ctx.get().kept ?? []).toEqual([]);

      await ctx.go(
        async ({ run }) => {
          await run(`python3 -c "print(open('note.txt').read())"`);
          await run(`python3 -c "open('note.txt', 'w').write('v2')"`, () => writeFile(ctx.note, "v2"));
          await run(`python3 -c "open('note.txt', 'w').write('v3')"`, () => writeFile(ctx.note, "v3"));
        },
        [],
        "Cambia la nota",
      );
      expect(await ctx.keptFiles()).toHaveLength(1);
      expect(ctx.get().kept?.map((k) => k.path)).toEqual([ctx.note]);
      expect(listed(ctx.get(), ctx.note)).toEqual({ path: ctx.note, ...CHANGED });
      await ctx.runner.restore(ctx.taskId, ctx.note);
      expect(await readFile(ctx.note, "utf8")).toBe("v1");
    });

    it("still asks with the card about a write it can read, and keeps nothing when the user refuses it", async () => {
      for (const decision of ["refuse", "discard"] as const) {
        const ctx = await setup(provider);
        const answers: boolean[] = [];
        const cards = await ctx.go(
          async ({ run }) => {
            answers.push(
              await run(`printf v9 > note.txt; python3 -c "print(open('Listino.txt').read())"`, () =>
                writeFile(ctx.note, "v9"),
              ),
            );
          },
          [decision],
        );
        expect(cards).toEqual([[ctx.note]]);
        expect(answers).toEqual([false]);
        expect(await readFile(ctx.note, "utf8")).toBe("v1");
        // The copy of Listino.txt, made for a command that didn't run, is gone.
        expect(await ctx.keptFiles()).toEqual([]);
        expect(ctx.get().files).toEqual([]);
      }
    });

    it("never copies a file the task made itself, in its run or after a question", async () => {
      const ctx = await setup(provider);
      const draft = join(ctx.work, "Bozza.txt");
      await ctx.go(async ({ engine, run }) => {
        await run(`python3 -c "open('Bozza.txt', 'w').write('uno')"`, () => writeFile(draft, "uno"));
        await run(`python3 -c "open('Bozza.txt', 'w').write('due')"`, () => writeFile(draft, "due"));
        await askWhich(engine, ctx.taskId);
      });
      await ctx.go(
        async ({ run }) => {
          await run(`python3 -c "open('Bozza.txt', 'w').write('tre')"`, () => writeFile(draft, "tre"));
        },
        [],
        "Rossi",
      );
      expect(await ctx.keptFiles()).toEqual([]);
      expect(ctx.get().own).toEqual([draft]);
    });
  });
}
