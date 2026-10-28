/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Task, type TaskStatus } from "../shared/model";
import { Notifier, notifyKind, type Shown } from "./notify";

const task = (status: TaskStatus, id = "t1") => ({ id, title: "Proposal", status }) as Task;

describe("notifyKind", () => {
  it("names a task that needs the user, failed, or finished a run", () => {
    expect(notifyKind("running", task("needs-you"))).toBe("needsYou");
    expect(notifyKind("running", task("failed"))).toBe("failed");
    expect(notifyKind("running", task("done"))).toBe("done");
    expect(notifyKind("needs-you", task("done"))).toBe("done");
  });

  it("stays quiet when nothing changed, or the user stopped it", () => {
    expect(notifyKind("needs-you", task("needs-you"))).toBeNull();
    expect(notifyKind("running", task("stopped"))).toBeNull();
    expect(notifyKind(undefined, task("done"))).toBeNull();
    expect(notifyKind("draft", task("running"))).toBeNull();
  });
});

describe("Notifier", () => {
  const make = (settings = DEFAULT_SETTINGS, looking = false) => {
    const shown: Shown[] = [];
    const n = new Notifier(
      () => settings,
      () => looking,
      (s) => shown.push(s),
    );
    return { n, shown };
  };

  it("follows each kind's setting: normal with sound, quiet without, off not at all", () => {
    const { n, shown } = make({ ...DEFAULT_SETTINGS, notify: { needsYou: "normal", failed: "quiet", done: "off" } });
    n.know([task("running", "a"), task("running", "b"), task("running", "c")]);
    n.changed(task("needs-you", "a"));
    n.changed(task("failed", "b"));
    n.changed(task("done", "c"));
    expect(shown).toEqual([
      { kind: "needsYou", taskId: "a", title: "Proposal", silent: false },
      { kind: "failed", taskId: "b", title: "Proposal", silent: true },
    ]);
  });

  it("says nothing with notifications off, while the user is looking, or twice for the same status", () => {
    const off = make({ ...DEFAULT_SETTINGS, notifications: false });
    off.n.know([task("running")]);
    off.n.changed(task("needs-you"));
    expect(off.shown).toEqual([]);

    const looking = make(DEFAULT_SETTINGS, true);
    looking.n.know([task("running")]);
    looking.n.changed(task("failed"));
    expect(looking.shown).toEqual([]);

    const twice = make();
    twice.n.know([task("running")]);
    twice.n.changed(task("needs-you"));
    twice.n.changed(task("needs-you"));
    expect(twice.shown).toHaveLength(1);
  });
});
