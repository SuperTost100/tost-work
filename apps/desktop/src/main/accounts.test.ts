/** @vitest-environment node */
import type { LoginEvent, LoginSession } from "cli-funnel";
import { describe, expect, it } from "vitest";
import type { SignInEvent } from "../shared/api";
import { type AccountSource, Accounts } from "./accounts";

function source(events: LoginEvent[], state = { installed: true, loggedIn: false }) {
  const codes: string[] = [];
  const src: AccountSource = {
    detect: async () => ({ installed: state.installed, version: "0.158.0", testedRange: { min: "0.150.0" } }),
    authStatus: async () => (state.loggedIn ? { loggedIn: true, account: "giulia@example.com" } : { loggedIn: false }),
    login: (): LoginSession => ({
      sendCode: (code) => codes.push(code),
      cancel: () => {},
      async *[Symbol.asyncIterator]() {
        for (const e of events) {
          if (e.type === "done") state.loggedIn = true;
          yield e;
        }
      },
    }),
  };
  return { src, codes };
}

const setup = (events: LoginEvent[], state?: { installed: boolean; loggedIn: boolean }) => {
  const { src, codes } = source(events, state);
  const seen: SignInEvent[] = [];
  const opened: string[] = [];
  const accounts = new Accounts(
    src,
    (e) => seen.push(e),
    async (url) => {
      if (url.includes("fail")) throw new Error("no browser");
      opened.push(url);
    },
  );
  return { accounts, seen, opened, codes };
};

describe("Accounts", () => {
  it("reports Codex missing without asking for an account", async () => {
    const { accounts } = setup([], { installed: false, loggedIn: false });
    expect(await accounts.status()).toEqual({ installed: false, loggedIn: false });
  });

  it("opens the sign-in page only when Codex didn't, and ends with the account", async () => {
    const { accounts, seen, opened } = setup([
      { type: "open-url", url: "https://auth.openai.com/a", opened: true },
      { type: "open-url", url: "https://auth.openai.com/b" },
      { type: "done", status: { loggedIn: true } },
    ]);
    await accounts.signIn();
    expect(opened).toEqual(["https://auth.openai.com/b"]);
    expect(seen.map((e) => e.type)).toEqual(["link", "link", "done"]);
    expect(seen.at(-1)).toMatchObject({ account: { loggedIn: true, account: "giulia@example.com" } });
  });

  it("never opens a link that isn't a web page", async () => {
    const { accounts, seen, opened } = setup([{ type: "open-url", url: "file:///etc/passwd" }]);
    await accounts.signIn();
    expect(opened).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("passes the code on, and allows one sign-in at a time", async () => {
    const { accounts, seen, codes } = setup([{ type: "code-prompt", message: "Paste the code" }]);
    const flow = accounts.signIn();
    expect(() => accounts.signIn()).toThrow(/already open/);
    accounts.sendCode("ABCD-1234");
    await flow;
    expect(codes).toEqual(["ABCD-1234"]);
    expect(seen).toEqual([{ type: "code", message: "Paste the code" }]);
    expect(() => accounts.sendCode("x")).toThrow(/No sign-in/);
  });

  it("turns errors into events instead of throwing", async () => {
    const { accounts, seen } = setup([{ type: "error", message: "Timed out" }]);
    await accounts.signIn();
    expect(seen).toEqual([{ type: "error", message: "Timed out" }]);
  });

  it("says so when the browser doesn't open, and still shows the link", async () => {
    const { accounts, seen } = setup([{ type: "open-url", url: "https://auth.openai.com/fail" }]);
    await accounts.signIn();
    expect(seen[0]).toEqual({ type: "link", url: "https://auth.openai.com/fail" });
    expect(seen[1]).toMatchObject({ type: "error", message: expect.stringMatching(/browser didn't open/) });
  });

  it("drops what a cancelled sign-in still had queued", async () => {
    const { accounts, seen } = setup([
      { type: "code-prompt", message: "old prompt" },
      { type: "done", status: { loggedIn: true } },
    ]);
    const flow = accounts.signIn();
    accounts.cancel();
    await flow;
    expect(seen).toEqual([]);
  });
});
