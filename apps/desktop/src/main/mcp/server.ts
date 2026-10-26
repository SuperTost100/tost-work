import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { Review } from "../../shared/model";

/** What the tools do for a task. The engine that runs the task implements it. */
export interface ToolHandler {
  /**
   * Resolves with the user's answer, one of the options or their own words. `signal` aborts when the agent gives up
   * on the call, for example on disconnect; the handler should then take the question off the task.
   */
  ask(taskId: string, question: { text: string; options: string[] }, signal?: AbortSignal): Promise<string>;
  /** Resolves once the user decided, and after Tost Work kept copies or moved files to the Trash. */
  approve(taskId: string, action: "overwrite" | "delete", paths: string[], signal?: AbortSignal): Promise<boolean>;
  reportFile(taskId: string, change: { path: string; kind: "add" | "update" | "delete" }): Promise<void>;
  review(taskId: string, review: Review): Promise<void>;
}

const absolute = z
  .string()
  .min(1)
  .max(4096)
  .refine((p) => p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p), {
    message: "Use the file's absolute path",
  });
const item = z.object({ text: z.string().min(1).max(300), detail: z.string().max(300).optional() });
const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });

/** One agent session: its task, the MCP server and transport that live as long as it, and its open tool calls. */
interface Session {
  taskId: string;
  mcp?: { server: McpServer; transport: StreamableHTTPServerTransport };
  /** A controller for each tool call whose HTTP request is still open, by JSON-RPC id, keeping 1 and "1" apart. */
  open: Map<string | number, AbortController>;
}

function toolsFor(session: Session, handler: ToolHandler): McpServer {
  const { taskId } = session;
  // Aborts when the agent gives up: it cancels the call, or the connection carrying the call closes.
  const giveUp = (extra: { signal: AbortSignal; requestId: string | number }) => {
    const dropped = session.open.get(extra.requestId)?.signal;
    return dropped ? AbortSignal.any([extra.signal, dropped]) : extra.signal;
  };
  const server = new McpServer({ name: "tost-work", version: "0.0.1" });
  server.registerTool(
    "ask_user",
    {
      description:
        "Ask the user a question when the brief leaves a choice open. Give 2 to 4 short answer options; the user can also write their own. Waits for the answer.",
      inputSchema: {
        question: z.string().min(1).max(500),
        options: z.array(z.string().min(1).max(120)).min(2).max(4),
      },
    },
    async ({ question, options }, extra) => text(await handler.ask(taskId, { text: question, options }, giveUp(extra))),
  );
  server.registerTool(
    "request_approval",
    {
      description:
        "Ask before replacing or deleting existing files. Never overwrite or delete without it. If allowed, Tost Work keeps a copy of replaced files and moves deleted files to the Trash itself: don't delete them yourself.",
      inputSchema: { action: z.enum(["overwrite", "delete"]), paths: z.array(absolute).min(1).max(50) },
    },
    async ({ action, paths }, extra) =>
      text((await handler.approve(taskId, action, paths, giveUp(extra))) ? "allowed" : "refused"),
  );
  server.registerTool(
    "report_file",
    {
      description: "Report each file you made, changed or deleted, so the user sees it in the task.",
      inputSchema: { path: absolute, kind: z.enum(["add", "update", "delete"]) },
    },
    async ({ path, kind }) => {
      await handler.reportFile(taskId, { path, kind });
      return text("noted");
    },
  );
  server.registerTool(
    "submit_review",
    {
      description:
        "At the end, check the work against the brief: what the user asked and whether it's done, what you decided on your own, and what the user should check themselves.",
      inputSchema: {
        asked: z.array(item).max(20),
        decided: z.array(item).max(20),
        check_yourself: z.array(item).max(20),
      },
    },
    async ({ asked, decided, check_yourself }) => {
      await handler.review(taskId, { asked, decided, checkYourself: check_yourself });
      return text("noted");
    },
  );
  return server;
}

