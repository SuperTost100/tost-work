import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { MAX_QUESTIONS, type Review } from "../../shared/model";

/** The answer to Codex's hook before one step: run it, or refuse it with the reason the agent reads. */
export type HookAnswer = { decision: "allow" } | { decision: "deny"; reason: string };

/** What the tools do for a task. The engine that runs the task implements it. */
export interface ToolHandler {
  /** Puts the question on the task and resolves at once with what the agent does next: end its turn and wait. */
  ask(taskId: string, questions: { text: string; options: string[] }[]): Promise<string>;
  /** Puts the approval on the task and resolves at once, like `ask`. */
  approve(taskId: string, action: "overwrite" | "delete", paths: string[]): Promise<string>;
  reportFile(taskId: string, change: { path: string; kind: "add" | "update" | "delete" }): Promise<void>;
  /** Makes a PDF of a Word, Excel or PowerPoint file and resolves with what to tell the agent. */
  makePdf(taskId: string, path: string): Promise<string>;
  review(taskId: string, review: Review): Promise<void>;
  /** Decides one step Codex is about to take, sent by its hook as Codex's own JSON. May wait for the user. */
  gate(taskId: string, step: unknown): Promise<HookAnswer>;
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

/** One agent session: its task, and the MCP server and transport that live as long as it. */
interface Session {
  taskId: string;
  mcp?: { server: McpServer; transport: StreamableHTTPServerTransport };
}

function toolsFor(session: Session, handler: ToolHandler): McpServer {
  const { taskId } = session;
  const server = new McpServer({ name: "tost-work", version: "0.0.1" });
  server.registerTool(
    "ask_user",
    {
      description:
        "Ask the user every question you need answered now, up to 16. Give a question 2 to 4 short options, each a complete answer on its own, or none when the answer needs the user's own words. Then end your turn: the answers arrive together as your next message.",

      inputSchema: {
        questions: z
          .array(
            z.object({
              question: z.string().min(1).max(500),
              // No options makes an open question, answered only in the user's own words.
              options: z
                .array(z.string().min(1).max(120))
                .max(4)
                .refine((o) => o.length !== 1, { message: "Give 2 to 4 options, or none" })
                .optional(),
            }),
          )
          .min(1)
          .max(MAX_QUESTIONS),
      },
    },
    async ({ questions }) =>
      text(
        await handler.ask(
          taskId,
          questions.map((q) => ({ text: q.question, options: q.options ?? [] })),
        ),
      ),
  );
  server.registerTool(
    "request_approval",
    {
      description:
        "Ask before replacing or deleting existing files. Then end your turn: the decision arrives as your next message.",
      inputSchema: { action: z.enum(["overwrite", "delete"]), paths: z.array(absolute).min(1).max(50) },
    },
    async ({ action, paths }) => text(await handler.approve(taskId, action, paths)),
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
    "make_pdf",
    {
      description:
        "Make a PDF of a Word, Excel or PowerPoint file in the task's folder. Tost Work saves it next to the file, with the same name, adds it to the task and returns its path.",
      inputSchema: { path: absolute },
    },
    async ({ path }) => text(await handler.makePdf(taskId, path)),
  );
  server.registerTool(
    "submit_review",
    {
      description:
        "At the end, check the work against the brief: `asked` is what the user asked and whether it's done, `decided` what you decided on your own, `check_yourself` what the user should check themselves.",
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
 * which says which task a call belongs to. A session keeps one MCP server and transport for its whole life. Every tool
 * returns at once: nothing holds a request open waiting for the user.
 *
 * Codex's hook asks at /hook, with the same token, before each step Codex takes. That request does wait, as long as a
 * card is open, and its answer is always 200 with the decision as JSON: any other answer makes the hook refuse.
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
    this.sessions.set(token, { taskId });
    return { url: `http://127.0.0.1:${this.port}/mcp`, token };
  }

  close(token: string): void {
    const session = this.sessions.get(token);
    this.sessions.delete(token);
    if (!session) return;
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
    if (pathname !== "/mcp" && pathname !== "/hook") return deny(404, "Not found");
    const auth = req.headers.authorization ?? "";
    const session = auth.startsWith("Bearer ") ? this.sessions.get(auth.slice(7)) : undefined;
    if (!session) return deny(401, "Unauthorized");
    if (pathname === "/hook") return this.hook(session, req, res);

    try {
      let body: unknown;
      if (req.method === "POST") {
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          return deny(400, "Bad request");
        }
      }
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

  private async hook(session: Session, req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "text/plain" }).end("Method not allowed");
      return;
    }
    let answer: HookAnswer;
    try {
      answer = await this.handler.gate(session.taskId, JSON.parse(await readBody(req)));
    } catch (err) {
      answer = {
        decision: "deny",
        reason: `Tost Work couldn't check this step: ${err instanceof Error ? err.message : err}`,
      };
    }
    // The hook may have gone meanwhile, as when Codex stopped the turn: the step can't run without its answer.
    if (!res.destroyed) res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(answer));
  }
}
