/** Newsletters and lists, grouped by sender from List-Unsubscribe headers. Electron-free. */

export interface SubscriptionMessage {
  from: string;
  fromEmail: string;
  /** Raw List-Unsubscribe header ("<mailto:…>, <https://…>"), or "". */
  listUnsubscribe: string;
  /** Raw List-Unsubscribe-Post header, or "". */
  listUnsubscribePost: string;
  unread: boolean;
  date: number;
}

export interface UnsubscribeMethod {
  /** RFC 8058: an HTTPS POST unsubscribes without a page or an email. */
  oneClick?: string;
  mailto?: string;
  /** A web page the user finishes in their browser. */
  url?: string;
}

export interface Subscription {
  name: string;
  email: string;
  count: number;
  opened: number;
  lastAt: number;
  unsubscribe: UnsubscribeMethod;
}

export function parseListUnsubscribe(header: string, post: string): UnsubscribeMethod {
  const targets = [...header.matchAll(/<([^<>]+)>/g)].map((match) => match[1].trim());
  const mailto = targets.find((target) => /^mailto:/i.test(target));
  const https = targets.find((target) => /^https:\/\//i.test(target));
  const oneClick = /List-Unsubscribe=One-Click/i.test(post) && https ? https : undefined;
  return {
    ...(oneClick ? { oneClick } : {}),
    ...(mailto ? { mailto } : {}),
    ...(https && !oneClick ? { url: https } : {}),
  };
}

/** Senders with an unsubscribe method, most mail first. */
export function groupSubscriptions(messages: SubscriptionMessage[]): Subscription[] {
  const groups = new Map<string, Subscription>();
  for (const message of [...messages].sort((a, b) => b.date - a.date)) {
    const method = parseListUnsubscribe(message.listUnsubscribe, message.listUnsubscribePost);
    if (!method.oneClick && !method.mailto && !method.url) continue;
    const email = message.fromEmail.toLowerCase();
    const group = groups.get(email);
    if (group) {
      group.count += 1;
      if (!message.unread) group.opened += 1;
    } else {
      groups.set(email, {
        name: message.from || email,
        email,
        count: 1,
        opened: message.unread ? 0 : 1,
        lastAt: message.date,
        unsubscribe: method,
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
}

const PRIVATE_HOST =
  /^(localhost|.*\.local|.*\.internal|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0|\[?::1\]?|\[?f[cd][0-9a-f]{2}:.*)$/i;

/** One-click targets must be public HTTPS, so a header can't make DayBoard post to this Mac's network. */
export function safeOneClickUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (PRIVATE_HOST.test(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

/** "mailto:list@x.com?subject=unsubscribe&body=…" → recipient, subject and body to send. */
export function parseMailto(value: string): { to: string; subject: string; body: string } | null {
  const match = /^mailto:([^?]+)(?:\?(.*))?$/i.exec(value.trim());
  if (!match) return null;
  const params = new URLSearchParams(match[2] ?? "");
  let to: string;
  try {
    to = decodeURIComponent(match[1]).trim();
  } catch {
    return null;
  }
  if (!/^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/.test(to)) return null;
  return {
    to,
    subject: (params.get("subject") ?? "unsubscribe").slice(0, 200) || "unsubscribe",
    body: (params.get("body") ?? "unsubscribe").slice(0, 2000) || "unsubscribe",
  };
}
