import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { ipcMain, logger } from "@glaze/core/backend";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  createEvent,
  createReplyDraft,
  createTask,
  getMessageBody,
  listCompletedTasks,
  listEvents,
  listEventsBetween,
  listInbox,
  listTasks,
  modifyMessage,
  setTaskCompleted,
} from "./google-api.js";
import { GoogleAuthError } from "./google-auth.js";
import {
  createReminder,
  getRemindersAccess,
  listCompletedReminders,
  listReminders,
  setReminderCompleted,
} from "./apple-reminders.js";
import { getSettings } from "./settings-store.js";
import type { DataChangedEvent, SourceId } from "../shared-types.js";

// Local MCP endpoint so MCP clients (Claude Code, Codex, …) can use the dashboard's
// sources through the app's own Google sign-in and Reminders access. Works only while
// the app is running.

const MAX_LIST = 100;
const MAX_BODY_CHARS = 20_000;
const WEEK_MS = 7 * 86_400_000;

const SOURCE_NAMES: Record<SourceId, string> = {
  tasks: "Google Tasks",
  reminders: "Apple Reminders",
  mail: "Gmail",
  calendar: "Google Calendar",
};

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("Date as YYYY-MM-DD");
const time = z
  .string()
  .regex(/^\d{2}:\d{2}$/)
  .describe("24-hour time as HH:mm");

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function text(value: unknown): ToolResult {
  return {
    content: [
      { type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) },
    ],
  };
}

function failure(message: string): ToolResult {
  return { ...text(message), isError: true };
}

class SourceUnavailable extends Error {}

async function ensureSource(source: SourceId): Promise<void> {
  const settings = await getSettings();
  if (!settings.sources[source].enabled) {
    throw new SourceUnavailable(
      `${SOURCE_NAMES[source]} is turned off in Work Dashboard settings.`,
    );
  }
  if (source === "reminders") {
    const access = await getRemindersAccess();
    if (access !== "full-access") {
      throw new SourceUnavailable(
        "Work Dashboard doesn't have Reminders access. Grant it from the app's Settings.",
      );
    }
  }
}

function notifyChanged(source: SourceId): void {
  const event: DataChangedEvent = { source };
  ipcMain.broadcast("data:changed", event);
}

/** Runs a tool body for one source, turning setup/auth problems into readable tool errors. */
function run<A>(source: SourceId, body: (args: A) => Promise<ToolResult>) {
  return async (args: A): Promise<ToolResult> => {
    try {
      await ensureSource(source);
      return await body(args);
    } catch (error) {
      if (error instanceof SourceUnavailable) return failure(error.message);
      if (error instanceof GoogleAuthError) {
        return failure(
          error.reason === "needs-setup"
            ? "Google isn't set up in Work Dashboard. Add the Google account in the app's Settings."
            : "Work Dashboard's Google account isn't connected. Reconnect it in the app's Settings.",
        );
      }
      logger.error("mcp", `${source} tool failed`, error);
      return failure(error instanceof Error ? error.message : String(error));
    }
  };
}

function capped<T>(items: T[], label: string) {
  return { total: items.length, [label]: items.slice(0, MAX_LIST) };
}

