/** @vitest-environment node */
// Every test here stands in for cli-funnel: no report ever reaches OpenAI or Anthropic.
import { createFunnel, type FeedbackReport, type FeedbackSupport, FunnelError, type ProviderId } from "cli-funnel";
import { describe, expect, it, vi } from "vitest";
import type { Task } from "../shared/model";
import { fakeFeedback } from "./engine/fake";
import {
  CLASSIFICATION,
  cardFor,
  type ReportDeps,
  type ReportFunnel,
  ResultReports,
  reasonText,
  reportProvider,
} from "./reportResult";
import { UserError } from "./userError";

const task = (over: Partial<Task> = {}): Task => ({
  id: "t1",
  projectId: "p1",
  title: "Prepara il listino prezzi 2027",
  brief: "The client's price list, with their VAT number",
  attachments: [],
  workdir: "/tmp/p1",
  provider: "codex",
  auth: "account",
  model: "gpt-6.1-terra",
  effort: "medium",
  status: "done",
  steps: [],
  files: [],
  messages: [],
  question: null,
  approval: null,
  review: null,
  sessionId: "thread-123",
  error: null,
  createdAt: "2026-11-10T10:00:00Z",
  updatedAt: "2026-11-10T10:00:00Z",
  ...over,
});

// cli-funnel's real channels, which it reads without starting anything. Its sendFeedback is never called here.
const real = createFunnel({ apiKeys: {} });

/** cli-funnel's channels with a send that only records what it was given. */
function stubFunnel(send: ReportFunnel["sendFeedback"] = async (id) => ({ provider: id, sent: true, reportId: "r1" })) {
  const sendFeedback = vi.fn(send);
  const funnel: ReportFunnel = { feedbackSupport: (id) => real.feedbackSupport(id), sendFeedback };
  return { funnel, sendFeedback };
}

function reports(over: Partial<ReportDeps> & { tasks?: Task[] } = {}) {
  const tasks = over.tasks ?? [task()];
  const deps: ReportDeps = {
    feedback: stubFunnel().funnel,
    task: (id) => tasks.find((t) => t.id === id),
    env: () => ({ PATH: "/opt/officecli:/usr/bin" }),
    open: vi.fn(async () => {}),
    log: vi.fn(),
    app: { version: "0.0.34-dev", build: "abc1234" },
    ...over,
  };
  return { reports: new ResultReports(deps), deps };
}

const input = { kind: "offensive", note: "It insulted the client.", attach: false };

describe("which channel a task reports on", () => {
  it("is the task's own CLI on a subscription, and the vendor's API on the course key", () => {
    expect(reportProvider(task())).toBe("codex");
    expect(reportProvider(task({ provider: "claude" }))).toBe("claude");
    expect(reportProvider(task({ provider: undefined }))).toBe("codex");
    expect(reportProvider(task({ auth: "key" }))).toBe("openai-api");
    expect(reportProvider(task({ provider: "claude", auth: "key" }))).toBe("anthropic-api");
  });

  it("gives every AI the app runs a card, from what cli-funnel says", () => {
    const shape = (t: Task) => cardFor(t, real.feedbackSupport(reportProvider(t)));
    expect(shape(task())).toEqual({ how: "send", maker: "OpenAI", ai: "ChatGPT", model: "gpt-6.1-terra" });
    expect(shape(task({ provider: "claude", model: "claude-opus-5-5" }))).toEqual({
      how: "email",
      maker: "Anthropic",
      ai: "Claude",
      model: "claude-opus-5-5",
    });
    expect(shape(task({ auth: "key" })).how).toBe("form");
    expect(shape(task({ provider: "claude", auth: "key" })).how).toBe("email");
  });

  it("has a card for each shape a channel can have", () => {
    const support = (s: Partial<FeedbackSupport>): FeedbackSupport => ({ provider: "codex", send: false, ...s });
    expect(cardFor(task(), support({ send: true })).how).toBe("send");
    expect(cardFor(task(), support({ channel: { email: "a@b.com", url: "https://b.com", sources: [] } })).how).toBe(
      "email",
    );
    expect(cardFor(task(), support({ channel: { url: "https://b.com/form", sources: [] } })).how).toBe("form");
    expect(cardFor(task(), support({ channel: { note: "In the app", sources: [] } })).how).toBe("none");
    expect(cardFor(task(), support({})).how).toBe("none");
    // Only an https page and a plain address are ever opened.
    expect(cardFor(task(), support({ channel: { url: "file:///etc/passwd", sources: [] } })).how).toBe("none");
    expect(cardFor(task(), support({ channel: { email: "a@b.com?bcc=c@d.com", sources: [] } })).how).toBe("none");
  });
});

