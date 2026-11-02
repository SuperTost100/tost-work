/** @vitest-environment node */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../shared/model";
import { buildInfo, type InfoInput, logsZip, logsZipName, within } from "./exportLogs";

const EMAIL = "giulia.rossi@example.com";
const KEY = "sk-ant-api03-Abcdefghijklmnopqrstuvwxyz0123456789";

const input: InfoInput = {
  version: "0.0.21",
  build: "abc1234",
  os: { platform: "darwin", release: "25.1.0", arch: "arm64" },
  electron: "45.0.0",
  chrome: "150.0.0.0",
  window: { width: 1100, height: 760 },
  systemLanguage: "it-IT",
  settings: {
    ...DEFAULT_SETTINGS,
    name: "Giulia Rossi",
    work: "Accountant at Alpi Logistica",
    notes: `Write to ${EMAIL}. My key is ${KEY}`,
    level: "expert",
    debug: true,
    sections: { board: false },
    modelPick: { ai: "claude", model: "claude-opus-5-5", effort: "high" },
  },
  accounts: {
    codex: { installed: true, version: "0.164.0", loggedIn: true, account: EMAIL, plan: "plus" },
    claude: { installed: true, version: "2.1.310", loggedIn: false },
  },
  key: { vendor: "anthropic", last4: "6789" },
  at: "2026-11-02T15:30:00.000Z",
};

describe("buildInfo", () => {
  it("reports versions, window, settings, connected AIs and CLI versions", () => {
    expect(buildInfo(input)).toMatchObject({
      app: { version: "0.0.21", build: "abc1234" },
      os: { platform: "darwin", release: "25.1.0", arch: "arm64" },
      electron: "45.0.0",
      chrome: "150.0.0.0",
      window: { width: 1100, height: 760 },
      language: null,
      systemLanguage: "it-IT",
      level: "expert",
      theme: "system",
      textSize: "normal",
      sections: { skills: true, quickEdit: true, jobs: true, board: false },
      modelPick: { ai: "claude", model: "claude-opus-5-5", effort: "high" },
      ais: [
        { ai: "chatgpt", kind: "subscription", connected: true },
        { ai: "claude", kind: "subscription", connected: false },
        { ai: "key", kind: "api-key", connected: true, vendor: "anthropic" },
      ],
      clis: { codex: { installed: true, version: "0.164.0" }, claude: { installed: true, version: "2.1.310" } },
    });
  });

  it("leaves out the user's text, the account's address and plan, and the key", () => {
    const text = JSON.stringify(buildInfo(input));
    for (const secret of [EMAIL, "Giulia", "Rossi", "Alpi Logistica", KEY, "sk-ant", "6789", "plus"])
      expect(text).not.toContain(secret);
  });

  it("marks a CLI that couldn't be checked", () => {
    const info = buildInfo({ ...input, accounts: { codex: null, claude: null }, key: null, window: null });
    expect(info.clis).toEqual({ codex: null, claude: null });
    expect(info.ais.map((a) => a.connected)).toEqual([null, null, false]);
    expect(info.window).toBeNull();
  });
});

describe("logsZipName", () => {
  it("has the version and the local date and time", () => {
    expect(logsZipName("0.0.21", new Date(2026, 10, 2, 9, 5))).toBe("tost-work-logs-0.0.21-20261102-0905.zip");
  });
});

describe("logsZip", () => {
  it("holds the files under their names and info.json", async () => {
    const data = await logsZip(
      [
        { name: "app.log", data: Buffer.from("line\n") },
        { name: "tasks/abc.jsonl", data: Buffer.from('{"type":"run"}\n') },
      ],
      { app: { version: "0.0.21" } },
    );
    const zip = await JSZip.loadAsync(data);
    expect(Object.keys(zip.files).sort()).toEqual(["app.log", "info.json", "tasks/abc.jsonl"]);
    expect(await zip.file("app.log")?.async("string")).toBe("line\n");
    expect(JSON.parse((await zip.file("info.json")?.async("string")) ?? "")).toEqual({ app: { version: "0.0.21" } });
  });
});

describe("within", () => {
  it("gives the result, or null when the work fails or is too slow", async () => {
    expect(await within(50, Promise.resolve(3))).toBe(3);
    expect(await within(50, Promise.reject(new Error("no")))).toBeNull();
    expect(await within(10, new Promise<number>(() => {}))).toBeNull();
  });
});
