/** @vitest-environment node */
import { mkdtemp, readdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type EventLine, OUTPUT_MAX } from "../shared/debug";
import { DEFAULT_SETTINGS } from "../shared/model";
import { DebugLogs, redactText, redactValue, settingChanges } from "./debugLog";

const COURSE_KEY = "sk-ant-api03-Abcdefghijklmnopqrstuvwxyz0123456789";
const OPENAI_KEY = "sk-proj-Zyxwvutsrqponmlkjihgfedcba9876543210";
const PLAIN_KEY = "sk-Qwertyuiopasdfghjkl1234567890";
const SERVER_TOKEN = "f3b1c2d4-mcp-session-token-9a8b7c6d";

async function logs(on = true, limits?: { task: number; app: number }) {
  const dir = await mkdtemp(join(tmpdir(), "tw-debug-"));
  const state = { on };
  const debug = new DebugLogs(
    dir,
    () => state.on,
    () => [COURSE_KEY],
    () => "2026-11-02T10:00:00.000Z",
    limits,
  );
  return { dir, debug, state };
}

describe("redaction", () => {
  it("masks keys, bearer tokens, credential fields and environment values", () => {
    const masked = JSON.stringify(
      redactValue(
        {
          apiKey: "anything at all",
          headers: { Authorization: `Bearer ${SERVER_TOKEN}` },
          env: { PATH: "/usr/bin", CUSTOM: "hunter2" },
          output: `OPENAI_API_KEY=${OPENAI_KEY}\nANTHROPIC_API_KEY=plainvalue123\nHOME=/home/giulia`,
          command: `curl -H "Authorization: Bearer ${SERVER_TOKEN}" -H 'x-api-key: ${PLAIN_KEY}' https://api.example.com`,
          note: `the course key is ${COURSE_KEY}`,
          usage: { inputTokens: 1200, outputTokens: 300 },
          sessionId: "s-123",
        },
        [SERVER_TOKEN],
      ),
    );
    for (const secret of [
      COURSE_KEY,
      OPENAI_KEY,
      PLAIN_KEY,
      SERVER_TOKEN,
      "anything at all",
      "hunter2",
      "plainvalue123",
    ])
      expect(masked).not.toContain(secret);
    // What isn't a secret stays readable.
    expect(masked).toContain("HOME=/home/giulia");
    expect(masked).toContain('"inputTokens":1200');
    expect(masked).toContain('"sessionId":"s-123"');
    expect(masked).toContain('"PATH":"[redacted]"');
  });

  it("masks a secret given by value even when it doesn't look like a key", () => {
    expect(redactText("token=abc and opaque-value-42", ["opaque-value-42"])).not.toContain("opaque-value-42");
  });
});

describe("DebugLogs", () => {
  it("writes a task's events as JSON lines with the time, and no key or token reaches a line", async () => {
    const { dir, debug } = await logs();
    const log = debug.forTask("t1", [SERVER_TOKEN]);
    log.write({ type: "run", provider: "claude", model: "m", effort: "medium", access: "supervised", cwd: "/w" });
    log.write({ type: "tool.start", id: "c1", name: "Bash", input: { command: `echo ${COURSE_KEY}` } });
    log.write({ type: "tool.end", id: "c1", output: `Authorization: Bearer ${SERVER_TOKEN}\n${OPENAI_KEY}` });
    debug.app("error", `Task t1 failed: bad key ${PLAIN_KEY}`, new Error(`401 for ${COURSE_KEY}`));
    await debug.flush();
    const task = await readFile(join(dir, "tasks", "t1.jsonl"), "utf8");
    const app = await readFile(join(dir, "app.log"), "utf8");
    expect(task.trim().split("\n")).toHaveLength(3);
    expect(JSON.parse(task.split("\n")[0] ?? "")).toMatchObject({ type: "run", at: "2026-11-02T10:00:00.000Z" });
    for (const text of [task, app])
      for (const secret of [COURSE_KEY, OPENAI_KEY, PLAIN_KEY, SERVER_TOKEN]) expect(text).not.toContain(secret);
    expect(app).toContain("[error] Task t1 failed");
  });

  it("writes nothing while debug is off", async () => {
    const { dir, debug, state } = await logs(false);
    debug.forTask("t1").write({ type: "text.delta", text: "hi" });
    debug.app("info", "started");
    await debug.flush();
    expect(await readdir(dir)).toEqual([]);
    state.on = true;
    debug.forTask("t1").write({ type: "text.delta", text: "hi" });
    await debug.flush();
    expect(debug.hasTask("t1")).toBe(true);
  });

  it("stops a task's log at its cap with one line saying so, even after a restart", async () => {
    const { dir, debug } = await logs(true, { task: 300, app: 1000 });
    const log = debug.forTask("t1");
    for (let i = 0; i < 20; i++) log.write({ type: "text.delta", text: `word ${i}` });
    await debug.flush();
    const lines = (await readFile(join(dir, "tasks", "t1.jsonl"), "utf8")).trim().split("\n");
    expect(lines.filter((l) => l.includes("log.capped"))).toHaveLength(1);
    expect(lines.at(-1)).toContain("log.capped");
    // Another start of the app sees the cap and adds nothing.
    const again = new DebugLogs(dir, () => true, undefined, undefined, { task: 300, app: 1000 });
    again.forTask("t1").write({ type: "text.delta", text: "more" });
    await again.flush();
    expect((await readFile(join(dir, "tasks", "t1.jsonl"), "utf8")).trim().split("\n")).toEqual(lines);
  });

  it("moves app.log to app.1.log when it grows past its limit", async () => {
    const { dir, debug } = await logs(true, { task: 1000, app: 200 });
    for (let i = 0; i < 10; i++) debug.app("info", `line ${i} ${"x".repeat(30)}`);
    await debug.flush();
    expect((await readdir(dir)).sort()).toEqual(["app.1.log", "app.log"]);
    expect(await readFile(join(dir, "app.log"), "utf8")).toContain("line 9");
  });

  it("reads a task's log with long output cut, skipping a broken line, and deletes it with the task", async () => {
    const { dir, debug } = await logs();
    const log = debug.forTask("t1");
    log.write({ type: "tool.start", id: "c1", name: "Bash", input: { command: "cat big.txt" } });
    log.write({ type: "tool.end", id: "c1", output: "y".repeat(OUTPUT_MAX + 5) });
    await debug.flush();
    await writeFile(join(dir, "tasks", "t1.jsonl"), '{"type":"text.del', { flag: "a" });
    const lines = await debug.readTask("t1");
    expect(lines).toHaveLength(2);
    expect(lines?.[1]).toMatchObject({ type: "tool.end", cut: OUTPUT_MAX + 5 });
    expect((lines?.[1] as EventLine | undefined)?.output).toHaveLength(OUTPUT_MAX);
    await debug.removeTask("t1");
    expect(await debug.readTask("t1")).toBeNull();
    expect(debug.hasTask("t1")).toBe(false);
  });

  it("refuses a task id that could reach outside the logs folder", async () => {
    const { debug } = await logs();
    expect(() => debug.taskFile("../app")).toThrow();
    expect(debug.hasTask("../../etc/passwd")).toBe(false);
  });

  it("keeps the run going when a line can't be written", async () => {
    const { dir, debug } = await logs();
    // A file where the tasks folder should be makes every task line fail.
    await writeFile(join(dir, "tasks"), "not a folder");
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      debug.forTask("t1").write({ type: "text.delta", text: "a" });
      debug.forTask("t1").write({ type: "text.delta", text: "b" });
      await debug.flush();
    } finally {
      console.error = original;
    }
    expect(errors).toHaveLength(1);
  });
});

