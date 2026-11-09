/** @vitest-environment node */
import { request } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ToolHandler, ToolServer } from "./server";

const calls: { taskId: string; tool: string; args: unknown }[] = [];
const handler: ToolHandler = {
  ask: async (taskId, q) => {
    calls.push({ taskId, tool: "ask", args: q });
    return `asked: ${q.map((x) => x.text).join(" | ")}`;
  },
  approve: async (taskId, action, paths) => {
    calls.push({ taskId, tool: "approve", args: { action, paths } });
    return `requested: ${action}`;
  },
  makePdf: async (taskId, path) => {
    calls.push({ taskId, tool: "pdf", args: path });
    return `made: ${path.replace(/\.docx$/, ".pdf")}`;
  },
  reportFile: async (taskId, change) => {
    calls.push({ taskId, tool: "file", args: change });
  },
  review: async (taskId, review) => {
    calls.push({ taskId, tool: "review", args: review });
  },
  gate: async (taskId, step) => {
    calls.push({ taskId, tool: "gate", args: step });
    if ((step as { tool_name?: string }).tool_name === "boom") throw new Error("the policy broke");
    return (step as { tool_name?: string }).tool_name === "Bash"
      ? { decision: "allow" }
      : { decision: "deny", reason: "not that" };
  },
};

let server: ToolServer;
beforeEach(async () => {
  calls.length = 0;
  server = new ToolServer(handler);
  await server.start();
});
afterEach(() => server.stop());

async function connect(session: { url: string; token: string }) {
  const client = new Client({ name: "test", version: "1" });
  const transport = new StreamableHTTPClientTransport(new URL(session.url), {
    requestInit: { headers: { Authorization: `Bearer ${session.token}` } },
  });
  await client.connect(transport);
  return client;
}

