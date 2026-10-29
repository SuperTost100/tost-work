/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { activityOf, commandActivity } from "./activity";

describe("activity", () => {
  it("words Claude Code's tools, from what a real run sent", () => {
    expect(activityOf("Read", { file_path: "/w/note.txt" })).toEqual({ kind: "read", target: "note.txt" });
    expect(activityOf("Read", { file_path: "/Users/g/Documents/Tost Work/Skills/voce-del-brand/SKILL.md" })).toEqual({
      kind: "skill",
      target: "voce-del-brand",
    });
    expect(activityOf("Write", { file_path: "/w/riassunto.txt", content: "x" })).toEqual({
      kind: "write",
      target: "riassunto.txt",
    });
    expect(activityOf("Edit", { file_path: "/w/riassunto.txt" })).toEqual({ kind: "edit", target: "riassunto.txt" });
    expect(activityOf("WebSearch", { query: "sito ufficiale comune di Biella" })).toEqual({
      kind: "web",
      target: "sito ufficiale comune di Biella",
    });
    expect(activityOf("WebFetch", { url: "https://www.comune.biella.it/x" })).toEqual({
      kind: "page",
      target: "comune.biella.it",
    });
    expect(activityOf("Bash", { command: "ls -la /w", description: "List files" })).toEqual({ kind: "folder" });
  });

  it("words Codex's tools, from what a real run sent", () => {
    expect(
      activityOf("file_change", { changes: [{ path: "/w/riassunto.txt", kind: { type: "add" }, diff: "x" }] }),
    ).toEqual({ kind: "write", target: "riassunto.txt" });
    expect(activityOf("file_change", { changes: [{ path: "/w/riassunto.txt", kind: { type: "update" } }] })).toEqual({
      kind: "edit",
      target: "riassunto.txt",
    });
    // Codex starts a search before it has the words.
    expect(activityOf("web_search", { query: "" })).toEqual({ kind: "web", target: undefined });
    expect(activityOf("command", { command: `/bin/bash -lc "sed -n '1,10p' riassunto.txt"` })).toEqual({
      kind: "read",
      target: "riassunto.txt",
    });
  });

  it("tells a built-in guide from a user's skill with the same folder name", () => {
    const guides = "/Applications/Tost Work.app/Contents/Resources/skills";
    expect(activityOf("Read", { file_path: `${guides}/word/SKILL.md` }, guides)).toEqual({
      kind: "skill",
      target: "@word",
    });
    expect(activityOf("Read", { file_path: "/Users/g/Documents/Tost Work/Skills/word/SKILL.md" }, guides)).toEqual({
      kind: "skill",
      target: "word",
    });
    expect(commandActivity(`/bin/bash -lc "sed -n '1,80p' '${guides}/excel/SKILL.md'"`, guides)).toEqual({
      kind: "skill",
      target: "@excel",
    });
  });

  it("says which skill a command reads, and what a command does to a document", () => {
    expect(commandActivity(`/bin/bash -lc "sed -n '1,200p' /Users/g/Skills/brand-voice/SKILL.md"`)).toEqual({
      kind: "skill",
      target: "brand-voice",
    });
    expect(commandActivity("officecli set Proposta.docx /body/p[1] --text Ciao")).toEqual({
      kind: "edit",
      target: "Proposta.docx",
    });
    expect(commandActivity("officecli view Proposta.docx")).toEqual({ kind: "read", target: "Proposta.docx" });
    // A name with spaces is quoted or escaped in the command, and the whole name counts, not its last word.
    const name = "Preventivo 2026-10-28 Ferrari & Figli.docx";
    expect(commandActivity(`officecli set "/w/clienti/${name}" /body/p[1] --text Ciao`)).toEqual({
      kind: "edit",
      target: name,
    });
    expect(commandActivity(`/bin/bash -lc "officecli view '/w/${name}'"`)).toEqual({ kind: "read", target: name });
    expect(commandActivity("cat Note\\ di\\ Giulia.txt")).toEqual({ kind: "read", target: "Note di Giulia.txt" });
    expect(commandActivity(`python3 -c "open('dati.xlsx')"`)).toEqual({ kind: "work", target: "dati.xlsx" });
    expect(commandActivity("cat O\\'Brien.txt")).toEqual({ kind: "read", target: "O'Brien.txt" });
    expect(commandActivity("cd /w&&cat note.txt>out.md")).toEqual({ kind: "read", target: "note.txt" });
    // The first document named is the one the command works on.
    expect(commandActivity(`officecli view a.docx "B c.docx"`)).toEqual({ kind: "read", target: "a.docx" });
    expect(commandActivity(`officecli view "Offerta dell'Acqua.docx"`)).toEqual({
      kind: "read",
      target: "Offerta dell'Acqua.docx",
    });
    expect(commandActivity("python3 make_table.py prezzi.xlsx")).toEqual({ kind: "work", target: "prezzi.xlsx" });
    expect(commandActivity("pwd && ls")).toEqual({ kind: "folder" });
    expect(commandActivity("npm --version")).toEqual({ kind: "command" });
  });

  it("leaves out the plan and Tost Work's own tools, which show on their own", () => {
    expect(activityOf("TodoWrite", {})).toBeNull();
    expect(activityOf("update_plan", {})).toBeNull();
    expect(activityOf("mcp__tost_work__ask_user", {})).toBeNull();
    expect(activityOf("mcp__tost_work__make_pdf", {})).toEqual({ kind: "pdf" });
  });
});
