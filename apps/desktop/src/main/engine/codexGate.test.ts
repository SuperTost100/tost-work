/** @vitest-environment node */
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
        patch("*** Update File: note.txt", "*** Add File: sub\\new.md", "*** Delete File: C:\\Users\\Giulia\\x.docx"),
        work,
      ),
    ).toEqual([
      { path: `${work}\\note.txt`, kind: "update" },
      { path: `${work}\\sub\\new.md`, kind: "add" },
      { path: "C:\\Users\\Giulia\\x.docx", kind: "delete" },
    ]);
    expect(patchChanges(patch("*** Update File: ..\\elsewhere.txt"), work)).toEqual([
      { path: "C:\\Users\\Giulia\\Documents\\elsewhere.txt", kind: "update" },
    ]);
  });

  it("reads a patch given to apply_patch inside a command, from the folder its cd names", () => {
    const body = patch("*** Update File: note.txt", "@@", "-a", "+b");
    expect(commandPatch(heredoc(body), "/w")).toEqual([{ path: "/w/note.txt", kind: "update" }]);
    expect(commandPatch(heredoc(body, "cd sub && "), "/w")).toEqual([{ path: "/w/sub/note.txt", kind: "update" }]);
    expect(commandPatch(heredoc(body, "cd '/w/a b' && "), "/w")).toEqual([{ path: "/w/a b/note.txt", kind: "update" }]);
    expect(commandPatch(`applypatch "${body}"`, "/w")).toEqual([{ path: "/w/note.txt", kind: "update" }]);
    // A patch's text in a command that doesn't run apply_patch is only text, and a command without one changes nothing.
    expect(commandPatch(`cat > fix.patch <<'EOF'\n${body}\nEOF`, "/w")).toEqual([]);
    expect(commandPatch("ls -la", "/w")).toEqual([]);
  });

  it("can't read a patch from a file, or one that lands where another cd moved it", () => {
    expect(commandPatch("apply_patch < fix.patch", "/w")).toBeNull();
    expect(commandPatch("cat fix.patch | apply_patch", "/w")).toBeNull();
    expect(commandPatch(`${heredoc(patch("*** Add File: a.txt", "+a"))}apply_patch < more.patch`, "/w")).toBeNull();
    expect(commandPatch(heredoc(patch("*** Update File: note.txt"), "cd sub; "), "/w")).toBeNull();
    expect(commandPatch(heredoc(patch("*** Update File: note.txt"), "cd a && cd b && "), "/w")).toBeNull();
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
    expect(gateRequest(call("apply_patch", { command: patch("*** Update File: a", "*** Move to: b") }))).toEqual({
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
    ])
      expect(opensShell(command), command).toBe(false);
  });
});
