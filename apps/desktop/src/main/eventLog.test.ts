import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Task } from "../shared/model";
import { EventLog } from "./eventLog";

const file = () => join(mkdtempSync(join(tmpdir(), "events-")), "events.log");
const at = new Date("2026-11-07T20:00:00Z");

const task = (over: Partial<Task> = {}): Task =>
  ({
    id: "1a2b3c4d-0000-4000-8000-000000000000",
    projectId: "p1",
    title: "Proposta per Ferraris Trasporti",
    brief: "Scrivi la proposta per il cliente Mario Rossi",
    provider: "codex",
    model: "gpt-6.1",
    effort: "medium",
    status: "running",
    files: [
      { path: "/Users/tost/Clienti/Ferraris/Proposta Ferraris.docx", kind: "add", role: "made" },
      { path: "/Users/tost/Clienti/Ferraris/prezzi.xlsx", kind: "edit", role: "made" },
      { path: "/Users/tost/Clienti/Ferraris/appunti.md", kind: "read", role: "read" },
    ],
    question: null,
    approval: null,
    error: null,
    ...over,
  }) as unknown as Task;

describe("the events log of a test build", () => {
  it("writes a task's state, AI and file types, and nothing the user wrote or named", async () => {
    const path = file();
    const log = new EventLog(path, true, () => at);
    log.task(task({ status: "done" }));
    const text = await log.tail(10_000);
    expect(text).toBe(
      "2026-11-07 20:00:00 task id=1a2b3c4d status=done ai=codex model=gpt-6.1 effort=medium project=true made=docx:1,xlsx:1",
    );
    for (const secret of ["Ferraris", "Rossi", "Proposta", "Clienti", "tost", "appunti"])
      expect(text).not.toContain(secret);
  });

  it("writes a task again only when its state changes", async () => {
    const path = file();
    const log = new EventLog(path, true, () => at);
    log.task(task());
    log.task(task());
    log.task(task({ status: "needs-you", question: { id: "q", text: "Chi paga?", options: [] } }));
    const lines = (await log.tail(10_000)).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("status=needs-you");
    expect(lines[1]).toContain("asks=true");
    expect(lines[1]).not.toContain("Chi paga");
  });

  it("keeps an error's kind, never its message", async () => {
    const log = new EventLog(file(), true, () => at);
    log.error("job", Object.assign(new Error("Can't open /Users/tost/Clienti/Ferraris.docx"), { code: "ENOENT" }));
    expect(await log.tail(10_000)).toBe("2026-11-07 20:00:00 error where=job name=Error code=ENOENT");
  });

  it("gives a report the newest lines that fit", async () => {
    const log = new EventLog(file(), true, () => at);
    for (let i = 0; i < 50; i++) log.app("started", { n: i });
    const tail = await log.tail(200);
    expect(tail.length).toBeLessThanOrEqual(200);
    expect(tail.endsWith("n=49")).toBe(true);
  });

  it("drops lines older than a week when the app starts", async () => {
    const path = file();
    writeFileSync(path, "2026-10-20 10:00:00 started\n2026-11-06 10:00:00 started\n");
    await new EventLog(path, true, () => at).prune();
    expect(readFileSync(path, "utf8")).toBe("2026-11-06 10:00:00 started\n");
  });

  it("writes nothing in a stable build", async () => {
    const path = file();
    const log = new EventLog(path, false, () => at);
    log.app("started");
    log.task(task());
    expect(await log.tail(10_000)).toBe("");
  });
});