function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "work-dashboard", version: "1.0.0" });

  // ── Google Tasks ──────────────────────────────────────────────────────
  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description: `List open Google Tasks across all task lists (up to ${MAX_LIST}), with list, due date, and notes.`,
      inputSchema: {},
    },
    run("tasks", async () => text(capped(await listTasks(), "tasks"))),
  );

  server.registerTool(
    "create_task",
    {
      title: "Create task",
      description: "Add a task to the default Google Tasks list.",
      inputSchema: { title: z.string().min(1), notes: z.string().optional(), due: date.optional() },
    },
    run("tasks", async ({ title, notes, due }: { title: string; notes?: string; due?: string }) => {
      await createTask({ title, notes, due });
      notifyChanged("tasks");
      return text(`Created task "${title}".`);
    }),
  );

  server.registerTool(
    "complete_task",
    {
      title: "Complete task",
      description:
        "Mark a Google Task done (or reopen it with completed=false). IDs come from list_tasks.",
      inputSchema: {
        list_id: z.string().min(1),
        task_id: z.string().min(1),
        completed: z.boolean().default(true),
      },
    },
    run(
      "tasks",
      async ({
        list_id,
        task_id,
        completed,
      }: {
        list_id: string;
        task_id: string;
        completed: boolean;
      }) => {
        await setTaskCompleted(list_id, task_id, completed);
        notifyChanged("tasks");
        return text(completed ? "Task marked done." : "Task reopened.");
      },
    ),
  );

  // ── Apple Reminders ───────────────────────────────────────────────────
  server.registerTool(
    "list_reminders",
    {
      title: "List reminders",
      description: `List open Apple Reminders (up to ${MAX_LIST}) with list, due date/time, and priority.`,
      inputSchema: {},
    },
    run("reminders", async () => text(capped(await listReminders(), "reminders"))),
  );

  server.registerTool(
    "create_reminder",
    {
      title: "Create reminder",
      description: "Add an Apple Reminder to the default list. due_time requires due_date.",
      inputSchema: {
        title: z.string().min(1),
        notes: z.string().optional(),
        due_date: date.optional(),
        due_time: time.optional(),
      },
    },
    run(
      "reminders",
      async (args: { title: string; notes?: string; due_date?: string; due_time?: string }) => {
        if (args.due_time && !args.due_date) return failure("due_time needs a due_date.");
        await createReminder({
          title: args.title,
          notes: args.notes,
          dueDate: args.due_date,
          dueTime: args.due_time,
        });
        notifyChanged("reminders");
        return text(`Created reminder "${args.title}".`);
      },
    ),
  );

  server.registerTool(
    "complete_reminder",
    {
      title: "Complete reminder",
      description:
        "Mark an Apple Reminder done (or reopen it with completed=false). The ref comes from list_reminders.",
      inputSchema: { ref: z.string().min(1), completed: z.boolean().default(true) },
    },
    run("reminders", async ({ ref, completed }: { ref: string; completed: boolean }) => {
      await setReminderCompleted(ref, completed);
      notifyChanged("reminders");
      return text(completed ? "Reminder marked done." : "Reminder reopened.");
    }),
  );

  // ── Gmail ─────────────────────────────────────────────────────────────
  server.registerTool(
    "list_inbox",
    {
      title: "List inbox",
      description:
        "List the newest Gmail inbox messages with sender, subject, snippet, and unread state.",
      inputSchema: {
        max: z
          .number()
          .int()
          .min(1)
          .max(MAX_LIST)
          .optional()
          .describe("Defaults to the app's inbox size"),
      },
    },
    run("mail", async ({ max }: { max?: number }) => {
      const limit = max ?? (await getSettings()).mail.maxMessages;
      return text({ messages: await listInbox(Math.min(limit, MAX_LIST)) });
    }),
  );

  server.registerTool(
    "read_email",
    {
      title: "Read email",
      description: "Get the plain-text body of a Gmail message. The id comes from list_inbox.",
      inputSchema: { id: z.string().min(1) },
    },
    run("mail", async ({ id }: { id: string }) => {
      const body = await getMessageBody(id);
      return text(
        body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS)}\n\n[truncated]` : body,
      );
    }),
  );

  server.registerTool(
    "draft_email_reply",
    {
      title: "Draft email reply",
      description:
        "Save a reply to a Gmail message as a draft in the same thread. Nothing is sent.",
      inputSchema: { id: z.string().min(1), body: z.string().min(1) },
    },
    run("mail", async ({ id, body }: { id: string; body: string }) => {
      const { draftId } = await createReplyDraft(id, body);
      return text(`Saved reply draft ${draftId} in Gmail.`);
    }),
  );

  server.registerTool(
    "archive_email",
    {
      title: "Archive email",
      description: "Remove a Gmail message from the inbox (it stays in All Mail).",
      inputSchema: { id: z.string().min(1) },
    },
    run("mail", async ({ id }: { id: string }) => {
      await modifyMessage(id, ["INBOX"]);
      notifyChanged("mail");
      return text("Message archived.");
    }),
  );

  server.registerTool(
    "mark_email_read",
    {
      title: "Mark email read",
      description: "Mark a Gmail message as read.",
      inputSchema: { id: z.string().min(1) },
    },
    run("mail", async ({ id }: { id: string }) => {
      await modifyMessage(id, ["UNREAD"]);
      notifyChanged("mail");
      return text("Message marked read.");
    }),
  );

  // ── Google Calendar ───────────────────────────────────────────────────
  server.registerTool(
    "list_events",
    {
      title: "List events",
      description: `List upcoming Google Calendar events from the calendars shown in the app (up to ${MAX_LIST}).`,
      inputSchema: {
        days_ahead: z
          .number()
          .int()
          .min(1)
          .max(60)
          .optional()
          .describe("Defaults to the app's calendar range"),
      },
    },
    run("calendar", async ({ days_ahead }: { days_ahead?: number }) => {
      const settings = await getSettings();
      const events = await listEvents(
        days_ahead ?? settings.calendar.daysAhead,
        settings.calendar.visibility,
      );
      return text(capped(events, "events"));
    }),
  );

  server.registerTool(
    "create_event",
    {
      title: "Create event",
      description:
        "Add an event to the primary Google Calendar. Omit start_time for an all-day event.",
      inputSchema: {
        title: z.string().min(1),
        date,
        start_time: time.optional(),
        end_time: time.optional(),
        time_zone: z.string().optional().describe("IANA zone; defaults to this Mac's time zone"),
        notes: z.string().optional(),
      },
    },
    run(
      "calendar",
      async (args: {
        title: string;
        date: string;
        start_time?: string;
        end_time?: string;
        time_zone?: string;
        notes?: string;
      }) => {
        await createEvent({
          title: args.title,
          date: args.date,
          startTime: args.start_time,
          endTime: args.end_time,
          timeZone: args.time_zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
          notes: args.notes,
        });
        notifyChanged("calendar");
        return text(`Created event "${args.title}" on ${args.date}.`);
      },
    ),
  );

  // ── Weekly review ─────────────────────────────────────────────────────
  server.registerTool(
    "get_weekly_review",
    {
      title: "Weekly review",
      description: `Everything finished in the past 7 days: completed tasks, completed reminders, and past events (up to ${MAX_LIST} each). Turned-off or disconnected sources are noted.`,
      inputSchema: {},
    },
    async () => {
      const since = new Date(Date.now() - WEEK_MS);
      const section = async <T>(source: SourceId, load: () => Promise<T[]>) => {
        const result = await run(source, async () => text(capped(await load(), "items")))({});
        return result.isError
          ? { unavailable: result.content[0]?.text }
          : JSON.parse(result.content[0]?.text ?? "{}");
      };
      const visibility = (await getSettings()).calendar.visibility;
      const [tasks, reminders, events] = await Promise.all([
        section("tasks", () => listCompletedTasks(since)),
        section("reminders", () => listCompletedReminders(since)),
        section("calendar", () => listEventsBetween(since, new Date(), visibility)),
      ]);
      return text({
        since: since.toISOString(),
        completedTasks: tasks,
        completedReminders: reminders,
        events,
      });
    },
  );

  return server;
}

export function stableMcpPort(projectId: string): number {
  let hash = 0;
  for (const char of projectId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return 49152 + (hash % 16000);
}

export function startMcpHttpServer(projectId: string): void {
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const port = stableMcpPort(projectId);

  const httpServer = createServer(async (request, response) => {
    try {
      const { pathname } = new URL(request.url ?? "", "http://127.0.0.1");
      if (pathname !== "/mcp") {
        response.writeHead(404).end();
        return;
      }

      const sessionHeader = request.headers["mcp-session-id"];
      const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
      let transport = sessionId ? transports.get(sessionId) : undefined;

      if (request.method === "POST") {
        let body = "";
        for await (const chunk of request) body += chunk;
        const parsedBody: unknown = JSON.parse(body);

        if (!transport && isInitializeRequest(parsedBody)) {
          const newTransport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (newSessionId: string): void => {
              transports.set(newSessionId, newTransport);
            },
          });
          newTransport.onclose = () => {
            if (newTransport.sessionId) transports.delete(newTransport.sessionId);
          };
          await buildMcpServer().connect(newTransport);
          transport = newTransport;
        }
        if (!transport) {
          response.writeHead(400).end("Unknown or missing MCP session");
          return;
        }
        await transport.handleRequest(request, response, parsedBody);
        return;
      }

      if (request.method === "GET" || request.method === "DELETE") {
        if (!transport) {
          response.writeHead(400).end("Unknown or missing MCP session");
          return;
        }
        await transport.handleRequest(request, response);
        return;
      }

      response.writeHead(405, { Allow: "GET, POST, DELETE" }).end();
    } catch (error) {
      logger.error("mcp", "MCP request failed", { error: String(error) });
      if (!response.headersSent) response.writeHead(500).end();
    }
  });

  httpServer.once("error", (error) => {
    logger.warn("mcp", "MCP HTTP server failed to start", { port, error: String(error) });
  });
  httpServer.listen(port, "127.0.0.1", () => {
    logger.info("mcp", "MCP server listening", { url: `http://127.0.0.1:${port}/mcp` });
  });
}
