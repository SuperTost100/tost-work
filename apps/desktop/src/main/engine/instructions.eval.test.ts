/** @vitest-environment node */
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, relative } from "node:path";
import { promisify } from "node:util";
import { createFunnel } from "cli-funnel";
import { afterAll, describe, it } from "vitest";
import type { Language } from "../../shared/i18n";
import { type AiId, questionItems, type Task } from "../../shared/model";
import { fileGuard } from "../guard";
import { ToolServer } from "../mcp/server";
import { Store } from "../store/store";
import { AgentEngine, type DocumentTools } from "./agent";
import { TaskRunner } from "./runner";

/*
 * Ten everyday office briefs, run on the real Codex and Claude Code with the instructions as they stand, to compare
 * the instructions before and after a change (#153). Each run spends real usage, so it runs only when asked:
 *
 *   TOST_WORK_EVAL=<label> TOST_WORK_EVAL_OUT=<folder> [TOST_WORK_EVAL_AI=chatgpt|claude] [TOST_WORK_EVAL_ONLY=a,b]
 *     pnpm vitest run src/main/engine/instructions.eval.test.ts
 *
 * Each run writes what the agent said, asked and did to <folder>/<label>/<ai>/<brief>.json, with a copy of the
 * task's folder next to it. Nothing here passes or fails: a person reads the results. The CLIs run with whatever
 * homes the environment gives them; set CODEX_HOME and CLAUDE_CONFIG_DIR (or a wrapper in CLI_FUNNEL_CLAUDE_BIN)
 * so the tester's own instructions, skills and MCP servers stay out, as the app does.
 */

const label = process.env.TOST_WORK_EVAL ?? "";
const out = process.env.TOST_WORK_EVAL_OUT ?? "";
const ais = (process.env.TOST_WORK_EVAL_AI ?? "chatgpt,claude").split(",") as AiId[];
const only = process.env.TOST_WORK_EVAL_ONLY?.split(",");
const run = promisify(execFile);

const APP = join(__dirname, "../../..");
const BIN = join(
  APP,
  "resources/bin",
  `${{ darwin: "mac", win32: "win" }[process.platform as string] ?? process.platform}-${process.arch}`,
);
const documents: DocumentTools = {
  skills: join(APP, "resources/skills"),
  env: {
    PATH: `${BIN}${delimiter}${process.env.PATH ?? ""}`,
    OFFICECLI_SKIP_UPDATE: "1",
    OFFICECLI_NO_AUTO_RESIDENT: "1",
    OFFICECLI_NO_STAMP: "1",
  },
  makePdf: async () => {
    throw new Error("No PDFs in the eval");
  },
};
const officecli = (...args: string[]) =>
  run(join(BIN, "officecli"), args, { env: { ...process.env, ...documents.env } });

interface Brief {
  id: string;
  language: Language;
  brief: string;
  /** Files to put in the project folder before the run. */
  setup?: (folder: string) => Promise<void>;
  /** Files to attach, relative to the project folder. */
  attach?: string[];
  /** What a good run does, for the person reading the results. */
  expect: string;
}

const BRIEFS: Brief[] = [
  {
    id: "01-excel-quote",
    language: "it",
    brief:
      "Prepara un preventivo in Excel per il nuovo sito della Pasticceria Bonetti: analisi 2 giorni, grafica 3 giorni, sviluppo 5 giorni, a 450 € al giorno, più IVA al 22%.",
    expect: "An .xlsx with formulas for totals and VAT, a short message, a review.",
  },
  {
    id: "02-word-proposal",
    language: "it",
    brief:
      "Scrivi una proposta in Word per l'Hotel Bellavista di Biella: gestione dei loro profili Instagram e Facebook, con tre pacchetti a prezzi diversi.",
    expect: "A .docx with headings and a table of packages; questions only if prices can't be decided sensibly.",
  },
  {
    id: "03-slides",
    language: "it",
    brief:
      "Fai una presentazione di 6 slide per spiegare al team il nuovo modo di chiedere il rimborso delle note spese: foto dello scontrino nell'app entro 5 giorni, approvazione del responsabile, rimborso nello stipendio del mese dopo.",
    expect: "A 6-slide .pptx with titles that state the point; no practice files.",
  },
  {
    id: "04-answer-notes",
    language: "it",
    brief:
      "Sistemami questi appunti della riunione di stamattina:\n- sito nuovo entro marzo?? chiedere a Paolo budget\n- Laura dice newsletter mensile non settimanale\n- fiera Milano 12-14 aprile, stand piccolo, chi va? io + Marco\n- rifare listino entro fine mese\n- Paolo ok budget sito 8k max",
    expect: "An answer in the message with headings or lists, no file, and a one-line offer of a file.",
  },
  {
    id: "05-email",
    language: "it",
    brief:
      "Scrivi un'email al signor Ferraris della Ferraris Arredi per sollecitare il pagamento della fattura 112 da 2.350 €, scaduta il 15 ottobre.",
    expect:
      "The email in the message, ready to copy: subject first, formal register (Lei), signed Giulia Rossi; no file.",
  },
  {
    id: "06-edit-word",
    language: "it",
    setup: async (folder) => {
      const file = join(folder, "Contratto Pedroni.docx");
      await officecli("create", file);
      await officecli(
        "add",
        file,
        "/body",
        "--type",
        "markdown",
        "--prop",
        "markdown=# Contratto di consulenza\n\nTra Studio Rossi e il signor Alberto Pedrini.\n\n## Oggetto\n\nIl signor Alberto Pedrini affida a Studio Rossi la revisione del sito.",
      );
    },
    brief: "Nel contratto il nome del cliente è sbagliato: è Alberto Pedroni, non Pedrini. Correggilo.",
    expect: "Asks to overwrite, then replaces the name in place, keeping the formatting.",
  },
  {
    id: "07-web",
    language: "it",
    brief: "Quanto costa la marca da bollo sulle fatture e da che importo va messa? Rispondimi in breve con le fonti.",
    expect: "A short answer in the message with official sources and links; no file.",
  },
  {
    id: "08-vague",
    language: "it",
    brief: "Prepara il volantino per l'evento.",
    expect: "Asks what the event is (ask_user with options) before making anything.",
  },
  {
    id: "09-english-summary",
    language: "en",
    setup: async (folder) => {
      await writeFile(
        join(folder, "meeting-notes.txt"),
        "Kickoff with Greenleaf, 3 Nov\n- they want the catalogue redone before spring fair (march)\n- budget not fixed, Tom says around 6k\n- photos: they have some, need 20 new product shots\n- next call: send draft structure by 14 Nov\n- contact for invoices: accounts@greenleaf.example\n",
      );
    },
    attach: ["meeting-notes.txt"],
    brief: "Turn the attached notes into a one-page summary in Word.",
    expect: "A one-page .docx summary in English with actions and dates.",
  },
  {
    id: "10-folders",
    language: "it",
    setup: async (folder) => {
      await mkdir(join(folder, "Clienti", "Rossi"), { recursive: true });
      await mkdir(join(folder, "Clienti", "Bianchi"), { recursive: true });
      await officecli("create", join(folder, "Clienti", "Rossi", "Preventivo Rossi.xlsx"));
    },
    brief: "Fai un preventivo in Excel per Bianchi: 10 ore di consulenza a 80 € l'ora.",
    expect: "An .xlsx saved in Clienti/Bianchi, named like the Rossi one.",
  },
];

