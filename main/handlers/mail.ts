// Sending mail through a held outbox (so Undo can stop it), and snoozes and follow-ups.

import * as path from "node:path";

import { app, ipcMain, logger } from "../platform/index.js";
import { assertNotDemo, isDemoMode } from "../services/demo-data.js";
import { readFileIfExists, writeFileAtomic } from "../services/file-store.js";
import {
  getReplyContext,
  modifyMessage,
  sendRawMessage,
  threadHasReplyAfter,
} from "../services/google-api.js";
import {
  MAX_BODY,
  buildRawMessage,
  parseRecipients,
  replySubject,
} from "../services/mail-compose.js";
import { createOutbox } from "../services/mail-outbox.js";
import {
  createMailSchedule,
  type MailScheduleEntry,
  type MailScheduleKind,
} from "../services/mail-schedule.js";
import { trackPendingWrite } from "../services/pending-writes.js";
import { getSettings } from "../services/settings-store.js";
import type { MailSendRequest, MailSendResult, MailSendTicket } from "../shared-types.js";
import { getAccountsStatus, onAccountsChanged, requireAgendaScope } from "./productivity.js";

const DAY = 24 * 60 * 60 * 1000;

function object(value: unknown, channel: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${channel}: expected an object payload`);
  return value as Record<string, unknown>;
}

function text(input: Record<string, unknown>, key: string, channel: string, max: number): string {
  const value = input[key] ?? "";
  if (typeof value !== "string") throw new Error(`${channel}: "${key}" must be text`);
  if (value.length > max) throw new Error(`${channel}: "${key}" is too long`);
  return value;
}

function required(input: Record<string, unknown>, key: string, channel: string, max = 200) {
  const value = text(input, key, channel, max).trim();
  if (!value) throw new Error(`${channel}: "${key}" is required`);
  return value;
}

/** Validates the renderer's request; recipients are checked now so mistakes fail before Undo. */
export function parseSendRequest(payload: unknown): MailSendRequest {
  const channel = "mail:send";
  const input = object(payload, channel);
  const body = text(input, "body", channel, MAX_BODY);
  if (!body.trim()) throw new Error("Write a message first");
  const cc = text(input, "cc", channel, 5000);
  if (cc) parseRecipients(cc, "Cc");
  if (input.kind === "reply") {
    const id = text(input, "id", channel, 200);
    if (!id) throw new Error(`${channel}: "id" is required`);
    return { kind: "reply", id, body, ...(cc ? { cc } : {}) };
  }
  if (input.kind !== "new") throw new Error(`${channel}: "kind" must be "reply" or "new"`);
  const to = text(input, "to", channel, 5000);
  if (!parseRecipients(to, "To").length) throw new Error("Add at least one recipient");
  const subject = text(input, "subject", channel, 900);
  return { kind: "new", to, subject, body, ...(cc ? { cc } : {}) };
}

async function send(request: MailSendRequest): Promise<void> {
  const cc = request.cc ? parseRecipients(request.cc, "Cc") : undefined;
  if (request.kind === "new") {
    await sendRawMessage(
      buildRawMessage({
        to: parseRecipients(request.to, "To"),
        cc,
        subject: request.subject,
        body: request.body,
      }),
    );
    return;
  }
  const context = await getReplyContext(request.id);
  await sendRawMessage(
    buildRawMessage({
      to: [context.to],
      cc,
      subject: replySubject(context.subject),
      body: request.body,
      inReplyTo: context.messageId || undefined,
      references: context.references || undefined,
    }),
    context.threadId,
  );
}

const outbox = createOutbox<MailSendRequest>({
  send: (request) => trackPendingWrite(() => send(request)),
  onResult: (id, result) => {
    if (!result.ok) logger.error("mail", "mail:send failed", result.error);
    else ipcMain.broadcast("data:changed", { source: "mail" });
    ipcMain.broadcast("mail:sendResult", {
      id,
      ...result,
    } satisfies MailSendResult);
  },
});

const dueListeners = new Set<(entry: MailScheduleEntry) => void>();

/** Notifications subscribe here: a snoozed email came back, or nobody replied in time. */
export function onMailDue(listener: (entry: MailScheduleEntry) => void): () => void {
  dueListeners.add(listener);
  return () => dueListeners.delete(listener);
}

const scheduleFile = () =>
  path.join(
    app.getPath("userData"),
    isDemoMode() ? "demo-mail-schedule.json" : "mail-schedule.json",
  );

export const mailSchedule = createMailSchedule({
  read: async () => (await readFileIfExists(scheduleFile()))?.toString("utf8") ?? null,
  write: (contents) => writeFileAtomic(scheduleFile(), contents),
  scope: requireAgendaScope,
  now: () => Date.now(),
  unsnooze: (entry) =>
    trackPendingWrite(() => modifyMessage(entry.messageId, [], ["INBOX", "UNREAD"])),
  hasReply: async (entry) =>
    threadHasReplyAfter(
      entry.threadId,
      entry.createdAt,
      (await getAccountsStatus()).google.email ?? null,
    ),
  onChange: () => {
    ipcMain.broadcast("mail:scheduleChanged", {});
    ipcMain.broadcast("data:changed", { source: "mail" });
  },
  onDue: (entry) => {
    for (const listener of dueListeners) listener(entry);
  },
});

/** Sends every email still in its undo window; quitting runs this before the app exits. */
export async function drainMailOutbox(): Promise<void> {
  await outbox.drain();
  await mailSchedule.drain();
}

function scheduleEntry(
  input: Record<string, unknown>,
  channel: string,
  kind: MailScheduleKind,
  dueAt: number,
): MailScheduleEntry {
  return {
    kind,
    messageId: required(input, "messageId", channel),
    threadId: required(input, "threadId", channel),
    subject: text(input, "subject", channel, 1000).slice(0, 300),
    from: text(input, "from", channel, 500).slice(0, 200),
    fromEmail: text(input, "fromEmail", channel, 320),
    createdAt: Date.now(),
    dueAt,
  };
}

export function registerMailHandlers(): void {
  ipcMain.handle("mail:send", async (_event, payload: unknown): Promise<MailSendTicket> => {
    assertNotDemo("mail:send");
    const request = parseSendRequest(payload);
    const delay = (await getSettings()).mail.undoSendSeconds * 1000;
    const ticket = outbox.queue(request, delay);
    if (ticket.sent) {
      const result = await ticket.sent;
      if (!result.ok) throw new Error(result.error);
    }
    return { id: ticket.id, sendAt: ticket.sendAt, held: !ticket.sent };
  });

  ipcMain.handle("mail:cancelSend", (_event, payload: unknown) => {
    const id = text(object(payload, "mail:cancelSend"), "id", "mail:cancelSend", 100);
    return { cancelled: outbox.cancel(id) };
  });

  ipcMain.handle("mail:schedule", () => mailSchedule.list());

  ipcMain.handle("mail:snooze", async (_event, payload: unknown) => {
    const channel = "mail:snooze";
    assertNotDemo(channel);
    const input = object(payload, channel);
    const until = input.until;
    const now = Date.now();
    if (typeof until !== "number" || !Number.isFinite(until) || until < now + 60_000)
      throw new Error(`${channel}: pick a time in the future`);
    if (until > now + 366 * DAY) throw new Error(`${channel}: snooze for at most a year`);
    const entry = scheduleEntry(input, channel, "snooze", until);
    // Archive first: if that fails, nothing is recorded and the email stays where it was.
    await trackPendingWrite(() => modifyMessage(entry.messageId, ["INBOX"]));
    await mailSchedule.add(entry);
    return entry;
  });

  ipcMain.handle("mail:unsnooze", async (_event, payload: unknown) => {
    const channel = "mail:unsnooze";
    assertNotDemo(channel);
    const messageId = required(object(payload, channel), "messageId", channel);
    await trackPendingWrite(() => modifyMessage(messageId, [], ["INBOX"]));
    return { removed: Boolean(await mailSchedule.remove("snooze", messageId)) };
  });

  ipcMain.handle("mail:followUp", async (_event, payload: unknown) => {
    const channel = "mail:followUp";
    const input = object(payload, channel);
    const days = input.days;
    if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 30)
      throw new Error(`${channel}: "days" must be 1 to 30`);
    const entry = scheduleEntry(input, channel, "follow-up", Date.now() + days * DAY);
    await mailSchedule.add(entry);
    return entry;
  });

  ipcMain.handle("mail:cancelFollowUp", async (_event, payload: unknown) => {
    const channel = "mail:cancelFollowUp";
    const messageId = required(object(payload, channel), "messageId", channel);
    return {
      removed: Boolean(await mailSchedule.remove("follow-up", messageId)),
    };
  });

  onAccountsChanged(() => void mailSchedule.reload().catch(() => undefined));
  // Demo data never reaches Gmail, so its follow-ups are kept but never checked.
  if (!isDemoMode())
    void mailSchedule.start().catch((error) => logger.warn("mail", "schedule check failed", error));
}
