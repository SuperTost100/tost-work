/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings, type Project } from "../shared/model";
import {
  absolutePath,
  droppedInput,
  oneLine,
  PASTED_MAX_BYTES,
  paths,
  pickInput,
  placedTask,
  settingsPatch,
  taskInput,
  text,
} from "./validate";

describe("taskInput", () => {
  it("takes a brief, a project or none, and files, the same for starting now or later", () => {
    expect(taskInput({ brief: "  Sum up  ", projectId: "p1", attachments: ["/a.docx"] })).toEqual({
      brief: "Sum up",
      projectId: "p1",
      attachments: ["/a.docx"],
    });
    expect(taskInput({ brief: "Sum up" })).toEqual({ brief: "Sum up", projectId: null, attachments: [] });
  });

  it("takes files without a brief, as a chat app does, but not neither", () => {
    expect(taskInput({ brief: " ", attachments: ["/shot.png"] })).toEqual({
      brief: "",
      projectId: null,
      attachments: ["/shot.png"],
    });
    expect(() => taskInput({ brief: "", attachments: [] })).toThrow(/needs a brief/);
  });

  it("refuses an empty brief, odd projects and relative files", () => {
    expect(() => taskInput({ brief: "   " })).toThrow(/needs a brief/);
    expect(() => taskInput(null)).toThrow(/brief must be text/);
    expect(() => taskInput({ brief: "x", projectId: 3 })).toThrow(/projectId/);
    expect(() => taskInput({ brief: "x", attachments: ["notes.txt"] })).toThrow(/absolute/);
  });
});

describe("droppedInput", () => {
  it("takes paths and pasted files, with names that can only land in the folder they're written to", () => {
    const bytes = new Uint8Array([1, 2]);
    expect(
      droppedInput([
        { path: "/Users/g/a.docx" },
        { name: "../../etc/passwd", bytes },
        { name: "..", bytes },
        { name: "shot\u0007:1.png", bytes },
      ]),
    ).toEqual([
      { path: "/Users/g/a.docx" },
      { name: ".._.._etc_passwd", bytes },
      { name: "pasted", bytes },
      { name: "shot__1.png", bytes },
    ]);
  });

  it("refuses relative paths, missing bytes, too many files and a paste too big", () => {
    expect(() => droppedInput([{ path: "a.docx" }])).toThrow(/absolute/);
    expect(() => droppedInput([{ name: "a.png", bytes: "AAAA" }])).toThrow(/bytes/);
    expect(() => droppedInput(Array.from({ length: 21 }, () => ({ path: "/a" })))).toThrow(/at most/);
    expect(() => droppedInput([{ name: "a.png", bytes: new Uint8Array(PASTED_MAX_BYTES + 1) }])).toThrow(/too big/i);
  });
});

describe("pickInput", () => {
  it("reads the AI a new task asked for, and leaves the remembered one when it asked for none", () => {
    expect(pickInput({ brief: "x" })).toBeUndefined();
    expect(pickInput({ brief: "x", pick: null })).toBeUndefined();
    expect(pickInput({ pick: { preset: "thorough" } })).toEqual({ preset: "thorough" });
    expect(pickInput(null)).toBeUndefined();
  });

  it("refuses a pick the app couldn't have made", () => {
    expect(() => pickInput({ pick: { preset: "slow" } })).toThrow(/pick/);
    expect(() => pickInput({ pick: { ai: "claude", model: "x" } })).toThrow(/pick/);
    expect(() => pickInput({ pick: "balanced" })).toThrow(/pick/);
  });
});

