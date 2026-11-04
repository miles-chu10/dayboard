/** Composing raw RFC 5322 messages for Gmail's send and draft endpoints. Electron-free. */

export const MAX_RECIPIENTS = 50;
export const MAX_BODY = 200_000;
const MAX_SUBJECT = 900;

const ADDRESS = /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]+$/;

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function encodeHeaderValue(value: string): string {
  const clean = oneLine(value);
  return /^[\x20-\x7e]*$/.test(clean)
    ? clean
    : `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

/**
 * Splits "a@x.com, Sam <s@y.com>" into header-safe recipients, or throws naming the bad one.
 * Display names keep only printable characters; addresses must look like user@domain.tld.
 */
export function parseRecipients(value: string, field: string): string[] {
  const parts = value
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length > MAX_RECIPIENTS)
    throw new Error(`${field}: at most ${MAX_RECIPIENTS} recipients`);
  return parts.map((part) => {
    const named = part.match(/^(.*?)<([^<>]+)>$/);
    const address = (named ? named[2] : part).trim();
    if (!ADDRESS.test(address)) throw new Error(`${field}: “${part}” isn't an email address`);
    const name = named ? named[1].replace(/["\\]/g, "").trim() : "";
    if (!name) return address;
    // ASCII names are quoted; others become an encoded word, which must not sit inside quotes.
    const display = /^[\x20-\x7e]*$/.test(name) ? `"${name}"` : encodeHeaderValue(name);
    return `${display} <${address}>`;
  });
}

export interface ComposedMessage {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}

/** base64url of a plain-text UTF-8 message, ready for `raw`. */
export function buildRawMessage(message: ComposedMessage): string {
  if (!message.to.length) throw new Error("Add at least one recipient");
  if (message.body.length > MAX_BODY) throw new Error("The message is too long to send");
  const lines = [
    `To: ${message.to.join(", ")}`,
    ...(message.cc?.length ? [`Cc: ${message.cc.join(", ")}`] : []),
    `Subject: ${encodeHeaderValue(message.subject.slice(0, MAX_SUBJECT))}`,
    ...(message.inReplyTo
      ? [
          `In-Reply-To: ${oneLine(message.inReplyTo)}`,
          `References: ${oneLine(message.references || message.inReplyTo)}`,
        ]
      : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    message.body.replace(/\r?\n/g, "\r\n"),
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

export function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;
}