const raw = (url: string, headers: Record<string, string>) =>
  new Promise<number>((resolve, reject) => {
    const req = request(url, { method: "POST", headers: { "content-type": "application/json", ...headers } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end("{}");
  });

/** A POST to the hook's address, with its status and body. */
const post = (url: string, headers: Record<string, string>, body: string, method = "POST") =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(url, { method, headers: { "content-type": "application/json", ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(body);
  });

const textOf = (result: unknown) => (result as { content: { text: string }[] }).content[0]?.text;

describe("ToolServer", () => {
  it("lists the five Tost Work tools", async () => {
    const client = await connect(server.open("task-1"));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "ask_user",
      "make_pdf",
      "report_file",
      "request_approval",
      "submit_review",
    ]);
    await client.close();
  });

  it("passes make_pdf to the handler and returns what it says", async () => {
    const client = await connect(server.open("task-p"));
    const made = await client.callTool({ name: "make_pdf", arguments: { path: "/w/Proposta.docx" } });
    expect(textOf(made)).toBe("made: /w/Proposta.pdf");
    expect(calls.at(-1)).toEqual({ taskId: "task-p", tool: "pdf", args: "/w/Proposta.docx" });
    await client.close();
  });

  it("routes each call to the task its token belongs to", async () => {
    const a = await connect(server.open("task-a"));
    const b = await connect(server.open("task-b"));
    const answer = await a.callTool({
      name: "ask_user",
      arguments: {
        questions: [
          { question: "Who pays?", options: ["Us", "Them"] },
          { question: "Which date?", options: ["Monday", "Friday"] },
        ],
      },
    });
    expect(textOf(answer)).toBe("asked: Who pays? | Which date?");
    const decision = await b.callTool({
      name: "request_approval",
      arguments: { action: "delete", paths: ["/w/a.txt"] },
    });
    expect(textOf(decision)).toBe("requested: delete");
    await b.callTool({
      name: "submit_review",
      arguments: { asked: [{ text: "A proposal" }], decided: [], check_yourself: [] },
    });
    expect(calls.map((c) => `${c.taskId}:${c.tool}`)).toEqual(["task-a:ask", "task-b:approve", "task-b:review"]);
    expect(calls[2]?.args).toEqual({ asked: [{ text: "A proposal" }], decided: [], checkYourself: [] });
    await Promise.all([a.close(), b.close()]);
  });

  it("takes open questions, without options or with an empty list", async () => {
    const client = await connect(server.open("task-o"));
    const asked = await client.callTool({
      name: "ask_user",
      arguments: {
        questions: [
          { question: "Describe the event" },
          { question: "List the guests", options: [] },
          { question: "Who pays?", options: ["Us", "Them"] },
        ],
      },
    });
    expect(asked.isError).toBeFalsy();
    expect(calls.at(-1)?.args).toEqual([
      { text: "Describe the event", options: [] },
      { text: "List the guests", options: [] },
      { text: "Who pays?", options: ["Us", "Them"] },
    ]);
    await client.close();
  });

  it("rejects bad input before it reaches the handler", async () => {
    const client = await connect(server.open("task-1"));
    const oneOption = await client.callTool({
      name: "ask_user",
      arguments: { questions: [{ question: "Ok?", options: ["Yes"] }] },
    });
    expect(oneOption.isError).toBe(true);
    // Sixteen questions a round at most: more wait for the next round.
    const many = Array.from({ length: 17 }, (_, i) => ({ question: `Q${i}?`, options: ["Yes", "No"] }));
    const tooMany = await client.callTool({ name: "ask_user", arguments: { questions: many } });
    expect(tooMany.isError).toBe(true);
    const sixteen = await client.callTool({ name: "ask_user", arguments: { questions: many.slice(0, 16) } });
    expect(sixteen.isError).toBeFalsy();
    const relative = await client.callTool({ name: "report_file", arguments: { path: "notes.txt", kind: "add" } });
    expect(relative.isError).toBe(true);
    // Only the round of sixteen got through.
    expect(calls.map((c) => c.tool)).toEqual(["ask"]);
    expect(calls[0]?.args).toHaveLength(16);
    await client.close();
  });

  it("refuses a missing, unknown or closed token", async () => {
    const session = server.open("task-1");
    const host = new URL(session.url).host;
    expect(await raw(session.url, { host })).toBe(401);
    expect(await raw(session.url, { host, authorization: "Bearer nope" })).toBe(401);
    server.close(session.token);
    expect(await raw(session.url, { host, authorization: `Bearer ${session.token}` })).toBe(401);
  });

  it("refuses requests from a web page or through another host name", async () => {
    const session = server.open("task-1");
    const auth = { authorization: `Bearer ${session.token}` };
    const port = new URL(session.url).port;
    expect(await raw(session.url, { ...auth, origin: "https://evil.example" })).toBe(403);
    expect(await raw(session.url, { ...auth, host: `evil.example:${port}` })).toBe(403);
  });

  it("answers a request target URL can't parse, instead of failing", async () => {
    const session = server.open("task-1");
    const port = new URL(session.url).port;
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port, path: "//", method: "POST", headers: { host: `127.0.0.1:${port}` } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end("{}");
    });
    expect(status).toBe(404);
  });

  it("passes Codex's hook to the gate of the task its token belongs to, and answers every step with a decision", async () => {
    const one = server.open("task-1");
    const two = server.open("task-2");
    const hook = new URL("/hook", one.url).toString();
    const step = (tool: string) => JSON.stringify({ tool_name: tool, tool_input: { command: "ls" } });
    const ask = (token: string, body: string) => post(hook, { authorization: `Bearer ${token}` }, body);

    expect(await ask(one.token, step("Bash"))).toEqual({ status: 200, body: '{"decision":"allow"}' });
    expect(JSON.parse((await ask(two.token, step("apply_patch"))).body)).toEqual({
      decision: "deny",
      reason: "not that",
    });
    expect(calls.map((c) => [c.taskId, (c.args as { tool_name: string }).tool_name])).toEqual([
      ["task-1", "Bash"],
      ["task-2", "apply_patch"],
    ]);
    // A body that isn't JSON, or a policy that fails, is a refusal: the hook lets a step run only on an allow.
    expect(JSON.parse((await ask(one.token, "not json")).body)).toMatchObject({ decision: "deny" });
    expect(JSON.parse((await ask(one.token, step("boom"))).body)).toEqual({
      decision: "deny",
      reason: "Tost Work couldn't check this step: the policy broke",
    });
    // The token is checked as for the tools, and only a POST is a step.
    expect((await post(hook, {}, step("Bash"))).status).toBe(401);
    expect((await post(hook, { authorization: "Bearer nope" }, step("Bash"))).status).toBe(401);
    expect((await post(hook, { authorization: `Bearer ${one.token}` }, "", "GET")).status).toBe(405);
    server.close(one.token);
    expect((await ask(one.token, step("Bash"))).status).toBe(401);
  });

  it("refuses to start twice", async () => {
    await expect(server.start()).rejects.toThrow(/already running/);
  });
});