describe("the report", () => {
  it("sends a harmful result as a bad result, never as a safety check, with the kind first in the reason", async () => {
    const { funnel, sendFeedback } = stubFunnel();
    const { reports: r } = reports({ feedback: funnel });
    expect(await r.report("t1", input)).toBe("sent");
    expect(sendFeedback).toHaveBeenCalledWith(
      "codex",
      {
        classification: "bad_result",
        sessionId: "thread-123",
        reason: "Offensive: It insulted the client.",
        includeLogs: false,
      },
      { env: { PATH: "/opt/officecli:/usr/bin" } },
    );
    expect(Object.values(CLASSIFICATION)).not.toContain("safety_check");
    expect(CLASSIFICATION.other).toBe("other");
    expect(reasonText("dangerous", "  ")).toBe("Dangerous or illegal");
  });

  it("attaches the conversation only when the box is ticked", async () => {
    const { funnel, sendFeedback } = stubFunnel();
    const { reports: r } = reports({ feedback: funnel });
    await r.report("t1", { ...input, attach: true });
    expect((sendFeedback.mock.calls[0]?.[1] as FeedbackReport | undefined)?.includeLogs).toBe(true);
  });

  it("doesn't try again after a send that timed out, and says it may have arrived", async () => {
    const { funnel, sendFeedback } = stubFunnel(async () => {
      throw new FunnelError("feedback/upload failed: Codex did not answer feedback/upload in time.", "cli-failed");
    });
    const { reports: r, deps } = reports({ feedback: funnel });
    const err = await r.report("t1", input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserError);
    expect((err as UserError).key).toBe("error.reportMaybeSent");
    expect((err as UserError).message).toMatch(/^OpenAI didn't confirm the report in time\. It may have arrived/);
    expect(sendFeedback).toHaveBeenCalledTimes(1);
    expect(deps.log).toHaveBeenCalledWith(
      "warn",
      expect.any(String),
      expect.not.objectContaining({ note: expect.anything() }),
    );
  });

  it("refuses a second send while the first is on its way", async () => {
    let finish: () => void = () => {};
    const { funnel, sendFeedback } = stubFunnel(
      (id) =>
        new Promise((resolve) => {
          finish = () => resolve({ provider: id, sent: true, reportId: "r1" });
        }),
    );
    const { reports: r } = reports({ feedback: funnel });
    const first = r.report("t1", input);
    await expect(r.report("t1", input)).rejects.toMatchObject({ key: "error.reportSending" });
    finish();
    expect(await first).toBe("sent");
    expect(sendFeedback).toHaveBeenCalledTimes(1);
  });

  it("opens the mail app for Claude, with the kind, the note, the model and the version, and not the task's text", async () => {
    const { funnel, sendFeedback } = stubFunnel();
    const claude = task({ provider: "claude", model: "claude-opus-5-5" });
    const { reports: r, deps } = reports({ feedback: funnel, tasks: [claude] });
    expect(await r.report("t1", { kind: "sexual", note: "Rude words", attach: true })).toBe("email");
    expect(sendFeedback).not.toHaveBeenCalled();
    const url = vi.mocked(deps.open).mock.calls[0]?.[0] ?? "";
    expect(url.startsWith("mailto:usersafety@anthropic.com?subject=")).toBe(true);
    const body = decodeURIComponent(new URL(url).searchParams.get("body") ?? "");
    expect(body).toContain("Kind: Sexual or violent");
    expect(body).toContain("What happened: Rude words");
    expect(body).toContain("claude-opus-5-5");
    expect(body).toContain("Tost Work 0.0.34-dev, build abc1234");
    expect(body).not.toContain(claude.brief);
    expect(body).not.toContain(claude.title);
  });

  it("opens the maker's form for a task on an OpenAI key, and sends nothing itself", async () => {
    const { funnel, sendFeedback } = stubFunnel();
    const { reports: r, deps } = reports({ feedback: funnel, tasks: [task({ auth: "key" })] });
    expect(await r.report("t1", input)).toBe("form");
    expect(deps.open).toHaveBeenCalledWith("https://openai.com/form/report-content/");
    expect(sendFeedback).not.toHaveBeenCalled();
  });

  it("refuses when the AI has nowhere to report to", async () => {
    const none: ReportFunnel = {
      ...stubFunnel().funnel,
      feedbackSupport: (id: ProviderId) => ({ provider: id, send: false }),
    };
    const { reports: r, deps } = reports({ feedback: none });
    expect(r.card("t1").how).toBe("none");
    await expect(r.report("t1", input)).rejects.toThrow();
    expect(deps.open).not.toHaveBeenCalled();
  });

  it("logs what was reported, never the note", async () => {
    const { reports: r, deps } = reports();
    await r.report("t1", { ...input, kind: "other" });
    expect(deps.log).toHaveBeenCalledWith("info", "AI result report sent", {
      taskId: "t1",
      provider: "codex",
      kind: "other",
      attached: false,
    });
    expect(JSON.stringify(vi.mocked(deps.log).mock.calls)).not.toContain(input.note);
  });
});

describe("what the window sends", () => {
  it("is checked before anything is sent", async () => {
    const { funnel, sendFeedback } = stubFunnel();
    const { reports: r } = reports({ feedback: funnel, tasks: [task(), task({ id: "draft", status: "draft" })] });
    await expect(r.report("nope", input)).rejects.toMatchObject({ key: "error.noTask" });
    await expect(r.report(42, input)).rejects.toThrow("id must be text");
    await expect(r.report("draft", input)).rejects.toThrow();
    await expect(r.report("t1", { ...input, kind: "safety_check" })).rejects.toThrow(/kind must be one of/);
    await expect(r.report("t1", { ...input, attach: "yes" })).rejects.toThrow("attach must be true or false");
    await expect(r.report("t1", { ...input, note: "x".repeat(2001) })).rejects.toThrow("note is too long");
    await expect(r.report("t1", null)).rejects.toThrow();
    // A provider, session or address from the window is never used.
    await r.report("t1", { ...input, provider: "claude", sessionId: "other", email: "x@y.com" });
    expect(sendFeedback).toHaveBeenCalledTimes(1);
    expect(sendFeedback.mock.calls[0]?.[0]).toBe("codex");
    expect((sendFeedback.mock.calls[0]?.[1] as FeedbackReport | undefined)?.sessionId).toBe("thread-123");
  });
});

describe("the fake engine's reports", () => {
  it("never leaves the computer, and can fail or have nowhere to go", async () => {
    vi.useFakeTimers();
    try {
      const ok = fakeFeedback(real, "", 10).sendFeedback("codex", { classification: "bad_result" });
      vi.advanceTimersByTime(10);
      await expect(ok).resolves.toMatchObject({ sent: true });
      const failing = fakeFeedback(real, "fail", 10).sendFeedback("codex", { classification: "bad_result" });
      const caught = failing.catch((e: unknown) => e);
      vi.advanceTimersByTime(10);
      expect(await caught).toBeInstanceOf(FunnelError);
    } finally {
      vi.useRealTimers();
    }
    expect(fakeFeedback(real, "none").feedbackSupport("codex")).toEqual({ provider: "codex", send: false });
    expect(fakeFeedback(real).feedbackSupport("claude").channel?.email).toBe("usersafety@anthropic.com");
  });
});
