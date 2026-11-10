/** @vitest-environment node */
import { mkdir, mkdtemp, readFile, realpath, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApprovalRequest } from "cli-funnel";
import { describe, expect, it } from "vitest";
import type { Decision, Task } from "../../shared/model";
import { fileGuard } from "../guard";
import { Store } from "../store/store";
import { AgentEngine, type AgentFunnel, sameStamp } from "./agent";
import { TaskRunner } from "./runner";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What a run does in place of the CLI. `ask` runs a command or a file change through the policy, as each CLI does. */
type Steps = (ctx: {
  engine: AgentEngine;
  ask: (step: { command: string } | { tool: "Write" | "Edit"; path: string } | { patch: string }) => Promise<boolean>;
}) => Promise<unknown>;

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

/**
 * A task on the real engine, runner and guard, in a folder laid out like Tost's: a template, an older quote, and
 * note.txt, all there before the task.
 */
async function setup(provider: "codex" | "claude") {
  const work = await realpath(await mkdtemp(join(tmpdir(), "tw-own-")));
  const keptDir = await mkdtemp(join(tmpdir(), "tw-own-kept-"));
  const client = join(work, "Clienti", "Ferrari & Figli");
  await mkdir(client, { recursive: true });
  await mkdir(join(work, "Modelli"));
  await writeFile(join(work, "Modelli", "Modello preventivo.docx"), "template");
  await writeFile(join(client, "Preventivo 2026-07-02 Ferrari & Figli.docx"), "july");
  const note = join(work, "note.txt");
  await writeFile(note, "v1");
  const quote = join(client, "Preventivo 2026-11-10 Ferrari & Figli.docx");
  const holder: { engine?: AgentEngine; steps: Steps } = { steps: async () => {} };
  const funnel = {
    models: async () => [{ id: "m", efforts: [{ id: "medium" }], defaultEffort: "medium" }],
    stream: (input: { onApproval?: (r: ApprovalRequest) => Promise<unknown> }) => {
      const engine = holder.engine as AgentEngine;
      const allowed = (answer: unknown) =>
        answer === "allow" || (answer as { decision?: string } | undefined)?.decision === "allow";
      const ask: Parameters<Steps>[0]["ask"] = async (step) => {
        if (provider === "codex") {
          if ("command" in step) return allowed(await engine.gate(id, hook("Bash", { command: step.command }, work)));
          if ("patch" in step)
            return allowed(await engine.gate(id, hook("apply_patch", { command: step.patch }, work)));
          throw new Error("Codex changes files with patches");
        }
        if (!input.onApproval) throw new Error("This run takes no approvals");
        if ("command" in step)
          return allowed(await input.onApproval({ id: "c", tool: "Bash", input: { command: step.command } }));
        if ("tool" in step)
          return allowed(await input.onApproval({ id: "w", tool: step.tool, input: { file_path: step.path } }));
        throw new Error("Claude Code changes files with Write and Edit");
      };
      const result = holder.steps({ engine, ask }).then(() => ({
        text: "",
        toolCalls: [],
        deniedActions: [],
        finishReason: "stop",
      }));
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
  const { id } = runner.create({ projectId: "p1", brief: "Prepara il preventivo", workdir: work, provider });
  const get = () => store.getTask(id) as Task;

  /** Resolves once the run that answering a question started has ended. */
  const answered = async () => {
    while (runner.isRunning(id)) await sleep(2);
  };
  /**
   * Runs `steps` once, as the task's first run or a follow-up, and answers every card a step waits on with the next
   * of `decisions`, or "refuse". When the last run ended on a question, `followUp` is the answer to it. Returns the
   * files each card asked about, including a card left on the task.
   */
  const go = async (steps: Steps, decisions: Decision[] = [], followUp: string | null = null) => {
    holder.steps = steps;
    const answer = get().question ? followUp : null;
    if (answer !== null) runner.answer(id, [answer]);
    else if (followUp !== null) runner.followUp(id, followUp);
    const cards: string[][] = [];
    let finished = false;
    const done = (answer !== null ? answered() : runner.start(id, followUp)).finally(() => {
      finished = true;
    });
    let seen = "";
    while (!finished) {
      const card = get().approval;
      if (card && card.id !== seen) {
        seen = card.id;
        cards.push(card.paths);
        // Only a card a step is waiting on is decided here: one the agent left with its turn stays on the task.
        if (runner.isRunning(id)) {
          holder.steps = async () => {};
          await runner.decide(id, decisions.shift() ?? "refuse");
        }
      }
      await sleep(2);
    }
    await done;
    const left = get().approval;
    if (left && left.id !== seen) cards.push(left.paths);
    return cards;
  };
  return { id, work, note, quote, get, go, store, runner };
}

const listed = (t: Task, path: string) => t.files.find((f) => f.path === path);
/** Ends a run on a question, so the files it made stay the task's own in the run that follows the answer. */
const askWhich = (engine: AgentEngine, id: string) =>
  engine.ask(id, [{ text: "Quale data?", options: ["Venerdì", "Lunedì"] }]);
const MADE = { kind: "add", role: "made" } as const;

/** Tost's first run: a script copies the template into a new quote, and officecli then edits that quote. */
const PYTHON = (quote: string) =>
  `/bin/zsh -lc "python3 - <<'PY'\nimport shutil\nshutil.copyfile('Modelli/Modello preventivo.docx', '${quote}')\nPY"`;
const OFFICECLI = (quote: string) =>
  `/bin/zsh -lc "officecli set '${quote}' / --find '10 novembre 2026' --replace '11 novembre 2026'"`;
const REL = "Clienti/Ferrari & Figli/Preventivo 2026-11-10 Ferrari & Figli.docx";

for (const provider of ["codex", "claude"] as const) {
  describe(`a file the task made, on ${provider}`, () => {
    it("is changed without a card when a script made it, and stays listed as made with no earlier version", async () => {
      const { id, quote, get, go } = await setup(provider);
      const answers: boolean[] = [];
      const cards = await go(async ({ engine, ask }) => {
        answers.push(await ask({ command: PYTHON(REL) }));
        await writeFile(quote, "Torino, 10 novembre 2026");
        answers.push(await ask({ command: OFFICECLI(REL) }));
        await writeFile(quote, "Torino, 11 novembre 2026");
        await engine.reportFile(id, { path: quote, kind: "add" });
      });
      expect(cards).toEqual([]);
      expect(answers).toEqual([true, true]);
      expect(await readFile(quote, "utf8")).toBe("Torino, 11 novembre 2026");
      expect(listed(get(), quote)).toEqual({ path: quote, ...MADE });
      expect(get().kept ?? []).toEqual([]);
      expect(get().own).toEqual([quote]);
    });

    it("needs no card when the AI asks with request_approval, in the run that made it and after a question", async () => {
      const { id, quote, get, go } = await setup(provider);
      const heard: string[] = [];
      const cards = await go(async ({ engine, ask }) => {
        await ask({ command: PYTHON(REL) });
        await writeFile(quote, "Torino, 10 novembre 2026");
        heard.push(await engine.approve(id, "overwrite", [quote]));
        await askWhich(engine, id);
      });
      const later = await go(
        async ({ engine }) => {
          heard.push(await engine.approve(id, "overwrite", [quote]));
          await writeFile(quote, "Torino, 13 novembre 2026");
          await engine.reportFile(id, { path: quote, kind: "update" });
        },
        [],
        "ora a quella di venerdì",
      );
      expect([...cards, ...later]).toEqual([]);
      expect(heard).toEqual([expect.stringMatching(/^No approval is needed/), expect.stringMatching(/^No approval/)]);
      expect(get().approval).toBeNull();
      expect(get().status).toBe("done");
      // The AI called its own change an update: the file is still the task's, with no earlier version.
      expect(listed(get(), quote)).toEqual({ path: quote, ...MADE });
      expect(get().kept ?? []).toEqual([]);
    });

    it("is changed without a card after a question, when a file tool made it and the AI never reported it", async () => {
      const { work, get, go } = await setup(provider);
      const draft = join(work, "Bozza.docx");
      const create =
        provider === "codex"
          ? { patch: `*** Begin Patch\n*** Add File: ${draft}\n+uno\n*** End Patch` }
          : ({ tool: "Write", path: draft } as const);
      const change =
        provider === "codex"
          ? { patch: `*** Begin Patch\n*** Update File: ${draft}\n@@\n-uno\n+due\n*** End Patch` }
          : ({ tool: "Edit", path: draft } as const);
      const answers: boolean[] = [];
      await go(async ({ engine, ask }) => {
        answers.push(await ask(create));
        await writeFile(draft, "uno");
        await askWhich(engine, get().id);
      });
      const cards = await go(
        async ({ ask }) => {
          answers.push(await ask(change));
          await writeFile(draft, "due");
          answers.push(await ask({ command: `printf tre > '${draft}'` }));
        },
        [],
        "Cambia la bozza",
      );
      expect(cards).toEqual([]);
      expect(answers).toEqual([true, true, true]);
      expect(get().own).toEqual([draft]);
    });
  });

  describe(`a file the task made in a run that finished, on ${provider}`, () => {
    /** Tost's first run: a script makes Ciao.docx, and the run ends with the work done. */
    const makeCiao = async (ctx: Awaited<ReturnType<typeof setup>>) => {
      const ciao = join(ctx.work, "Ciao.docx");
      await ctx.go(async ({ ask }) => {
        await ask({ command: `python3 -c "open('Ciao.docx', 'w').write('Ciao')"` });
        await writeFile(ciao, "Ciao");
      });
      expect(ctx.get().status).toBe("done");
      return ciao;
    };
    const buonasera = (ciao: string) => `/bin/zsh -lc "officecli set '${ciao}' / --find 'Ciao' --replace 'Buonasera'"`;

    it("asks before a command changes it in the next run, and the kept copy gives back the first run's version", async () => {
      const ctx = await setup(provider);
      const { id, get, go, runner } = ctx;
      const ciao = await makeCiao(ctx);
      const cards = await go(
        async ({ ask }) => {
          if (await ask({ command: buonasera(ciao) })) await writeFile(ciao, "Buonasera");
        },
        ["allow"],
        "ora deve dire buonasera",
      );
      expect(cards).toEqual([[ciao]]);
      expect(await readFile(ciao, "utf8")).toBe("Buonasera");
      // Listed as changed, with the first run's version to go back to, and no longer the task's own.
      expect(listed(get(), ciao)).toEqual({ path: ciao, kind: "update", role: "made" });
      expect(get().own ?? []).not.toContain(ciao);
      await runner.restore(id, ciao);
      expect(await readFile(ciao, "utf8")).toBe("Ciao");
    });

    it("asks before a file tool changes it, and when the AI asks with request_approval", async () => {
      const ctx = await setup(provider);
      const { id, go } = ctx;
      const ciao = await makeCiao(ctx);
      const change =
        provider === "codex"
          ? { patch: `*** Begin Patch\n*** Update File: ${ciao}\n@@\n-Ciao\n+Buonasera\n*** End Patch` }
          : ({ tool: "Edit", path: ciao } as const);
      const answers: boolean[] = [];
      const cards = await go(async ({ ask }) => answers.push(await ask(change)), ["refuse"], "ora deve dire buonasera");
      expect(cards).toEqual([[ciao]]);
      expect(answers).toEqual([false]);
      expect(await readFile(ciao, "utf8")).toBe("Ciao");
      const asked = await go(({ engine }) => engine.approve(id, "overwrite", [ciao]), [], "Riprova");
      expect(asked).toEqual([[ciao]]);
    });

    it("asks with the delete card before it goes", async () => {
      const ctx = await setup(provider);
      const { id, go } = ctx;
      const ciao = await makeCiao(ctx);
      const cards = await go(({ engine }) => engine.approve(id, "delete", [ciao]), [], "Cancellalo");
      expect(cards).toEqual([[ciao]]);
    });

    it("leaves a file the next run makes the task's own in that run", async () => {
      const ctx = await setup(provider);
      const { work, get, go } = ctx;
      const ciao = await makeCiao(ctx);
      const sera = join(work, "Buonasera.docx");
      const answers: boolean[] = [];
      const cards = await go(
        async ({ ask }) => {
          answers.push(await ask({ command: `printf uno > '${sera}'` }));
          await writeFile(sera, "uno");
          answers.push(await ask({ command: `printf due > '${sera}'` }));
          await writeFile(sera, "due");
        },
        [],
        "Fanne un altro",
      );
      expect(cards).toEqual([]);
      expect(answers).toEqual([true, true]);
      expect(get().own).toEqual([sera]);
      expect(get().own).not.toContain(ciao);
    });
  });

  describe(`a file the task made in a run that didn't finish, on ${provider}`, () => {
    /** A first run that makes a draft with a file tool, changes it, and ends as `end` says. */
    const draftThen = async (ctx: Awaited<ReturnType<typeof setup>>, end: Steps) => {
      const draft = join(ctx.work, "Bozza.docx");
      const create =
        provider === "codex"
          ? { patch: `*** Begin Patch\n*** Add File: ${draft}\n+uno\n*** End Patch` }
          : ({ tool: "Write", path: draft } as const);
      const change =
        provider === "codex"
          ? { patch: `*** Begin Patch\n*** Update File: ${draft}\n@@\n-uno\n+due\n*** End Patch` }
          : ({ tool: "Edit", path: draft } as const);
      await ctx.go(async (step) => {
        await step.ask(create);
        await writeFile(draft, "uno");
        await step.ask(change);
        await writeFile(draft, "due");
        await end(step);
      });
      return draft;
    };
    const changeAgain = (ctx: Awaited<ReturnType<typeof setup>>, draft: string, followUp: string) =>
      ctx.go(async ({ ask }) => ask({ command: `printf tre > '${draft}'` }), ["refuse"], followUp);

    it("stays the task's own after the run asked the user something", async () => {
      const ctx = await setup(provider);
      const draft = await draftThen(ctx, ({ engine }) =>
        engine.ask(ctx.id, [{ text: "Per chi è?", options: ["Ferrari", "Rossi"] }]),
      );
      expect(ctx.get().status).toBe("needs-you");
      expect(await changeAgain(ctx, draft, "Ferrari")).toEqual([]);
      expect(ctx.get().own).toEqual([draft]);
    });

    it("stays the task's own after the user stopped the run", async () => {
      const ctx = await setup(provider);
      const draft = await draftThen(ctx, async () => {
        ctx.runner.stop(ctx.id);
        throw new Error("The run was stopped");
      });
      expect(ctx.get().status).toBe("stopped");
      expect(await changeAgain(ctx, draft, "Continua")).toEqual([]);
    });

    it("stays the task's own after the run failed", async () => {
      const ctx = await setup(provider);
      const draft = await draftThen(ctx, async () => {
        throw new Error("The connection dropped");
      });
      expect(ctx.get().status).toBe("failed");
      expect(await changeAgain(ctx, draft, "Continua")).toEqual([]);
    });
  });

  describe(`a file that was there before the task, on ${provider}`, () => {
    it("still asks, even after the AI reported it as a file it made", async () => {
      const { id, note, get, go } = await setup(provider);
      await go(async ({ engine }) => {
        await engine.reportFile(id, { path: note, kind: "add" });
      });
      expect(get().own ?? []).toEqual([]);
      const cards = await go(async ({ ask }) => ask({ command: "printf v9 > note.txt" }), ["refuse"], "Cambia la nota");
      expect(cards).toEqual([[note]]);
      expect(await readFile(note, "utf8")).toBe("v1");
      const asked = await go(({ engine }) => engine.approve(id, "overwrite", [note]), [], "Riprova");
      expect(asked).toEqual([[note]]);
    });

    it("asks when the user put it in the folder between two runs", async () => {
      const { work, go } = await setup(provider);
      await go(async () => {});
      const theirs = join(work, "Nuovo listino.xlsx");
      await writeFile(theirs, "prezzi");
      const cards = await go(
        async ({ ask }) => ask({ command: `printf x > '${theirs}'` }),
        ["refuse"],
        "Aggiorna il listino",
      );
      expect(cards).toEqual([[theirs]]);
    });

    it("goes alone on the card when the AI asks about it together with a file the task made", async () => {
      const { id, note, quote, go } = await setup(provider);
      const heard: string[] = [];
      const cards = await go(async ({ engine, ask }) => {
        await ask({ command: PYTHON(REL) });
        await writeFile(quote, "nuovo");
        heard.push(await engine.approve(id, "overwrite", [quote, note]));
      });
      expect(cards).toEqual([[note]]);
      expect(heard).toEqual([expect.stringContaining(`No approval is needed for ${quote}`)]);
    });
  });
  describe(`a file the task made and the user saved since, on ${provider}`, () => {
    /**
     * Tost's first run: a script makes the quote, the AI writes the date into it and asks something, so the quote is
     * still the task's own when the answer comes.
     */
    const makeQuote = (ctx: Awaited<ReturnType<typeof setup>>) =>
      ctx.go(async ({ engine, ask }) => {
        await ask({ command: PYTHON(REL) });
        await writeFile(ctx.quote, "Torino, 10 novembre 2026");
        await askWhich(engine, ctx.id);
      });
    /** The user opens the quote, edits it and saves: new text, and a modification time that is only ever different. */
    const userSaves = async (path: string, text: string, as?: { mtimeMs?: number }) => {
      const before = await stat(path);
      await writeFile(path, text);
      await utimes(path, new Date(), new Date(as?.mtimeMs ?? before.mtimeMs + 60_000));
    };

    it("asks, and keeps a copy of the user's version, the next time the task changes it", async () => {
      const ctx = await setup(provider);
      const { quote, get, go } = ctx;
      await makeQuote(ctx);
      expect(get().own).toEqual([quote]);
      await userSaves(quote, "Torino, 10 novembre 2026, con le mie correzioni");
      const cards = await go(async ({ ask }) => ask({ command: OFFICECLI(REL) }), ["allow"], "Cambia la data");
      expect(cards).toEqual([[quote]]);
      const copy = get().kept?.find((k) => k.path === quote)?.copy as string;
      expect(await readFile(copy, "utf8")).toBe("Torino, 10 novembre 2026, con le mie correzioni");
      // Listed as changed, with its earlier version, and no longer the task's own.
      expect(listed(get(), quote)).toEqual({ path: quote, kind: "update", role: "made" });
      expect(get().own ?? []).not.toContain(quote);
    });

    it("asks through request_approval too, with the file on the card", async () => {
      const ctx = await setup(provider);
      const { id, quote, go } = ctx;
      await makeQuote(ctx);
      await userSaves(quote, "Torino, 10 novembre 2026, con le mie correzioni");
      const cards = await go(({ engine }) => engine.approve(id, "overwrite", [quote]), [], "Cambia la data");
      expect(cards).toEqual([[quote]]);
    });

    it.each([
      ["rewritten with the same size", "Torino, 10 novembre 2025", undefined],
      // A clock set back leaves a time before the one recorded: only a comparison for equality sees it.
      ["saved with a modification time in the past", "Torino, 10 novembre 2025", 1_000_000],
    ])("asks when the user's save is %s", async (_name, text, mtimeMs) => {
      const ctx = await setup(provider);
      const { quote, go } = ctx;
      await makeQuote(ctx);
      await userSaves(quote, text, { mtimeMs });
      const cards = await go(async ({ ask }) => ask({ command: OFFICECLI(REL) }), ["refuse"], "Cambia la data");
      expect(cards).toEqual([[quote]]);
    });

    it("asks when the size differs", async () => {
      const ctx = await setup(provider);
      const { quote, go } = ctx;
      await makeQuote(ctx);
      const { mtimeMs } = await stat(quote);
      await userSaves(quote, "Torino, 10 novembre 2026, con le mie correzioni", { mtimeMs });
      const cards = await go(async ({ ask }) => ask({ command: OFFICECLI(REL) }), ["refuse"], "Cambia la data");
      expect(cards).toEqual([[quote]]);
    });

    it("doesn't ask when the file is as the task left it", async () => {
      const ctx = await setup(provider);
      const { quote, get, go } = ctx;
      await makeQuote(ctx);
      const cards = await go(async ({ ask }) => ask({ command: OFFICECLI(REL) }), [], "Cambia la data");
      expect(cards).toEqual([]);
      expect(get().own).toEqual([quote]);
      expect(get().kept ?? []).toEqual([]);
    });

    it("doesn't ask in a third run about a change the task made itself in the second", async () => {
      const ctx = await setup(provider);
      const { quote, get, go } = ctx;
      await makeQuote(ctx);
      const second = await go(
        async ({ engine, ask }) => {
          await ask({ command: OFFICECLI(REL) });
          await writeFile(quote, "Torino, 11 novembre 2026");
          await askWhich(engine, ctx.id);
        },
        [],
        "Cambia la data",
      );
      const third = await go(
        async ({ ask }) => {
          await ask({ command: OFFICECLI(REL) });
          await writeFile(quote, "Torino, 12 novembre 2026");
        },
        [],
        "Ancora",
      );
      expect([...second, ...third]).toEqual([]);
      expect(get().own).toEqual([quote]);
      expect(get().ownSeen?.[quote]?.size).toBe("Torino, 12 novembre 2026".length);
    });

    it("drops a file that is gone", async () => {
      const ctx = await setup(provider);
      const { quote, get, go } = ctx;
      await makeQuote(ctx);
      await rm(quote);
      await go(async () => {}, [], "Com'è andata?");
      expect(get().own).toEqual([]);
      expect(get().ownSeen).toEqual({});
    });

    it("stays the task's own when the task was saved before the app recorded how the file looked", async () => {
      const ctx = await setup(provider);
      const { id, quote, get, go, store } = ctx;
      await makeQuote(ctx);
      const { ownSeen: _recorded, ...legacy } = get();
      store.saveTask(legacy);
      await userSaves(quote, "Torino, 10 novembre 2026, con le mie correzioni");
      const cards = await go(async ({ ask }) => ask({ command: OFFICECLI(REL) }), [], "Cambia la data");
      expect(cards).toEqual([]);
      // The run's end records it, so the next run compares.
      expect(get().ownSeen?.[quote]).toBeDefined();
      expect(get().id).toBe(id);
    });
  });
}

describe("sameStamp", () => {
  it("tells a file apart by its size alone, and by its time alone", () => {
    const seen = { mtimeMs: 1_731_234_567_890.123, size: 40 };
    expect(sameStamp(seen, { ...seen })).toBe(true);
    expect(sameStamp(seen, { ...seen, size: 41 })).toBe(false);
    expect(sameStamp(seen, { ...seen, mtimeMs: seen.mtimeMs + 0.001 })).toBe(false);
    expect(sameStamp(seen, undefined)).toBe(false);
  });
});