describe("settings changes", () => {
  const before = { ...DEFAULT_SETTINGS, name: "Giulia", work: "Accountant", notes: "Be brief" };

  it("lists what changed with its new value, and the free text without it", () => {
    const after = {
      ...before,
      name: "Giulia Rossi",
      work: "Accountant at Alpi Logistica",
      notes: "Write to giulia@example.com",
      theme: "dark" as const,
      sections: { board: false },
    };
    const changes = settingChanges(before, after);
    expect(changes).toEqual({
      name: "(text changed)",
      work: "(text changed)",
      notes: "(text changed)",
      theme: "dark",
      sections: { board: false },
    });
    expect(JSON.stringify(changes)).not.toMatch(/Rossi|Alpi|example\.com|brief/i);
  });

  it("is empty when nothing changed", () => {
    expect(settingChanges(before, { ...before })).toEqual({});
  });

  it("writes a line for a model pick and one for the other settings, only while debug is on", async () => {
    const { dir, debug, state } = await logs(false);
    const after = { ...before, name: "Marco", textSize: "large" as const, modelPick: { preset: "fast" as const } };
    debug.settingsChanged(before, after);
    await debug.flush();
    expect(await readdir(dir)).toEqual([]);

    state.on = true;
    debug.settingsChanged(before, after);
    await debug.flush();
    const text = await readFile(debug.appFile, "utf8");
    expect(text).toContain('[info] Model pick changed {"preset":"fast"}');
    expect(text).toContain('[info] Settings changed {"name":"(text changed)","textSize":"large"}');
    expect(text).not.toContain("Marco");
  });
});

describe("snapshot", () => {
  it("holds the app logs and every task log, and nothing else", async () => {
    const { dir, debug } = await logs(true, { task: 1000, app: 120 });
    debug.app("info", "first line of the app log");
    debug.app("info", "second line, which moves the first to app.1.log");
    debug.forTask("task-1").write({ type: "run" });
    debug.forTask("task-2").write({ type: "run" });
    await debug.flush();
    await writeFile(join(dir, "tasks", "notes.txt"), "not a log");
    const names = (await debug.snapshot()).files.map((f) => f.name);
    expect(names.slice(0, 2)).toEqual(["app.1.log", "app.log"]);
    expect(names.slice(2).sort()).toEqual(["tasks/task-1.jsonl", "tasks/task-2.jsonl"]);
  });

  it("stops at its size budget, keeping the app log and the newest task logs", async () => {
    const { dir, debug } = await logs(true);
    debug.app("info", "the app log");
    debug.forTask("old").write({ type: "run", text: "x".repeat(400) });
    debug.forTask("new").write({ type: "run", text: "y".repeat(400) });
    await debug.flush();
    await utimes(join(dir, "tasks", "old.jsonl"), new Date(2026, 0, 1), new Date(2026, 0, 1));
    const appSize = (await stat(join(dir, "app.log"))).size;
    const { files, leftOut } = await debug.snapshot(appSize + 600);
    expect(files.map((f) => f.name)).toEqual(["app.log", "tasks/new.jsonl"]);
    expect(leftOut).toBe(1);
  });

  it("is empty when nothing was ever logged", async () => {
    const { debug } = await logs(false);
    expect(await debug.snapshot()).toEqual({ files: [], leftOut: 0 });
  });
});
