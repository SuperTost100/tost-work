/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commandPatch, gateRequest, hookCall, opensShell, patchChanges } from "./codexGate";

const patch = (...lines: string[]) => ["*** Begin Patch", ...lines, "*** End Patch"].join("\n");
const heredoc = (body: string, before = "") => `${before}apply_patch <<'EOF'\n${body}\nEOF\n`;

describe("Codex's patches", () => {
  it("names each file a patch touches, with its path taken from the folder", () => {
    const text = patch(
      "*** Update File: note.txt",
      "@@",
      "-old",
      "+new",
      "*** Add File: sub/new.md",
      "+hello",
      "*** Delete File: /w/old.txt",
      "*** Update File: draft.md",
      "*** Move to: final/draft.md",
      "@@",
      "-a",
      "+b",
    );
    expect(patchChanges(text, "/w")).toEqual([
      { path: "/w/note.txt", kind: "update" },
      { path: "/w/sub/new.md", kind: "add" },
      { path: "/w/old.txt", kind: "delete" },
      { path: "/w/draft.md", kind: "update", movedTo: "/w/final/draft.md" },
    ]);
  });

  it("counts a file's Delete and Add in one patch as an overwrite, and a patch that ends in a Delete as a deletion", () => {
    expect(patchChanges(patch("*** Delete File: note.txt", "*** Add File: note.txt", "+new"), "/w")).toEqual([
      { path: "/w/note.txt", kind: "update" },
    ]);
    expect(patchChanges(patch("*** Update File: note.txt", "@@", "+x", "*** Delete File: note.txt"), "/w")).toEqual([
      { path: "/w/note.txt", kind: "delete" },
    ]);
  });

  it("reads Windows paths as Windows paths", () => {
    const work = "C:\\Users\\Giulia\\Documents\\Corso";
    expect(
      patchChanges(
        patch(
          "*** Update File: note.txt",
          "@@",
          "+a",
          "*** Add File: sub\\new.md",
          "+b",
          "*** Delete File: C:\\Users\\Giulia\\x.docx",
        ),
        work,
      ),
    ).toEqual([
      { path: `${work}\\note.txt`, kind: "update" },
      { path: `${work}\\sub\\new.md`, kind: "add" },
      { path: "C:\\Users\\Giulia\\x.docx", kind: "delete" },
    ]);
    expect(patchChanges(patch("*** Update File: ..\\elsewhere.txt", "@@", "+a"), work)).toEqual([
      { path: "C:\\Users\\Giulia\\Documents\\elsewhere.txt", kind: "update" },
    ]);
  });

  it("reads a patch given to apply_patch inside a command, from the folder its cd names", () => {
    const body = patch("*** Update File: note.txt", "@@", "-a", "+b");
    expect(commandPatch(heredoc(body), "/w")).toEqual([{ path: "/w/note.txt", kind: "update" }]);
    expect(commandPatch(heredoc(body, "cd sub && "), "/w")).toEqual([{ path: "/w/sub/note.txt", kind: "update" }]);
    expect(commandPatch(heredoc(body, "cd '/w/a b' && "), "/w")).toEqual([{ path: "/w/a b/note.txt", kind: "update" }]);
    // A patch's text in a command that doesn't run apply_patch is only text, and a command without one changes nothing.
    expect(commandPatch(`cat > fix.patch <<'EOF'\n${body}\nEOF`, "/w")).toEqual([]);
    expect(commandPatch("ls -la", "/w")).toEqual([]);
  });

  it("can't read a patch from a file, from an argument, or one that lands where another cd moved it", () => {
    // In an argument the shell may change the text before apply_patch reads it, so only a heredoc is read.
    expect(commandPatch(`applypatch "${patch("*** Update File: note.txt", "@@", "+a")}"`, "/w")).toBeNull();
    expect(commandPatch("apply_patch < fix.patch", "/w")).toBeNull();
    expect(commandPatch("cat fix.patch | apply_patch", "/w")).toBeNull();
    expect(commandPatch(`${heredoc(patch("*** Add File: a.txt", "+a"))}apply_patch < more.patch`, "/w")).toBeNull();
    expect(commandPatch(heredoc(patch("*** Update File: note.txt"), "cd sub; "), "/w")).toBeNull();
    expect(commandPatch(heredoc(patch("*** Update File: note.txt"), "cd a && cd b && "), "/w")).toBeNull();
  });
});

