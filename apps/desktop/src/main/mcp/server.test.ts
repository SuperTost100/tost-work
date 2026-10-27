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

  it("refuses to start twice", async () => {
    await expect(server.start()).rejects.toThrow(/already running/);
  });
});