/** Every file under `folder`, relative to it. */
async function filesIn(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => relative(folder, join(e.parentPath, e.name)));
}

const funnel = createFunnel();
afterAll(() => funnel.close());

for (const ai of ais) {
  describe.runIf(label && out)(`instructions eval on ${ai}`, () => {
    for (const b of BRIEFS.filter((x) => !only || only.includes(x.id))) {
      it(b.id, { timeout: 1_200_000 }, async () => {
        const work = await mkdtemp(join(tmpdir(), `tw-eval-${b.id}-`));
        const kept = await mkdtemp(join(tmpdir(), "tw-eval-kept-"));
        await b.setup?.(work);
        const before = await filesIn(work);
        const engine = new AgentEngine(funnel, () => b.language, {
          ai: async () => ai,
          documents,
          user: () => ({ name: "Giulia Rossi", work: "Consulente marketing per piccole aziende", notes: "" }),
        });
        const tools = new ToolServer(engine);
        await tools.start();
        engine.attachTools(tools);
        const store = new Store(":memory:");
        const runner = new TaskRunner(
          store,
          engine,
          () => {},
          undefined,
          fileGuard(kept, async () => {}),
        );
        const { provider, model, effort } = await engine.defaults();
        store.saveProject({ id: "p", name: "Lavoro", description: "", folder: work, instructions: "", createdAt: "" });
        const task = runner.create({
          projectId: "p",
          workdir: work,
          provider,
          model,
          effort,
          brief: b.brief,
          attachments: (b.attach ?? []).map((f) => join(work, f)),
        });
        const asked: unknown[] = [];
        const started = Date.now();
        runner.launch(task.id);
        // Plays the user: the first option of every question, and yes to every approval.
        const handled = new Set<string>();
        let final: Task | undefined;
        for (;;) {
          const t = store.getTask(task.id);
          if (!t) throw new Error("The task is gone");
          const open = t.question?.id ?? t.approval?.id;
          if (open && !handled.has(open)) {
            handled.add(open);
            if (t.approval) {
              asked.push({ approval: t.approval });
              await runner.decide(task.id, true);
            } else if (t.question) {
              const items = questionItems(t.question);
              asked.push({ questions: items });
              runner.answer(
                task.id,
                items.map((q) => q.options[0] ?? "Decidi tu"),
              );
            }
          } else if (!runner.isRunning(task.id) && ["done", "failed", "stopped"].includes(t.status)) {
            final = t;
            break;
          }
          await new Promise((r) => setTimeout(r, 300));
        }
        await tools.stop();
        const after = await filesIn(work);
        const validate: Record<string, string> = {};
        for (const f of after.filter((x) => /\.(docx|xlsx|pptx)$/.test(x))) {
          const result = await officecli("validate", join(work, f)).catch(
            (e: { stdout?: string; stderr?: string }) => e,
          );
          validate[f] = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().slice(0, 500);
        }
        const dir = join(out, label, ai);
        await mkdir(dir, { recursive: true });
        await cp(work, join(dir, `${b.id}-files`), { recursive: true });
        await writeFile(
          join(dir, `${b.id}.json`),
          `${JSON.stringify(
            {
              brief: b.brief,
              expect: b.expect,
              ai,
              model,
              effort,
              seconds: Math.round((Date.now() - started) / 1000),
              status: final.status,
              error: final.error,
              asked,
              messages: final.messages.map((m) => ({ from: m.from, text: m.text })),
              activity: (final.activity ?? []).map((a) => `${a.kind}${a.target ? `: ${a.target}` : ""}`),
              review: final.review,
              reported: final.files,
              skillsUsed: final.skillsUsed,
              filesBefore: before,
              filesAfter: after,
              validate,
            },
            null,
            2,
          )}\n`,
        );
        await rm(kept, { recursive: true, force: true });
        await rm(work, { recursive: true, force: true });
      });
    }
  });
}