/**
 * Patches that once hid a file from the gate while Codex's own apply_patch changed it: text that ends the patch only
 * inside an Add's line, and U+0085, which Rust's trim takes off and JavaScript's \s keeps.
 */
const HOSTILE: [string, string][] = [
  [
    "an end inside an Add, then a Delete",
    patch("*** Add File: notes.txt", "+*** End Patch", "*** Delete File: important.docx"),
  ],
  [
    "an end inside an Add, then an Update",
    patch("*** Add File: notes.txt", "+*** End Patch", "*** Update File: report.docx", "@@", "-a", "+b"),
  ],
  ["a Delete after U+0085", patch("*** Add File: notes.txt", "+x", "\u0085*** Delete File: important.docx")],
  ["an Add ending in U+0085", patch("*** Add File: report.docx\u0085", "+x")],
  ["CRLF lines", patch("*** Add File: notes.txt", "+x", "*** Delete File: important.docx").replaceAll("\n", "\r\n")],
  ["a header after leading spaces", patch("*** Add File: notes.txt", "+x", "  *** Delete File: important.docx")],
  ["a move", patch("*** Update File: report.docx", "*** Move to: important.docx", "@@", "-a", "+b")],
  [
    "an end of file, then a header",
    patch("*** Update File: report.docx", "@@", "-a", "+b", "*** End of File", "*** Delete File: important.docx"),
  ],
];

describe("Codex's patches, read as Codex reads them", () => {
  const paths = (changes: { path: string }[] | null) => changes?.map((c) => c.path).sort();

  it("sees every file in the patches that once hid one", () => {
    const want: Record<string, string[]> = {
      "an end inside an Add, then a Delete": ["/w/important.docx", "/w/notes.txt"],
      "an end inside an Add, then an Update": ["/w/notes.txt", "/w/report.docx"],
      "a Delete after U+0085": ["/w/important.docx", "/w/notes.txt"],
      "an Add ending in U+0085": ["/w/report.docx"],
      "CRLF lines": ["/w/important.docx", "/w/notes.txt"],
      "a header after leading spaces": ["/w/important.docx", "/w/notes.txt"],
      "a move": ["/w/report.docx"],
      "an end of file, then a header": ["/w/important.docx", "/w/report.docx"],
    };
    for (const [name, text] of HOSTILE) {
      expect(paths(patchChanges(text, "/w")), name).toEqual(want[name]);
      expect(paths(commandPatch(heredoc(text), "/w")), name).toEqual(want[name]);
    }
    expect(patchChanges(HOSTILE[6]?.[1] ?? "", "/w")).toEqual([
      { path: "/w/report.docx", kind: "update", movedTo: "/w/important.docx" },
    ]);
  });

  it("reads an indented header inside an Update as one of its lines, as Codex does", () => {
    expect(patchChanges(patch("*** Update File: a.txt", "@@", "-x", "+y", " *** Delete File: b.txt"), "/w")).toEqual([
      { path: "/w/a.txt", kind: "update" },
    ]);
    // An indented end inside an Update is a line too, so the patch goes on to the real end.
    expect(
      paths(
        patchChanges(patch("*** Update File: a.txt", "@@", "-x", " *** End Patch", "*** Delete File: b.txt"), "/w"),
      ),
    ).toEqual(["/w/a.txt", "/w/b.txt"]);
  });

  it("refuses what Codex refuses, and what it can't be sure to read as Codex does", () => {
    for (const [name, text] of [
      ["no end", "*** Begin Patch\n*** Delete File: a.txt"],
      ["text after the end", `${patch("*** Delete File: a.txt")}\n*** Delete File: b.txt`],
      ["an empty Update", patch("*** Update File: a.txt", "*** Delete File: b.txt")],
      ["a line that's not a patch's", patch("*** Add File: a.txt", "x")],
      ["another environment", patch("*** Environment ID: remote", "*** Delete File: a.txt")],
    ])
      expect(patchChanges(text as string, "/w"), name).toBeNull();
    // A <<EOF heredoc's lines around the patch, which Codex takes off.
    expect(patchChanges(`<<'EOF'\n${patch("*** Delete File: a.txt")}\nEOF`, "/w")).toEqual([
      { path: "/w/a.txt", kind: "delete" },
    ]);
  });

  it("refuses a patch in a command that the shell may change before apply_patch reads it", () => {
    const body = patch("*** Add File: a.txt", "+$(printf 'x')");
    expect(commandPatch(`apply_patch <<EOF\n${body}\nEOF`, "/w")).toBeNull();
    expect(commandPatch(`apply_patch <<"EOF"\n${body}\nEOF`, "/w")).toEqual([{ path: "/w/a.txt", kind: "add" }]);
    expect(commandPatch(`apply_patch <<\\EOF\n${body}\nEOF`, "/w")).toEqual([{ path: "/w/a.txt", kind: "add" }]);
    // A patch with no end, or one Codex refuses, isn't read either.
    expect(commandPatch("apply_patch <<'EOF'\n*** Begin Patch\n*** Delete File: a.txt\nEOF", "/w")).toBeNull();
  });
});