describe("placedTask", () => {
  const projects: Record<string, Project> = {
    p1: {
      id: "p1",
      name: "Proposals",
      description: "",
      folder: "/home/giulia/Proposals",
      instructions: "",
      createdAt: "",
    },
    p2: { id: "p2", name: "Website", description: "", folder: "/home/giulia/Website", instructions: "", createdAt: "" },
  };
  const place = (input: unknown) =>
    placedTask(
      input,
      (id) => projects[id],
      () => "/tmp/tost-work/quick/new",
    );

  it("works in its project's folder, so moving a saved task to another project moves its folder too", () => {
    expect(place({ brief: "Rewrite About", projectId: "p1" }).workdir).toBe("/home/giulia/Proposals");
    expect(place({ brief: "Rewrite About", projectId: "p2" })).toEqual({
      brief: "Rewrite About",
      projectId: "p2",
      attachments: [],
      workdir: "/home/giulia/Website",
    });
    // Without a project it gets a temporary folder of its own, as a quick edit does.
    expect(place({ brief: "Fix the letter", projectId: null, attachments: ["/a.docx"] }).workdir).toBe(
      "/tmp/tost-work/quick/new",
    );
  });

  it("refuses an empty brief and a project that isn't there", () => {
    expect(() => place({ brief: "  ", projectId: "p1" })).toThrow(/needs a brief/);
    expect(() => place({ brief: "Rewrite About", projectId: "gone" })).toThrow(/doesn't exist/);
  });
});

describe("the board's settings", () => {
  it("keeps the view and the grouping, and refuses anything else", () => {
    expect(settingsPatch({ boardView: "columns", boardGroup: "project" })).toEqual({
      boardView: "columns",
      boardGroup: "project",
    });
    expect(() => settingsPatch({ boardView: "grid" })).toThrow(/boardView/);
    expect(() => settingsPatch({ boardGroup: "date" })).toThrow(/boardGroup/);
  });
});

describe("IPC validation", () => {
  it("accepts absolute paths and rejects empty or relative ones", () => {
    expect(absolutePath("/Users/giulia/Proposals", "folder")).toBe("/Users/giulia/Proposals");
    expect(() => absolutePath("", "folder")).toThrow(/absolute/);
    expect(() => absolutePath("Proposals", "folder")).toThrow(/absolute/);
    expect(() => absolutePath(42, "folder")).toThrow(/text/);
  });

  it("checks attachment lists", () => {
    expect(paths(undefined, "attachments")).toEqual([]);
    expect(paths(["/a.docx"], "attachments")).toEqual(["/a.docx"]);
    expect(() => paths("/a.docx", "attachments")).toThrow(/list/);
    expect(() => paths(["notes.docx"], "attachments")).toThrow(/absolute/);
    expect(() =>
      paths(
        Array.from({ length: 21 }, (_, i) => `/f${i}`),
        "attachments",
      ),
    ).toThrow(/at most 20/);
  });

  it("limits text length", () => {
    expect(() => text("x".repeat(11), "name", 10)).toThrow(/too long/);
  });
});

describe("oneLine", () => {
  it("puts a description's lines on one line, so editing it in a field changes nothing by itself", () => {
    expect(oneLine("  Quotes for\n\nthe Alpine   clients \t")).toBe("Quotes for the Alpine clients");
    expect(oneLine("   ")).toBe("");
  });
});

describe("settingsPatch", () => {
  it("keeps known settings and trims the name", () => {
    expect(settingsPatch({ name: " Giulia ", level: "expert", language: null, setupDone: true })).toEqual({
      name: "Giulia",
      level: "expert",
      language: null,
      setupDone: true,
    });
  });

  it("takes notifications and starting at login, and refuses unknown kinds or levels", () => {
    expect(
      settingsPatch({
        notifications: false,
        openAtLogin: true,
        stayInMenuBar: false,
        sidebarHidden: true,
        notify: { failed: "quiet" },
      }),
    ).toEqual({
      notifications: false,
      openAtLogin: true,
      stayInMenuBar: false,
      sidebarHidden: true,
      notify: { failed: "quiet" },
    });
    expect(() => settingsPatch({ notify: { email: "normal" } })).toThrow(/Unknown notification/);
    expect(() => settingsPatch({ notify: { done: "loud" } })).toThrow(/off, quiet or normal/);
    expect(() => settingsPatch({ openAtLogin: "yes" })).toThrow(/true or false/);
    expect(() => settingsPatch({ sidebarHidden: 1 })).toThrow(/true or false/);
  });

  it("takes the debug switch, on or off only, and keeps it on through a change of level", () => {
    expect(settingsPatch({ debug: true })).toEqual({ debug: true });
    expect(() => settingsPatch({ debug: "on" })).toThrow(/true or false/);
    const on = mergeSettings({ ...DEFAULT_SETTINGS, level: "expert" }, { debug: true });
    expect(mergeSettings(on, { level: "intermediate" }).debug).toBe(true);
  });

  it("takes the profile's work and notes, trimmed", () => {
    expect(settingsPatch({ work: " Formatrice ", notes: " Documenti brevi. " })).toEqual({
      work: "Formatrice",
      notes: "Documenti brevi.",
    });
    expect(() => settingsPatch({ notes: "x".repeat(4001) })).toThrow();
  });

  it("takes sections, text size and theme, and refuses anything else in them", () => {
    expect(settingsPatch({ sections: { jobs: false, board: true }, textSize: "large", theme: "dark" })).toEqual({
      sections: { jobs: false, board: true },
      textSize: "large",
      theme: "dark",
    });
    expect(() => settingsPatch({ sections: { code: true } })).toThrow(/Unknown section/);
    expect(() => settingsPatch({ sections: { toString: true } })).toThrow(/Unknown section/);
    expect(() => settingsPatch({ sections: { jobs: "on" } })).toThrow(/on or off/);
    expect(() => settingsPatch({ sections: null })).toThrow(/object/);
    expect(() => settingsPatch({ textSize: "huge" })).toThrow(/small, normal or large/);
    expect(() => settingsPatch({ theme: "blue" })).toThrow(/light, dark or system/);
  });

  it("takes the default AI, or null for the first one signed in", () => {
    expect(settingsPatch({ defaultAi: "claude" })).toEqual({ defaultAi: "claude" });
    expect(settingsPatch({ defaultAi: null })).toEqual({ defaultAi: null });
    expect(() => settingsPatch({ defaultAi: "gemini" })).toThrow(/chatgpt, claude, key or null/);
    expect(settingsPatch({ modelPick: { preset: "fast" } })).toEqual({ modelPick: { preset: "fast" } });
    const model = { ai: "claude", model: "claude-opus-5-5", effort: "high" };
    expect(settingsPatch({ modelPick: model })).toEqual({ modelPick: model });
    expect(() => settingsPatch({ modelPick: { preset: "slow" } })).toThrow(/modelPick/);
    expect(() => settingsPatch({ modelPick: { ai: "gemini", model: "x", effort: "low" } })).toThrow(/modelPick/);
    expect(() => settingsPatch({ modelPick: "balanced" })).toThrow(/modelPick/);
  });

  it("refuses unknown keys and wrong values", () => {
    expect(() => settingsPatch({ admin: true })).toThrow(/Unknown setting/);
    expect(() => settingsPatch({ level: "guru" })).toThrow(/four levels/);
    expect(() => settingsPatch({ language: "fr" })).toThrow(/en, it or null/);
    expect(() => settingsPatch({ setupDone: "yes" })).toThrow(/true or false/);
    expect(() => settingsPatch(["name"])).toThrow(/object/);
  });
});
