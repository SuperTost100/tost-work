/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

// Node's path module as it is on Windows, so the folder check runs on Windows paths here too. The files below don't
// exist, so links resolve to nothing and the paths are compared as written.
vi.mock("node:path", async () => {
  const actual = await vi.importActual<typeof import("node:path")>("node:path");
  return { ...actual.win32, default: actual.win32 };
});

// Links that lead nowhere, which Linux can't make under Windows paths: lstat finds them, realpath doesn't.
const { DANGLING } = vi.hoisted(() => ({ DANGLING: new Set<string>() }));
vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  const lstat = (path: string) => (DANGLING.has(path) ? Promise.resolve({}) : actual.lstat(path));
  return { ...actual, lstat, default: { ...actual, lstat } };
});

const { inside } = await import("../files");
const { asCodexRequest, outside } = await import("./agent");

const WORK = "C:\\Users\\Giulia\\Documents\\Corso";
const write = (file_path: string) => ({ id: "1", tool: "Write", input: { file_path, content: "x" } });

describe("the task's folder on Windows paths", () => {
  it("tells paths inside the folder from the rest", () => {
    expect(inside(WORK, `${WORK}\\note.txt`)).toBe(true);
    expect(inside(WORK, "c:\\users\\giulia\\documents\\corso\\sub\\note.txt")).toBe(true);
    expect(inside(WORK, "C:/Users/Giulia/Documents/Corso/note.txt")).toBe(true);
    expect(inside(WORK, WORK)).toBe(false);
    expect(inside(WORK, "C:\\Users\\Giulia\\Documents\\Corso2\\note.txt")).toBe(false);
    expect(inside(WORK, `${WORK}\\..\\note.txt`)).toBe(false);
    expect(inside(WORK, "D:\\Users\\Giulia\\Documents\\Corso\\note.txt")).toBe(false);
    expect(inside(WORK, "\\\\server\\share\\note.txt")).toBe(false);
  });

  it("lets Claude Code and Codex write inside the folder, however the path is written", async () => {
    for (const path of [
      "note.txt",
      "sub\\note.txt",
      "new\\deeper\\note.txt",
      `${WORK}\\note.txt`,
      "c:\\USERS\\giulia\\documents\\corso\\note.txt",
      "C:/Users/Giulia/Documents/Corso/note.txt",
    ]) {
      expect(await asCodexRequest(write(path), WORK), path).toMatchObject({ tool: "file_change" });
      expect(await outside(WORK, path), path).toBe(false);
    }
  });

  it("refuses a write outside the folder, from either CLI", async () => {
    for (const path of [
      "..\\note.txt",
      "sub\\..\\..\\note.txt",
      "C:\\Users\\Giulia\\Desktop\\note.txt",
      "C:\\Users\\Giulia\\Documents\\Corso2\\note.txt",
      "c:/users/giulia/documents/note.txt",
      "D:\\note.txt",
      "\\\\server\\share\\note.txt",
      "C:\\Windows\\System32\\drivers\\etc\\hosts",
    ])
      expect(await outside(WORK, path), path).toBe(true);
  });

  it("refuses a write through a link or junction in the folder that leads nowhere", async () => {
    DANGLING.add(`${WORK}\\link.txt`);
    DANGLING.add(`${WORK}\\Shared`);
    try {
      expect(await outside(WORK, "link.txt")).toBe(true);
      expect(await outside(WORK, "Shared\\note.txt")).toBe(true);
      expect(await outside(WORK, "other.txt")).toBe(false);
    } finally {
      DANGLING.clear();
    }
  });
});