/** The installed Codex, when this computer has one: its apply_patch needs no sign-in. Set TOST_WORK_LIVE to run it. */
const codexBin =
  process.platform !== "win32" ? spawnSync("sh", ["-c", "command -v codex"]).stdout.toString().trim() : "";

describe.runIf(process.env.TOST_WORK_LIVE && codexBin)("Codex's own apply_patch", () => {
  /** The files in a folder, with their contents. */
  const snapshot = async (dir: string) =>
    Object.fromEntries(
      await Promise.all((await readdir(dir)).map(async (f) => [f, await readFile(join(dir, f), "utf8")] as const)),
    );

  it("changes only files the gate names, given each patch as the tool and in a heredoc", async () => {
    for (const [name, text] of HOSTILE)
      for (const form of ["tool", "heredoc"] as const) {
        const dir = await mkdtemp(join(tmpdir(), "tw-patch-"));
        try {
          await writeFile(join(dir, "important.docx"), "keep\n");
          await writeFile(join(dir, "report.docx"), "a\n");
          const before = await snapshot(dir);
          const run =
            form === "tool"
              ? spawnSync(codexBin, ["--codex-run-as-apply-patch", text], { cwd: dir })
              : spawnSync("sh", ["-c", `${codexBin} --codex-run-as-apply-patch "$(cat <<'EOF'\n${text}\nEOF\n)"`], {
                  cwd: dir,
                });
          expect(run.status, `${name} (${form}): ${run.stderr}`).toBe(0);
          const after = await snapshot(dir);
          const touched = [...new Set([...Object.keys(before), ...Object.keys(after)])]
            .filter((f) => before[f] !== after[f])
            .map((f) => join(dir, f));
          const named = (form === "tool" ? patchChanges(text, dir) : commandPatch(heredoc(text), dir)) ?? [];
          const seen = named.flatMap((c) => [c.path, c.movedTo]);
          expect(touched.length, `${name} (${form})`).toBeGreaterThan(0);
          for (const file of touched) expect(seen, `${name} (${form})`).toContain(file);
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      }
  });
});

describe("Codex's hook calls", () => {
  const call = (tool: string, input: unknown) => ({ id: "call_1", tool, input, cwd: "/w" });

  it("reads the hook's input, and nothing without the fields the policy needs", () => {
    const body = {
      session_id: "s",
      turn_id: "t",
      cwd: "/w",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "ls" },
      tool_use_id: "call_1",
    };
    expect(hookCall(body)).toEqual({ id: "call_1", tool: "Bash", input: { command: "ls" }, cwd: "/w" });
    for (const missing of ["tool_name", "tool_use_id", "cwd"])
      expect(hookCall({ ...body, [missing]: undefined }), missing).toBeNull();
    expect(hookCall(null)).toBeNull();
    expect(hookCall("Bash")).toBeNull();
  });

  it("turns each kind of step into what the policy decides on", () => {
    expect(gateRequest(call("Bash", { command: "ls" }))).toEqual({
      command: { id: "call_1", tool: "command", input: { command: "ls" } },
    });
    expect(gateRequest(call("apply_patch", { command: patch("*** Add File: a.md", "+a") }))).toEqual({
      change: { id: "call_1", tool: "file_change", input: { changes: [{ path: "/w/a.md", kind: "add" }] } },
    });
    // A patch inside a command is a command and a file change: both must pass.
    expect(gateRequest(call("Bash", { command: heredoc(patch("*** Delete File: a.md")) }))).toMatchObject({
      command: { tool: "command" },
      change: { tool: "file_change", input: { changes: [{ path: "/w/a.md", kind: "delete" }] } },
    });
    expect(
      gateRequest(call("apply_patch", { command: patch("*** Update File: a", "*** Move to: b", "@@", "-x", "+y") })),
    ).toEqual({
      change: {
        id: "call_1",
        tool: "file_change",
        input: { changes: [{ path: "/w/a", kind: "update", move_path: "/w/b" }] },
      },
    });
    expect(gateRequest(call("mcp__tost_work__ask_user", { questions: [] }))).toEqual({
      other: { id: "call_1", tool: "mcp:tost_work/ask_user", input: { questions: [] } },
    });
    expect(gateRequest(call("update_plan", { plan: [] }))).toEqual({
      other: { id: "call_1", tool: "update_plan", input: { plan: [] } },
    });
  });

  it("refuses a patch it can't read", () => {
    expect(gateRequest(call("apply_patch", { command: "not a patch" }))).toMatchObject({ refuse: expect.any(String) });
    expect(gateRequest(call("Bash", { command: "apply_patch < fix.patch" }))).toMatchObject({
      refuse: expect.stringMatching(/couldn't read this patch/),
    });
  });
});

describe("opensShell", () => {
  it("finds shells and interpreters left waiting for typed commands", () => {
    for (const command of [
      "bash",
      "sh",
      "zsh -i",
      "bash --login",
      "/bin/bash",
      "env bash",
      "sudo -u bob sh",
      "bash -s",
      "cd out && bash",
      "ls; python3",
      "python",
      "python3 -i make.py",
      "python3 -",
      "node",
      "node -i",
      "ipython",
      "perl",
      "pwsh",
      "powershell -NoProfile",
      "powershell -NoExit -Command Get-Date",
      "pwsh -Command -",
      "cmd",
      "cmd.exe /k dir",
      '"C:\\Program Files\\PowerShell\\7\\pwsh.exe"',
      "& 'C:\\Python312\\python.exe'",
      "echo $(bash)",
      "bash 2>&1",
      // A shell that reads what's typed through a pipe, or behind a program that runs the one after it.
      "cat | sh",
      "cat | python3",
      "timeout 600 bash",
      "timeout -s KILL 10m sh",
      "setsid bash",
      "nohup bash",
      "env -i bash",
      "busybox sh",
      // -v is verbose for Python and bash, not a version.
      "python3 -v",
      "bash -v",
    ])
      expect(opensShell(command), command).toBe(true);
  });

  it("leaves alone a shell or an interpreter given something to run, or reading a pipe or a file", () => {
    for (const command of [
      "bash -c 'ls'",
      "bash -lc 'ls'",
      "sh make.sh",
      "bash make.sh 2>&1 | tee log.txt",
      "python3 make_docx.py",
      "python3 -c 'print(1)'",
      "python3 -m json.tool data.json",
      "python3 - <<'PY'\nprint(1)\nPY",
      "echo 'print(1)' | python3",
      "python3 < script.py",
      "node -e 'console.log(1)'",
      "node build.js",
      "pwsh -Command Get-Date",
      "powershell -NoProfile -File make.ps1",
      "pwsh make.ps1",
      "cmd /c dir",
      "officecli view report.docx",
      "ls -la && cat notes.txt",
      "echo bash",
      "grep -r python .",
      // Scripts by absolute path, which Codex usually runs, and a version or help that prints and ends.
      "python3 /work/task/convert.py",
      "bash /Users/mario/build.sh",
      "/usr/bin/python3 /tmp/x.py",
      "python3 --version",
      "python3 -V",
      "node -v && npm -v",
      "bash --version",
      "php -v",
      "perl -v",
      "pwsh -Version",
      "cmd /?",
      "cat build.sh | bash",
      "printf 'ls\\n' | sh",
      "timeout 600 bash make.sh",
    ])
      expect(opensShell(command), command).toBe(false);
  });
});
