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
    return q.options[1] ?? "";
  },
  approve: async (taskId, action, paths) => {
    calls.push({ taskId, tool: "approve", args: { action, paths } });
    return action === "overwrite";
  },
  reportFile: async (taskId, change) => {
    calls.push({ taskId, tool: "file", args: change });
  },
  review: async (taskId, review) => {
    calls.push({ taskId, tool: "review", args: review });
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

const textOf = (result: unknown) => (result as { content: { text: string }[] }).content[0]?.text;

describe("ToolServer", () => {
  it("lists the four Tost Work tools", async () => {
    const client = await connect(server.open("task-1"));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["ask_user", "report_file", "request_approval", "submit_review"]);
    await client.close();
  });

  it("routes each call to the task its token belongs to", async () => {
    const a = await connect(server.open("task-a"));
    const b = await connect(server.open("task-b"));
    const answer = await a.callTool({
      name: "ask_user",
      arguments: { question: "Who pays?", options: ["Us", "Them"] },
    });
    expect(textOf(answer)).toBe("Them");
    const decision = await b.callTool({
      name: "request_approval",
      arguments: { action: "delete", paths: ["/w/a.txt"] },
    });
    expect(textOf(decision)).toBe("refused");
    await b.callTool({
      name: "submit_review",
      arguments: { asked: [{ text: "A proposal" }], decided: [], check_yourself: [] },
    });
    expect(calls.map((c) => `${c.taskId}:${c.tool}`)).toEqual(["task-a:ask", "task-b:approve", "task-b:review"]);
    expect(calls[2]?.args).toEqual({ asked: [{ text: "A proposal" }], decided: [], checkYourself: [] });
    await Promise.all([a.close(), b.close()]);
  });

  it("rejects bad input before it reaches the handler", async () => {
    const client = await connect(server.open("task-1"));
    const oneOption = await client.callTool({ name: "ask_user", arguments: { question: "Ok?", options: ["Yes"] } });
    expect(oneOption.isError).toBe(true);
    const relative = await client.callTool({ name: "report_file", arguments: { path: "notes.txt", kind: "add" } });
    expect(relative.isError).toBe(true);
    expect(calls).toEqual([]);
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

  it("refuses to start twice", async () => {
    await expect(server.start()).rejects.toThrow(/already running/);
  });

  it("tells the handler when the agent's connection drops while it waits", async () => {
    let seen: AbortSignal | undefined;
    const waiting = new ToolServer({
      ...handler,
      ask: (_taskId, _q, signal) => {
        seen = signal;
        return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("gone"))));
      },
    });
    await waiting.start();
    const client = await connect(waiting.open("task-1"));
    const call = client
      .callTool({ name: "ask_user", arguments: { question: "?", options: ["a", "b"] } })
      .catch(() => "dropped");
    for (let i = 0; i < 100 && !seen; i++) await new Promise((r) => setTimeout(r, 5));
    expect(seen?.aborted).toBe(false);
    // As when the agent's process exits: its connection closes.
    await client.close();
    expect(await call).toBe("dropped");
    for (let i = 0; i < 100 && !seen?.aborted; i++) await new Promise((r) => setTimeout(r, 5));
    expect(seen?.aborted).toBe(true);
    await waiting.stop();
  });
});