/** The largest request body the server reads. Tool calls are small; this only stops a runaway client. */
const MAX_BODY = 4 * 1024 * 1024;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("Request too large"));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Tost Work's tools for agents, as an MCP server over HTTP on 127.0.0.1. Each agent session gets its own bearer token,
 * which says which task a call belongs to, so no environment variables are needed. A session keeps one MCP server and
 * transport for its whole life, so a cancel sent on a later request reaches the call it cancels.
 * shortcut: ask_user and request_approval hold the HTTP request until the user answers, so the agent's MCP tool
 * timeout must be long; the engine sets it when it attaches the server.
 */
export class ToolServer {
  private http: Server | null = null;
  private port = 0;
  private sessions = new Map<string, Session>();

  constructor(private handler: ToolHandler) {}

  async start(): Promise<void> {
    // A second listener would be left open when stop() closes the one it knows about.
    if (this.http) throw new Error("The tool server is already running");
    const http = createServer((req, res) => void this.serve(req, res));
    await new Promise<void>((resolve, reject) => {
      http.once("error", reject);
      http.listen(0, "127.0.0.1", () => resolve());
    });
    this.http = http;
    this.port = (http.address() as AddressInfo).port;
  }

  /** A URL and token for one agent session of a task. Close it when the session ends. */
  open(taskId: string): { url: string; token: string } {
    if (!this.http) throw new Error("The tool server isn't running");
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(token, { taskId, open: new Map() });
    return { url: `http://127.0.0.1:${this.port}/mcp`, token };
  }

  close(token: string): void {
    const session = this.sessions.get(token);
    this.sessions.delete(token);
    if (!session) return;
    for (const controller of session.open.values()) controller.abort();
    void session.mcp?.transport.close();
    void session.mcp?.server.close();
  }

  async stop(): Promise<void> {
    for (const token of [...this.sessions.keys()]) this.close(token);
    const http = this.http;
    this.http = null;
    if (!http) return;
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }

  private async serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const deny = (status: number, message: string) => {
      if (!res.headersSent) res.writeHead(status, { "content-type": "text/plain" }).end(message);
    };
    // A web page can't reach the server: browsers send an Origin, and a rebound DNS name fails the Host check.
    const host = req.headers.host ?? "";
    if (req.headers.origin || (host !== `127.0.0.1:${this.port}` && host !== `localhost:${this.port}`))
      return deny(403, "Forbidden");
    // Node accepts targets such as "//", which URL can't parse; those get a 404 rather than an unhandled error.
    let pathname = "";
    try {
      pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    } catch {
      return deny(404, "Not found");
    }
    if (pathname !== "/mcp") return deny(404, "Not found");
    const auth = req.headers.authorization ?? "";
    const session = auth.startsWith("Bearer ") ? this.sessions.get(auth.slice(7)) : undefined;
    if (!session) return deny(401, "Unauthorized");

    try {
      let body: unknown;
      const calls: [string | number, AbortController][] = [];
      if (req.method === "POST") {
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          return deny(400, "Bad request");
        }
        // The tool calls this request carries: if its connection closes before they're answered, the agent is gone.
        for (const message of Array.isArray(body) ? body : [body]) {
          const m = message as { method?: unknown; id?: unknown };
          if (m?.method === "tools/call" && (typeof m.id === "string" || typeof m.id === "number")) {
            const controller = new AbortController();
            session.open.set(m.id, controller);
            calls.push([m.id, controller]);
          }
        }
      }
      res.on("close", () => {
        for (const [id, controller] of calls) {
          controller.abort();
          // Only this request's controller: a later call may reuse the id.
          if (session.open.get(id) === controller) session.open.delete(id);
        }
      });
      if (!session.mcp) {
        const server = toolsFor(session, this.handler);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
        await server.connect(transport);
        session.mcp = { server, transport };
      }
      await session.mcp.transport.handleRequest(req, res, body);
    } catch (err) {
      deny(500, err instanceof Error ? err.message : "Internal error");
    }
  }
}
